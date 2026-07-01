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
    choice?: string; // picker | display | window | repeat | library
    pickerMode?: string; // default | display | window | custom
    display?: string;
    window?: string;
    windowTitle?: string;
    format?: string;
}

interface OpenLastSettings extends JsonObject {
    filter?: string; // any | image | video
    mode?: string; // reveal | open
}

// ---- shared visible-key registry (for recording visuals + ping) -----------

type KeyType = "snapshot" | "record" | "openlast";
interface VisibleKey {
    action: any;
    type: KeyType;
    title: string;
}
const keys = new Map<string, VisibleKey>();

function registerKey(action: any, type: KeyType): void {
    keys.set(action.id, { action, type, title: keys.get(action.id)?.title ?? "" });
}
function unregisterKey(id: string): void {
    keys.delete(id);
}
function setKeyTitle(id: string, title: string): void {
    const k = keys.get(id);
    if (!k) return;
    k.title = title;
    if (!Recording.active) void k.action.setTitle(title); // don't fight the timer
}

// ---- shared helpers -------------------------------------------------------

async function safeRequest(command: string, args?: Record<string, unknown>) {
    try {
        return await snapture.request(command, args);
    } catch {
        return null;
    }
}

async function ensureReady(a: { showAlert(): Promise<void>; setTitle(t: string): Promise<void>; id: string }): Promise<boolean> {
    if (!snapture.isConnected) {
        streamDeck.logger.warn("Snapture is not running / not reachable.");
        await a.showAlert();
        return false;
    }
    if (!versionAtLeast(snapture.version, MIN_VERSION)) {
        streamDeck.logger.warn(`Snapture ${snapture.version ?? "?"} is older than ${MIN_VERSION}; feature unavailable.`);
        await a.showAlert();
        await a.setTitle(`Update to\nv${MIN_VERSION}`);
        setTimeout(() => void a.setTitle(keys.get(a.id)?.title ?? ""), 2500);
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

abstract class CaptureAction extends SingletonAction<CaptureSettings> {
    protected abstract readonly kind: Kind;
    private get keyType(): KeyType { return this.kind === "video" ? "record" : "snapshot"; }

    override onWillAppear(ev: WillAppearEvent<CaptureSettings>): void {
        registerKey(ev.action, this.keyType);
        if (this.kind === "video" && Recording.active) Recording.paint(ev.action);
    }
    override onWillDisappear(ev: WillDisappearEvent<CaptureSettings>): void {
        unregisterKey(ev.action.id);
    }
    override onTitleParametersDidChange(ev: TitleParametersDidChangeEvent<CaptureSettings>): void {
        setKeyTitle(ev.action.id, ev.payload.title);
    }
    override onSendToPlugin(ev: SendToPluginEvent<JsonObject, CaptureSettings>): Promise<void> | void {
        return handlePropertyInspectorRequest(ev);
    }

    override async onKeyDown(ev: KeyDownEvent<CaptureSettings>): Promise<void> {
        const s = ev.payload.settings;
        if (!(await ensureReady(ev.action))) return;

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
}

@action({ UUID: "com.este.snapture.snapshot" })
export class SnapshotAction extends CaptureAction {
    protected readonly kind: Kind = "image";
}

@action({ UUID: "com.este.snapture.record" })
export class RecordAction extends CaptureAction {
    protected readonly kind: Kind = "video";

    override async onKeyDown(ev: KeyDownEvent<CaptureSettings>): Promise<void> {
        // Pressing while recording stops the recording.
        if (snapture.isConnected && snapture.state === "recording") {
            await safeRequest("stop");
            return;
        }
        await super.onKeyDown(ev);
    }
}

@action({ UUID: "com.este.snapture.openlast" })
export class OpenLastAction extends SingletonAction<OpenLastSettings> {
    override onWillAppear(ev: WillAppearEvent<OpenLastSettings>): void {
        registerKey(ev.action, "openlast");
    }
    override onWillDisappear(ev: WillDisappearEvent<OpenLastSettings>): void {
        unregisterKey(ev.action.id);
    }
    override onTitleParametersDidChange(ev: TitleParametersDidChangeEvent<OpenLastSettings>): void {
        setKeyTitle(ev.action.id, ev.payload.title);
    }
    override onSendToPlugin(ev: SendToPluginEvent<JsonObject, OpenLastSettings>): Promise<void> | void {
        return handlePropertyInspectorRequest(ev);
    }

    override async onKeyDown(ev: KeyDownEvent<OpenLastSettings>): Promise<void> {
        if (!(await ensureReady(ev.action))) return;
        const s = ev.payload.settings;
        const res = await safeRequest("openLast", { filter: s.filter || "any", action: s.mode || "reveal" });
        if (!res || !res.ok) await ev.action.showAlert();
        else await ev.action.showOk();
    }
}

// ---- Property Inspector data + live status --------------------------------

async function handlePropertyInspectorRequest(ev: SendToPluginEvent<JsonObject, JsonObject>): Promise<void> {
    const req = (ev.payload as { event?: string })?.event;
    if (!req) return;

    if (req === "getDisplays") {
        const r = await safeRequest("getDisplays");
        await streamDeck.ui.sendToPropertyInspector({ event: "displays", items: r?.data?.displays ?? [] });
    } else if (req === "getWindows") {
        const r = await safeRequest("getWindows");
        await streamDeck.ui.sendToPropertyInspector({ event: "windows", items: r?.data?.windows ?? [] });
    } else if (req === "identify") {
        await safeRequest("identifyDisplays");
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

function pushStatus(): void {
    void streamDeck.ui.sendToPropertyInspector({
        event: "appSettings",
        connected: snapture.isConnected,
        version: snapture.version,
        settings: null,
    });
}

// ---- recording visuals (red + pulse + timer) ------------------------------

const PULSE_FRAMES = ["imgs/state/rec0.png", "imgs/state/rec1.png", "imgs/state/rec2.png", "imgs/state/rec1.png"];

const Recording = {
    active: false,
    timer: null as NodeJS.Timeout | null,
    frame: 0,
    seconds: 0,

    recordKeys(): VisibleKey[] {
        return [...keys.values()].filter((k) => k.type === "record");
    },

    paint(actionOrIndex: any): void {
        void actionOrIndex.setImage(PULSE_FRAMES[this.frame]);
    },

    onEvent(state: string, seconds?: number): void {
        const nowRecording = state === "recording";
        if (typeof seconds === "number") this.seconds = seconds;

        if (nowRecording && !this.active) this.start();
        else if (!nowRecording && this.active) this.stop();

        this.active = nowRecording;
        if (this.active) {
            const label = formatElapsed(this.seconds);
            for (const k of this.recordKeys()) void k.action.setTitle(label);
        }
    },

    start(): void {
        this.frame = 0;
        this.timer = setInterval(() => {
            this.frame = (this.frame + 1) % PULSE_FRAMES.length;
            for (const k of this.recordKeys()) this.paint(k.action);
        }, 450);
    },

    stop(): void {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
        for (const k of this.recordKeys()) {
            void k.action.setImage();       // reset to manifest default
            void k.action.setTitle(k.title); // restore the user's title
        }
    },
};

// ---- ping (flash a message on every visible key) --------------------------

function flashPing(): void {
    for (const k of keys.values()) {
        if (Recording.active && k.type === "record") continue; // don't disturb the timer
        void k.action.setTitle("👋\nSnapture");
        setTimeout(() => void k.action.setTitle(k.title), 1000);
    }
}

// ---- bootstrap ------------------------------------------------------------

snapture.on("event", (evt: { event: string; state?: string; data?: any }) => {
    if (evt.event === "stateChanged") Recording.onEvent(evt.state ?? "idle");
    else if (evt.event === "elapsed") Recording.onEvent(evt.state ?? "recording", evt.data?.seconds);
    else if (evt.event === "recordingCompleted") Recording.onEvent("idle");
    else if (evt.event === "ping") { flashPing(); void safeRequest("heartbeat"); } // answer the app
});

// Periodic heartbeat so the app can detect us going away (Stream Deck closing)
// even if the socket close isn't observed promptly.
setInterval(() => { if (snapture.isConnected) void safeRequest("heartbeat"); }, 3000);
snapture.on("disconnected", () => Recording.onEvent("idle"));
snapture.on("status", pushStatus);

streamDeck.actions.registerAction(new SnapshotAction());
streamDeck.actions.registerAction(new RecordAction());
streamDeck.actions.registerAction(new OpenLastAction());

streamDeck.connect();
snapture.start();
