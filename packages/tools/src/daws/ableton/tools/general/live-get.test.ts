import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../../client.ts";
import { ADDRESS, liveSet, StandInSocket, useStandIn } from "../../stand-in-live.ts";
import { readSet } from "../reads/read-set.ts";
import { liveGet } from "./live-get.ts";

// A Live Set with Bass, holding EQ Eight, and Main. Reads it first, as the mentor does.
async function setup(t: TestContext) {
    const { live, track, set } = liveSet({ tempo: 124, numerator: 4, denominator: 4 });
    const bass = track({ name: "Bass", type: "midi", volume: "0.0 dB", pan: "C", arm: true, devices: [{ name: "EQ Eight", class_name: "Eq8" }] });
    const main = track({ name: "Main", type: "main", volume: "0.0 dB", pan: "C" });
    set({ tracks: [bass], return_tracks: [], master_track: main });
    useStandIn(t, live);
    const client = createClient(ADDRESS);
    const tool = liveGet(client);
    const overview = JSON.parse(await readSet(client).run({}));
    const get = async (args: Record<string, unknown>) => JSON.parse(await tool.run(args));
    return { live, client, tool, get, bass: overview.tracks[0].id as string, eq: overview.tracks[0].devices[0].id as string };
}

// The commands sent after the handshake, by the name of each.
const sentNames = () => StandInSocket.opened.flatMap((socket) => socket.sent.slice(1).flatMap((request) => request.commands.map((command) => command.name)));

test("live_get reads a property of the song", async (t) => {
    const { get } = await setup(t);

    assert.deepEqual(await get({ object: "song", property: "tempo" }), { object: "song", property: "tempo", value: 124 });
});

test("live_get reads a property of a track or device by object id", async (t) => {
    const { get, bass, eq } = await setup(t);

    assert.equal((await get({ object: bass, property: "arm" })).value, true);
    assert.equal((await get({ object: eq, property: "class_name" })).value, "Eq8");
});

test("live_get gives Live objects in its answer as object ids, and never the script's own ids", async (t) => {
    const { tool, get, bass, eq } = await setup(t);

    const tracks = (await get({ object: "song", property: "tracks" })).value;
    const devices = (await get({ object: bass, property: "devices" })).value;
    const mixer = await tool.run({ object: bass, property: "mixer_device" });

    assert.deepEqual(
        tracks.map((track: { id: string; name: string }) => [track.id, track.name]),
        [[bass, "Bass"]],
    );
    assert.equal(devices[0].id, eq);
    assert.doesNotMatch(mixer, /live_/);
});

test("live_get cannot change anything, even given the name of a function", async (t) => {
    const { live, tool, get } = await setup(t);
    const before = sentNames().length;

    await get({ object: "song", property: "continue_playing" });
    await get({ object: "song", property: "create_midi_track", value: 0 });

    assert.equal(live.get("song")?.is_playing, false);
    assert.equal((live.get("song")?.tracks as unknown[] | undefined)?.length, 1);
    assert.deepEqual(new Set(sentNames().slice(before)), new Set(["get_prop"]));
    assert.equal(tool.needsApproval, undefined);
    assert.deepEqual(Object.keys((tool.params as { properties: object }).properties), ["object", "property"]);
});

test("live_get returns Live's error as it is", async (t) => {
    const { client, tool } = await setup(t);
    const main = JSON.parse(await readSet(client).run({})).tracks[1].id;

    await assert.rejects(async () => tool.run({ object: main, property: "arrangement_clips" }), /arrangement_clips is not available on this track/);
});

test("live_get refuses an object that is not the song or an object id of a track, device, clip or rack chain", async (t) => {
    const { tool } = await setup(t);

    for (const object of [undefined, "x1", "n3", "Song", 4]) {
        await assert.rejects(async () => tool.run({ object, property: "name" }), /object must be "song" or the object id of a track, device, clip or rack chain/i);
    }
});

test("live_get refuses a property that is not one of Live's names", async (t) => {
    const { tool } = await setup(t);

    for (const property of [undefined, "", "tempo; x", "Tempo", 3]) {
        await assert.rejects(async () => tool.run({ object: "song", property }), /property must be one of Live's names, such as/i);
    }
});

test("live_get refuses an object deleted in Live since it was read, and says to read again", async (t) => {
    const { live, client, tool, eq } = await setup(t);
    live.delete(client.scriptId(eq));

    await assert.rejects(async () => tool.run({ object: eq, property: "name" }), new RegExp(`${eq} is no longer in the Live Set.*read again`, "i"));
});

test("live_get keeps an answer past the result limit short, with its count and a way to read less", async (t) => {
    const { live, track, set } = liveSet({ tempo: 124, numerator: 4, denominator: 4 });
    const tracks = Array.from({ length: 600 }, (_, i) => track({ name: `A track with a long name, number ${i}`, type: "audio", volume: "0.0 dB", pan: "C" }));
    set({ tracks, return_tracks: [], master_track: track({ name: "Main", type: "main", volume: "0.0 dB", pan: "C" }) });
    useStandIn(t, live);

    const output = await liveGet(createClient(ADDRESS)).run({ object: "song", property: "tracks" });

    assert.ok(output.length < 40_000, `${output.length} characters`);
    const result = JSON.parse(output);
    assert.equal(result.count, 600);
    assert.equal("value" in result, false);
    assert.match(result.note, /past the result limit.*read_set/i);
});
