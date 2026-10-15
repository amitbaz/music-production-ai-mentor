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
// The version of our own file in the script, read from its own file.
const MENTOR_VERSION = readFileSync(new URL("../../../remote-scripts/ableton-js/Mentor.py", import.meta.url), "utf8").match(
    /^VERSION = "(.+)"$/m,
)?.[1];
if (!MENTOR_VERSION) throw new Error("No VERSION found in the script's Mentor.py");
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
    // The version our own file reports, or null for a copy of the script that does not have it.
    static mentorVersion = MENTOR_VERSION as string | null;
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

// Namespaces the script answers for with no object id: there is one of each.
const SINGLETONS = new Set(["song", "song-view", "application-view", "mentor", "browser"]);

// A track's routing as the script describes it: each type of routing with the channels it offers.
export type RoutingSpec = { types: Record<string, string[]>; type: string; channel: string };

const ROUTING = /^(available_)?(input|output)_routing_(type|channel)s?$/;

// As the script does: a routing is found by the name Live shows, and a new type brings its own
// channels, the first of them chosen.
function routingProp(routing: Record<"input" | "output", RoutingSpec>, prop: string, value?: string) {
    const [, available, direction, part] = prop.match(ROUTING) as RegExpMatchArray;
    const spec = routing[direction as "input" | "output"];
    if (value === undefined) {
        const channels = spec.types[spec.type] ?? [];
        if (available) {
            return part === "type"
                ? Object.keys(spec.types).map((display_name) => ({ display_name, category: "Normal" }))
                : channels.map((display_name) => ({ display_name, layout: "Mono" }));
        }
        return part === "type" ? { display_name: spec.type, category: "Normal" } : { display_name: spec.channel, layout: "Mono" };
    }
    if (part === "type") {
        if (!(value in spec.types)) throw new Error(`Routing type not found: ${value}`);
        spec.type = value;
        spec.channel = spec.types[value]?.[0] ?? "";
    } else {
        if (!spec.types[spec.type]?.includes(value)) throw new Error(`Routing channel not found: ${value}`);
        spec.channel = value;
    }
    return null;
}

// What Live 12.4.6 answers for any use of an object deleted since the script took its id.
const DEAD = "Python argument types in\n    None.None(MaxDevice)\ndid not match C++ signature:\n    None(TPyHandle<ADevice>)";

// A script function that raises is a failed command, not a failed message.
function attempt(run: () => unknown) {
    try {
        return { ok: true, data: run() };
    } catch (error) {
        return { ok: false, error: (error as Error).message, errorType: "Exception" };
    }
}

// What Live accepts to insert by name: only native devices.
const NATIVE_DEVICES = ["Auto Filter", "Compressor", "EQ Eight", "Limiter", "Reverb", "Saturator", "Utility"];

