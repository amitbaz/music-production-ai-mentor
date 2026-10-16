import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { Tool } from "@mentor/harness";
import { type Client, type Command, getProp, setProp } from "../../client.ts";
import { goneMessage, isGone } from "../../changing.ts";
import { type LiveClip, type LiveCuePoint, type LiveTrack, WARP_MODES } from "../../live.ts";
import { barOf, beatsOf, beatsPerBar, warpShown } from "../../reading.ts";

type Edit = Record<string, unknown>;
// The Live Set as of the start of the call: its tracks, those that hold no arrangement clips as
// well, and how many beats a bar holds; and what went wrong beside the edits, for the result.
type Song = { tracks: LiveTrack[]; all: LiveTrack[]; perBar: number; problems: string[] };

const ACTIONS = ["create_clip", "place_sample", "duplicate", "move", "edit_clip", "add_locator", "rename_locator", "remove_locator"];

// What Live does not let a script do to the arrangement (ADR 0015), each refused with the steps the
// mentor gives the user instead. The bar and length asked for go into the steps.
const at = (edit: Edit) => (typeof edit.bar === "number" ? ` at bar ${edit.bar}` : "");
// The stretch of time asked for, such as " from bar 9 across 8 bars".
const stretch = (edit: Edit) => `${typeof edit.bar === "number" ? ` from bar ${edit.bar}` : ""} across ${typeof edit.bars === "number" ? `${edit.bars} bars` : "the bars"}`;
const NOT_OFFERED: Record<string, (edit: Edit) => string> = {
    split: (edit) =>
        `Live does not let the mentor split a clip, so the mentor cannot split it. Steps for the user: in the Arrangement View, click inside the clip${at(edit)} so the insert marker is there, then choose Edit → Split (Cmd+E). show can select the clip first.`,
    insert_time: (edit) =>
        `Live does not let the mentor insert time, so the mentor cannot insert time. Steps for the user: in the Arrangement View, drag in the beat time ruler at the top${stretch(edit)}, then choose Edit → Insert Silence (Cmd+I); everything after moves later by that much.`,
    cut_time: (edit) =>
        `Live does not let the mentor cut time, so the mentor cannot cut time. Steps for the user: in the Arrangement View, drag in the beat time ruler at the top${stretch(edit)}, then choose Edit → Cut Time (Cmd+Shift+X), or Delete Time (Cmd+Shift+Delete) to drop it; everything after moves earlier.`,
    automation: () =>
        "Live does not let a script write automation on the arrangement timeline, so the mentor cannot write automation. Steps for the user: in the Arrangement View, press A to show automation, choose the device and the parameter in the choosers under the track name, then draw with Draw Mode (B) or click the line to add breakpoints. show can select the track first.",
    delete: () => "edit_arrangement cannot delete a clip. delete removes clips, after asking the user.",
};

