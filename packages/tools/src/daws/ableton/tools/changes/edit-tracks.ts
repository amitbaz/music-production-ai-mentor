import type { Tool } from "@mentor/harness";
import { type Client, type Command, getProp, setProp } from "../../client.ts";
import { goneMessage, isGone } from "../../changing.ts";
import type { LiveTrack } from "../../live.ts";

type Change = Record<string, unknown>;
type Direction = "input" | "output";
type Routing = { type: string; channel: string };
type Wanted = Partial<Routing>;
// The tracks of the Live Set as of the last look: the tracks that can be duplicated, and all of them.
type Known = { tracks: LiveTrack[]; all: LiveTrack[] };

const KINDS = ["audio", "midi", "return"] as const;
const ACTIONS = ["create", "duplicate", "edit"];
const FIELDS = ["name", "mute", "solo", "arm"] as const;
const DIRECTIONS: Direction[] = ["input", "output"];

const ROUTING = {
    type: "object",
    properties: {
        type: { type: "string", description: 'The routing type as Live shows it, such as "Ext. In", "Main" or the name of a track.' },
        channel: { type: "string", description: 'The channel of the type, such as "1/2" or "Post FX".' },
    },
};

// A change that went wrong after some of it was already done: the error says why, and `changed`
// is what happened before it.
class HalfDone extends Error {
    changed: Record<string, unknown>;
    constructor(message: string, changed: Record<string, unknown>) {
        super(message);
        this.changed = changed;
    }
}

// Creates, duplicates and changes tracks. It has no way to delete one: removals are for a tool that asks first.
export function editTracks(client: Client): Tool {
    return {
        name: "edit_tracks",
        description:
            'Create, duplicate and change tracks, with a list of changes that are made in order. Each change has an action. create: kind audio, midi or return, and a name if you want one; a new audio or MIDI track goes after the last track, a return track after the last return. duplicate: track (an object id from read_set), and a name for the copy if you want one; audio, MIDI and group tracks only. edit: track, and any of name, mute, solo, arm, input and output. arm and input are for audio and MIDI tracks only, and Main cannot be changed. input and output are the routing as Live shows it, {type, channel}, such as {type: "Ext. In", channel: "1/2"}: a type alone gives the first channel of that type, a channel alone keeps the type, and a name that does not exist is refused with the names that do. Every result gives the object id of the track; an edit gives each thing it changed as before and after. A change that fails is reported with the reason, and the others still happen. It cannot delete a track.',
        params: {
            type: "object",
            properties: {
                changes: {
                    type: "array",
                    description: "The changes to make, in order.",
                    items: {
                        type: "object",
                        properties: {
                            action: { type: "string", enum: ACTIONS },
                            kind: { type: "string", enum: [...KINDS], description: "create only: the kind of track." },
                            track: { type: "string", description: "duplicate and edit: object id of the track, such as t1." },
                            name: { type: "string", description: "create, duplicate and edit: the name of the track." },
                            mute: { type: "boolean", description: "edit only." },
                            solo: { type: "boolean", description: "edit only." },
                            arm: { type: "boolean", description: "edit only: record-arm. Audio and MIDI tracks." },
                            input: { ...ROUTING, description: "edit only: where the track takes its signal from. Audio and MIDI tracks." },
                            output: { ...ROUTING, description: "edit only: where the track sends its signal. Not on Main." },
                        },
                        required: ["action"],
                    },
                },
            },
            required: ["changes"],
        },
        run: (args) => run(client, args),
    };
}

async function run(client: Client, args: Record<string, unknown>) {
    const { changes } = args;
    if (!Array.isArray(changes) || changes.length === 0) {
        throw new Error('changes must be a list of one or more changes, such as [{"action": "edit", "track": "t1", "mute": true}]');
    }
    // Looked at first, so a Live that cannot be reached fails the whole call, not each change.
    const known = await readKnown(client);

    const results: unknown[] = [];
    for (const change of changes) {
        const asked = (change ?? {}) as Change;
        try {
            results.push(await apply(client, change, known));
        } catch (error) {
            const message = isGone(error) && typeof asked.track === "string" ? goneMessage(asked.track) : (error as Error).message;
            results.push({
                ...(typeof asked.action === "string" && { action: asked.action }),
                ...(typeof asked.track === "string" && { track: asked.track }),
                ...(error instanceof HalfDone && { changed: error.changed }),
                error: message,
            });
        }
    }
    return JSON.stringify({ changes: results });
}

async function readKnown(client: Client): Promise<Known> {
    const [tracks, returns, main] = (await client.send([
        getProp("song", "tracks"),
        getProp("song", "return_tracks"),
        getProp("song", "master_track"),
    ])) as [LiveTrack[], LiveTrack[], LiveTrack];
    return { tracks, all: [...tracks, ...returns, main] };
}

