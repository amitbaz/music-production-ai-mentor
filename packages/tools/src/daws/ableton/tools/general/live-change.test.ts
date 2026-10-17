import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../../client.ts";
import { ADDRESS, liveSet, StandInSocket, useStandIn } from "../../stand-in-live.ts";
import { readSet } from "../reads/read-set.ts";
import { liveChange } from "./live-change.ts";
import { liveGet } from "./live-get.ts";

const requests = () => StandInSocket.opened.flatMap((socket) => socket.sent).length;

// A Live Set with Bass and Main. Reads it first, as the mentor does.
async function setup(t: TestContext) {
    const { live, track, set } = liveSet({ tempo: 124, numerator: 4, denominator: 4 });
    const bass = track({ name: "Bass", type: "midi", volume: "0.0 dB", pan: "C" });
    const main = track({ name: "Main", type: "main", volume: "0.0 dB", pan: "C" });
    set({ tracks: [bass], return_tracks: [], master_track: main });
    useStandIn(t, live);
    const client = createClient(ADDRESS);
    const tool = liveChange(client);
    const bassId = JSON.parse(await readSet(client).run({})).tracks[0].id as string;
    const change = async (args: Record<string, unknown>) => JSON.parse(await tool.run(args));
    return { live, client, tool, change, bass: bassId, song: live.get("song") as Record<string, unknown> };
}

test("live_change sets a property and gives the value before and after", async (t) => {
    const { change, bass, song } = await setup(t);

    assert.deepEqual(await change({ object: bass, property: "mute", value: true }), { object: bass, property: "mute", before: false, after: true });
    assert.deepEqual(await change({ object: "song", property: "tempo", value: 128 }), { object: "song", property: "tempo", before: 124, after: 128 });
    assert.equal(song.tempo, 128);
});

test("live_change calls a function of the song, with or without arguments", async (t) => {
    const { change, song } = await setup(t);

    const played = await change({ object: "song", function: "continue_playing" });
    await change({ object: "song", function: "duplicate_track", args: [0] });

    assert.deepEqual(played, { object: "song", function: "continue_playing", result: null });
    assert.equal(song.is_playing, true);
    assert.equal((song.tracks as unknown[]).length, 2);
});

test("live_change never gives the script's own ids in a function's answer", async (t) => {
    const { tool } = await setup(t);

    const output = await tool.run({ object: "song", function: "create_midi_track", args: { index: -1 } });

    assert.doesNotMatch(output, /live_/);
    assert.match(output, /"name":"MIDI"/);
});

test("live_change gives Live objects in the value before and after as object ids", async (t) => {
    const { change, client } = await setup(t);
    const main = JSON.parse(await readSet(client).run({})).tracks[1].id;

    // The stand-in takes any value; the property is one that holds a track.
    const result = await change({ object: "song", property: "master_track", value: null });

    assert.equal(result.before.id, main);
});

test("live_change keeps a function's answer past the result limit short", async (t) => {
    const { live, tool } = await setup(t);
    (live.get("song") as Record<string, unknown>).list_everything = () => Array.from({ length: 5000 }, (_, i) => ({ name: `Item ${i}` }));

    const output = await tool.run({ object: "song", function: "list_everything" });

    assert.ok(output.length < 40_000, `${output.length} characters`);
    assert.equal(JSON.parse(output).count, 5000);
});

test("after live_change deletes a track with Live's own function, its id says it is gone, and to read again", async (t) => {
    const { client, change, bass } = await setup(t);

    await change({ object: "song", function: "delete_track", args: [0] });

    await assert.rejects(async () => liveGet(client).run({ object: bass, property: "name" }), new RegExp(`${bass} is no longer in the Live Set.*read again`, "i"));
});

test("live_change refuses the script's own functions, which are not Live's", async (t) => {
    const { tool } = await setup(t);

    for (const name of ["add_listener", "remove_listener", "get_prop", "set_prop", "dispatch", "get_obj", "save_obj", "serialize_track", "serialize_clip"]) {
        await assert.rejects(async () => tool.run({ object: "song", function: name }), new RegExp(`${name} belongs to the script`));
    }
});

// The script reads these args as its own ids, so an object id there would not be found.
test("live_change refuses a function that takes a Live object, says what to do instead, and sends Live nothing", async (t) => {
    const { tool, bass } = await setup(t);
    const sent = requests();

    for (const [name, instead] of [
        ["delete_clip", /\bdelete\b/],
        ["duplicate_clip_to_arrangement", /edit_arrangement.*duplicate/],
        ["automation_envelope", /give the user the steps/],
        ["create_automation_envelope", /give the user the steps/],
        ["clear_envelope", /give the user the steps/],
        ["export_to_clip_slot", /give the user the steps/],
        ["move_device", /edit_devices.*move/],
        ["find_device_position", /edit_devices.*move/],
    ] as const) {
        await assert.rejects(async () => tool.run({ object: bass, function: name, args: ["c2"] }), new RegExp(`${name}.*${instead.source}`));
    }

    assert.equal(requests(), sent);
});

test("live_change refuses to set the appointed device, which takes a Live object, names show, and sends Live nothing", async (t) => {
    const { tool } = await setup(t);
    const sent = requests();

    await assert.rejects(async () => tool.run({ object: "song", property: "appointed_device", value: "d1" }), /appointed_device.*\bshow\b/);

    assert.equal(requests(), sent);
});

test("live_change is marked as needing approval", async (t) => {
    const { tool } = await setup(t);

    assert.equal(tool.needsApproval, true);
});

test("live_change returns Live's error as it is", async (t) => {
    const { live, client, tool, bass } = await setup(t);
    (live.get(client.scriptId(bass)) as Record<string, unknown>).refuses = "name";

    await assert.rejects(async () => tool.run({ object: bass, property: "name", value: "Sub" }), /name could not be set/);
    await assert.rejects(async () => tool.run({ object: "song", function: "make_it_louder" }), /make_it_louder doesn't exist/);
});

test("live_change takes either a property with a value or a function", async (t) => {
    const { tool, bass } = await setup(t);

    for (const args of [
        { object: bass },
        { object: bass, property: "mute", function: "stop_all_clips", value: true },
        { object: bass, property: "mute" },
    ]) {
        await assert.rejects(async () => tool.run(args), /either property with value, or function/i);
    }
    await assert.rejects(async () => tool.run({ object: "song", function: "continue_playing", args: 3 }), /args must be a list or an object/i);
    await assert.rejects(async () => tool.run({ object: "song", function: "stop playing" }), /function must be one of Live's names/i);
    await assert.rejects(async () => tool.run({ object: "c9", property: "name", value: "x" }), /c9 is not an object id from the current connection/);
});