// Reshapes the Arrangement View: creates clips, places samples, duplicates and moves clips, changes
// clip settings, and adds, renames and removes locators. It has no way to delete a clip: removals are for a tool that asks first.
export function editArrangement(client: Client): Tool {
    return {
        name: "edit_arrangement",
        description:
            'Reshapes the Arrangement View of the Live Set. Takes a list of edits, applied in order; each is reported, and one that fails does not stop the rest. Bars are numbered as read_arrangement gives them, from 1 by the time signature; lengths are in bars. Object ids come from read_set and read_arrangement. Live moves the playback position to a clip it makes and to a locator; each edit puts it back where it was, and position_problems in the result says when it could not. The edits: {action: "create_clip", track, bar, bars, name?} creates an empty MIDI clip on a MIDI track and gives its object id. {action: "place_sample", track, bar, file, name?} places an audio file from disk on an audio track, as a clip as long as the file, and gives its object id, bars and warp mode; file is its full path, such as /Users/me/Samples/vox.wav, as read_clip gives the file of an audio clip. {action: "duplicate", clip, bar, track?} copies a clip to start at a bar, on its own track or another track of the same kind (MIDI or audio), and gives the copy\'s object id. {action: "move", clip, bar, track?} moves a clip the same way: Live cannot move a clip, so it is copied and the original removed, and the clip gets a new object id. {action: "edit_clip", clip, ...} changes any of name, muted, looping, loop_start and loop_end (beats from the start of the clip, as read_clip counts; not on an unwarped audio clip), and for an audio clip warp (off, beats, tones, texture, repitch, complex or complex_pro), gain (dB, as Live shows it, or "-inf" for silence), pitch_semitones and pitch_cents, and reports each before and after as Live shows it. {action: "add_locator", bar, name?} adds a locator at the start of a bar inside the arrangement, and gives its object id. {action: "rename_locator", locator, name} and {action: "remove_locator", locator} take a locator\'s object id from read_arrangement. Live does not let a script split a clip, insert or cut time, or write automation on the arrangement timeline: the actions split, insert_time, cut_time and automation give the steps to tell the user instead, with bar and bars if given. It cannot delete a clip.',
        params: {
            type: "object",
            properties: {
                edits: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            action: { type: "string", enum: [...ACTIONS, ...Object.keys(NOT_OFFERED).filter((action) => action !== "delete")] },
                            clip: { type: "string", description: "duplicate, move, edit_clip: object id of the clip, such as c3." },
                            track: { type: "string", description: "create_clip: the MIDI track. place_sample: the audio track. duplicate, move: the track it goes to, its own if left out. Such as t1." },
                            bar: { type: "number", description: "create_clip, place_sample, duplicate, move: the bar it starts at. add_locator: the bar, a whole number." },
                            bars: { type: "number", description: "create_clip: its length in bars." },
                            file: { type: "string", description: "place_sample: the full path of the audio file on disk." },
                            name: { type: "string", description: "create_clip, place_sample, edit_clip, add_locator, rename_locator: the name." },
                            locator: { type: "string", description: "rename_locator, remove_locator: object id of the locator, such as l2." },
                            muted: { type: "boolean", description: "edit_clip." },
                            looping: { type: "boolean", description: "edit_clip: loop on or off." },
                            loop_start: { type: "number", description: "edit_clip: beats from the start of the clip." },
                            loop_end: { type: "number", description: "edit_clip: beats from the start of the clip, after loop_start." },
                            warp: { type: "string", enum: WARPS, description: "edit_clip, audio only: the warp mode, or off." },
                            gain: {
                                anyOf: [{ type: "number" }, { type: "string", enum: ["-inf"] }],
                                description: `edit_clip, audio only: dB, from ${MIN_GAIN} to ${MAX_GAIN}, or "-inf" for silence.`,
                            },
                            pitch_semitones: { type: "number", description: "edit_clip, audio only: -48 to 48." },
                            pitch_cents: { type: "number", description: "edit_clip, audio only: -50 to 49." },
                        },
                        required: ["action"],
                    },
                    description: "The edits, applied in order.",
                },
            },
            required: ["edits"],
        },
        run: (args) => run(client, args),
    };
}

async function run(client: Client, args: Record<string, unknown>) {
    const { edits } = args;
    if (!Array.isArray(edits) || edits.length === 0 || edits.some((edit) => typeof edit !== "object" || edit === null || Array.isArray(edit))) {
        throw new Error('edits must be a list of one or more edits, such as [{"action": "create_clip", "track": "t1", "bar": 9, "bars": 4}]');
    }
    // Read first, so a Live that cannot be reached fails the whole call, not each edit.
    const [tracks, returns, main, numerator, denominator] = (await client.send([
        getProp("song", "tracks"),
        getProp("song", "return_tracks"),
        getProp("song", "master_track"),
        getProp("song", "signature_numerator"),
        getProp("song", "signature_denominator"),
    ])) as [LiveTrack[], LiveTrack[], LiveTrack, number, number];
    const song: Song = { tracks, all: [...tracks, ...returns, main], perBar: beatsPerBar(numerator, denominator), problems: [] };

    const results: Record<string, unknown>[] = [];
    for (const edit of edits as Edit[]) {
        try {
            results.push(await apply(client, edit, song));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // A clip is read again with read_arrangement, a track with read_set.
            const gone = typeof edit.clip === "string" ? goneMessage(edit.clip, "read_arrangement") : typeof edit.track === "string" ? goneMessage(edit.track) : message;
            results.push({ action: edit.action, error: isGone(error) ? gone : message });
        }
    }
    return JSON.stringify({ edits: results, ...(song.problems.length > 0 && { position_problems: song.problems }) });
}

