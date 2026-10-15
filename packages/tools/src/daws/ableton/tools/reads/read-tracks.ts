import type { Tool } from "@mentor/harness";
import { type Client, getProp, strForValue } from "../../client.ts";
import {
    isPlugin,
    type LiveChain,
    type LiveClip,
    type LiveClipSlot,
    type LiveDevice,
    type LiveDeviceParameter,
    type LiveTrack,
} from "../../live.ts";

// The most characters a result may hold (AGENTS.md), less room for the note about what was left out.
const RESULT_LIMIT = 40_000;
const NOTE_ROOM = 1_000;

type Parameter = { name: string; value: string; range?: [string, string]; choices?: string[] };
type Chain = { id: string; name: string; mute?: true; solo?: true; devices?: Device[] };
type Clip = { id: string; name: string; kind: string; scene?: number; start?: number; end?: number; muted?: true };
type TrackDetail = { id: string; name: string; devices?: Device[]; session?: Clip[]; arrangement?: Clip[] };
type Device = { id: string; name: string; plugin?: true; parameters?: Parameter[]; chains?: Chain[] };

// The detail of the tracks the mentor chose: every parameter of each native device, the chains of
// a rack, and the clips of the track.
export function readTracks(client: Client): Tool {
    return {
        name: "read_tracks",
        description:
            "Detail of the tracks you choose by object id, as given by read_set (read_set first if you have none). For each track: its devices in order, each native device with every parameter as {name, value, range: [min, max]} in the units Live shows, such as \"-3.0 dB\"; a parameter that is a list gives {name, value, choices} with the current choice and all the choices instead of a range. A rack lists its chains, each with an object id and its devices, which get object ids too. A third-party plug-in is named and marked plugin, with no parameters, because they cannot be read. Clips: session lists the clips in the launch grid with their scene number (from 1), arrangement lists the clips on the timeline with start and end in beats; each clip has an object id. Fields that are false or empty are left out. A long result is cut at 40,000 characters: left_out lists the devices left out, which you read with the devices argument, and counts the clips cut from the end of each track's lists.",
        params: {
            type: "object",
            properties: {
                tracks: {
                    type: "array",
                    items: { type: "string" },
                    description: "Object ids of the tracks to read, such as [\"t1\", \"t4\"]. Read only the tracks you need.",
                },
                devices: {
                    type: "array",
                    items: { type: "string" },
                    description:
                        "Optional. Object ids of devices, also those inside racks. Only these get their parameters; the other devices are listed by name, and racks still list their chains.",
                },
            },
            required: ["tracks"],
        },
        run: (args) => read(client, args),
    };
}

function idList(value: unknown, name: string, required: boolean): string[] | undefined {
    if (value === undefined && !required) return undefined;
    if (!Array.isArray(value) || value.some((id) => typeof id !== "string") || (required && value.length === 0)) {
        throw new Error(`${name} must be a list of ${required ? "one or more " : ""}object ids, such as ["t1"]`);
    }
    return value;
}

// Reads in a fixed number of messages, whatever the size of the Live Set, plus three for each
// level of racks inside racks.
async function read(client: Client, args: Record<string, unknown>) {
    const trackIds = idList(args.tracks, "tracks", true) as string[];
    try {
        return await readIds(client, trackIds, args);
    } catch (error) {
        // An object the user deleted in Live since the ids were given fails in the script like this.
        if (!(error instanceof Error) || !error.message.includes("Unknown object id")) throw error;
        throw new Error(`One of ${trackIds.join(", ")}, or something inside it, is no longer in the Live Set. Read again with read_set to get current ids.`);
    }
}

