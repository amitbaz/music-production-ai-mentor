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

test("edit_devices refuses a move past the end of the device's own chain, and asks Live nothing", async (t) => {
    const { edit, names, track, limiter } = await setup(t);
    const before = sentNames().length;

    // The chain holds 3 devices, Limiter among them, so its last place is 3.
    const [refused] = await edit([{ action: "move", device: limiter, to: track, position: 4 }]);

    assert.match(refused.error, /position.*1 to 3/i);
    assert.equal(sentNames().slice(before).includes("move_device"), false);
    assert.deepEqual(await names(track), ["EQ Eight", "Limiter", "Drum Rack"]);
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

    for (const result of results) assert.match(result.error, /add, load, move or switch/i);
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

// A Live Set to load into: Bass, a MIDI track with Pitch, Drift and EQ Eight; Keys, a MIDI track with
// only Pitch; and Pad, an audio track with Utility and a rack. The browser holds what Live loads, as
// the device each item becomes. The user has Pad selected.
async function setupLoad(t: TestContext) {
    const { live, track, set, browser } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
    const pitch = { name: "Pitch", class_name: "MidiPitcher", type: "midi_effect" as const };
    const bass = track({
        name: "Bass",
        type: "midi",
        volume: "0.0 dB",
        pan: "C",
        devices: [pitch, { name: "Drift", class_name: "Drift", type: "instrument" }, { name: "EQ Eight", class_name: "Eq8" }],
    });
    const keys = track({ name: "Keys", type: "midi", volume: "0.0 dB", pan: "C", devices: [pitch] });
    const pad = track({
        name: "Pad",
        type: "audio",
        volume: "0.0 dB",
        pan: "C",
        devices: [
            { name: "Utility", class_name: "StereoGain" },
            { name: "Audio Effect Rack", class_name: "AudioEffectGroupDevice", chains: [{ name: "Wet", devices: [{ name: "Reverb", class_name: "Reverb" }] }] },
        ],
    });
    const main = track({ name: "Main", type: "main", volume: "0.0 dB", pan: "C" });
    set({ tracks: [bass, keys, pad], return_tracks: [], master_track: main });
    browser({
        instruments: [{ name: "Drift", device: true, children: [{ name: "Bass", children: [{ name: "808 Drifter.adg", loads: { name: "808 Drifter", class_name: "InstrumentGroupDevice", type: "instrument" } }] }] }],
        drums: [
            { name: "505 Core Kit.adg", loads: { name: "505 Core Kit", class_name: "DrumGroupDevice", type: "instrument" } },
            { name: "Kit", children: [{ name: "Kit", loads: { name: "Kit", class_name: "DrumGroupDevice", type: "instrument" } }] },
        ],
        audio_effects: [
            { name: "Glue Compressor", device: true, children: [{ name: "Glue Punch.adv", loads: { name: "Glue Punch", class_name: "GlueCompressor" } }] },
        ],
        user_library: [
            {
                name: "Presets",
                children: [
                    { name: "Audio Effects", children: [{ name: "My Glue.adv", loads: { name: "My Glue", class_name: "GlueCompressor" } }] },
                    { name: "My Keys.adg", loads: { name: "My Keys", class_name: "InstrumentGroupDevice", type: "instrument" } },
                    { name: "Keys with Audio Effects.adg", loads: { name: "Keys with Audio Effects", class_name: "InstrumentGroupDevice", type: "instrument" } },
                ],
            },
        ],
        samples: [{ name: "Kick.wav", loads: { name: "Kick", class_name: "OriginalSimpler", type: "instrument", sample: true } }],
    });
    (live.get("song-view") as Record<string, unknown>).selected_track = pad.id;
    useStandIn(t, live);
    const client = createClient(ADDRESS);
    const tool = editDevices(client);
    const overview = async () => JSON.parse(await readSet(client).run({})) as { tracks: { id: string; name: string; devices: { id: string; name: string }[] }[] };
    const tracks = (await overview()).tracks;
    const ids = Object.fromEntries(tracks.map((read) => [read.name, read.id])) as Record<"Bass" | "Keys" | "Pad", string>;
    const [, rack] = (tracks[2] as { devices: { id: string }[] }).devices;
    const chains = JSON.parse(await readTracks(client).run({ tracks: [ids.Pad], devices: [] })).tracks[0].devices[1].chains;
    const edit = async (edits: unknown[]) => JSON.parse(await tool.run({ edits })).edits;
    const names = async (trackId: string) => (await overview()).tracks.find((read) => read.id === trackId)?.devices.map((device) => device.name);
    const chainNames = async () => JSON.parse(await readTracks(client).run({ tracks: [ids.Pad], devices: [] })).tracks[0].devices[1].chains[0].devices.map((device: { name: string }) => device.name);
    const drift = (tracks[0] as { devices: { id: string }[] }).devices[1]?.id as string;
    return { live, edit, names, chainNames, ...ids, pad: pad.id, rack: rack?.id as string, chain: chains[0].id as string, drift };
}

test("edit_devices loads an effect preset from the browser at a position and gives its object id and the new order", async (t) => {
    const { edit, names, Pad } = await setupLoad(t);

    const [loaded] = await edit([{ action: "load", item: "audio_effects/Glue Compressor/Glue Punch.adv", to: Pad, position: 1 }]);

    assert.match(loaded.device, /^d\d+$/);
    assert.deepEqual([loaded.action, loaded.name, loaded.in, loaded.position], ["load", "Glue Punch", Pad, 1]);
    assert.equal(loaded.item, "audio_effects/Glue Compressor/Glue Punch.adv");
    assert.deepEqual(
        loaded.order.map((device: { name: string }) => device.name),
        ["Glue Punch", "Utility", "Audio Effect Rack"],
    );
    assert.deepEqual(await names(Pad), ["Glue Punch", "Utility", "Audio Effect Rack"]);
});

test("edit_devices loads an effect preset into a rack chain, at its end when no position is given", async (t) => {
    const { edit, names, chainNames, Pad, chain } = await setupLoad(t);

    const [loaded] = await edit([{ action: "load", item: "audio_effects/Glue Compressor/Glue Punch.adv", to: chain }]);

    assert.deepEqual([loaded.in, loaded.position], [chain, 2]);
    assert.deepEqual(await chainNames(), ["Reverb", "Glue Punch"]);
    assert.deepEqual(await names(Pad), ["Utility", "Audio Effect Rack"]);
});

test("edit_devices loads a kit onto a MIDI track in the instrument's place", async (t) => {
    const { edit, names, Keys } = await setupLoad(t);

    const [kit] = await edit([{ action: "load", item: "drums/505 Core Kit.adg", to: Keys }]);
    assert.deepEqual([kit.name, kit.in, kit.position], ["505 Core Kit", Keys, 2]);
    assert.deepEqual(await names(Keys), ["Pitch", "505 Core Kit"]);
});

test("edit_devices loads a sample onto a MIDI track with no instrument, as a Simpler", async (t) => {
    const { edit, names, Keys } = await setupLoad(t);

    const [sample] = await edit([{ action: "load", item: "samples/Kick.wav", to: Keys }]);

    assert.deepEqual([sample.name, sample.position], ["Kick", 2]);
    assert.deepEqual(await names(Keys), ["Pitch", "Kick"]);
});

test("edit_devices selects the user's track again after a load", async (t) => {
    const { live, edit, Keys, pad } = await setupLoad(t);

    await edit([{ action: "load", item: "drums/505 Core Kit.adg", to: Keys }]);

    assert.equal((live.get("song-view") as { selected_track: string }).selected_track, pad);
});

test("edit_devices refuses to load an instrument or sample where the track has an instrument, and points to delete", async (t) => {
    const { edit, names, Bass, drift } = await setupLoad(t);

    const results = await edit([
        { action: "load", item: "instruments/Drift/Bass/808 Drifter.adg", to: Bass },
        { action: "load", item: "samples/Kick.wav", to: Bass },
    ]);

    for (const result of results) {
        assert.match(result.error, new RegExp(`${Bass} already has an instrument, ${drift} Drift`));
        assert.match(result.error, /delete it first with delete/i);
    }
    assert.deepEqual(await names(Bass), ["Pitch", "Drift", "EQ Eight"]);
});

test("edit_devices refuses to load an instrument or sample onto an audio track", async (t) => {
    const { edit, names, Pad } = await setupLoad(t);

    const [result] = await edit([{ action: "load", item: "drums/505 Core Kit.adg", to: Pad }]);

    assert.match(result.error, /MIDI track/);
    assert.deepEqual(await names(Pad), ["Utility", "Audio Effect Rack"]);
});

test("edit_devices loads an instrument only onto a track, with no position", async (t) => {
    const { edit, names, Keys, chain } = await setupLoad(t);

    const results = await edit([
        { action: "load", item: "drums/505 Core Kit.adg", to: chain },
        { action: "load", item: "samples/Kick.wav", to: Keys, position: 1 },
    ]);

    for (const result of results) assert.match(result.error, /An instrument goes onto a track, in the instrument's place\. Give a track as to, with no position\./);
    assert.deepEqual(await names(Keys), ["Pitch"]);
});

test("edit_devices says which part of a browser path is not there, and that a folder cannot be loaded", async (t) => {
    const { edit, Keys } = await setupLoad(t);

    const results = await edit([
        { action: "load", item: "instruments/Drift/Lead/Saw Lead.adg", to: Keys },
        { action: "load", item: "instruments/Drift/Bass", to: Keys },
        { action: "load", item: "Glue Punch.adv", to: Keys },
        { action: "load", to: Keys },
    ]);

    assert.match(results[0].error, /instruments\/Drift has no Lead/);
    assert.match(results[0].error, /find_in_browser/);
    assert.match(results[1].error, /instruments\/Drift\/Bass is a folder/);
    for (const result of results.slice(2)) assert.match(result.error, /item must be a browser path/);
});

test("edit_devices reports a load that Live did not make", async (t) => {
    const { edit, names, Keys } = await setupLoad(t);

    // The stand-in browser's Drift has no device to load, as when Live loads nothing and says nothing.
    const [result] = await edit([{ action: "load", item: "instruments/Drift", to: Keys }]);

    assert.match(result.error, /Live loaded nothing from instruments\/Drift/);
    assert.deepEqual(await names(Keys), ["Pitch"]);
});

test("edit_devices finds an item in a folder of the same name", async (t) => {
    const { edit, names, Keys } = await setupLoad(t);

    const [loaded] = await edit([{ action: "load", item: "drums/Kit/Kit", to: Keys }]);

    assert.equal(loaded.name, "Kit");
    assert.deepEqual(await names(Keys), ["Pitch", "Kit"]);
});

test("edit_devices loads an effect from the user library's Audio Effects onto a track with an instrument", async (t) => {
    const { edit, names, Bass } = await setupLoad(t);

    const [loaded] = await edit([{ action: "load", item: "user_library/Presets/Audio Effects/My Glue.adv", to: Bass, position: 3 }]);

    assert.equal(loaded.position, 3);
    assert.deepEqual(await names(Bass), ["Pitch", "Drift", "My Glue", "EQ Eight"]);
});

test("edit_devices tells an instrument from an effect by its folders, not by its own name", async (t) => {
    const { edit, names, Bass } = await setupLoad(t);

    const [refused] = await edit([{ action: "load", item: "user_library/Presets/Keys with Audio Effects.adg", to: Bass }]);

    assert.match(refused.error, /already has an instrument/);
    assert.deepEqual(await names(Bass), ["Pitch", "Drift", "EQ Eight"]);
});

test("edit_devices reports an item the path did not show to be an instrument where Live put it", async (t) => {
    const { edit, names, Keys, Pad } = await setupLoad(t);

    const [loaded, onAudio] = await edit([
        { action: "load", item: "user_library/Presets/My Keys.adg", to: Keys, position: 1 },
        { action: "load", item: "user_library/Presets/My Keys.adg", to: Pad },
    ]);

    assert.deepEqual([loaded.name, loaded.in, loaded.position], ["My Keys", Keys, 2]);
    assert.deepEqual(await names(Keys), ["Pitch", "My Keys"]);
    assert.match(onAudio.error, /Live loaded nothing/);
    assert.match(onAudio.error, /MIDI track/);
});
