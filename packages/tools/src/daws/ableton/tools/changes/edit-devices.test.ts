import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../../client.ts";
import { ADDRESS, liveSet, StandInSocket, useStandIn } from "../../stand-in-live.ts";
import { readSet } from "../reads/read-set.ts";
import { readTracks } from "../reads/read-tracks.ts";
import { editDevices } from "./edit-devices.ts";

const deviceOn = { name: "Device On", items: ["off", "on"], value: 1 };

// A Live Set with one track, Bass, holding EQ Eight and then Limiter, and a rack on a second track.
// Reads it first, as the mentor does, so the tool is given object ids.
async function setup(t: TestContext) {
    const { live, track, set } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
    const bass = track({
        name: "Bass",
        type: "midi",
        volume: "0.0 dB",
        pan: "C",
        devices: [
            { name: "EQ Eight", class_name: "Eq8Device", parameters: [deviceOn] },
            { name: "Limiter", class_name: "Limiter", parameters: [deviceOn] },
            { name: "Drum Rack", class_name: "DrumGroupDevice", parameters: [deviceOn], chains: [{ name: "Kick" }] },
        ],
    });
    const plain = track({ name: "Pad", type: "audio", volume: "0.0 dB", pan: "C", devices: [{ name: "Utility", class_name: "StereoGain" }] });
    const main = track({ name: "Main", type: "main", volume: "0.0 dB", pan: "C" });
    set({ tracks: [bass, plain], return_tracks: [], master_track: main });
    useStandIn(t, live);
    const client = createClient(ADDRESS);
    const tool = editDevices(client);
    const overview = async () => JSON.parse(await readSet(client).run({})) as { tracks: { id: string; name: string; devices: { id: string; name: string }[] }[] };
    const [first, second] = (await overview()).tracks;
    const [eq, limiter, rack] = (first as { devices: { id: string }[] }).devices;
    const [utility] = (second as { devices: { id: string }[] }).devices;
    const chains = JSON.parse(await readTracks(client).run({ tracks: [first?.id], devices: [] })).tracks[0].devices[2].chains;
    const edit = async (edits: unknown[]) => JSON.parse(await tool.run({ edits })).edits;
    const names = async (trackId: string) => (await overview()).tracks.find((track) => track.id === trackId)?.devices.map((device) => device.name);
    return {
        tool,
        edit,
        names,
        track: first?.id as string,
        pad: second?.id as string,
        utility: utility?.id as string,
        eq: eq?.id as string,
        limiter: limiter?.id as string,
        rack: rack?.id as string,
        chain: chains[0].id as string,
    };
}

// The commands sent after the handshake, as each Live function was called.
const sentNames = () => StandInSocket.opened.flatMap((socket) => socket.sent.flatMap((request) => request.commands.map((command) => command.name)));

test("edit_devices adds a native device at a position and gives its object id and the new order", async (t) => {
    const { edit, names, track, limiter } = await setup(t);

    const [added] = await edit([{ action: "add", name: "Compressor", to: track, position: 2 }]);

    assert.match(added.device, /^d\d+$/);
    assert.notEqual(added.device, limiter);
    assert.deepEqual([added.action, added.name, added.in, added.position], ["add", "Compressor", track, 2]);
    assert.deepEqual(
        added.order.map((device: { name: string }) => device.name),
        ["EQ Eight", "Compressor", "Limiter", "Drum Rack"],
    );
    assert.equal(added.order[1].id, added.device);
    assert.deepEqual(await names(track), ["EQ Eight", "Compressor", "Limiter", "Drum Rack"]);
});

test("edit_devices adds at the end when no position is given", async (t) => {
    const { edit, track } = await setup(t);

    const [added] = await edit([{ action: "add", name: "Reverb", to: track }]);

    assert.equal(added.position, 4);
    assert.equal(added.order.at(-1).name, "Reverb");
});

test("edit_devices adds a device into a rack chain", async (t) => {
    const { edit, chain } = await setup(t);

    const [added] = await edit([{ action: "add", name: "Saturator", to: chain, position: 1 }]);

    assert.equal(added.in, chain);
    assert.deepEqual(
        added.order.map((device: { name: string }) => device.name),
        ["Saturator"],
    );
});

test("edit_devices says what is native when Live does not know the name, and carries on with the other edits", async (t) => {
    const { edit, track } = await setup(t);

    const [refused, added] = await edit([
        { action: "add", name: "Serum", to: track },
        { action: "add", name: "Utility", to: track, position: 1 },
    ]);

    assert.equal(refused.action, "add");
    assert.match(refused.error, /Serum.*not found.*native.*name Live shows/i);
    assert.equal(added.order[0].name, "Utility");
});