function apply(client: Client, edit: Edit, song: Song) {
    if (edit.action === "create_clip") return createClip(client, edit, song);
    if (edit.action === "place_sample") return placeSample(client, edit, song);
    if (edit.action === "duplicate" || edit.action === "move") return duplicate(client, edit, song, edit.action);
    if (edit.action === "edit_clip") return editClip(client, edit);
    if (edit.action === "add_locator") return addLocator(client, edit, song);
    if (edit.action === "rename_locator") return renameLocator(client, edit, song);
    if (edit.action === "remove_locator") return removeLocator(client, edit, song);
    const refusal = NOT_OFFERED[String(edit.action)];
    if (refusal) throw new Error(refusal(edit));
    throw new Error(`${JSON.stringify(edit.action)} is not an action of edit_arrangement. Its actions are ${ACTIONS.join(", ")}.`);
}

function barArg(edit: Edit, name = "bar") {
    const value = edit[name];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 1) throw new Error(`${name} must be a bar number from 1`);
    return value;
}

// An audio or MIDI track of the Live Set by its object id: the only tracks that hold arrangement clips.
function trackArg(client: Client, edit: Edit, song: Song) {
    const id = edit.track;
    if (typeof id !== "string" || !/^t\d+$/.test(id)) throw new Error("track must be the object id of a track, such as t1, from read_set");
    const scriptId = client.scriptId(id);
    const track = song.all.find((track) => track.id === scriptId);
    if (!track) throw new Error(goneMessage(id));
    if (track.type === "group") throw new Error(`${id} is a group track, which holds no arrangement clips: they are on the tracks inside it.`);
    if (track.type === "return" || track.type === "main") {
        throw new Error(`${id} is ${track.type === "main" ? "Main" : "a return track"}, which holds no arrangement clips. Use an audio or MIDI track.`);
    }
    return { id, track };
}

// "a MIDI track", "an audio track".
const kindOf = (type: string, noun: string) => `${type === "audio" ? "an audio" : `a ${type === "midi" ? "MIDI" : type}`} ${noun}`;

// Live moves the playback position when it does some things for a script: to a clip it made or
// copied, and to where a locator is added or removed. It is put back where it was, so the user's
// place in the song does not move. A put-back that fails does not hide what was done, or the error
// that stopped it: it is reported apart.
async function keepingPosition<T>(client: Client, song: Song, act: () => Promise<T>) {
    const [position] = (await client.send([getProp("song", "current_song_time")])) as [number];
    try {
        return await act();
    } finally {
        await client.send([setProp("song", "current_song_time", position)]).catch((error: Error) => {
            song.problems.push(`The playback position could not be put back to bar ${barOf(position, song.perBar)}: ${error.message}`);
        });
    }
}

const span = (clip: LiveClip, song: Song) => ({ from_bar: barOf(clip.start_time, song.perBar), to_bar: barOf(clip.end_time, song.perBar) });

async function createClip(client: Client, edit: Edit, song: Song) {
    const { id, track } = trackArg(client, edit, song);
    const bar = barArg(edit);
    const { bars, name } = edit;
    if (typeof bars !== "number" || !(bars > 0)) throw new Error("bars must be the length of the clip in bars, above 0");
    if (name !== undefined && (typeof name !== "string" || name.trim() === "")) throw new Error("name must be some text");
    if (track.type !== "midi") throw new Error(`${id} is ${kindOf(track.type, "track")}. Live creates clips on MIDI tracks only.`);

    const start = beatsOf(bar, song.perBar);
    const [clips] = (await client.send([getProp("track", "arrangement_clips", track.id)])) as [LiveClip[]];
    refuseOverlap(client, id, clips, start, start + bars * song.perBar, song);
    const create = { ns: "track", nsid: track.id, name: "create_midi_clip", args: { start_time: start, length: bars * song.perBar } };
    const [created] = (await keepingPosition(client, song, () => client.send([create]))) as [LiveClip];
    const clip = client.objectId("c", created.id);
    const named = (await client.send([...(name === undefined ? [] : [setProp("clip", "name", name, created.id)]), getProp("clip", "name", created.id)])).at(-1);
    return { action: "create_clip", clip, track: id, name: named, ...span(created, song) };
}

