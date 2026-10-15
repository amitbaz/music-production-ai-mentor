import { test } from "node:test";
import assert from "node:assert/strict";
import type { Tool } from "@mentor/harness";
import { createAbleton } from "./ableton.ts";
import { type Client, createClient, getProp } from "./client.ts";
import { readSet } from "./tools/reads/read-set.ts";
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

test("a wrong password fails with an error that says to pair Ableton again", async (t) => {
    useStandIn(t, emptySet(), { locked: true });

    await assert.rejects(
        async () => findTool(createAbleton({ address: ADDRESS, password: "a-wrong-one" }), "read_set").run({}),
        /refused the password.*pnpm pair ableton/i,
    );
});

test("Live asking for a password when the app gives none says Ableton is not paired", async (t) => {
    useStandIn(t, emptySet(), { locked: true });

    await assert.rejects(
        async () => findTool(createAbleton({ address: ADDRESS }), "read_set").run({}),
        /not paired.*pnpm pair ableton/i,
    );
});

test("with nothing answering and no password, read_set says Ableton is not paired and how to pair it", async (t) => {
    useStandIn(t, new Map(), { closed: true });

    await assert.rejects(
        async () => findTool(createAbleton({ address: ADDRESS }), "read_set").run({}),
        /not paired.*pnpm pair ableton/i,
    );
});

test("with nothing answering once paired, read_set asks whether Live is open with MusicMentor chosen", async (t) => {
    useStandIn(t, new Map(), { closed: true });

    await assert.rejects(
        async () => findTool(createAbleton({ address: ADDRESS, password: PASSWORD }), "read_set").run({}),
        /Could not reach Ableton Live.*open.*MusicMentor/i,
    );
});

// A tool that takes an object id, as read_tracks and the tools after it do: it answers with the
// name of the track the id names.
function trackName(client: Client): Tool {
    return {
        name: "track_name",
        description: "",
        params: { type: "object", properties: { id: { type: "string" } } },
        run: async ({ id }) => String((await client.send([getProp("track", "name", client.scriptId(String(id)))]))[0]),
    };
}

// Lets the stand-in deliver what it has queued.
const turn = () => new Promise((resolve) => setImmediate(resolve));

// Live closes the connection, as when it quits or opens another Live Set.
async function loseConnection() {
    StandInSocket.opened.at(-1)?.close();
    await new Promise((resolve) => setTimeout(resolve));
}

test("a tool given an object id from read_set reaches that object", async (t) => {
    useStandIn(t, emptySet());
    const client = createClient(ADDRESS);

    const [main] = JSON.parse(await readSet(client).run({})).tracks;

    assert.equal(await trackName(client).run({ id: main.id }), "Main");
});

test("after the connection is lost, the next tool call connects again", async (t) => {
    useStandIn(t, emptySet());
    const tool = readSet(createClient(ADDRESS));

    await tool.run({});
    await loseConnection();
    const result = JSON.parse(await tool.run({}));

    assert.equal(result.tempo, 120);
    assert.equal(StandInSocket.opened.length, 2);
});

test("an object id from before a lost connection is refused with a message to read again", async (t) => {
    useStandIn(t, emptySet());
    const client = createClient(ADDRESS);
    const [main] = JSON.parse(await readSet(client).run({})).tracks;

    await loseConnection();

    await assert.rejects(
        async () => trackName(client).run({ id: main.id }),
        new Error(`${main.id} is not an object id from the current connection to Ableton Live. Read again with read_set to get current ids.`),
    );
});

test("an object id never given out is refused the same way", async (t) => {
    useStandIn(t, emptySet());

    await assert.rejects(async () => trackName(createClient(ADDRESS)).run({ id: "t9" }), /t9 is not an object id.*Read again/);
});

test("after a reconnect, read_set gives out none of the ids from before, so an old id cannot name another object", async (t) => {
    useStandIn(t, emptySet());
    const client = createClient(ADDRESS);
    const before = JSON.parse(await readSet(client).run({})).tracks.map((track: { id: string }) => track.id);

    await loseConnection();
    const after = JSON.parse(await readSet(client).run({})).tracks.map((track: { id: string }) => track.id);

    assert.deepEqual(before, ["t1"]);
    assert.deepEqual(after, ["t2"]);
});

test("when Live accepts the connection but never answers, read_set gives up after 5 seconds and says so", async (t) => {
    useStandIn(t, new Map(), { silent: true });
    t.mock.timers.enable({ apis: ["setTimeout"] });

    let finished = false;
    const run = Promise.resolve(findTool(createAbleton({ address: ADDRESS, password: PASSWORD }), "read_set").run({})).finally(
        () => (finished = true),
    );

    await turn();
    t.mock.timers.tick(4999);
    await turn();
    assert.equal(finished, false);
    t.mock.timers.tick(1);

    await assert.rejects(run, /did not answer/);
});
