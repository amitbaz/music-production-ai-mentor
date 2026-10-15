import type { Tool } from "@mentor/harness";
import { type Client, getProp } from "../../client.ts";
import { goneMessage, isGone } from "../../changing.ts";
import type { LiveNote } from "../../live.ts";
import { noteKey, noteRow, roundBeats } from "../../reading.ts";

type Asked = Record<string, unknown>;

// The fields of a note as read_clip names them, and as Live names them.
const FIELDS = { pitch: "pitch", start: "start_time", length: "duration", velocity: "velocity", probability: "probability" } as const;
type Field = keyof typeof FIELDS;

// Adds and changes the notes of a MIDI clip. It has no way to remove one: removals are for a tool that asks first.
export function writeNotes(client: Client): Tool {
    const note = {
        pitch: { type: "number", description: "MIDI note number, 0 to 127; 60 is C3 in Live." },
        start: { type: "number", description: "Beats (quarter notes) from the start of the clip." },
        length: { type: "number", description: "In beats." },
        velocity: { type: "number", description: "1 to 127." },
        probability: { type: "number", description: "The chance the note plays, 0 to 1." },
    };
    return {
        name: "write_notes",
        description:
            "Adds and changes the notes of one MIDI clip, by its object id from read_arrangement. add is a list of new notes, each with pitch, start and length, and velocity (100 if left out) and probability (1 if left out); the result gives each as a row [object id, pitch, start, length, velocity, probability], as read_clip does. change is a list of notes to change, each with note (its object id from read_clip) and the fields to change; the result gives each changed field before and after. Changes are made before adds. A note that cannot be written is reported with the reason, and the others are still written. It cannot remove notes.",
        params: {
            type: "object",
            properties: {
                clip: { type: "string", description: "Object id of the MIDI clip, such as c3." },
                add: { type: "array", items: { type: "object", properties: note, required: ["pitch", "start", "length"] }, description: "Notes to add." },
                change: {
                    type: "array",
                    items: { type: "object", properties: { note: { type: "string", description: "Object id of the note, such as n4." }, ...note }, required: ["note"] },
                    description: "Notes to change.",
                },
            },
            required: ["clip"],
        },
        run: async (args) => {
            try {
                return await run(client, args);
            } catch (error) {
                if (isGone(error) && typeof args.clip === "string") throw new Error(goneMessage(args.clip, "read_arrangement"));
                throw error;
            }
        },
    };
}

async function run(client: Client, args: Asked) {
    if (args.remove !== undefined || args.delete !== undefined) {
        throw new Error("write_notes cannot remove notes. delete removes notes, after asking the user.");
    }
    const { clip } = args;
    if (typeof clip !== "string") throw new Error("clip is needed: the object id of a MIDI clip, such as c3, from read_arrangement");
    if (!/^c\d+$/.test(clip)) throw new Error(`${clip} is not a clip. Use an object id such as c3 from read_arrangement.`);
    const add = list(args, "add");
    const change = list(args, "change");
    if (add.length === 0 && change.length === 0) throw new Error("Nothing to write. Give add, change or both.");
    const clipId = client.scriptId(clip);

    const [isMidi] = await client.send([getProp("clip", "is_midi_clip", clipId)]);
    if (!isMidi) throw new Error(`${clip} is an audio clip. write_notes writes the notes of a MIDI clip.`);
    const before = await notesOf(client, clipId);

    // Each asked note becomes a change for Live or the error it is reported with.
    const changes = change.map((asked) => {
        const item = attempt(() => toChange(client, asked, clipId, before));
        return "error" in item && typeof asked.note === "string" ? { note: asked.note, ...item } : item;
    });
    const valid = changes.filter((item): item is Planned => !("error" in item));
    if (valid.length > 0) {
        await client.send([{ ns: "clip", nsid: clipId, name: "apply_note_modifications", args: { notes: valid.map((item) => item.live) } }]);
    }
    const adds = add.map((asked) => attempt(() => toLive(asked, ["pitch", "start", "length"], { velocity: 100, probability: 1 })));
    const newNotes = adds.filter((item): item is Partial<LiveNote> => !("error" in item));
    // The changes are made already, so a failed add is reported with them, not thrown.
    let ids: number[] = [];
    let addProblem: string | undefined;
    try {
        if (newNotes.length > 0) [ids] = (await client.send([{ ns: "mentor", name: "add_notes", args: { clip_id: clipId, notes: newNotes } }])) as [number[]];
    } catch (error) {
        addProblem = `Ableton Live did not add the notes: ${(error as Error).message}`;
    }

    const after = await notesOf(client, clipId);
    // Live may not keep a note, as when it merges two of the same pitch that overlap.
    const read = (noteId: number) => {
        const note = after.find((note) => note.note_id === noteId);
        if (!note) throw new Error("Ableton Live did not keep this note, as when it overlaps another of the same pitch. Read the clip again with read_clip.");
        return note;
    };
    let next = 0;
    return JSON.stringify({
        clip,
        ...(add.length > 0 && {
            added: adds.map((item) => {
                if ("error" in item) return item;
                if (addProblem) return { error: addProblem };
                const noteId = ids[next++] as number;
                return attempt(() => noteRow(client, clipId, read(noteId)));
            }),
        }),
        ...(change.length > 0 && {
            changed: changes.map((item) => {
                if ("error" in item) return item;
                const now = attempt(() => read(item.noteId));
                if ("error" in now) return { note: item.note, ...now };
                const changed = Object.fromEntries(item.fields.map((field) => [field, { before: shown(field, item.before), after: shown(field, now) }]));
                return { note: item.note, changed };
            }),
        }),
    });
}

