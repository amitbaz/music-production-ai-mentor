// Test only: a stand-in for the global WebSocket that answers like the ableton-js
// Remote Script, and a builder for the Live Set it answers about. Each Ableton test uses it
// the way the Gemini adapter tests replace the global fetch.
import { readFileSync } from "node:fs";
import type { TestContext } from "node:test";
import type { Command } from "./client.ts";

type Request = { uuid: string; commands: Command[] };

// A stand-in Live Set: the objects the script would answer for, keyed by the script's own ids.
// The song is under "song". Each object holds the namespace it belongs to and maps a
// property to its value; a parameter also holds the text Live shows for it, which is
// what str_for_value answers: a text, or a function from a value to its text.
type LiveSet = Map<string, Record<string, unknown>>;

// The password a stand-in Live can ask for, the salt it sends, and the hash the script would
// accept: HMAC-SHA256 of the salt keyed with the password, worked out apart from our code.
export const PASSWORD = "the-right-password";

// The version of the pinned script the repo installs, read from its own file.
const PINNED_VERSION = readFileSync(new URL("../../../remote-scripts/ableton-js/version.py", import.meta.url), "utf8").match(
    /"(.+)"/,
)?.[1];
if (!PINNED_VERSION) throw new Error("No version found in the pinned script's version.py");
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
    // Whether something accepts the connection but never answers, as a stalled Live would.
    static silent = false;
    // Whether Live has stopped answering commands on a connection it already took, as when it is busy.
    static stalled = false;
    // The script version it reports, and Live's major and minor version.
    static scriptVersion = PINNED_VERSION;
    static liveVersion: readonly [number, number] = [12, 4];

    url: string;
    sent: Request[] = [];
    authenticated = false;

    constructor(url: string) {
        super();
        this.url = url;
        StandInSocket.opened.push(this);
        // As Node's WebSocket does when nothing listens: one error event, and no close event.
        if (StandInSocket.closed) {
            setTimeout(() => this.dispatchEvent(new Event("error")));
            return;
        }
        if (StandInSocket.silent) return;
        setTimeout(() => {
            this.dispatchEvent(new Event("open"));
            const auth = StandInSocket.locked ? { requiresAuth: true, salt: SALT } : {};
            this.reply({ event: "connect", data: { port: 39031, ...auth }, uuid: null });
        });
    }

    send(text: string) {
        const request = JSON.parse(text) as Request;
        this.sent.push(request);
        if (StandInSocket.stalled) return;
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
    if (ns === "internal" && name === "get_version") return { ok: true, data: StandInSocket.scriptVersion };
    if (ns === "application" && name === "get_major_version") return { ok: true, data: StandInSocket.liveVersion[0] };
    if (ns === "application" && name === "get_minor_version") return { ok: true, data: StandInSocket.liveVersion[1] };
    const object = live.get(ns === "song" ? "song" : (nsid ?? ""));
    if (!object) return { ok: false, error: `Unknown object id: ${nsid}`, errorType: "Exception" };
    // The script would look the name up on the wrong kind of object and fail.
    if (object.ns !== ns) return { ok: false, error: `${nsid} is not a ${ns}`, errorType: "Exception" };
    if (name === "get_prop") {
        const { prop } = args as { prop: string };
        // Live may refuse a return track or Main its clips, and a refused command fails the whole message.
        if (object.clipless && (prop === "clip_slots" || prop === "arrangement_clips")) {
            return { ok: false, error: `${prop} is not available on this track`, errorType: "Exception" };
        }
        return { ok: true, data: object[prop] ?? null };
    }
    if (name === "str_for_value") {
        const [value] = args as number[];
        return { ok: true, data: typeof object.shown === "function" ? object.shown(value) : object.shown };
    }
    if (name === "get_notes_extended") {
        // As the script does, from_time and time_span pick the notes that start inside that stretch.
        const { from_time = 0, time_span = 99999999999999 } = (args ?? {}) as { from_time?: number; time_span?: number };
        const notes = (object.notes as { start_time: number }[]).filter(
            (note) => note.start_time >= from_time && note.start_time < from_time + time_span,
        );
        return { ok: true, data: notes };
    }
    return { ok: false, error: `Function call failed: ${name} doesn't exist`, errorType: "Exception" };
}

const realWebSocket = globalThis.WebSocket;
// Not the script's default port, so a test can tell the address given was used.
export const ADDRESS = "ws://127.0.0.1:40123";

