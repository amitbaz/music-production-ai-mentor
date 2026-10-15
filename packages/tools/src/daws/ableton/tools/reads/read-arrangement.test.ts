import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../../client.ts";
import { ADDRESS, liveSet, StandInSocket, useStandIn } from "../../stand-in-live.ts";
import { readArrangement } from "./read-arrangement.ts";

const midi = (name: string, start: number, end: number) => ({ name, kind: "midi", start, end }) as const;
const main = { name: "Main", type: "main", volume: "0.0 dB", pan: "C" } as const;
const midiTrack = (name: string) => ({ name, type: "midi", volume: "0.0 dB", pan: "C" }) as const;

test("read_arrangement lists the locators and each track's arrangement clips with their object ids, in bars counted from 1", async (t) => {
    const { live, track, set } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
    const kick = track({
        ...midiTrack("Kick"),
        arrangement: [midi("Intro", 0, 32), midi("Verse", 64, 66)],
        session: [midi("Launch me", 0, 16)],
    });
    const vocal = track({ ...midiTrack("Vocal"), arrangement: [midi("Hook", 128, 190)] });
    const empty = track({ ...midiTrack("Empty") });
    set({
        tracks: [kick, vocal, empty],
        return_tracks: [],
        master_track: track({ ...main }),
        cue_points: [
            { id: "live_cue_1", name: "Intro", time: 0 },
            { id: "live_cue_2", name: "Drop", time: 64 },
        ],
    });
    useStandIn(t, live);

    const output = await readArrangement(createClient(ADDRESS)).run({});

    assert.doesNotMatch(output, /\n/);
    assert.deepEqual(JSON.parse(output), {
        locators: [
            { id: "l1", name: "Intro", bar: 1 },
            { id: "l2", name: "Drop", bar: 17 },
        ],
        tracks: [
            {
                id: "t1",
                name: "Kick",
                clips: [
                    ["c1", "Intro", 1, 9],
                    ["c2", "Verse", 17, 17.5],
                ],
            },
            { id: "t2", name: "Vocal", clips: [["c3", "Hook", 33, 48.5]] },
        ],
    });
});

test("read_arrangement skips group tracks, which Live refuses arrangement clips, and lists their children", async (t) => {
    const { live, track, set } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
    const drums = track({ name: "Drums", type: "group", volume: "0.0 dB", pan: "C" });
    const kick = track({ ...midiTrack("Kick"), group: drums, arrangement: [midi("Four on the floor", 0, 16)] });
    set({
        tracks: [drums, kick],
        return_tracks: [],
        master_track: track({ ...main }),
        cue_points: [{ id: "live_cue", name: "IDEA", time: 64 }],
    });
    useStandIn(t, live);

    const result = JSON.parse(await readArrangement(createClient(ADDRESS)).run({}));

    assert.deepEqual(result, {
        locators: [{ id: "l1", name: "IDEA", bar: 17 }],
        tracks: [{ id: "t2", name: "Kick", clips: [["c1", "Four on the floor", 1, 5]] }],
    });
    await assert.rejects(
        async () => readArrangement(createClient(ADDRESS)).run({ tracks: ["t1"] }),
        /t1 is not a track that holds arrangement clips/,
    );
});

test("read_arrangement counts bars by the time signature of the Live Set", async (t) => {
    const { live, track, set } = liveSet({ tempo: 120, numerator: 6, denominator: 8 });
    // A bar of 6/8 is three beats.
    set({
        tracks: [track({ ...midiTrack("Keys"), arrangement: [midi("A", 3, 12)] })],
        return_tracks: [],
        master_track: track({ ...main }),
    });
    useStandIn(t, live);

    const result = JSON.parse(await readArrangement(createClient(ADDRESS)).run({}));

    assert.deepEqual(result.tracks[0].clips, [["c1", "A", 2, 5]]);
});

test("read_arrangement never asks for Session View clips", async (t) => {
    const { live, track, set } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
    set({
        tracks: [track({ ...midiTrack("Kick"), session: [midi("Launch me", 0, 16)] })],
        return_tracks: [],
        master_track: track({ ...main }),
    });
    useStandIn(t, live);

    const output = await readArrangement(createClient(ADDRESS)).run({});

    assert.doesNotMatch(output, /Launch me/);
    const names = StandInSocket.opened.flatMap((socket) => socket.sent).flatMap((request) => request.commands);
    assert.ok(names.every((command) => JSON.stringify(command).indexOf("clip_slots") === -1));
});