// A sample placed on an audio track at a bar, as a clip as long as the file.
async function placeSample(client: Client, edit: Edit, song: Song) {
    const { id, track } = trackArg(client, edit, song);
    const bar = barArg(edit);
    const { file, name } = edit;
    if (typeof file !== "string" || !isAbsolute(file)) throw new Error("file must be the full path of an audio file on disk, such as /Users/me/Samples/vox.wav");
    if (name !== undefined) checkSetting("name", name);
    if (track.type !== "audio") throw new Error(`${id} is ${kindOf(track.type, "track")}. A sample is placed on an audio track.`);
    if (!(await stat(file).catch(() => undefined))?.isFile()) throw new Error(`There is no file at ${file}.`);
    const start = beatsOf(bar, song.perBar);
    const [clips] = (await client.send([getProp("track", "arrangement_clips", track.id)])) as [LiveClip[]];
    // Live cuts the clips a new one lands on, and a sample's length is known only once Live has made
    // it. So it is made where no clip of the track follows, and copied to its bar if those bars are free.
    const at = Math.max(start, ...clips.map((clip) => clip.end_time));
    const { placed, problem } = await keepingPosition(client, song, async () => {
        const create = { ns: "track", nsid: track.id, name: "create_audio_clip", args: { file_path: file, position: at } };
        const [made] = (await client.send([create])) as [LiveClip];
        if (at === start) return { placed: made };
        const remove = () => client.send([{ ns: "track", nsid: track.id, name: "delete_clip", args: { clip_id: made.id } }]);
        // What is left behind when the clip made past the last one cannot be removed.
        const left = (error: Error) => `The sample was first placed past the last clip of ${id}, as ${client.objectId("c", made.id)} at bar ${barOf(at, song.perBar)}, and that clip could not be removed: ${error.message}`;
        let copy: LiveClip;
        try {
            refuseOverlap(client, id, clips, start, start + made.end_time - made.start_time, song);
            [copy] = (await client.send([{ ns: "track", nsid: track.id, name: "duplicate_clip_to_arrangement", args: { clip_id: made.id, time: start } }])) as [LiveClip];
        } catch (error) {
            const message = await remove().then(() => (error as Error).message, (failed: Error) => `${(error as Error).message} ${left(failed)}`);
            throw new Error(message);
        }
        return { placed: copy, problem: await remove().then(() => undefined, left) };
    });
    // The sample is on the track by now, so a name Live refuses is reported with it, not in its place.
    const renamed =
        name === undefined ? undefined : await client.send([setProp("clip", "name", name, placed.id)]).then(() => undefined, (error: Error) => `The sample could not be named ${name}: ${error.message}`);
    const [named, warping, warpMode] = await client.send(["name", "warping", "warp_mode"].map((prop) => getProp("clip", prop, placed.id)));
    const result = { action: "place_sample", clip: client.objectId("c", placed.id), track: id, name: named, ...span(placed, song), warp: warpShown(warping, warpMode) };
    const error = [problem, renamed].filter(Boolean).join(" ");
    return error ? { ...result, error } : result;
}