// Puts the stand-in in place of the global WebSocket for one test. `locked` makes Live ask
// for PASSWORD, as the installed script does; `closed` makes nothing listen at all, and `silent`
// accepts the connection but never answers. `scriptVersion` and `liveVersion` are what it reports.
export function useStandIn(
    t: TestContext,
    live: LiveSet,
    {
        locked = false,
        closed = false,
        silent = false,
        scriptVersion = PINNED_VERSION,
        liveVersion = [12, 4] as readonly [number, number],
    } = {},
) {
    StandInSocket.opened = [];
    StandInSocket.live = live;
    StandInSocket.locked = locked;
    StandInSocket.closed = closed;
    StandInSocket.silent = silent;
    StandInSocket.stalled = false;
    StandInSocket.scriptVersion = scriptVersion;
    StandInSocket.liveVersion = liveVersion;
    globalThis.WebSocket = StandInSocket as unknown as typeof WebSocket;
    t.after(() => {
        globalThis.WebSocket = realWebSocket;
    });
}

// A device parameter as Live would describe it: a number with a range and the text Live shows for
// a value, or a list of choices, where the value is the index of the current choice.
export type ParameterSpec =
    | { name: string; value: number; min: number; max: number; shown: (value: number) => string }
    | { name: string; items: string[]; value: number };

export type DeviceSpec = {
    name: string;
    class_name: string;
    parameters?: ParameterSpec[];
    // A rack's chains, each with its own devices.
    chains?: { name: string; mute?: boolean; solo?: boolean; devices?: DeviceSpec[] }[];
};

type NoteSpec = { pitch: number; start_time: number; duration: number; velocity: number; probability: number };

type AudioSpec = {
    warping: boolean;
    warp_mode: string;
    gain_display_string: string;
    pitch_coarse: number;
    pitch_fine: number;
    file_path: string;
};

// A clip in beats. A MIDI clip holds `notes`; an audio clip's `audio` settings are those of a
// warped loop unless given.
export type ClipSpec = {
    name: string;
    kind: "midi" | "audio";
    muted?: boolean;
    start?: number;
    end?: number;
    notes?: NoteSpec[];
    audio?: Partial<AudioSpec>;
};

type TrackSpec = {
    name: string;
    type: "audio" | "midi" | "group" | "return" | "main";
    volume: string;
    pan: string;
    sends?: string[];
    mute?: boolean;
    solo?: boolean;
    group?: { id: string };
    devices?: DeviceSpec[];
    // The Session slots from the top, null for an empty one.
    session?: (ClipSpec | null)[];
    arrangement?: ClipSpec[];
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

    // A clip as the script serializes it; the object behind it holds what a read of the clip asks for.
    function clip(spec: ClipSpec) {
        const clipId = id();
        live.set(clipId, {
            ns: "clip",
            name: spec.name,
            is_midi_clip: spec.kind === "midi",
            notes: spec.notes ?? [],
            warping: true,
            warp_mode: "beats",
            gain_display_string: "0.0 dB",
            pitch_coarse: 0,
            pitch_fine: 0,
            file_path: "/Samples/loop.wav",
            ...spec.audio,
        });
        return {
            id: clipId,
            name: spec.name,
            is_audio_clip: spec.kind === "audio",
            is_midi_clip: spec.kind === "midi",
            start_time: spec.start ?? 0,
            end_time: spec.end ?? 4,
            muted: spec.muted ?? false,
        };
    }

    function deviceParameter(spec: ParameterSpec) {
        const paramId = id();
        const common = { ns: "device-parameter" };
        if ("items" in spec) live.set(paramId, { ...common, value_items: spec.items, shown: (value: number) => spec.items[value] });
        else live.set(paramId, { ...common, min: spec.min, max: spec.max, shown: spec.shown });
        return { id: paramId, name: spec.name, value: spec.value, is_quantized: "items" in spec };
    }

    function device(spec: DeviceSpec): { id: string; name: string; type: string; class_name: string } {
        const deviceId = id();
        live.set(deviceId, {
            ns: "device",
            parameters: (spec.parameters ?? []).map(deviceParameter),
            can_have_chains: spec.chains !== undefined,
            chains: (spec.chains ?? []).map((chain) => {
                const chainId = id();
                live.set(chainId, { ns: "chain", devices: (chain.devices ?? []).map(device) });
                return { id: chainId, name: chain.name, color: 0, mute: chain.mute ?? false, solo: chain.solo ?? false };
            }),
        });
        return { id: deviceId, name: spec.name, type: "audio_effect", class_name: spec.class_name };
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
            name: spec.name,
            clipless: spec.type === "return" || spec.type === "main",
            devices: (spec.devices ?? []).map(device),
            clip_slots: (spec.session ?? []).map((spec) => {
                const slotId = id();
                const clipData = spec ? clip(spec) : null;
                live.set(slotId, { ns: "clip_slot", clip: clipData });
                return { id: slotId, has_clip: spec !== null };
            }),
            arrangement_clips: (spec.arrangement ?? []).map(clip),
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

    const set = { ns: "song", tempo: song.tempo, signature_numerator: song.numerator, signature_denominator: song.denominator, cue_points: [] };
    live.set("song", set);
    return { live, track, clip, set: (props: Record<string, unknown>) => Object.assign(set, props) };
}
