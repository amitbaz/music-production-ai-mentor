import { test } from "node:test";
import assert from "node:assert/strict";
import type { Tool } from "@mentor/harness";
import { createAbleton } from "./ableton.ts";
import { ADDRESS, liveSet, PASSWORD, StandInSocket, useStandIn } from "./stand-in-live.ts";

// What belongs to the whole tool set (the connection, object ids, batching),
// tested through whichever tool is handiest, as the harness would call it.

function findTool(tools: Tool[], name: string): Tool {
    const tool = tools.find((tool) => tool.name === name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    return tool;
}

test("read_set keeps each object's id across reads, and gives a new object a new id", async (t) => {
    const { live, track, set } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
    const bass = track({ name: "Bass", type: "midi", volume: "0.0 dB", pan: "C", devices: [{ name: "Operator", class_name: "Operator" }] });
    const main = track({ name: "Main", type: "main", volume: "0.0 dB", pan: "C" });
    set({ tracks: [bass], return_tracks: [], master_track: main });
    useStandIn(t, live);
    const readSet = findTool(createAbleton({ address: ADDRESS }), "read_set");

    await readSet.run({});
    // The user adds a track above, then renames the bass.
    const lead = track({ name: "Lead", type: "midi", volume: "0.0 dB", pan: "C", devices: [{ name: "Wavetable", class_name: "InstrumentVector" }] });
    set({ tracks: [lead, { ...bass, name: "Sub" }] });
    const second = JSON.parse(await readSet.run({}));

    assert.deepEqual(
        second.tracks.map((track: { id: string; name: string; devices?: { id: string }[] }) => [
            track.id,
            track.name,
            track.devices?.map((device) => device.id),
        ]),
        [
            ["t3", "Lead", ["d2"]],
            ["t1", "Sub", ["d1"]],
            ["t2", "Main", undefined],
        ],
    );
});

test("no connection is opened before a tool is first used, and later calls reuse it at the address given", async (t) => {
    const { live, track, set } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
    set({ tracks: [], return_tracks: [], master_track: track({ name: "Main", type: "main", volume: "0.0 dB", pan: "C" }) });
    useStandIn(t, live);

    const readSet = findTool(createAbleton({ address: ADDRESS }), "read_set");
    assert.equal(StandInSocket.opened.length, 0);

    await readSet.run({});
    await readSet.run({});
    assert.deepEqual(
        StandInSocket.opened.map((socket) => socket.url),
        [ADDRESS],
    );
});

test("read_set sends the same number of messages for a large Live Set as for a small one", async (t) => {
    async function messagesFor(trackCount: number) {
        const { live, track, set } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
        const reverb = track({ name: "A-Reverb", type: "return", volume: "0.0 dB", pan: "C" });
        const tracks = Array.from({ length: trackCount }, (_, i) =>
            track({ name: `Track ${i}`, type: "audio", volume: "0.0 dB", pan: "C", sends: ["-inf dB"], devices: [{ name: "EQ Eight", class_name: "Eq8" }] }),
        );
        set({ tracks, return_tracks: [reverb], master_track: track({ name: "Main", type: "main", volume: "0.0 dB", pan: "C" }) });
        useStandIn(t, live);
        await findTool(createAbleton({ address: ADDRESS }), "read_set").run({});
        return StandInSocket.opened.flatMap((socket) => socket.sent).length;
    }

    const small = await messagesFor(2);
    const large = await messagesFor(60);

    assert.equal(large, small);
    assert.ok(large <= 4, `sent ${large} messages`);
});

test("with no address for Live, read_set fails with an error saying so and opens no connection", async (t) => {
    useStandIn(t, new Map());

    await assert.rejects(
        async () => findTool(createAbleton({}), "read_set").run({}),
        /No address for Ableton Live/,
    );
    assert.equal(StandInSocket.opened.length, 0);
});

// A Live Set with nothing in it but its main track.
function emptySet() {
    const { live, track, set } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
    set({ tracks: [], return_tracks: [], master_track: track({ name: "Main", type: "main", volume: "0.0 dB", pan: "C" }) });
    return live;
}

test("read_set works when Live asks for the password the app gives", async (t) => {
    useStandIn(t, emptySet(), { locked: true });

    const result = JSON.parse(await findTool(createAbleton({ address: ADDRESS, password: PASSWORD }), "read_set").run({}));

    assert.equal(result.tempo, 120);
});

test("a wrong password fails with an error that says to connect Ableton again", async (t) => {
    useStandIn(t, emptySet(), { locked: true });

    await assert.rejects(
        async () => findTool(createAbleton({ address: ADDRESS, password: "a-wrong-one" }), "read_set").run({}),
        /refused the password.*connect Ableton again/i,
    );
});

test("Live asking for a password when the app gives none fails with the same advice", async (t) => {
    useStandIn(t, emptySet(), { locked: true });

    await assert.rejects(
        async () => findTool(createAbleton({ address: ADDRESS }), "read_set").run({}),
        /asks for a password.*connect Ableton again/i,
    );
});