async function apply(client: Client, change: unknown, known: Known) {
    if (typeof change !== "object" || change === null || Array.isArray(change)) {
        throw new Error('Each change is an object with an action, such as {"action": "edit", "track": "t1", "mute": true}');
    }
    const { action } = change as Change;
    if (action === "create") return create(client, change as Change, known);
    if (action === "duplicate") return duplicate(client, change as Change, known);
    if (action === "edit") return edit(client, change as Change, known);
    throw new Error(`action must be ${ACTIONS.slice(0, -1).join(", ")} or ${ACTIONS.at(-1)}, not ${String(action)}. edit_tracks cannot delete a track.`);
}

function nameArg(change: Change) {
    const { name } = change;
    if (name === undefined) return undefined;
    if (typeof name !== "string" || name.trim() === "") throw new Error("name must be some text");
    return name;
}

function trackId(change: Change) {
    const id = change.track;
    if (typeof id !== "string") throw new Error("track is needed: the object id of a track, such as t1, from read_set");
    if (!/^t\d+$/.test(id)) throw new Error(`${id} is not a track. Use an object id such as t1, from read_set.`);
    return id;
}

// The track the object id names, from the last look at the Live Set.
function trackOf(client: Client, id: string, known: Known) {
    const scriptId = client.scriptId(id);
    const track = known.all.find((track) => track.id === scriptId);
    if (!track) throw new Error(goneMessage(id));
    return { scriptId, track };
}

// What Live calls the track now, after it was given the name, if one was asked for.
async function rename(client: Client, scriptId: string, name: string | undefined) {
    const results = await client.send([...(name === undefined ? [] : [setProp("track", "name", name, scriptId)]), getProp("track", "name", scriptId)]);
    return results.at(-1) as string;
}

async function create(client: Client, change: Change, known: Known) {
    const { kind } = change;
    if (!KINDS.includes(kind as (typeof KINDS)[number])) throw new Error(`kind must be audio, midi or return, not ${String(kind)}`);
    const name = nameArg(change);
    // Live answers with the new track, so its id is known without reading the Live Set again.
    const [created] = (await client.send([
        kind === "return"
            ? { ns: "song", name: "create_return_track" }
            : { ns: "song", name: `create_${kind as "audio" | "midi"}_track`, args: { index: -1 } },
    ])) as [LiveTrack];
    // The Live Set has a track more, which a later duplicate must not take for its copy.
    Object.assign(known, await readKnown(client));
    return { action: "create", track: client.objectId("t", created.id), kind, name: await rename(client, created.id, name) };
}

async function duplicate(client: Client, change: Change, known: Known) {
    const id = trackId(change);
    const name = nameArg(change);
    const { scriptId, track } = trackOf(client, id, known);
    if (track.type === "main") throw new Error(`${id} is Main, which edit_tracks cannot change.`);
    if (track.type === "return") throw new Error(`${id} is a return track, and only audio, MIDI and group tracks can be duplicated.`);

    await client.send([{ ns: "song", name: "duplicate_track", args: [known.tracks.findIndex((track) => track.id === scriptId)] }]);
    // Live does not say which track is the copy, so it is the one that was not there before.
    const now = await readKnown(client);
    const copy = now.tracks.find((track) => !known.tracks.some((before) => before.id === track.id));
    Object.assign(known, now);
    if (!copy) throw new Error(`Ableton Live did not make a copy of ${id}. Read again with read_set to see the Live Set.`);
    return { action: "duplicate", from: id, track: client.objectId("t", copy.id), name: await rename(client, copy.id, name) };
}

function routeArg(change: Change, direction: Direction): Wanted | undefined {
    const value = change[direction];
    if (value === undefined) return undefined;
    const { type, channel } = (value ?? {}) as Wanted;
    const text = (part: unknown) => part === undefined || typeof part === "string";
    if (typeof value !== "object" || Array.isArray(value) || !text(type) || !text(channel) || (type === undefined && channel === undefined)) {
        throw new Error(`${direction} must be an object with a type, a channel or both, such as {"type": "Ext. In", "channel": "1/2"}`);
    }
    return { type, channel };
}

const noType = (direction: Direction, type: string, types: string[]) =>
    `${direction === "input" ? "Input" : "Output"} type ${type} does not exist. The ${direction} types are: ${types.join(", ")}.`;
const noChannel = (direction: Direction, type: string, channel: string, channels: string[]) =>
    `${type} has no ${direction} channel ${channel}. ${channels.length > 0 ? `Its channels are: ${channels.join(", ")}.` : "It has no channels."}`;

const names = (list: unknown) => (list as { display_name: string }[]).map((item) => item.display_name);

