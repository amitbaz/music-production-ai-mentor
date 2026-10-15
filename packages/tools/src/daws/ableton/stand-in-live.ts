// Test only: a stand-in for the global WebSocket that answers like the ableton-js
// Remote Script, and a builder for the Live Set it answers about. Each Ableton test uses it
// the way the Gemini adapter tests replace the global fetch.
import type { TestContext } from "node:test";
import type { Command } from "./client.ts";

type Request = { uuid: string; commands: Command[] };

// A stand-in Live Set: the objects the script would answer for, keyed by the script's own ids.
// The song is under "song". Each object holds the namespace it belongs to and maps a
// property to its value; a parameter also holds the text Live shows for it, which is
// what str_for_value answers.
type LiveSet = Map<string, Record<string, unknown>>;

// The password a stand-in Live can ask for, the salt it sends, and the hash the script would
// accept: HMAC-SHA256 of the salt keyed with the password, worked out apart from our code.
export const PASSWORD = "the-right-password";
const SALT = "a1b2c3d4";
const HASH = "4c780e169dbefc73d44e402a05c72ee2bcde8596208b31b37e317902a5baa169";

// A stand-in for the global WebSocket that answers like the ableton-js Remote Script.
export class StandInSocket extends EventTarget {
    static opened: StandInSocket[] = [];
    static live: LiveSet = new Map();
    // Whether Live asks for PASSWORD before it takes commands.
    static locked = false;
    // Whether nothing listens at the address, as when Live is closed or the script is not chosen.
    static closed = false;

    url: string;
    sent: Request[] = [];
    authenticated = false;

    constructor(url: string) {
        super();
        this.url = url;
        StandInSocket.opened.push(this);
        if (StandInSocket.closed) {
            this.close();
            return;
        }
        setTimeout(() => {
            this.dispatchEvent(new Event("open"));
            const auth = StandInSocket.locked ? { requiresAuth: true, salt: SALT } : {};
            this.reply({ event: "connect", data: { port: 39031, ...auth }, uuid: null });
        });
    }

    send(text: string) {
        const request = JSON.parse(text) as Request;
        this.sent.push(request);
        const [first] = request.commands;
        const authenticating = first?.ns === "internal" && first.name === "authenticate";
        if (StandInSocket.locked && !this.authenticated) {
            // As the script does: a wrong hash closes the connection, no hash refuses the command.
            if (!authenticating) return this.later({ event: "error", data: "Unauthorized", uuid: request.uuid });
            if ((first.args as { hash?: string }).hash !== HASH) {
                this.later({ event: "error", data: "Invalid password", uuid: request.uuid });
                return this.close();
            }
            this.authenticated = true;
        }
        const data = request.commands.map((command) =>
            command === first && authenticating ? { ok: true, data: true } : answer(StandInSocket.live, command),
        );
        this.later({ event: "result", data, uuid: request.uuid });
    }

    later(message: unknown) {
        setTimeout(() => this.reply(message));
    }

    close() {
        setTimeout(() => this.dispatchEvent(new Event("close")));
    }

    reply(message: unknown) {
        this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) }));
    }
}

function answer(live: LiveSet, { ns, nsid, name, args }: Command) {
    const object = live.get(ns === "song" ? "song" : (nsid ?? ""));
    if (!object) return { ok: false, error: `Unknown object id: ${nsid}`, errorType: "Exception" };
    // The script would look the name up on the wrong kind of object and fail.
    if (object.ns !== ns) return { ok: false, error: `${nsid} is not a ${ns}`, errorType: "Exception" };
    if (name === "get_prop") {
        const { prop } = args as { prop: string };
        return { ok: true, data: object[prop] ?? null };
    }
    if (name === "str_for_value") return { ok: true, data: object.shown };
    return { ok: false, error: `Function call failed: ${name} doesn't exist`, errorType: "Exception" };
}

const realWebSocket = globalThis.WebSocket;
// Not the script's default port, so a test can tell the address given was used.
export const ADDRESS = "ws://127.0.0.1:40123";

// Puts the stand-in in place of the global WebSocket for one test. `locked` makes Live ask
// for PASSWORD, as the installed script does; `closed` makes nothing answer at all.
export function useStandIn(t: TestContext, live: LiveSet, { locked = false, closed = false } = {}) {
    StandInSocket.opened = [];
    StandInSocket.live = live;
    StandInSocket.locked = locked;
    StandInSocket.closed = closed;
    globalThis.WebSocket = StandInSocket as unknown as typeof WebSocket;
    t.after(() => {
        globalThis.WebSocket = realWebSocket;
    });
}

type TrackSpec = {
    name: string;
    type: "audio" | "midi" | "group" | "return" | "main";
    volume: string;
    pan: string;
    sends?: string[];
    mute?: boolean;
    solo?: boolean;
    group?: { id: string };
    devices?: { name: string; class_name: string }[];
};

// Builds a stand-in Live Set the way the script describes one.
export function liveSet(song: { tempo: number; numerator: number; denominator: number }) {
    const live: LiveSet = new Map();
    let next = 1;
    const id = () => `live_${next++}`;

    function parameter(shown: string) {
        const paramId = id();
        live.set(paramId, { ns: "device-parameter", shown });
        return { id: paramId, name: "", value: 0, is_quantized: false };
    }

    function track(spec: TrackSpec) {
        const trackId = id();
        const mixerId = id();
        const serialized = {
            id: trackId,
            name: spec.name,
            solo: spec.solo ?? false,
            mute: spec.mute ?? false,
            color: 0,
            color_index: 0,
            is_grouped: spec.group !== undefined,
            type: spec.type,
        };
        live.set(trackId, {
            ns: "track",
            devices: (spec.devices ?? []).map((device) => {
                const deviceId = id();
                live.set(deviceId, { ns: "device" });
                return { id: deviceId, name: device.name, type: "audio_effect", class_name: device.class_name };
            }),
            mixer_device: { id: mixerId },
            group_track: spec.group ?? null,
        });
        live.set(mixerId, {
            ns: "mixer-device",
            volume: parameter(spec.volume),
            panning: parameter(spec.pan),
            sends: (spec.sends ?? []).map(parameter),
        });
        return serialized;
    }

    const set = { ns: "song", tempo: song.tempo, signature_numerator: song.numerator, signature_denominator: song.denominator };
    live.set("song", set);
    return { live, track, set: (props: Record<string, unknown>) => Object.assign(set, props) };
}
