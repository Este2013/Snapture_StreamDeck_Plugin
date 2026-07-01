import streamDeck, { action, SingletonAction } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import type {
    KeyDownEvent,
    WillAppearEvent,
    WillDisappearEvent,
    SendToPluginEvent,
    TitleParametersDidChangeEvent,
} from "@elgato/streamdeck";
import { snapture, versionAtLeast } from "./snapture";

/** Minimum Snapture version exposing the plugin's control commands. */
const MIN_VERSION = "1.1.0";

type Kind = "image" | "video";

interface CaptureSettings extends JsonObject {
    /** picker | display | window | repeat | library */
    choice?: string;
    /** default | display | window | custom (for the picker choice) */
    pickerMode?: string;
    display?: string; // display id (device name)
    window?: string; // window handle (string)
    windowTitle?: string; // resolved fallback
    format?: string; // per-shot format override
}

interface OpenLastSettings extends JsonObject {
    filter?: string; // any | image | video
}

// ---- shared helpers -------------------------------------------------------

async function safeRequest(command: string, args?: Record<string, unknown>) {
    try {
        return await snapture.request(command, args);
    } catch {
        return null;
    }
}

/** Verify Snapture is reachable and new enough; give the user visible feedback if not. */
async function ensureReady(a: { showAlert(): Promise<void>; setTitle(t: string): Promise<void> }, restore: () => void): Promise<boolean> {
    if (!snapture.isConnected) {
        streamDeck.logger.warn("Snapture is not running / not reachable.");
        await a.showAlert();
        return false;
    }
    if (!versionAtLeast(snapture.version, MIN_VERSION)) {
        streamDeck.logger.warn(`Snapture ${snapture.version ?? "?"} is older than ${MIN_VERSION}; feature unavailable.`);
        await a.showAlert();
        await a.setTitle(`Update to\nv${MIN_VERSION}`);
        setTimeout(restore, 2500);
        return false;
    }
    return true;
}