function answer(live: LiveSet, { ns, nsid, name, args }: Command) {
    if (ns === "internal" && name === "get_version") return { ok: true, data: StandInSocket.scriptVersion };
    // A copy of the script without our file has no handler for its namespace.
    if (ns === "mentor" && name === "get_version") {
        return StandInSocket.mentorVersion === null
            ? { ok: false, error: "No handler for namespace mentor", errorType: "Exception" }
            : { ok: true, data: StandInSocket.mentorVersion };
    }
    if (ns === "application" && name === "get_major_version") return { ok: true, data: StandInSocket.liveVersion[0] };
    if (ns === "application" && name === "get_minor_version") return { ok: true, data: StandInSocket.liveVersion[1] };
    // A track's view is a part of the track, which the script reaches by the track's own id.
    const object = ns === "track-view" ? (live.get(nsid ?? "")?.view as Record<string, unknown> | undefined) : live.get(SINGLETONS.has(ns) ? ns : (nsid ?? ""));
    if (!object) return { ok: false, error: `Unknown object id: ${nsid}`, errorType: "Exception" };
    if (object.dead) return { ok: false, error: DEAD, errorType: "ArgumentError" };
    // The script would look the name up on the wrong kind of object and fail.
    if (object.ns !== ns) return { ok: false, error: `${nsid} is not a ${ns}`, errorType: "Exception" };
    if (name === "get_prop") {
        const { prop } = args as { prop: string };
        // Live may refuse a return track or Main its clips, and a refused command fails the whole message.
        if (object.clipless && (prop === "clip_slots" || prop === "arrangement_clips")) {
            return { ok: false, error: `${prop} is not available on this track`, errorType: "Exception" };
        }
        // Seen in Live 12.4: a group track refuses its arrangement clips, though its children have some.
        if (object.group && prop === "arrangement_clips") {
            return { ok: false, error: "Main, Group and Return Tracks have no arrangement clips", errorType: "Exception" };
        }
        // The shown number of a parameter: its value times the shown units per internal unit.
        if (object.ns === "device-parameter" && prop === "display_value") return { ok: true, data: (object.value as number) * ((object.scale as number) ?? 1) };
        if (object.routing && ROUTING.test(prop)) {
            return { ok: true, data: routingProp(object.routing as Record<"input" | "output", RoutingSpec>, prop) };
        }
        return { ok: true, data: object[prop] ?? null };
    }
    if (name === "set_prop") {
        const { prop, value } = args as { prop: string; value: unknown };
        if (object.ns === "device-parameter") return setParameter(object, prop, value);
        // Live's own bool properties take a bool, not 0 or 1.
        if (prop === "fold_state" && typeof value !== "boolean") {
            return { ok: false, error: "Python argument types in Track.fold_state: bool expected", errorType: "ArgumentError" };
        }
        // A property Live refuses to set, as when it is busy.
        if (object.refuses === prop) return { ok: false, error: `${prop} could not be set`, errorType: "Exception" };
        try {
            if (object.routing && ROUTING.test(prop)) routingProp(object.routing as Record<"input" | "output", RoutingSpec>, prop, value as string);
            else object[prop] = value;
        } catch (error) {
            return { ok: false, error: (error as Error).message, errorType: "Exception" };
        }
        // The track's entry in the song's list shows what the script would send for it next time.
        const entry = object.serialized as Record<string, unknown> | undefined;
        if (entry && prop in entry) entry[prop] = value;
        return { ok: true, data: null };
    }
    if (name === "insert_device" && typeof object.insertDevice === "function") {
        // A track takes target_index, a chain device_index.
        const { device_name, target_index, device_index } = args as { device_name: string; target_index?: number; device_index?: number };
        if (!NATIVE_DEVICES.includes(device_name)) return { ok: false, error: `Device "${device_name}" not found`, errorType: "Exception" };
        return attempt(() => (object.insertDevice as (name: string, index: number) => unknown)(device_name, target_index ?? device_index ?? -1));
    }
    if (name === "move_device" && typeof object.moveDevice === "function") {
        const { device_id, target_id, position } = args as { device_id: string; target_id: string; position: number };
        return attempt(() => (object.moveDevice as (...args: unknown[]) => unknown)(device_id, target_id, position));
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
    // Functions the live set holds: the script gives its handlers a dict of arguments and calls a
    // native function with a list, and so does the stand-in, so a call made the other way fails.
    const run = object[name];
    if (typeof run === "function" && name !== "shown") {
        try {
            return { ok: true, data: run(args ?? {}) ?? null };
        } catch (error) {
            return { ok: false, error: (error as Error).message, errorType: "Exception" };
        }
    }
    return { ok: false, error: `Function call failed: ${name} doesn't exist`, errorType: "Exception" };
}

// Writes a parameter as Live does (seen in Live 12.4.6): display_value takes the shown number and
// clamps it into the range without an error, a list takes the index of the choice, and value
// refuses what is outside min and max.
function setParameter(parameter: Record<string, unknown>, prop: string, value: unknown) {
    const items = parameter.value_items as string[] | undefined;
    const refuse = (error: string) => ({ ok: false, error, errorType: "Exception" });
    // As a parameter Live holds still does: the write is taken without an error and changes nothing.
    if (parameter.ignoresWrites) return { ok: true, data: null };
    if (typeof value !== "number") return refuse("Python argument types in DeviceParameter.value: the value must be a float");
    const min = items ? 0 : (parameter.min as number);
    const max = items ? items.length - 1 : (parameter.max as number);
    if (prop === "display_value") {
        parameter.value = Math.min(max, Math.max(min, value / ((parameter.scale as number) ?? 1)));
        return { ok: true, data: null };
    }
    if (prop !== "value") return refuse(`${prop} cannot be set on a parameter`);
    if (value < min || value > max) return refuse("Invalid value. Check the parameters range with min/max");
    parameter.value = value;
    return { ok: true, data: null };
}

const realWebSocket = globalThis.WebSocket;
// Not the script's default port, so a test can tell the address given was used.
export const ADDRESS = "ws://127.0.0.1:40123";

// Puts the stand-in in place of the global WebSocket for one test. `locked` makes Live ask
// for PASSWORD, as the installed script does; `closed` makes nothing listen at all, and `silent`
// accepts the connection but never answers. `scriptVersion`, `mentorVersion` (null for a copy without
// our own file) and `liveVersion` are what it reports.
export function useStandIn(
    t: TestContext,
    live: LiveSet,
    {
        locked = false,
        closed = false,
        silent = false,
        scriptVersion = PINNED_VERSION,
        mentorVersion = MENTOR_VERSION as string | null,
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
    StandInSocket.mentorVersion = mentorVersion;
    StandInSocket.liveVersion = liveVersion;
    globalThis.WebSocket = StandInSocket as unknown as typeof WebSocket;
    t.after(() => {
        globalThis.WebSocket = realWebSocket;
    });
}

// A device parameter as Live would describe it: a number with a range and the text Live shows for
// a value, or a list of choices, where the value is the index of the current choice. A number is in
// Live's own units; `scale` is the shown units per own unit, 1 unless given, as Utility's Output
// runs from -1 to 1 and shows -35 to 35 dB.
export type ParameterSpec =
    | { name: string; value: number; min: number; max: number; shown: (value: number) => string; scale?: number; ignoresWrites?: true }
    | { name: string; items: string[]; value: number; ignoresWrites?: true };

// A number of a track's mixer, as a device parameter without a name; a text stands for one that
// is only read, with the text Live shows.
export type MixerSpec = string | Omit<Extract<ParameterSpec, { min: number }>, "name">;

export type DeviceSpec = {
    name: string;
    class_name: string;
    parameters?: ParameterSpec[];
    // A rack's chains, each with its own devices.
    chains?: { name: string; mute?: boolean; solo?: boolean; devices?: DeviceSpec[] }[];
};

// Live gives each note of a clip an id of its own, note_id; the stand-in numbers them from 1 unless given.
type NoteSpec = { pitch: number; start_time: number; duration: number; velocity: number; probability: number; note_id?: number };

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
    volume: MixerSpec;
    pan: MixerSpec;
    sends?: MixerSpec[];
    mute?: boolean;
    solo?: boolean;
    arm?: boolean;
    // Not on Main, which only has an output, or on a return track, which has no input.
    routing?: { input: RoutingSpec; output: RoutingSpec };
    // For a group track: whether its tracks are hidden. For another, the group it is in.
    folded?: boolean;
    // Whether the track is shown as a thin strip in the Arrangement View.
    collapsed?: boolean;
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

    // What the script says of a parameter: its value is read from the parameter, so a write shows.
    function serialized(paramId: string, name: string, isQuantized: boolean) {
        const state = live.get(paramId) as { value: number };
        return {
            id: paramId,
            name,
            get value() {
                return state.value;
            },
            is_quantized: isQuantized,
        };
    }

    function parameter(spec: MixerSpec) {
        const paramId = id();
        live.set(paramId, typeof spec === "string" ? { ns: "device-parameter", shown: spec, value: 0 } : { ns: "device-parameter", ...spec });
        return serialized(paramId, "", false);
    }

    // A clip as the script serializes it; the object behind it holds what a read of the clip asks for.
    function clip(spec: ClipSpec) {
        const clipId = id();
        const object: Record<string, unknown> = {
            ns: "clip",
            name: spec.name,
            is_midi_clip: spec.kind === "midi",
            notes: (spec.notes ?? []).map((note, index) => ({ note_id: index + 1, ...note })),
            warping: true,
            warp_mode: "beats",
            gain_display_string: "0.0 dB",
            pitch_coarse: 0,
            pitch_fine: 0,
            file_path: "/Samples/loop.wav",
            ...spec.audio,
            // Live's own function, which the script calls with a list of arguments: the note ids.
            remove_notes_by_id: (args: unknown) => {
                if (!Array.isArray(args)) throw new Error("remove_notes_by_id takes its note ids as a list of arguments");
                const [ids] = args as [number[]];
                object.notes = (object.notes as { note_id: number }[]).filter((note) => !ids.includes(note.note_id));
            },
        };
        live.set(clipId, object);
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
        const common = { ns: "device-parameter", value: spec.value, ignoresWrites: spec.ignoresWrites };
        if ("items" in spec) live.set(paramId, { ...common, value_items: spec.items, shown: (value: number) => spec.items[value] });
        else live.set(paramId, { ...common, min: spec.min, max: spec.max, shown: spec.shown, scale: spec.scale });
        return serialized(paramId, spec.name, "items" in spec);
    }

    function device(spec: DeviceSpec): { id: string; name: string; type: string; class_name: string } {
        const deviceId = id();
        live.set(deviceId, {
            ns: "device",
            name: spec.name,
            class_name: spec.class_name,
            parameters: (spec.parameters ?? []).map(deviceParameter),
            can_have_chains: spec.chains !== undefined,
            chains: (spec.chains ?? []).map((chain) => {
                const chainId = id();
                live.set(chainId, { ns: "chain", devices: (chain.devices ?? []).map(device), insertDevice: inserter(chainId) });
                return { id: chainId, name: chain.name, color: 0, mute: chain.mute ?? false, solo: chain.solo ?? false };
            }),
        });
        return { id: deviceId, name: spec.name, type: "audio_effect", class_name: spec.class_name };
    }

    // Puts a new device, with a "Device On" switch, into the devices of a track or chain, at the
    // index or at the end for -1, as Live does; an index past the end is refused.
    function inserter(ownerId: string) {
        return (name: string, index: number) => {
            const devices = (live.get(ownerId) as { devices: { id: string }[] }).devices;
            if (index > devices.length) throw new Error(`Index ${index} is out of range`);
            const added = device({
                name,
                class_name: name.replace(/ /g, ""),
                parameters: [{ name: "Device On", items: ["off", "on"], value: 1 }],
            });
            devices.splice(index === -1 ? devices.length : index, 0, added);
            return added;
        };
    }

    // Moves a device from whichever track or chain holds it into the target, as Song.move_device does,
    // and answers the position it ended up at.
    function mover() {
        return (deviceId: string, targetId: string, position: number) => {
            const lists = [...live.values()].flatMap((object) => (Array.isArray(object.devices) ? [object.devices as { id: string }[]] : []));
            const from = lists.find((devices) => devices.some((candidate) => candidate.id === deviceId));
            const target = (live.get(targetId) as { devices?: { id: string }[] } | undefined)?.devices;
            if (!from || !target) throw new Error(`Unknown object id: ${from ? targetId : deviceId}`);
            const [moving] = from.splice(from.findIndex((candidate) => candidate.id === deviceId), 1);
            if (position > target.length) {
                from.push(moving as { id: string });
                throw new Error(`Index ${position} is out of range`);
            }
            target.splice(position, 0, moving as { id: string });
            return position;
        };
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
            spec,
            serialized,
            name: spec.name,
            mute: spec.mute ?? false,
            solo: spec.solo ?? false,
            arm: spec.arm ?? false,
            fold_state: spec.folded ?? false,
            view: { ns: "track-view", is_collapsed: spec.collapsed ?? false },
            routing: spec.routing,
            clipless: spec.type === "return" || spec.type === "main",
            group: spec.type === "group",
            devices: (spec.devices ?? []).map(device),
            insertDevice: inserter(trackId),
            clip_slots: (spec.session ?? []).map((spec) => {
                const slotId = id();
                const clipData = spec ? clip(spec) : null;
                live.set(slotId, { ns: "clip_slot", clip: clipData });
                // Read from the slot, so a deleted clip shows.
                return {
                    id: slotId,
                    get has_clip() {
                        return live.get(slotId)?.clip != null;
                    },
                };
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

    // The song's functions, as the script has them: it builds a track at the index given (-1 is the
    // end) and answers with the new track; a copy of a track goes right after it.
    const created = (type: TrackSpec["type"], name: string, list: "tracks" | "return_tracks", index: number) => {
        const added = track({ name, type, volume: "0.0 dB", pan: "C" });
        const tracks = set[list] as unknown[];
        tracks.splice(index < 0 ? tracks.length : index, 0, added);
        return added;
    };
    const set: Record<string, unknown> = {
        ns: "song",
        tempo: song.tempo,
        signature_numerator: song.numerator,
        signature_denominator: song.denominator,
        cue_points: [],
        tracks: [],
        return_tracks: [],
        loop: false,
        loop_start: 0,
        loop_length: 4,
        current_song_time: 0,
        is_playing: false,
        create_audio_track: ({ index }: { index: number }) => created("audio", "Audio", "tracks", index),
        create_midi_track: ({ index }: { index: number }) => created("midi", "MIDI", "tracks", index),
        create_return_track: () => created("return", "Return", "return_tracks", -1),
        // Live's own function: the track and what is in it are deleted, and the script keeps their ids.
        delete_track: (args: unknown) => {
            if (!Array.isArray(args)) throw new Error("delete_track takes its index as a list of arguments");
            const [deleted] = (set.tracks as { id: string }[]).splice(args[0] as number, 1);
            if (!deleted) throw new Error(`No track at index ${args[0]}`);
            kill(deleted.id);
        },
        duplicate_track: (args: unknown) => {
            if (!Array.isArray(args)) throw new Error("duplicate_track takes its index as a list of arguments");
            const [index] = args as [number];
            const original = (set.tracks as { id: string }[])[index];
            const spec = original && (live.get(original.id)?.spec as TrackSpec);
            if (!spec) throw new Error(`No track at index ${index}`);
            // The copy has a routing of its own.
            (set.tracks as unknown[]).splice(index + 1, 0, track({ ...spec, routing: spec.routing && structuredClone(spec.routing) }));
        },
        continue_playing: () => {
            set.is_playing = true;
        },
        stop_playing: () => {
            set.is_playing = false;
        },
    };
    live.set("song", set);
    // What Live is showing: the selection of the song view and the views the application shows.
    live.set("song-view", {
        ns: "song-view",
        selected_track: null,
        detail_clip: null,
        selected_device: null,
        select_device: ({ device_id }: { device_id: string }) => {
            (live.get("song-view") as Record<string, unknown>).selected_device = device_id;
        },
    });
    const views: string[] = [];
    // The scrolls Live was asked for, as { direction, view }. Live scrolls to what an arrow key
    // selects, so the stand-in moves nothing and only keeps them.
    const scrolls: { direction: string; view: string }[] = [];
    const focused: string[] = [];
    live.set("application-view", {
        ns: "application-view",
        focused_document_view: "Arranger",
        views,
        scrolls,
        focused,
        focus_view: (args: unknown) => {
            if (!Array.isArray(args)) throw new Error("focus_view takes its view name as a list of arguments");
            focused.push(args[0] as string);
        },
        scroll_view: (args: unknown) => {
            const { direction, view } = (args ?? {}) as { direction?: string; view?: string };
            if ((live.get("application-view") as Record<string, unknown>).scrollFails) throw new Error("scroll_view failed");
            if (!direction || !view) throw new Error("scroll_view takes its direction and view as named arguments");
            scrolls.push({ direction, view });
        },
        show_view: (args: unknown) => {
            if (!Array.isArray(args)) throw new Error("show_view takes its view name as a list of arguments");
            views.push(args[0] as string);
        },
    });
    // Marks an object and everything inside it as deleted in Live. The script still holds them by
    // their ids, so each fails as a dead object does in Live.
    function kill(objectId: string) {
        const object = live.get(objectId);
        if (!object) return;
        object.dead = true;
        for (const key of ["devices", "chains", "arrangement_clips", "clip_slots"]) {
            for (const entry of (object[key] as { id: string }[] | undefined) ?? []) kill(entry.id);
        }
        const clip = object.clip as { id: string } | null | undefined;
        if (clip) kill(clip.id);
    }

    // Deletes a track, device or clip by the script's id, as our Mentor.py does, and answers its name.
    // An object whose track or rack was deleted before it is unknown, as in Live.
    function deleter() {
        return ({ object_id }: { object_id: string }) => {
            const object = live.get(object_id);
            if (!object || object.dead) throw new Error(`Unknown object id: ${object_id}`);
            if ((set.master_track as { id: string }).id === object_id) throw new Error("Main cannot be deleted");
            // The song's lists of tracks, and the devices and clips of each track and chain.
            const lists = [...live.values()].flatMap((holder) =>
                [holder.tracks, holder.return_tracks, holder.devices, holder.arrangement_clips].filter(Array.isArray),
            ) as { id: string }[][];
            const list = lists.find((candidate) => candidate.some((entry) => entry.id === object_id));
            const slot = [...live.values()].find((holder) => holder.ns === "clip_slot" && (holder.clip as { id: string } | null)?.id === object_id);
            if (list) list.splice(list.findIndex((entry) => entry.id === object_id), 1);
            else if (slot) slot.clip = null;
            else throw new Error(`${object_id} cannot be deleted`);
            // Our file forgets the object itself, so only what was inside it stays behind, dead.
            kill(object_id);
            live.delete(object_id);
            return object.name as string;
        };
    }
    live.set("mentor", { ns: "mentor", moveDevice: mover(), delete: deleter() });

    // The browser as Live's script describes it: root items that hold their children, where a
    // folder has `children`, a device is_device, and anything else loadable is a preset or sample.
    type ItemSpec = { name: string; device?: boolean; loadable?: boolean; children?: ItemSpec[] };
    function browserItem(spec: ItemSpec): Record<string, unknown> {
        const itemId = id();
        live.set(itemId, { ns: "browser-item", children: (spec.children ?? []).map(browserItem) });
        return {
            id: itemId,
            name: spec.name,
            is_loadable: spec.loadable ?? spec.device ?? false,
            is_selected: false,
            is_device: spec.device ?? false,
            is_folder: spec.children !== undefined,
            source: "Live",
            uri: `query:${spec.name}`,
        };
    }
    function browser(roots: Record<string, ItemSpec[]>) {
        live.set("browser", { ns: "browser", ...Object.fromEntries(Object.entries(roots).map(([root, items]) => [root, items.map(browserItem)])) });
    }

    return { live, track, clip, browser, set: (props: Record<string, unknown>) => Object.assign(set, props) };
}