async function readIds(client: Client, trackIds: string[], args: Record<string, unknown>) {
    const deviceIds = idList(args.devices, "devices", false);
    const wanted = deviceIds && new Set(deviceIds);
    for (const id of trackIds) {
        if (!/^t\d+$/.test(id)) throw new Error(`${id} is not a track. read_tracks takes track object ids, such as t1.`);
    }
    const scriptIds = trackIds.map((id) => client.scriptId(id));

    // Return tracks and Main have no clips, and asking Live for them may fail the whole message.
    const [returns, main] = (await client.send([getProp("song", "return_tracks"), getProp("song", "master_track")])) as [LiveTrack[], LiveTrack];
    const withoutClips = new Set([main.id, ...returns.map((track) => track.id)]);
    const tracks = (await client.sendEach(scriptIds, (id) => [
        getProp("track", "name", id),
        getProp("track", "devices", id),
        ...(withoutClips.has(id) ? [] : [getProp("track", "clip_slots", id), getProp("track", "arrangement_clips", id)]),
    ])) as [string, LiveDevice[], LiveClipSlot[]?, LiveClip[]?][];

    const filledSlots = tracks.map(([, , slots]) => (slots ?? []).map((slot, index) => ({ slot, scene: index + 1 })).filter(({ slot }) => slot.has_clip));
    const [devices, sessionClips] = await Promise.all([
        describeDevices(client, tracks.flatMap(([, devices]) => devices), wanted),
        client.sendEach(filledSlots.flat(), ({ slot }) => [getProp("clip_slot", "clip", slot.id)]),
    ]);

    const devicesOf = splitter(devices);
    const sessionClipsOf = splitter(sessionClips.map(([clip]) => clip as LiveClip));
    const output = tracks.map(([name, trackDevices, , arrangement], index): TrackDetail => {
        const slots = filledSlots[index] as { scene: number }[];
        const session = sessionClipsOf(slots.length).map((clip, position) => ({
            ...describeClip(client, clip),
            scene: (slots[position] as { scene: number }).scene,
        }));
        const timeline = (arrangement ?? []).map((clip) => ({ ...describeClip(client, clip), start: clip.start_time, end: clip.end_time }));
        const trackDetail = devicesOf(trackDevices.length);
        return {
            id: trackIds[index] as string,
            name,
            ...(trackDetail.length > 0 && { devices: trackDetail }),
            ...(session.length > 0 && { session }),
            ...(timeline.length > 0 && { arrangement: timeline }),
        };
    });

    return JSON.stringify(withinLimit(output));
}

function describeClip(client: Client, clip: LiveClip): Clip {
    return {
        id: client.objectId("c", clip.id),
        name: clip.name,
        kind: clip.is_midi_clip ? "midi" : "audio",
        ...(clip.muted && { muted: true as const }),
    };
}

// Hands out the next `count` items of a flat list each time, to give flat results back to their owners.
function splitter<T>(items: T[]) {
    let next = 0;
    return (count: number) => {
        const part = items.slice(next, next + count);
        next += count;
        return part;
    };
}

// Keeps whole devices, in order, until the next one would pass the limit; the rest are listed by
// name only, and their ids go in left_out so the mentor can ask for exactly those. Clips come after
// the devices, each list cut at its end, and left_out counts what was cut per track.
function withinLimit(tracks: TrackDetail[]) {
    const budget = RESULT_LIMIT - NOTE_ROOM;
    const stub = ({ id, name, plugin }: Device): Device => ({ id, name, ...(plugin && { plugin }) });
    const kept = tracks.map(({ session, arrangement, ...track }): TrackDetail => ({ ...track, ...(track.devices && { devices: track.devices.map(stub) }) }));
    let size = JSON.stringify({ tracks: kept }).length;
    const devicesLeftOut: string[] = [];
    const clipsLeftOut: Record<string, number> = {};
    let full = true;
    for (const [t, track] of tracks.entries()) {
        for (const [d, device] of (track.devices ?? []).entries()) {
            const extra = JSON.stringify(device).length - JSON.stringify(stub(device)).length;
            if (extra === 0) continue;
            if (full && size + extra > budget) full = false;
            if (!full) {
                devicesLeftOut.push(device.id);
                continue;
            }
            size += extra;
            (kept[t]?.devices as Device[])[d] = device;
        }
    }
    for (const [t, track] of tracks.entries()) {
        for (const list of ["session", "arrangement"] as const) {
            const clips = track[list] ?? [];
            const fits: Clip[] = [];
            for (const clip of clips) {
                const length = JSON.stringify(clip).length + 1;
                if (size + length > budget) break;
                size += length;
                fits.push(clip);
            }
            if (fits.length > 0) (kept[t] as TrackDetail)[list] = fits;
            if (fits.length < clips.length) clipsLeftOut[track.id] = (clipsLeftOut[track.id] ?? 0) + clips.length - fits.length;
        }
    }
    const notes = [
        ...(devicesLeftOut.length > 0
            ? ["devices lists devices by name only: read fewer tracks, or pass devices with these object ids to read only those"]
            : []),
        ...(Object.keys(clipsLeftOut).length > 0 ? ["clips counts the clips cut from the end of each track's lists"] : []),
    ];
    if (notes.length === 0) return { tracks: kept };
    return {
        tracks: kept,
        left_out: {
            ...(devicesLeftOut.length > 0 && { devices: devicesLeftOut }),
            ...(Object.keys(clipsLeftOut).length > 0 && { clips: clipsLeftOut }),
            note: `The result would pass 40,000 characters, so ${notes.join("; ")}.`,
        },
    };
}