function formatElapsed(seconds: number): string {
    const s = Math.max(0, seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n: number) => n.toString().padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

// ---- capture actions (Snapshot / Snapture) --------------------------------

/** Base for the two capture actions; `kind` decides snapshot vs. recording. */
abstract class CaptureAction extends SingletonAction<CaptureSettings> {
    protected abstract readonly kind: Kind;

    override async onKeyDown(ev: KeyDownEvent<CaptureSettings>): Promise<void> {
        const s = ev.payload.settings;
        const restore = () => void ev.action.setTitle(RecordingState.userTitle(ev.action.id) ?? "");
        if (!(await ensureReady(ev.action, restore))) return;

        const cmd = this.kind === "video" ? "start" : "snapshot";
        const format = s.format || undefined;
        let res;

        switch (s.choice) {
            case "library":
                res = await safeRequest("openLibrary", { kind: this.kind });
                break;
            case "display":
                if (!s.display) { await ev.action.showAlert(); return; }
                res = await safeRequest(cmd, { display: s.display, format });
                break;
            case "window":
                if (!s.window && !s.windowTitle) { await ev.action.showAlert(); return; }
                res = await safeRequest(cmd, { window: s.window, windowTitle: s.windowTitle, format });
                break;
            case "repeat":
                res = await safeRequest(cmd, { repeat: true, format });
                break;
            case "picker":
            default:
                res = await safeRequest(cmd, { picker: true, mode: s.pickerMode || "default", format });
                break;
        }

        if (!res || !res.ok) {
            streamDeck.logger.warn(`Snapture command failed: ${res?.error ?? "no response"}`);
            await ev.action.showAlert();
        }
    }

    override onSendToPlugin(ev: SendToPluginEvent<JsonObject, CaptureSettings>): Promise<void> | void {
        return handlePropertyInspectorRequest(ev);
    }
}

@action({ UUID: "com.este.snapture.snapshot" })
export class SnapshotAction extends CaptureAction {
    protected readonly kind: Kind = "image";
}

@action({ UUID: "com.este.snapture.record" })
export class RecordAction extends CaptureAction {
    protected readonly kind: Kind = "video";

    override onWillAppear(ev: WillAppearEvent<CaptureSettings>): void {
        RecordingState.add(ev.action);
    }

    override onWillDisappear(ev: WillDisappearEvent<CaptureSettings>): void {
        RecordingState.remove(ev.action.id);
    }

    override onTitleParametersDidChange(ev: TitleParametersDidChangeEvent<CaptureSettings>): void {
        RecordingState.setUserTitle(ev.action.id, ev.payload.title);
    }
}

@action({ UUID: "com.este.snapture.openlast" })
export class OpenLastAction extends SingletonAction<OpenLastSettings> {
    override async onKeyDown(ev: KeyDownEvent<OpenLastSettings>): Promise<void> {
        const restore = () => void ev.action.setTitle("");
        if (!(await ensureReady(ev.action, restore))) return;

        const res = await safeRequest("openLast", { filter: ev.payload.settings.filter || "any" });
        if (!res || !res.ok) await ev.action.showAlert();
        else await ev.action.showOk();
    }

    override onSendToPlugin(ev: SendToPluginEvent<JsonObject, OpenLastSettings>): Promise<void> | void {
        return handlePropertyInspectorRequest(ev);
    }
}

// ---- Property Inspector data ----------------------------------------------

async function handlePropertyInspectorRequest(ev: SendToPluginEvent<JsonObject, JsonObject>): Promise<void> {
    const req = (ev.payload as { event?: string })?.event;
    if (!req) return;

    if (req === "getDisplays") {
        const r = await safeRequest("getDisplays");
        await streamDeck.ui.sendToPropertyInspector({ event: "displays", items: r?.data?.displays ?? [] });
    } else if (req === "getWindows") {
        const r = await safeRequest("getWindows");
        await streamDeck.ui.sendToPropertyInspector({ event: "windows", items: r?.data?.windows ?? [] });
    } else if (req === "getSettings") {
        const r = await safeRequest("getSettings");
        await streamDeck.ui.sendToPropertyInspector({
            event: "appSettings",
            connected: snapture.isConnected,
            version: snapture.version,
            settings: r?.data ?? null,
        });
    }
}

// ---- recording visuals (red + pulse + timer) ------------------------------

const PULSE_FRAMES = ["imgs/state/rec0.png", "imgs/state/rec1.png", "imgs/state/rec2.png", "imgs/state/rec1.png"];

/** Drives every visible Snapture (video) key while recording. */
class RecordingStateManager {
    private readonly actions = new Map<string, { action: any; userTitle: string }>();
    private pulseTimer: NodeJS.Timeout | null = null;
    private pulseIndex = 0;
    private lastSeconds = 0;
    private recording = false;

    add(action: any): void {
        this.actions.set(action.id, { action, userTitle: this.actions.get(action.id)?.userTitle ?? "" });
        if (this.recording) this.paint(action, this.pulseIndex);
    }

    remove(id: string): void {
        this.actions.delete(id);
    }

    setUserTitle(id: string, title: string): void {
        const entry = this.actions.get(id);
        if (entry) entry.userTitle = title;
        // While recording we own the title, so don't clobber the timer.
        if (!this.recording && entry) void entry.action.setTitle(title);
    }

    userTitle(id: string): string | undefined {
        return this.actions.get(id)?.userTitle;
    }

    onEvent(state: string, seconds?: number): void {
        const nowRecording = state === "recording";
        if (typeof seconds === "number") this.lastSeconds = seconds;

        if (nowRecording && !this.recording) this.startPulse();
        else if (!nowRecording && this.recording) this.stopPulse();

        this.recording = nowRecording;
        if (this.recording) this.updateTimerLabels();
    }

    private startPulse(): void {
        this.pulseIndex = 0;
        this.pulseTimer = setInterval(() => {
            this.pulseIndex = (this.pulseIndex + 1) % PULSE_FRAMES.length;
            for (const { action } of this.actions.values()) this.paint(action, this.pulseIndex);
        }, 450);
    }

    private stopPulse(): void {
        if (this.pulseTimer) { clearInterval(this.pulseTimer); this.pulseTimer = null; }
        for (const { action, userTitle } of this.actions.values()) {
            void action.setImage(); // reset to manifest default
            void action.setTitle(userTitle ?? "");
        }
    }

    private paint(action: any, frame: number): void {
        void action.setImage(PULSE_FRAMES[frame]);
    }

    private updateTimerLabels(): void {
        const label = formatElapsed(this.lastSeconds);
        for (const { action } of this.actions.values()) void action.setTitle(label);
    }
}

const RecordingState = new RecordingStateManager();

// ---- bootstrap ------------------------------------------------------------

streamDeck.logger.setLevel(streamDeck.logger.level);

snapture.on("event", (evt: { event: string; state?: string; data?: any }) => {
    if (evt.event === "stateChanged") RecordingState.onEvent(evt.state ?? "idle");
    else if (evt.event === "elapsed") RecordingState.onEvent(evt.state ?? "recording", evt.data?.seconds);
    else if (evt.event === "recordingCompleted") RecordingState.onEvent("idle");
});
snapture.on("disconnected", () => RecordingState.onEvent("idle"));

streamDeck.actions.registerAction(new SnapshotAction());
streamDeck.actions.registerAction(new RecordAction());
streamDeck.actions.registerAction(new OpenLastAction());

streamDeck.connect();
snapture.start();