// A clip by its object id, with the track it is on, and the clips of each track that holds them, by
// the track's script id. Live does not say which track a clip is on, so the clips of every track
// that holds arrangement clips are read, in one message.
async function clipArg(client: Client, edit: Edit, song: Song) {
    const id = edit.clip;
    if (typeof id !== "string" || !/^c\d+$/.test(id)) throw new Error("clip must be the object id of a clip, such as c3, from read_arrangement");
    const scriptId = client.scriptId(id);
    const holders = song.tracks.filter((track) => track.type === "midi" || track.type === "audio");
    const lists = (await client.sendEach(holders, (track) => [getProp("track", "arrangement_clips", track.id)])) as [LiveClip[]][];
    const clipsOf = new Map(holders.map((track, index) => [track.id, (lists[index] as [LiveClip[]])[0]]));
    for (const [trackId, clips] of clipsOf) {
        const clip = clips.find((clip) => clip.id === scriptId);
        if (clip) return { id, clip, track: holders.find((track) => track.id === trackId) as LiveTrack, clipsOf };
    }
    throw new Error(`${id} is not an arrangement clip of the Live Set now. Read again with read_arrangement to get current ids.`);
}

// Live makes room for a new clip by cutting the clips under it, which would remove the user's work
// without asking, so a clip is not put on bars that hold another.
function refuseOverlap(client: Client, trackId: string, clips: LiveClip[], start: number, end: number, song: Song, except?: string) {
    const under = clips.find((clip) => clip.id !== except && clip.start_time < end && clip.end_time > start);
    if (!under) return;
    throw new Error(
        `bars ${barOf(start, song.perBar)} to ${barOf(end, song.perBar)} of ${trackId} hold ${client.objectId("c", under.id)}, ${under.name}. Live would cut that clip to make room, so nothing was done. Choose free bars, or move that clip first.`,
    );
}

// A copy of a clip at a bar, on its own track or the one given. A move is a copy, then the original
// removed, since Live cannot move an arrangement clip; the copy has its own object id.
async function duplicate(client: Client, edit: Edit, song: Song, action: "duplicate" | "move") {
    const { id, clip, track: from, clipsOf } = await clipArg(client, edit, song);
    const to = edit.track === undefined ? { id: client.objectId("t", from.id), track: from } : trackArg(client, edit, song);
    const bar = barArg(edit);
    const start = beatsOf(bar, song.perBar);
    // Live copies a clip only onto a track of its own kind.
    if (clip.is_midi_clip !== (to.track.type === "midi")) {
        throw new Error(`A MIDI clip goes on a MIDI track, and an audio clip on an audio track. ${id} is ${kindOf(clip.is_midi_clip ? "midi" : "audio", "clip")} and ${to.id} is ${kindOf(to.track.type, "track")}.`);
    }
    // A clip moved along its own track may land on bars it covers itself, which go with it.
    const itself = action === "move" && to.track.id === from.id ? clip.id : undefined;
    refuseOverlap(client, to.id, clipsOf.get(to.track.id) ?? [], start, start + clip.end_time - clip.start_time, song, itself);

    const duplicate = { ns: "track", nsid: to.track.id, name: "duplicate_clip_to_arrangement", args: { clip_id: clip.id, time: start } };
    const [copy] = (await keepingPosition(client, song, () => client.send([duplicate]))) as [LiveClip];
    const result = { action, from: id, clip: client.objectId("c", copy.id), track: to.id, name: copy.name, ...span(copy, song) };
    if (action === "duplicate") return result;
    try {
        await client.send([{ ns: "track", nsid: from.id, name: "delete_clip", args: { clip_id: clip.id } }]);
    } catch (error) {
        return { ...result, error: `${id} was copied to ${result.clip}, but the original could not be removed: ${(error as Error).message}` };
    }
    return result;
}