test("edit_devices refuses a position past the end of the chain, and asks Live nothing", async (t) => {
    const { edit, track } = await setup(t);
    const before = sentNames().length;

    const [refused] = await edit([{ action: "add", name: "Reverb", to: track, position: 9 }]);

    assert.match(refused.error, /position.*1 to 4/i);
    assert.equal(sentNames().slice(before).includes("insert_device"), false);
});

test("edit_devices refuses a position that is not a whole number from 1", async (t) => {
    const { edit, track } = await setup(t);

    for (const position of [0, 1.5, "2"]) {
        const [refused] = await edit([{ action: "add", name: "Reverb", to: track, position }]);
        assert.match(refused.error, /position must be a whole number from 1/i);
    }
});

test("edit_devices moves a device within its chain and reports the new order", async (t) => {
    const { edit, names, track, limiter, eq } = await setup(t);

    const [moved] = await edit([{ action: "move", device: limiter, to: track, position: 1 }]);

    assert.equal(moved.action, "move");
    assert.equal(moved.device, limiter);
    assert.equal(moved.position, 1);
    assert.deepEqual(moved.order, [
        { id: limiter, name: "Limiter" },
        { id: eq, name: "EQ Eight" },
        { id: moved.order[2].id, name: "Drum Rack" },
    ]);
    assert.deepEqual(await names(track), ["Limiter", "EQ Eight", "Drum Rack"]);
});

test("edit_devices moves a device to another track", async (t) => {
    const { edit, pad, limiter } = await setup(t);

    const [moved] = await edit([{ action: "move", device: limiter, to: pad, position: 2 }]);

    assert.equal(moved.in, pad);
    assert.deepEqual(
        moved.order.map((device: { name: string }) => device.name),
        ["Utility", "Limiter"],
    );
});

test("edit_devices needs a position to move a device", async (t) => {
    const { edit, track, limiter } = await setup(t);

    const [refused] = await edit([{ action: "move", device: limiter, to: track }]);

    assert.match(refused.error, /position/i);
});

test("edit_devices switches a device off and on, with before and after", async (t) => {
    const { edit, eq } = await setup(t);

    const [off] = await edit([{ action: "switch", device: eq, on: false }]);
    const [on] = await edit([{ action: "switch", device: eq, on: true }]);

    assert.deepEqual(off, { action: "switch", device: eq, name: "EQ Eight", before: "on", after: "off" });
    assert.deepEqual(on, { action: "switch", device: eq, name: "EQ Eight", before: "off", after: "on" });
});

test("edit_devices needs on to be true or false to switch a device", async (t) => {
    const { edit, eq } = await setup(t);

    const [refused] = await edit([{ action: "switch", device: eq, on: "off" }]);

    assert.match(refused.error, /on must be true or false/i);
});

test("edit_devices says when a device has no switch", async (t) => {
    const { edit, utility } = await setup(t);

    const [refused] = await edit([{ action: "switch", device: utility, on: false }]);

    assert.match(refused.error, /no Device On switch/i);
});

test("edit_devices has no way to delete a device", async (t) => {
    const { edit, eq, track } = await setup(t);
    const before = sentNames().length;

    const results = await edit([
        { action: "delete", device: eq },
        { action: "remove", device: eq, to: track },
    ]);

    for (const result of results) assert.match(result.error, /add, move or switch/i);
    assert.match(results[0].error, /delete/);
    assert.equal(sentNames().length, before);
    assert.equal(sentNames().some((name) => name.includes("delete")), false);
});

test("edit_devices applies edits in order, and a failed one does not stop the rest", async (t) => {
    const { edit, names, track, eq, limiter } = await setup(t);

    const results = await edit([
        { action: "switch", device: eq, on: false },
        { action: "move", device: "d99", to: track, position: 1 },
        { action: "move", device: limiter, to: track, position: 1 },
    ]);

    assert.equal(results[0].after, "off");
    assert.match(results[1].error, /d99.*read again/i);
    assert.equal(results[2].position, 1);
    assert.deepEqual(await names(track), ["Limiter", "EQ Eight", "Drum Rack"]);
});

test("edit_devices tells a device id from a track or chain id", async (t) => {
    const { edit, track, eq } = await setup(t);

    const results = await edit([
        { action: "add", name: "Reverb", to: eq },
        { action: "move", device: track, to: track, position: 1 },
        { action: "switch", device: "t1" },
    ]);

    assert.match(results[0].error, /to.*track or a rack chain/i);
    assert.match(results[1].error, /device.*object id of a device/i);
    assert.match(results[2].error, /device.*object id of a device/i);
});

test("edit_devices needs a list of edits", async (t) => {
    const { tool } = await setup(t);

    for (const edits of [undefined, [], "add", [1]]) {
        await assert.rejects(async () => tool.run({ edits }), /edits must be a list of one or more edits/i);
    }
});

test("edit_devices is not marked as needing approval", async (t) => {
    const { tool } = await setup(t);

    assert.equal(tool.needsApproval, undefined);
});
