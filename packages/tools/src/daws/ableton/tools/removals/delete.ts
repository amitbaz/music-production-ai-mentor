import type { Tool } from "@mentor/harness";
import { goneMessage, isGone } from "../../changing.ts";
import { type Client, getProp } from "../../client.ts";
import type { LiveNote } from "../../live.ts";
import { noteKey, roundBeats } from "../../reading.ts";

// What is inside goes before what holds it, notes, clips, devices, then tracks, so a call that
// names a track and a device on it removes both.
const ORDER = ["n", "c", "d", "t"];
const kindOf = (id: string) => /^([tdcn])\d+$/.exec(id)?.[1];

// The one tool that removes the user's work: tracks, devices, clips and notes. It asks first (ADR 0014).
export function deleteTool(client: Client): Tool {
    return {
        name: "delete",
        description:
            "Deletes tracks, devices, clips and notes from the Live Set, by object id. The user is asked first, and can refuse. Takes a list of ids of any of these kinds: a track (t3) or return track from read_set, a device (d4) from read_set or read_tracks, a clip (c2) from read_tracks or read_arrangement, a note (n12) from read_clip. Everything inside a deleted track or clip goes with it. Each id is reported with what was removed, by name (a note by its clip and its row as read_clip gives it), or with the error; one that fails does not stop the rest. A deleted object's id cannot be used again, and an id inside something deleted earlier in the same call is reported as no longer in the Live Set. Main cannot be deleted. There is no undo tool: what is deleted comes back only through the user's own undo in Live.",
        params: {
            type: "object",
            properties: {
                ids: {
                    type: "array",
                    items: { type: "string" },
                    description: 'Object ids of what to delete, such as ["t3", "d4", "c2", "n12"].',
                },
            },
            required: ["ids"],
        },
        needsApproval: true,
        run: (args) => run(client, args),
    };
}

async function run(client: Client, args: Record<string, unknown>) {
    const { ids } = args;
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== "string")) {
        throw new Error('ids must be a list of one or more object ids, such as ["t3", "d4", "c2", "n12"]');
    }
    const rank = (id: string) => ORDER.indexOf(kindOf(id) ?? "");
    const order = (ids as string[]).map((id, index) => ({ id, index })).toSorted((a, b) => rank(a.id) - rank(b.id));
    // Reported in the order asked.
    const results: Record<string, unknown>[] = [];
    for (const { id, index } of order) {
        try {
            results[index] = await remove(client, id);
        } catch (error) {
            results[index] = { id, error: isGone(error) ? goneMessage(id) : error instanceof Error ? error.message : String(error) };
        }
    }
    return JSON.stringify({ deleted: results });
}

async function remove(client: Client, id: string) {
    const kind = kindOf(id);
    if (!kind) throw new Error(`${id} is not a track, device, clip or note. Use an object id such as t3, d4, c2 or n12.`);
    if (kind === "n") return removeNote(client, id);
    // Our Mentor.py finds where the object is in Live when it deletes it, and gives its name.
    const [name] = await client.send([{ ns: "mentor", name: "delete", args: { object_id: client.scriptId(id) } }]);
    client.forget(id);
    return { id, name };
}

async function removeNote(client: Client, id: string) {
    const { clip, noteId } = noteKey(client, id);
    const [name, notes] = (await client.send([
        getProp("clip", "name", clip),
        { ns: "clip", nsid: clip, name: "get_notes_extended", args: {} },
    ])) as [string, LiveNote[]];
    const note = notes.find((candidate) => candidate.note_id === noteId);
    if (!note) throw new Error(`${id} is no longer in its clip. Read the clip again with read_clip to get current ids.`);
    await client.send([{ ns: "clip", nsid: clip, name: "remove_notes_by_id", args: [[noteId]] }]);
    client.forget(id);
    return {
        id,
        clip: client.objectId("c", clip),
        clip_name: name,
        note: [note.pitch, roundBeats(note.start_time), roundBeats(note.duration), note.velocity, note.probability],
    };
}
