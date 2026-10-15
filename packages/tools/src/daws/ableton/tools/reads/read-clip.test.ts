import { test } from "node:test";
import assert from "node:assert/strict";
import type { Tool } from "@mentor/harness";
import { createAbleton } from "../../ableton.ts";
import { ADDRESS, type ClipSpec, liveSet, StandInSocket, useStandIn } from "../../stand-in-live.ts";

function findTool(tools: Tool[], name: string): Tool {
    const tool = tools.find((tool) => tool.name === name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    return tool;
}

const main = { name: "Main", type: "main", volume: "0.0 dB", pan: "C" } as const;
const note = (pitch: number, start_time: number, duration: number, velocity = 100, probability = 1) => ({
    pitch,
    start_time,
    duration,
    velocity,
    probability,
});
const audio = { gain_display_string: "-3.0 dB" };

// A Live Set with one track holding the clips given, and the tools of the tool set to read it.
function withClips(t: Parameters<typeof useStandIn>[0], clips: ClipSpec[]) {
    const { live, track, set } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
    const kick = track({ name: "Kick", type: "audio", volume: "0.0 dB", pan: "C", arrangement: clips });
    set({ tracks: [kick], return_tracks: [], master_track: track({ ...main }) });
    useStandIn(t, live);
    const tools = createAbleton({ address: ADDRESS });
    return {
        live,
        readArrangement: findTool(tools, "read_arrangement"),
        readClip: findTool(tools, "read_clip"),
    };
}

test("read_clip gives the notes of a MIDI clip, by the object id read_arrangement gave", async (t) => {
    const { readArrangement, readClip } = withClips(t, [
        {
            name: "Bass line",
            kind: "midi",
            start: 0,
            end: 16,
            // Not in order, as Live may give them.
            notes: [note(43, 1, 0.5, 90), note(36, 0, 1, 112, 0.5), note(48, 1, 0.25)],
        },
    ]);
    const id = JSON.parse(await readArrangement.run({})).tracks[0].clips[0][0];

    const output = await readClip.run({ clip: id });

    assert.doesNotMatch(output, /\n/);
    assert.deepEqual(JSON.parse(output), {
        id: "c1",
        name: "Bass line",
        kind: "midi",
        notes: [
            [36, 0, 1, 112, 0.5],
            [43, 1, 0.5, 90, 1],
            [48, 1, 0.25, 100, 1],
        ],
    });
});

test("read_clip gives the warp, gain, pitch and sample file of an audio clip", async (t) => {
    const { readArrangement, readClip } = withClips(t, [
        { name: "Loop", kind: "audio", start: 0, end: 16, audio: { ...audio, warp_mode: "complex", pitch_coarse: -2, pitch_fine: 15 } },
        { name: "Unwarped", kind: "audio", start: 16, end: 32, audio: { ...audio, warping: false } },
    ]);
    await readArrangement.run({});

    assert.deepEqual(JSON.parse(await readClip.run({ clip: "c1" })), {
        id: "c1",
        name: "Loop",
        kind: "audio",
        warp: "complex",
        gain: "-3.0 dB",
        pitch_semitones: -2,
        pitch_cents: 15,
        file: "/Samples/loop.wav",
    });
    assert.equal(JSON.parse(await readClip.run({ clip: "c2" })).warp, "off");
});

test("read_clip reports an audio clip with an empty sample path as a missing sample", async (t) => {
    const { readArrangement, readClip } = withClips(t, [
        { name: "Lost", kind: "audio", start: 0, end: 16, audio: { ...audio, file_path: "" } },
    ]);
    await readArrangement.run({});

    const result = JSON.parse(await readClip.run({ clip: "c1" }));

    assert.equal(result.missing_sample, true);
    assert.equal("file" in result, false);
});

test("read_clip refuses an id that is not a clip, or that Live never gave", async (t) => {
    const { readArrangement, readClip } = withClips(t, [{ name: "Bass line", kind: "midi", start: 0, end: 16 }]);
    await readArrangement.run({});

    await assert.rejects(async () => readClip.run({ clip: "t1" }), /t1 is not a clip.*read_arrangement/);
    await assert.rejects(async () => readClip.run({}), /clip is needed/);
    await assert.rejects(async () => readClip.run({ clip: "c9" }), /c9 is not an object id from the current connection/);
});

test("read_clip sends the same number of messages whatever the clip", async (t) => {
    const { readArrangement, readClip } = withClips(t, [
        { name: "Few", kind: "midi", start: 0, end: 16, notes: [note(36, 0, 1)] },
        { name: "Many", kind: "midi", start: 16, end: 32, notes: Array.from({ length: 500 }, (_, i) => note(36 + (i % 12), i / 4, 0.25)) },
    ]);
    await readArrangement.run({});
    const before = StandInSocket.opened.flatMap((socket) => socket.sent).length;

    await readClip.run({ clip: "c1" });
    const few = StandInSocket.opened.flatMap((socket) => socket.sent).length - before;
    await readClip.run({ clip: "c2" });
    const many = StandInSocket.opened.flatMap((socket) => socket.sent).length - before - few;

    assert.equal(many, few);
    assert.ok(few <= 2, `sent ${few} messages`);
});

// 3000 notes of 5 numbers each: more than the result limit when every note is listed.
function crowdedClip(t: Parameters<typeof useStandIn>[0]) {
    return withClips(t, [
        {
            name: "Hats",
            kind: "midi",
            start: 0,
            end: 64,
            notes: Array.from({ length: 3000 }, (_, i) => note(42, i / 50, 0.01, 100, 0.75)),
        },
    ]);
}

test("read_clip, when the notes would pass the result limit, gives the note count and says how to ask for less", async (t) => {
    const { readArrangement, readClip } = crowdedClip(t);
    await readArrangement.run({});

    const output = await readClip.run({ clip: "c1" });

    assert.ok(output.length < 40_000, `${output.length} characters`);
    const result = JSON.parse(output);
    assert.equal(result.note_count, 3000);
    assert.equal("notes" in result, false);
    assert.match(result.note, /from_beat/);
});

test("read_clip refuses a clip deleted in Live since it was read, and says to read again", async (t) => {
    const { live, readArrangement, readClip } = withClips(t, [{ name: "Bass line", kind: "midi", start: 0, end: 16 }]);
    await readArrangement.run({});
    for (const [id, object] of live) if (object.ns === "clip") live.delete(id);

    await assert.rejects(async () => readClip.run({ clip: "c1" }), /c1.*no longer.*read_arrangement/i);
});

test("read_clip refuses to_beat that is not after from_beat", async (t) => {
    const { readArrangement, readClip } = withClips(t, [{ name: "Bass line", kind: "midi", start: 0, end: 16 }]);
    await readArrangement.run({});

    await assert.rejects(async () => readClip.run({ clip: "c1", from_beat: 2, to_beat: 1 }), /to_beat must be after from_beat/);
});

test("read_clip lists only the notes that start inside the beats asked for", async (t) => {
    const { readArrangement, readClip } = crowdedClip(t);
    await readArrangement.run({});

    const result = JSON.parse(await readClip.run({ clip: "c1", from_beat: 1, to_beat: 1.1 }));

    // 3000 notes over 60 beats: one every 0.02 beat.
    assert.deepEqual(
        result.notes.map((row: number[]) => row[1]),
        [1, 1.02, 1.04, 1.06, 1.08],
    );
});