type Planned = { note: string; noteId: number; fields: Field[]; before: LiveNote; live: Partial<LiveNote> };

function list(args: Asked, name: string) {
    const value = args[name];
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== "object" || item === null || Array.isArray(item))) {
        throw new Error(`${name} must be a list of notes, each an object`);
    }
    return value as Asked[];
}

function attempt<T>(make: () => T): T | { error: string } {
    try {
        return make();
    } catch (error) {
        return { error: (error as Error).message };
    }
}

async function notesOf(client: Client, clipId: string) {
    const [notes] = (await client.send([{ ns: "clip", nsid: clipId, name: "get_notes_extended", args: { from_time: 0 } }])) as [LiveNote[]];
    return notes;
}

const shown = (field: Field, note: LiveNote) => (field === "start" || field === "length" ? roundBeats(note[FIELDS[field]]) : note[FIELDS[field]]);

// The fields of an asked note in Live's names, checked; `required` must be there, and `defaults` fill what is not.
function toLive(asked: Asked, required: Field[], defaults: Partial<Record<Field, number>> = {}) {
    const live: Partial<Record<string, number>> = {};
    for (const field of Object.keys(FIELDS) as Field[]) {
        const value = asked[field] ?? defaults[field];
        if (value === undefined) {
            if (required.includes(field)) throw new Error(`${field} is needed`);
            continue;
        }
        check(field, value);
        live[FIELDS[field]] = value as number;
    }
    return live as Partial<LiveNote>;
}

function check(field: Field, value: unknown) {
    const number = typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
    if (field === "pitch" && !(Number.isInteger(number) && number >= 0 && number <= 127)) throw new Error("pitch must be a whole number from 0 to 127");
    if (field === "start" && !(number >= 0)) throw new Error("start must be a number of beats from 0");
    if (field === "length" && !(number > 0)) throw new Error("length must be a number of beats above 0");
    if (field === "velocity" && !(number >= 1 && number <= 127)) throw new Error("velocity must be from 1 to 127");
    if (field === "probability" && !(number >= 0 && number <= 1)) throw new Error("probability must be from 0 to 1");
}

function toChange(client: Client, asked: Asked, clipId: string, notes: LiveNote[]): Planned {
    const { note } = asked;
    if (typeof note !== "string" || !/^n\d+$/.test(note)) throw new Error("note must be the object id of a note, such as n4, from read_clip");
    const { clip, noteId } = noteKey(client, note);
    if (clip !== clipId) throw new Error(`${note} is a note of another clip. Read this clip with read_clip for its notes.`);
    const before = notes.find((candidate) => candidate.note_id === noteId);
    if (!before) throw new Error(`${note} is no longer in the clip. Read again with read_clip.`);
    const live = toLive(asked, []);
    const fields = (Object.keys(FIELDS) as Field[]).filter((field) => live[FIELDS[field]] !== undefined);
    if (fields.length === 0) throw new Error(`Nothing to change on ${note}. Give at least one of ${Object.keys(FIELDS).join(", ")}.`);
    return { note, noteId, fields, before, live: { note_id: noteId, ...live } };
}