// Clip gain as Live 12.4.6 showed it for its own number from 0 to 1: [number, dB]. Above 0 dB it
// rises 40 dB per unit to 24 dB at 1; below, the curve was measured and is read between the points.
const GAIN_CURVE: [number, number][] = [
    [0.005, -61.6], [0.01, -57.4], [0.015, -51.8], [0.02, -48.4], [0.025, -45.2], [0.03, -42.9], [0.04, -41], [0.05, -39.2],
    [0.075, -34.7], [0.1, -30.6], [0.125, -26.6], [0.15, -23], [0.175, -19.6], [0.2, -16.4], [0.225, -13.5], [0.25, -10.8],
    [0.275, -8.37], [0.3, -6.2], [0.325, -4.27], [0.35, -2.6], [0.375, -1.18], [0.4, 0], [1, 24],
];
const MIN_GAIN = (GAIN_CURVE[0] as [number, number])[1];
// Below the curve is silence, gain 0, which Live shows as -inf dB.
const SILENCE = "-inf";
const MAX_GAIN = (GAIN_CURVE.at(-1) as [number, number])[1];

function gainOf(db: number) {
    const above = GAIN_CURVE.findIndex(([, point]) => point >= db);
    const [highValue, highDb] = GAIN_CURVE[above] as [number, number];
    if (above === 0 || highDb === db) return highValue;
    const [lowValue, lowDb] = GAIN_CURVE[above - 1] as [number, number];
    return lowValue + ((highValue - lowValue) * (db - lowDb)) / (highDb - lowDb);
}

// Every warp mode a script can choose, by the name Live's API gives it. REX is Live's own for a REX file.
const WARPS = ["off", ...Object.values(WARP_MODES).filter((mode) => mode !== "rex")];

// The settings edit_clip changes, with the property each is read from in Live; warp and gain are
// read as Live shows them. `audio` marks those only an audio clip has.
const SETTINGS = {
    name: { reads: ["name"] },
    muted: { reads: ["muted"] },
    looping: { reads: ["looping"] },
    loop_start: { reads: ["loop_start"] },
    loop_end: { reads: ["loop_end"] },
    warp: { reads: ["warping", "warp_mode"], audio: true },
    gain: { reads: ["gain_display_string"], audio: true },
    pitch_semitones: { reads: ["pitch_coarse"], audio: true },
    pitch_cents: { reads: ["pitch_fine"], audio: true },
} as const;
type Setting = keyof typeof SETTINGS;

function checkSetting(setting: Setting, value: unknown) {
    const whole = (low: number, high: number) => typeof value === "number" && Number.isInteger(value) && value >= low && value <= high;
    if (setting === "name" && (typeof value !== "string" || value.trim() === "")) throw new Error("name must be some text");
    if ((setting === "muted" || setting === "looping") && typeof value !== "boolean") throw new Error(`${setting} must be true or false`);
    if ((setting === "loop_start" || setting === "loop_end") && !(typeof value === "number" && value >= 0)) {
        throw new Error(`${setting} must be a number of beats from the start of the clip, from 0`);
    }
    if (setting === "warp" && !WARPS.includes(value as string)) throw new Error(`warp must be one of ${WARPS.join(", ")}`);
    if (setting === "gain" && value !== SILENCE && !(typeof value === "number" && value >= MIN_GAIN && value <= MAX_GAIN)) {
        throw new Error(`gain must be from ${MIN_GAIN} to ${MAX_GAIN} dB, or "${SILENCE}" for silence`);
    }
    if (setting === "pitch_semitones" && !whole(-48, 48)) throw new Error("pitch_semitones must be a whole number from -48 to 48");
    if (setting === "pitch_cents" && !whole(-50, 49)) throw new Error("pitch_cents must be a whole number from -50 to 49");
}

async function readSettings(client: Client, clipId: string, settings: Setting[]) {
    const props = settings.flatMap((setting) => SETTINGS[setting].reads);
    const values = await client.send(props.map((prop) => getProp("clip", prop, clipId)));
    const read = Object.fromEntries(props.map((prop, index) => [prop, values[index]]));
    return Object.fromEntries(
        settings.map((setting) => {
            if (setting === "warp") return [setting, warpShown(read.warping, read.warp_mode)];
            return [setting, read[SETTINGS[setting].reads[0]]];
        }),
    );
}

