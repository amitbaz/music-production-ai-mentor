// What the reading and the changing tools share.
import type { Client } from "./client.ts";
import { type LiveNote, WARP_MODES } from "./live.ts";

// The most characters a tool result may hold (ADR 0018). The harness cuts past it, so a tool
// whose answer grows with the Live Set measures its own answer and answers short instead.
export const RESULT_LIMIT = 40_000;

// An optional argument that must be a number, such as from_bar.
export function numberArg(args: Record<string, unknown>, name: string) {
    const value = args[name];
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} must be a number`);
    return value;
}

// How many beats a bar holds, by the time signature: 3 in 6/8, since a beat is a quarter note.
export const beatsPerBar = (numerator: number, denominator: number) => (numerator * 4) / denominator;

// The position in beats where a bar starts, the other way from barOf.
export const beatsOf = (bar: number, beatsInBar: number) => (bar - 1) * beatsInBar;

// The bar number for a position in beats, as Live's ruler shows it: bar 1 is the start.
export function barOf(beats: number, beatsInBar: number) {
    return Math.round((beats / beatsInBar + 1) * 1000) / 1000;
}

// Where a read of a clip's notes starts when no beat is asked for: far enough before the clip's
// start that a note recorded early, which Live keeps at a negative beat, is read too.
export const EARLIEST_BEAT = -1_000_000;

// Beats to four decimals, enough for a sixty-fourth note.
export const roundBeats = (beats: number) => Math.round(beats * 10000) / 10000;

// Live numbers the notes of each clip apart, so a note's object id stands for its clip and its number.
export const noteObjectId = (client: Client, clipScriptId: string, noteId: number) => client.objectId("n", `${clipScriptId}:${noteId}`);

// A note as read_clip gives it: [object id, pitch, start, length, velocity, probability].
export const noteRow = (client: Client, clipId: string, note: LiveNote) => [
    noteObjectId(client, clipId, note.note_id),
    note.pitch,
    roundBeats(note.start_time),
    roundBeats(note.duration),
    note.velocity,
    note.probability,
];

// An audio clip's warp mode by name, or off when it is not warped.
export const warpShown = (warping: unknown, mode: unknown) => (warping ? (WARP_MODES[String(mode)] ?? mode) : "off");

// The clip and Live's number for a note's object id.
export function noteKey(client: Client, id: string) {
    const key = client.scriptId(id);
    const split = key.lastIndexOf(":");
    return { clip: key.slice(0, split), noteId: Number(key.slice(split + 1)) };
}
