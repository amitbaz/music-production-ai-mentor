import type { Tool } from "@mentor/harness";
import { type Client, getProp } from "../../client.ts";
import { numberArg, RESULT_LIMIT } from "../../reading.ts";

type LiveNote = { pitch: number; start_time: number; duration: number; velocity: number; probability: number };

// What is inside one clip: the notes of a MIDI clip, the settings of an audio clip.
export function readClip(client: Client): Tool {
    return {
        name: "read_clip",
        description:
            "What is inside one clip, by its object id from read_arrangement. A MIDI clip gives its notes as rows [pitch, start, length, velocity, probability]: pitch is a MIDI note number (60 is C3 in Live), start and length are in beats (quarter notes) from the start of the clip, velocity is 1 to 127 and probability 0 to 1. An audio clip gives its warp mode (off when warping is off), gain, pitch in semitones and cents, and its sample file, or missing_sample when the file cannot be found. A clip with too many notes to list gives only the number of notes; ask again with from_beat and to_beat.",
        params: {
            type: "object",
            properties: {
                clip: { type: "string", description: "Object id of the clip, such as c3." },
                from_beat: { type: "number", description: "Only notes that start at or after this beat of the clip." },
                to_beat: { type: "number", description: "Only notes that start before this beat of the clip." },
            },
            required: ["clip"],
        },
        run: (args) => read(client, args),
    };
}

// Beats to four decimals, enough for a sixty-fourth note.
const round = (beats: number) => Math.round(beats * 10000) / 10000;

// Reads in two messages: what kind of clip it is, then what is inside.
async function read(client: Client, args: Record<string, unknown>) {
    try {
        return await readIt(client, args);
    } catch (error) {
        // A clip the user deleted in Live since the id was given fails in the script like this.
        if (!(error instanceof Error) || !error.message.includes("Unknown object id")) throw error;
        throw new Error(`${args.clip} is no longer in the Live Set. Read again with read_arrangement to get current ids.`);
    }
}

async function readIt(client: Client, args: Record<string, unknown>) {
    const { clip: id } = args;
    if (typeof id !== "string") throw new Error("clip is needed: the object id of a clip, such as c3, from read_arrangement");
    if (!/^c\d+$/.test(id)) throw new Error(`${id} is not a clip. Use an object id such as c3 from read_arrangement.`);
    const fromBeat = numberArg(args, "from_beat") ?? 0;
    const toBeat = numberArg(args, "to_beat");
    if (toBeat !== undefined && toBeat <= fromBeat) throw new Error("to_beat must be after from_beat");
    const clipId = client.scriptId(id);

    const [name, isMidi] = await client.send([getProp("clip", "name", clipId), getProp("clip", "is_midi_clip", clipId)]);

    if (!isMidi) {
        const [warping, warpMode, gain, coarse, fine, file] = await client.send(
            ["warping", "warp_mode", "gain_display_string", "pitch_coarse", "pitch_fine", "file_path"].map((prop) =>
                getProp("clip", prop, clipId),
            ),
        );
        return JSON.stringify({
            id,
            name,
            kind: "audio",
            warp: warping ? warpMode : "off",
            gain,
            pitch_semitones: coarse,
            pitch_cents: fine,
            ...(file ? { file } : { missing_sample: true }),
        });
    }

    const [notes] = (await client.send([
        {
            ns: "clip",
            nsid: clipId,
            name: "get_notes_extended",
            args: { from_time: fromBeat, ...(toBeat !== undefined && { time_span: toBeat - fromBeat }) },
        },
    ])) as [LiveNote[]];
    const rows = notes
        .toSorted((a, b) => a.start_time - b.start_time || a.pitch - b.pitch)
        .map((note) => [note.pitch, round(note.start_time), round(note.duration), note.velocity, note.probability]);
    const listed = JSON.stringify({ id, name, kind: "midi", notes: rows });
    if (listed.length <= RESULT_LIMIT) return listed;

    return JSON.stringify({
        id,
        name,
        kind: "midi",
        note_count: rows.length,
        note: "Too many notes to list. Ask again with from_beat and to_beat for a part of the clip.",
    });
}