// The writes for one setting, in Live's own terms.
function writes(setting: Setting, value: unknown, clipId: string): Command[] {
    const set = (prop: string, to: unknown) => setProp("clip", prop, to, clipId);
    if (setting === "warp") return value === "off" ? [set("warping", false)] : [set("warping", true), set("warp_mode", value)];
    if (setting === "gain") return [set("gain", value === SILENCE ? 0 : gainOf(value as number))];
    if (setting === "pitch_semitones") return [set("pitch_coarse", value)];
    if (setting === "pitch_cents") return [set("pitch_fine", value)];
    return [set(setting, value)];
}

async function editClip(client: Client, edit: Edit) {
    const { clip: id } = edit;
    if (typeof id !== "string" || !/^c\d+$/.test(id)) throw new Error("clip must be the object id of a clip, such as c3, from read_arrangement");
    const asked = (Object.keys(SETTINGS) as Setting[]).filter((setting) => edit[setting] !== undefined);
    if (asked.length === 0) throw new Error(`Nothing to change on ${id}. Give at least one of ${Object.keys(SETTINGS).join(", ")}.`);
    for (const setting of asked) checkSetting(setting, edit[setting]);
    const start = edit.loop_start as number | undefined;
    const end = edit.loop_end as number | undefined;
    if (start !== undefined && end !== undefined && end <= start) throw new Error("loop_end must be after loop_start");
    const clipId = client.scriptId(id);

    const [isMidi, loopEnd] = await client.send(["is_midi_clip", "loop_end"].map((prop) => getProp("clip", prop, clipId)));
    const audioOnly = asked.filter((setting) => "audio" in SETTINGS[setting]);
    if (isMidi && audioOnly.length > 0) throw new Error(`${audioOnly.join(" and ")}: ${id} is a MIDI clip, and only an audio clip has ${audioOnly.length > 1 ? "them" : "it"}.`);
    // Live refuses a MIDI clip anything about warping, so it is asked only of an audio clip.
    const warping = isMidi || (await client.send([getProp("clip", "warping", clipId)]))[0];
    if (!warping && (start !== undefined || end !== undefined)) {
        throw new Error(`${id} is not warped, so Live counts its loop in seconds, not beats. Warp it first with warp, or leave the loop out.`);
    }

    const before = await readSettings(client, clipId, asked);
    // Live refuses a loop start at or past the loop end, so a loop moved later gets its end first.
    const order = start !== undefined && start >= (loopEnd as number) ? asked.toSorted((a, b) => Number(b === "loop_end") - Number(a === "loop_end")) : asked;
    let problem: Error | undefined;
    try {
        for (const setting of order) await client.send(writes(setting, edit[setting], clipId));
    } catch (error) {
        problem = error as Error;
    }
    const after = await readSettings(client, clipId, [...new Set([...asked, "name" as const])]);
    // What was written stays written when a later write fails, so it is reported either way.
    const done = problem ? asked.filter((setting) => before[setting] !== after[setting]) : asked;
    const changed = Object.fromEntries(done.map((setting) => [setting, { before: before[setting], after: after[setting] }]));
    if (problem && done.length === 0) throw problem;
    return { action: "edit_clip", clip: id, name: after.name, ...(problem && { error: problem.message }), changed };
}

async function readLocators(client: Client) {
    const [cues, length, playing] = (await client.send([getProp("song", "cue_points"), getProp("song", "song_length"), getProp("song", "is_playing")])) as [
        LiveCuePoint[],
        number,
        boolean,
    ];
    return { cues, length, playing };
}

// Seen in Live 12.4.6: while Live plays, the playback position moves on under the toggle, and a
// locator was not removed. So adding and removing wait for Live to stop.
function refuseWhilePlaying(playing: boolean) {
    if (playing) {
        throw new Error("Live is playing, and it adds or removes a locator only at the playback position, which moves while it plays. Stop playback first (transport can stop it), then ask again.");
    }
}

// A locator by its object id, as it is now.
async function locatorArg(client: Client, edit: Edit) {
    const id = edit.locator;
    if (typeof id !== "string" || !/^l\d+$/.test(id)) throw new Error("locator must be the object id of a locator, such as l2, from read_arrangement");
    const scriptId = client.scriptId(id);
    const state = await readLocators(client);
    const cue = state.cues.find((cue) => cue.id === scriptId);
    if (!cue) throw new Error(goneMessage(id, "read_arrangement"));
    return { id, cue, ...state };
}