type RouteState = Awaited<ReturnType<typeof readRouting>>;

// Reads the routing of a track in one direction: where it is now, and what Live offers.
async function readRouting(client: Client, scriptId: string, direction: Direction) {
    const [type, channel, types, channels] = await client.send(
        ["routing_type", "routing_channel", "available_%_routing_types", "available_%_routing_channels"].map((prop) =>
            getProp("track", prop.includes("%") ? prop.replace("%", direction) : `${direction}_${prop}`, scriptId),
        ),
    );
    return { now: { type: names([type])[0] as string, channel: names([channel])[0] as string }, types: names(types), channels: names(channels) };
}

async function edit(client: Client, change: Change, known: Known) {
    const id = trackId(change);
    const name = nameArg(change);
    const flags = (["mute", "solo", "arm"] as const).filter((field) => change[field] !== undefined);
    for (const field of flags) {
        if (typeof change[field] !== "boolean") throw new Error(`${field} must be true or false`);
    }
    const wanted = DIRECTIONS.map((direction) => [direction, routeArg(change, direction)] as const).filter(
        (entry): entry is [Direction, Wanted] => entry[1] !== undefined,
    );
    if (name === undefined && flags.length === 0 && wanted.length === 0) {
        throw new Error(`Nothing to change on ${id}. Give at least one of ${[...FIELDS, ...DIRECTIONS].join(", ")}.`);
    }

    const { scriptId, track } = trackOf(client, id, known);
    if (track.type === "main") throw new Error(`${id} is Main, which edit_tracks cannot change.`);
    const canArm = track.type === "audio" || track.type === "midi";
    if (change.arm !== undefined && !canArm) throw new Error(`${id} is a ${track.type} track, and only audio and MIDI tracks can be armed.`);
    if (change.input !== undefined && !canArm) throw new Error(`${id} is a ${track.type} track, and only audio and MIDI tracks have an input.`);

    // Everything that can be checked is checked before the first change.
    const fields = ["name", ...flags];
    const beforeValues = await client.send(fields.map((field) => getProp("track", field, scriptId)));
    const before = Object.fromEntries(fields.map((field, index) => [field, beforeValues[index]]));
    const routes = new Map<Direction, RouteState>();
    for (const [direction, want] of wanted) {
        const route = await readRouting(client, scriptId, direction);
        routes.set(direction, route);
        if (want.type !== undefined && want.type !== route.now.type) {
            if (!route.types.includes(want.type)) throw new Error(noType(direction, want.type, route.types));
        } else if (want.channel !== undefined && want.channel !== route.now.channel && !route.channels.includes(want.channel)) {
            throw new Error(noChannel(direction, route.now.type, want.channel, route.channels));
        }
    }

    const changed: Record<string, unknown> = {};
    try {
        const set = [name === undefined ? undefined : "name", ...flags].filter((field) => field !== undefined);
        if (set.length > 0) {
            const commands: Command[] = [
                ...set.map((field) => setProp("track", field, field === "name" ? name : change[field], scriptId)),
                ...set.map((field) => getProp("track", field, scriptId)),
            ];
            const results = await client.send(commands);
            set.forEach((field, index) => {
                changed[field] = { before: before[field], after: results[set.length + index] };
            });
        }
        for (const [direction, want] of wanted) {
            const route = routes.get(direction) as NonNullable<ReturnType<typeof routes.get>>;
            await setRouting(client, scriptId, direction, want, route, changed);
        }
    } catch (error) {
        if (Object.keys(changed).length === 0) throw error;
        throw new HalfDone((error as Error).message, changed);
    }
    return { action: "edit", track: id, name: (changed.name as { after: string } | undefined)?.after ?? before.name, changed };
}

// Sets the type, then the channel, since the channels Live offers depend on the type. When the
// channel is not one the new type has, the type stays set and the error says so.
async function setRouting(
    client: Client,
    scriptId: string,
    direction: Direction,
    want: Wanted,
    route: RouteState,
    changed: Record<string, unknown>,
) {
    if (want.type !== undefined && want.type !== route.now.type) {
        await client.send([setProp("track", `${direction}_routing_type`, want.type, scriptId)]);
    }
    let problem: Error | undefined;
    if (want.channel !== undefined) {
        const current = await readRouting(client, scriptId, direction);
        if (want.channel === current.now.channel) {
            // Already so.
        } else if (current.channels.includes(want.channel)) {
            await client.send([setProp("track", `${direction}_routing_channel`, want.channel, scriptId)]);
        } else {
            problem = new Error(noChannel(direction, current.now.type, want.channel, current.channels));
        }
    }
    changed[direction] = { before: route.now, after: (await readRouting(client, scriptId, direction)).now };
    if (problem) throw problem;
}