// Gives each device an object id, and each native device its parameters (when asked for), and each
// rack its chains with their devices. Plug-ins are not asked about.
async function describeDevices(client: Client, devices: LiveDevice[], wanted: Set<string> | undefined): Promise<Device[]> {
    const described: Device[] = devices.map((device) => ({
        id: client.objectId("d", device.id),
        name: device.name,
        ...(isPlugin(device) && { plugin: true as const }),
    }));
    const native = devices.map((device, index) => ({ device, described: described[index] as Device })).filter(({ device }) => !isPlugin(device));
    if (native.length === 0) return described;
    const wantsParameters = (device: Device) => !wanted || wanted.has(device.id);

    const basics = await client.sendEach(native, ({ device, described }) => [
        getProp("device", "can_have_chains", device.id),
        ...(wantsParameters(described) ? [getProp("device", "parameters", device.id)] : []),
    ]);
    const readers = native.flatMap((item, index) =>
        wantsParameters(item.described) ? [{ ...item, parameters: basics[index]?.[1] as LiveDeviceParameter[] }] : [],
    );
    const racks = native.filter((_, index) => basics[index]?.[0]);

    const [parameters, chains] = await Promise.all([
        describeParameters(client, readers.flatMap(({ parameters }) => parameters)),
        describeChains(client, racks.map(({ device }) => device), wanted),
    ]);

    const parametersOf = splitter(parameters);
    for (const reader of readers) {
        const own = parametersOf(reader.parameters.length);
        if (own.length > 0) reader.described.parameters = own;
    }
    racks.forEach(({ described }, index) => {
        const own = chains[index] as Chain[];
        if (own.length > 0) described.chains = own;
    });
    return described;
}

async function describeChains(client: Client, racks: LiveDevice[], wanted: Set<string> | undefined): Promise<Chain[][]> {
    const chainLists = (await client.sendEach(racks, (rack) => [getProp("device", "chains", rack.id)])).map(([chains]) => chains as LiveChain[]);
    const chains = chainLists.flat();
    // Given before going down into the devices, so ids read from the top, as read_set's do.
    const chainIds = new Map(chains.map((chain) => [chain, client.objectId("ch", chain.id)]));
    const deviceLists = (await client.sendEach(chains, (chain) => [getProp("chain", "devices", chain.id)])).map(([devices]) => devices as LiveDevice[]);
    const inner = await describeDevices(client, deviceLists.flat(), wanted);

    const devicesOf = splitter(inner);
    const chainDevices = splitter(deviceLists);
    return chainLists.map((list) =>
        list.map((chain) => {
            const [chainsDevices] = chainDevices(1) as [LiveDevice[]];
            const own = devicesOf(chainsDevices.length);
            return {
                id: chainIds.get(chain) as string,
                name: chain.name,
                ...(chain.mute && { mute: true as const }),
                ...(chain.solo && { solo: true as const }),
                ...(own.length > 0 && { devices: own }),
            };
        }),
    );
}

// A number is given with its range, both as Live shows them; a list with its choices. A list's
// choices are only asked for a quantised parameter, which is the only kind that has them.
async function describeParameters(client: Client, parameters: LiveDeviceParameter[]): Promise<Parameter[]> {
    if (parameters.length === 0) return [];
    const props = await client.sendEach(parameters, (parameter) =>
        parameter.is_quantized
            ? [getProp("device-parameter", "value_items", parameter.id)]
            : [getProp("device-parameter", "min", parameter.id), getProp("device-parameter", "max", parameter.id)],
    );
    const shown = (await client.sendEach(
        parameters.map((parameter, index) => ({ parameter, range: parameter.is_quantized ? [] : (props[index] as number[]) })),
        ({ parameter, range }) => [parameter.value, ...range].map((value) => strForValue(parameter.id, value)),
    )) as string[][];
    return parameters.map(({ name, is_quantized }, index) => {
        const [value, min, max] = shown[index] as string[];
        return is_quantized
            ? { name, value: value as string, choices: props[index]?.[0] as string[] }
            : { name, value: value as string, range: [min as string, max as string] };
    });
}