// Live adds or removes a locator only at the playback position, so the position is moved there and
// the locator toggled. The toggle goes in a message of its own:
// Live runs every command of a message, so a toggle sent after a move that failed would land at the
// old position.
function toggleLocatorAt(client: Client, song: Song, beats: number) {
    return keepingPosition(client, song, async () => {
        await client.send([setProp("song", "current_song_time", beats)]);
        await client.send([{ ns: "song", name: "set_or_delete_cue" }]);
        return (await readLocators(client)).cues;
    });
}

async function addLocator(client: Client, edit: Edit, song: Song) {
    const bar = barArg(edit);
    if (!Number.isInteger(bar)) throw new Error("A locator goes at the start of a bar, so bar must be a whole number. Live snaps a locator to its grid.");
    const { name } = edit;
    if (name !== undefined && (typeof name !== "string" || name.trim() === "")) throw new Error("name must be some text");
    const beats = beatsOf(bar, song.perBar);
    const { cues, length, playing } = await readLocators(client);
    refuseWhilePlaying(playing);
    const there = cues.find((cue) => cue.time === beats);
    if (there) throw new Error(`There is already a locator at bar ${bar}: ${client.objectId("l", there.id)}, ${there.name}.`);
    if (beats > length) {
        throw new Error(`Live puts a locator only inside the arrangement, which ends at bar ${barOf(length, song.perBar)}. Ask the user to place one by hand past the end.`);
    }

    const after = await toggleLocatorAt(client, song, beats);
    const added = after.find((cue) => !cues.some((before) => before.id === cue.id));
    if (!added) throw new Error(`Ableton Live did not add a locator at bar ${bar}. Read again with read_arrangement to see the locators.`);
    const locator = client.objectId("l", added.id);
    const named = name === undefined ? added.name : (await client.send([setProp("cue-point", "name", name, added.id), getProp("cue-point", "name", added.id)]))[1];
    return { action: "add_locator", locator, name: named, bar: barOf(added.time, song.perBar) };
}

async function renameLocator(client: Client, edit: Edit, song: Song) {
    const { name } = edit;
    if (typeof name !== "string" || name.trim() === "") throw new Error("name must be some text");
    const { id, cue } = await locatorArg(client, edit);
    const [, after] = await client.send([setProp("cue-point", "name", name, cue.id), getProp("cue-point", "name", cue.id)]);
    return { action: "rename_locator", locator: id, bar: barOf(cue.time, song.perBar), changed: { name: { before: cue.name, after } } };
}

async function removeLocator(client: Client, edit: Edit, song: Song) {
    const { id, cue, length, playing } = await locatorArg(client, edit);
    refuseWhilePlaying(playing);
    // Live cannot move the playback position past the end of the arrangement, where the user may have put one.
    if (cue.time > length) {
        throw new Error(`${id}, ${cue.name}, is past the end of the arrangement, where the mentor cannot reach. Steps for the user: in the Arrangement View, click the locator's marker above the tracks and press Delete.`);
    }
    // Live snaps the position to its grid before it toggles, so at a locator off the grid it would add
    // one, or remove a neighbour. Only a locator at the start of a bar is surely on the grid.
    if (!Number.isInteger(cue.time / song.perBar)) {
        throw new Error(
            `${id}, ${cue.name}, is at bar ${barOf(cue.time, song.perBar)}, not at the start of a bar. Live removes a locator only at the playback position snapped to its grid, so the mentor cannot remove this one. Steps for the user: in the Arrangement View, click the locator's marker above the tracks and press Delete.`,
        );
    }
    const after = await toggleLocatorAt(client, song, cue.time);
    if (after.some((other) => other.id === cue.id)) throw new Error(`Ableton Live did not remove ${id}. Read again with read_arrangement to see the locators.`);
    return { action: "remove_locator", locator: id, name: cue.name, bar: barOf(cue.time, song.perBar) };
}
