import { createConnection, type Socket } from "node:net";
import { EventEmitter } from "node:events";

const HOST = "127.0.0.1";
const PORT = 48910; // Snapture's control server

export interface ControlResponse {
    type: "response";
    id?: string;
    ok: boolean;
    state?: string;
    error?: string;
    data?: any;
}

export interface ControlEvent {
    type: "event";
    event: string;
    state?: string;
    data?: any;
}

/** True if `version` (e.g. "1.1.0") is >= `min`. Null/unknown versions fail. */
export function versionAtLeast(version: string | null, min: string): boolean {
    if (!version) return false;
    const a = version.split(".").map((n) => parseInt(n, 10) || 0);
    const b = min.split(".").map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) {
        const x = a[i] ?? 0;
        const y = b[i] ?? 0;
        if (x !== y) return x > y;
    }
    return true;
}

/**
 * NDJSON TCP client for Snapture's control server, with request/response
 * correlation, event fan-out, and automatic reconnection. Emits "connected",
 * "disconnected", and "event" (with a {@link ControlEvent}).
 */
class SnaptureClient extends EventEmitter {
    private socket: Socket | null = null;
    private buffer = "";
    private nextId = 1;
    private connected = false;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private readonly pending = new Map<string, { resolve: (r: ControlResponse) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

    /** App version reported on connect, or null when unknown/offline. */
    public version: string | null = null;
    /** Latest known recording state ("idle" | "selecting" | "recording" | "encoding"). */
    public state = "idle";

    get isConnected(): boolean {
        return this.connected;
    }

    start(): void {
        this.connect();
    }

    private connect(): void {
        if (this.socket) return;
        const socket = createConnection({ host: HOST, port: PORT });
        this.socket = socket;
        socket.setEncoding("utf8");

        socket.on("connect", async () => {
            this.connected = true;
            this.emit("connected");
            try {
                const r = await this.request("getVersion");
                this.version = r.data?.version ?? null;
            } catch {
                this.version = null;
            }
        });
        socket.on("data", (chunk: string) => this.onData(chunk));
        socket.on("error", () => { /* surfaced via close */ });
        socket.on("close", () => {
            this.teardown();
            this.scheduleReconnect();
        });
    }

    private teardown(): void {
        this.connected = false;
        this.version = null;
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.destroy();
            this.socket = null;
        }
        for (const p of this.pending.values()) {
            clearTimeout(p.timer);
            p.reject(new Error("disconnected"));
        }
        this.pending.clear();
        this.emit("disconnected");
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, 1500);
    }

    private onData(chunk: string): void {
        this.buffer += chunk;
        let idx: number;
        while ((idx = this.buffer.indexOf("\n")) >= 0) {
            const line = this.buffer.slice(0, idx).trim();
            this.buffer = this.buffer.slice(idx + 1);
            if (!line) continue;

            let msg: ControlResponse | ControlEvent;
            try {
                msg = JSON.parse(line);
            } catch {
                continue;
            }

            if (msg.type === "response" && msg.id && this.pending.has(msg.id)) {
                const p = this.pending.get(msg.id)!;
                this.pending.delete(msg.id);
                clearTimeout(p.timer);
                p.resolve(msg);
            } else if (msg.type === "event") {
                if (msg.state) this.state = msg.state;
                this.emit("event", msg);
            }
        }
    }

    /** Send a command and await its response (rejects if offline or on timeout). */
    request(command: string, args?: Record<string, unknown>): Promise<ControlResponse> {
        return new Promise((resolve, reject) => {
            if (!this.connected || !this.socket) {
                reject(new Error("not-connected"));
                return;
            }
            const id = String(this.nextId++);
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error("timeout"));
            }, 8000);
            this.pending.set(id, { resolve, reject, timer });
            this.socket.write(JSON.stringify({ id, command, args: args ?? {} }) + "\n");
        });
    }
}

export const snapture = new SnaptureClient();
