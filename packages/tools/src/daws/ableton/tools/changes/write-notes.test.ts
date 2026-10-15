import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { Tool } from "@mentor/harness";
import { createAbleton } from "../../ableton.ts";
import { ADDRESS, liveSet, useStandIn } from "../../stand-in-live.ts";

function findTool(tools: Tool[], name: string): Tool {
    const tool = tools.find((tool) => tool.name === name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    return tool;
}

const note = (pitch: number, start_time: number, duration: number, velocity = 100, probability = 1) => ({
    pitch,
    start_time,
    duration,
    velocity,
    probability,
});

// A Live Set with a MIDI clip holding a kick on beats 0 and 1, a second MIDI clip and an audio clip,
// read first as the mentor does, so the tool is given object ids.
async function setup(t: TestContext) {
    const { live, track, set } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
    const drums = track({
        name: "Drums",
        type: "midi",
        volume: "0.0 dB",
        pan: "C",
        arrangement: [
            { name: "Beat", kind: "midi", start: 0, end: 16, notes: [note(36, 0, 0.5, 120), note(36, 1, 0.5, 110)] },
            { name: "Fill", kind: "midi", start: 16, end: 32, notes: [note(38, 0, 0.25)] },
        ],
    });
    const loop = track({ name: "Loop", type: "audio", volume: "0.0 dB", pan: "C", arrangement: [{ name: "Break", kind: "audio", start: 0, end: 16 }] });
    set({ tracks: [drums, loop], return_tracks: [], master_track: track({ name: "Main", type: "main", volume: "0.0 dB", pan: "C" }) });
    useStandIn(t, live);
    const tools = createAbleton({ address: ADDRESS });
    const writeNotes = findTool(tools, "write_notes");
    const arrangement = JSON.parse(await findTool(tools, "read_arrangement").run({}));
    const [beat, fill] = arrangement.tracks[0].clips.map((clip: unknown[]) => clip[0] as string);
    const audio = arrangement.tracks[1].clips[0][0] as string;
    const notes = async (clip: string) => JSON.parse(await findTool(tools, "read_clip").run({ clip })).notes as unknown[][];
    const [kick1, kick2] = (await notes(beat)).map((row) => row[0] as string);
    const [snare] = (await notes(fill)).map((row) => row[0] as string);
    const write = async (args: Record<string, unknown>) => JSON.parse(await writeNotes.run(args));
    return { live, writeNotes, write, notes, beat, fill, audio, kick1, kick2, snare };
}

test("write_notes adds notes with pitch, start, length, velocity and probability, and gives each its object id", async (t) => {
    const { write, notes, beat } = await setup(t);

    const result = await write({
        clip: beat,
        add: [
            { pitch: 42, start: 0.5, length: 0.25, velocity: 80, probability: 0.5 },
            { pitch: 42, start: 1.5, length: 0.25, velocity: 70, probability: 0.75 },
        ],
    });

    assert.equal(result.clip, beat);
    assert.equal(result.added.length, 2);
    for (const row of result.added) assert.match(row[0], /^n\d+$/);
    assert.deepEqual(
        result.added.map((row: unknown[]) => row.slice(1)),
        [
            [42, 0.5, 0.25, 80, 0.5],
            [42, 1.5, 0.25, 70, 0.75],
        ],
    );
    // read_clip shows them with the same ids.
    const rows = await notes(beat);
    for (const row of result.added) assert.deepEqual(rows.find((read) => read[0] === row[0]), row);
});

test("write_notes adds a note at velocity 100 and probability 1 when they are left out", async (t) => {
    const { write, beat } = await setup(t);

    const { added } = await write({ clip: beat, add: [{ pitch: 60, start: 2, length: 1 }] });

    assert.deepEqual(added[0].slice(1), [60, 2, 1, 100, 1]);
});

test("write_notes changes notes by object id and reports each changed field before and after", async (t) => {
    const { write, notes, beat, kick1, kick2 } = await setup(t);

    const result = await write({
        clip: beat,
        change: [
            { note: kick1, velocity: 90, probability: 0.5 },
            { note: kick2, start: 1.5, pitch: 35 },
        ],
    });

    assert.deepEqual(result.changed, [
        { note: kick1, changed: { velocity: { before: 120, after: 90 }, probability: { before: 1, after: 0.5 } } },
        { note: kick2, changed: { start: { before: 1, after: 1.5 }, pitch: { before: 36, after: 35 } } },
    ]);
    assert.deepEqual(await notes(beat), [
        [kick1, 36, 0, 0.5, 90, 0.5],
        [kick2, 35, 1.5, 0.5, 110, 1],
    ]);
});

test("write_notes reports a note it cannot write and still writes the others", async (t) => {
    const { write, notes, beat, kick1, snare } = await setup(t);

    const result = await write({
        clip: beat,
        add: [
            { pitch: 200, start: 0, length: 1 },
            { pitch: 48, start: 3, length: 1, velocity: 0 },
            { pitch: 48, start: 2, length: 1 },
        ],
        change: [
            { note: snare, velocity: 10 },
            { note: kick1, probability: 2 },
            { note: kick1, velocity: 64 },
        ],
    });

    assert.match(result.added[0].error, /pitch must be a whole number from 0 to 127/);
    assert.match(result.added[1].error, /velocity must be from 1 to 127/);
    assert.deepEqual(result.added[2].slice(1), [48, 2, 1, 100, 1]);
    assert.match(result.changed[0].error, new RegExp(`${snare} is a note of another clip`));
    assert.match(result.changed[1].error, /probability must be from 0 to 1/);
    assert.deepEqual(result.changed[2], { note: kick1, changed: { velocity: { before: 120, after: 64 } } });
    assert.equal((await notes(beat)).length, 3);
});

test("write_notes cannot remove notes", async (t) => {
    const { writeNotes, notes, beat, kick1 } = await setup(t);

    await assert.rejects(async () => writeNotes.run({ clip: beat, remove: [kick1] }), /cannot remove notes.*delete/);
    assert.equal((await notes(beat)).length, 2);
});

test("write_notes refuses an audio clip and a call with nothing to write", async (t) => {
    const { writeNotes, beat, audio } = await setup(t);

    await assert.rejects(async () => writeNotes.run({ clip: audio, add: [{ pitch: 60, start: 0, length: 1 }] }), /audio clip/);
    await assert.rejects(async () => writeNotes.run({ clip: beat }), /add, change or both/);
    await assert.rejects(async () => writeNotes.run({ clip: "t1", add: [] }), /t1 is not a clip/);
});

test("write_notes still reports the changes it made when Live fails to add notes", async (t) => {
    const { live, write, beat, kick1 } = await setup(t);
    delete (live.get("mentor") as Record<string, unknown>).add_notes;

    const result = await write({ clip: beat, change: [{ note: kick1, velocity: 64 }], add: [{ pitch: 60, start: 2, length: 1 }] });

    assert.deepEqual(result.changed, [{ note: kick1, changed: { velocity: { before: 120, after: 64 } } }]);
    assert.match(result.added[0].error, /add_notes/);
});

test("write_notes takes a field given as null as not given", async (t) => {
    const { write, beat, kick1 } = await setup(t);

    const result = await write({ clip: beat, change: [{ note: kick1, velocity: null, probability: 0.5 }, { note: kick1, pitch: null }] });

    assert.deepEqual(result.changed[0], { note: kick1, changed: { probability: { before: 1, after: 0.5 } } });
    assert.match(result.changed[1].error, /Nothing to change/);
});

test("write_notes says to read the clip again for a note id from before", async (t) => {
    const { write, beat } = await setup(t);

    const result = await write({ clip: beat, change: [{ note: "n99", velocity: 10 }] });

    assert.match(result.changed[0].error, /n99 is not an object id from the current connection.*read_clip/);
});