test("read_arrangement keeps a clip's object id across reads", async (t) => {
    const { live, track, clip, set } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
    const kick = track({ ...midiTrack("Kick"), arrangement: [midi("Verse", 0, 16)] });
    set({ tracks: [kick], return_tracks: [], master_track: track({ ...main }) });
    useStandIn(t, live);
    const tool = readArrangement(createClient(ADDRESS));

    await tool.run({});
    // The user adds a clip before it and renames it.
    const kickObject = live.get(kick.id) as { arrangement_clips: Record<string, unknown>[] };
    const [verse] = kickObject.arrangement_clips;
    kickObject.arrangement_clips = [clip(midi("New", 0, 4)), { ...verse, name: "Verse 2" }];
    const second = JSON.parse(await tool.run({}));

    assert.deepEqual(second.tracks[0].clips, [
        ["c2", "New", 1, 2],
        ["c1", "Verse 2", 1, 5],
    ]);
});

test("read_arrangement sends the same number of messages for a large Live Set as for a small one", async (t) => {
    async function messagesFor(trackCount: number) {
        const { live, track, set } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
        const tracks = Array.from({ length: trackCount }, (_, i) =>
            track({ ...midiTrack(`Track ${i}`), arrangement: [midi("A", 0, 16), midi("B", 16, 32)] }),
        );
        set({ tracks, return_tracks: [], master_track: track({ ...main }) });
        useStandIn(t, live);
        await readArrangement(createClient(ADDRESS)).run({});
        return StandInSocket.opened.flatMap((socket) => socket.sent).length;
    }

    const small = await messagesFor(2);
    const large = await messagesFor(60);

    assert.equal(large, small);
    assert.ok(large <= 3, `sent ${large} messages`);
});

// 8 tracks of 400 clips, one bar each: far more than the result limit when every clip is listed.
function bigLiveSet(t: Parameters<typeof useStandIn>[0]) {
    const { live, track, set } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
    const tracks = Array.from({ length: 8 }, (_, i) =>
        track({
            ...midiTrack(`Track ${i + 1}`),
            arrangement: Array.from({ length: 400 }, (_, bar) => midi(`Part ${bar}`, bar * 4, bar * 4 + 4)),
        }),
    );
    set({ tracks, return_tracks: [], master_track: track({ ...main }), cue_points: [{ id: "live_cue", name: "Start", time: 0 }] });
    useStandIn(t, live);
}

test("read_arrangement, when the clips would pass the result limit, gives counts per track and says how to ask for less", async (t) => {
    bigLiveSet(t);

    const output = await readArrangement(createClient(ADDRESS)).run({});

    assert.ok(output.length < 40_000, `${output.length} characters`);
    const result = JSON.parse(output);
    assert.deepEqual(result.locators, [{ id: "l1", name: "Start", bar: 1 }]);
    assert.deepEqual(result.tracks[0], { id: "t1", name: "Track 1", clip_count: 400, first_bar: 1, last_bar: 401 });
    assert.match(result.note, /tracks/);
    assert.match(result.note, /from_bar/);
});

test("read_arrangement lists only the tracks asked for, and the clips inside the bars asked for", async (t) => {
    bigLiveSet(t);
    const tool = readArrangement(createClient(ADDRESS));
    // The ids come from a first read, as the model would get them.
    const overview = JSON.parse(await tool.run({}));
    const second = overview.tracks[1].id;

    const result = JSON.parse(await tool.run({ tracks: [second], from_bar: 10, to_bar: 12 }));

    assert.deepEqual(
        result.tracks.map((track: { id: string; clips: unknown[][] }) => [track.id, track.clips.map((row) => row[1])]),
        [[second, ["Part 9", "Part 10"]]],
    );
});

test("read_arrangement refuses an id that is not a track", async (t) => {
    bigLiveSet(t);

    await assert.rejects(async () => readArrangement(createClient(ADDRESS)).run({ tracks: ["t99"] }), /t99 is not a track that holds arrangement clips/);
});
