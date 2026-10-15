import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createAgent, type Message, type Model } from "@mentor/harness";
import { createClient } from "../../client.ts";
import { ADDRESS, liveSet, useStandIn } from "../../stand-in-live.ts";
import { readArrangement } from "../reads/read-arrangement.ts";
import { readClip } from "../reads/read-clip.ts";
import { readSet } from "../reads/read-set.ts";
import { readTracks } from "../reads/read-tracks.ts";
import { editDevices } from "../changes/edit-devices.ts";
import { setParameters } from "../changes/set-parameters.ts";
import { liveGet } from "../general/live-get.ts";
import { deleteTool } from "./delete.ts";

const note = (pitch: number, start_time: number, duration: number, velocity = 100, probability = 1) => ({
    pitch,
    start_time,
    duration,
    velocity,
    probability,
});

type Overview = { tracks: { id: string; name: string; devices?: { id: string; name: string }[] }[] };

// A Live Set with Bass (EQ Eight, Limiter and a rack whose chain holds Saturator, an arrangement
// MIDI clip and a Session clip), Pad, a return track and Main. Reads it first, as the mentor does,
// so the tool is given object ids.
async function setup(t: TestContext) {
    const { live, track, set } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
    const bass = track({
        name: "Bass",
        type: "midi",
        volume: "0.0 dB",
        pan: "C",
        devices: [
            { name: "EQ Eight", class_name: "Eq8" },
            { name: "Limiter", class_name: "Limiter" },
            { name: "Audio Effect Rack", class_name: "AudioEffectGroupDevice", chains: [{ name: "Dirt", devices: [{ name: "Saturator", class_name: "Saturator" }] }] },
        ],
        arrangement: [{ name: "Bass line", kind: "midi", start: 0, end: 16, notes: [note(36, 0, 1, 112, 0.5), note(43, 1, 0.5, 90), note(48, 2, 0.25)] }],
        session: [{ name: "Idea", kind: "midi" }],
    });
    const pad = track({ name: "Pad", type: "audio", volume: "0.0 dB", pan: "C" });
    const reverb = track({ name: "A-Reverb", type: "return", volume: "0.0 dB", pan: "C" });
    const main = track({ name: "Main", type: "main", volume: "0.0 dB", pan: "C" });
    set({ tracks: [bass, pad], return_tracks: [reverb], master_track: main });
    useStandIn(t, live);
    const client = createClient(ADDRESS);
    const tool = deleteTool(client);

    const overview = async () => JSON.parse(await readSet(client).run({})) as Overview;
    const [bassTrack, padTrack, reverbTrack, mainTrack] = (await overview()).tracks.map((track) => track.id) as string[];
    const detail = JSON.parse(await readTracks(client).run({ tracks: [bassTrack], devices: [] })).tracks[0];
    const [eq, limiter, rack] = detail.devices.map((device: { id: string }) => device.id);
    const saturator = detail.devices[2].chains[0].devices[0].id;
    const sessionClip = detail.session[0].id;
    const arrangementClip = detail.arrangement[0].id;
    // read_clip gives note ids in #12; until then the test names the notes as the client would.
    const noteId = (noteNumber: number) => client.objectId("n", `${client.scriptId(arrangementClip)}:${noteNumber}`);

    const remove = async (ids: unknown) => JSON.parse(await tool.run({ ids })).deleted;
    const names = async () => (await overview()).tracks.map((track) => [track.name, track.devices?.map((device) => device.name)]);
    const notes = async () => JSON.parse(await readClip(client).run({ clip: arrangementClip })).notes;
    return {
        live,
        client,
        tool,
        remove,
        names,
        notes,
        noteId,
        ids: { bassTrack, padTrack, reverbTrack, mainTrack, eq, limiter, rack, saturator, sessionClip, arrangementClip },
    };
}

test("delete removes a track, a device and a clip by object id, and names each", async (t) => {
    const { remove, names, ids, client } = await setup(t);

    const deleted = await remove([ids.limiter, ids.padTrack, ids.arrangementClip]);

    assert.deepEqual(deleted, [
        { id: ids.limiter, name: "Limiter" },
        { id: ids.padTrack, name: "Pad" },
        { id: ids.arrangementClip, name: "Bass line" },
    ]);
    assert.deepEqual(await names(), [
        ["Bass", ["EQ Eight", "Audio Effect Rack"]],
        ["A-Reverb", undefined],
        ["Main", undefined],
    ]);
    assert.doesNotMatch(await readArrangement(client).run({}), /Bass line/);
});

test("delete removes a Session clip, a device inside a rack chain, and a return track", async (t) => {
    const { remove, names, ids, client } = await setup(t);

    const deleted = await remove([ids.sessionClip, ids.saturator, ids.reverbTrack]);

    assert.deepEqual(
        deleted.map((item: { name: string }) => item.name),
        ["Idea", "Saturator", "A-Reverb"],
    );
    assert.deepEqual(
        (await names()).map(([name]) => name),
        ["Bass", "Pad", "Main"],
    );
    const detail = JSON.parse(await readTracks(client).run({ tracks: [ids.bassTrack], devices: [] })).tracks[0];
    assert.equal(detail.session, undefined);
    assert.equal(detail.devices[2].chains[0].devices, undefined);
});

test("delete removes chosen notes from a MIDI clip and reports each with its clip", async (t) => {
    const { remove, notes, noteId, ids } = await setup(t);

    const [first, third] = [noteId(1), noteId(3)];

    const deleted = await remove([first, third]);

    assert.deepEqual(deleted, [
        { id: first, clip: ids.arrangementClip, clip_name: "Bass line", note: [36, 0, 1, 112, 0.5] },
        { id: third, clip: ids.arrangementClip, clip_name: "Bass line", note: [48, 2, 0.25, 100, 1] },
    ]);
    assert.deepEqual(await notes(), [[43, 1, 0.5, 90, 1]]);
});

test("delete removes what is inside before what holds it, whatever the order asked", async (t) => {
    const { remove, names, ids, noteId } = await setup(t);

    const second = noteId(2);

    const deleted = await remove([ids.bassTrack, ids.eq, ids.arrangementClip, second]);

    assert.deepEqual(
        deleted.map((item: { id: string; error?: string }) => [item.id, item.error]),
        [
            [ids.bassTrack, undefined],
            [ids.eq, undefined],
            [ids.arrangementClip, undefined],
            [second, undefined],
        ],
    );
    assert.deepEqual(
        (await names()).map(([name]) => name),
        ["Pad", "A-Reverb", "Main"],
    );
});

test("a deleted object's id is refused afterwards, with a message to read again", async (t) => {
    const { remove, ids, client, noteId } = await setup(t);
    const firstNote = noteId(1);
    await remove([ids.limiter, ids.arrangementClip]);

    const [again] = await remove([ids.limiter]);

    assert.match(again.error, new RegExp(`${ids.limiter} was deleted.*read again`, "i"));
    await assert.rejects(async () => readClip(client).run({ clip: ids.arrangementClip }), /was deleted.*read again/i);
    const [gone] = await remove([firstNote]);
    assert.match(gone.error, /no longer in the Live Set.*read again/i);
});

test("delete reports a device that went with the rack deleted before it in the same call as gone", async (t) => {
    const { remove, ids } = await setup(t);

    const [rack, saturator] = await remove([ids.rack, ids.saturator]);

    assert.equal(rack.name, "Audio Effect Rack");
    assert.match(saturator.error, new RegExp(`${ids.saturator} is no longer in the Live Set.*read again`, "i"));
});

test("after a track is deleted, the other tools say what was on it is gone, and to read again", async (t) => {
    const { remove, client, ids } = await setup(t);
    await remove([ids.bassTrack]);
    const gone = new RegExp(`${ids.eq} is no longer in the Live Set.*read again`, "i");

    await assert.rejects(async () => liveGet(client).run({ object: ids.eq, property: "name" }), gone);
    assert.match(await setParameters(client).run({ changes: [{ target: ids.eq, parameter: "Gain", value: 1 }] }), gone);
    assert.match(JSON.parse(await editDevices(client).run({ edits: [{ action: "switch", device: ids.eq, on: false }] })).edits[0].error, gone);
    await assert.rejects(async () => readClip(client).run({ clip: ids.arrangementClip }), /no longer in the Live Set.*read_arrangement/i);
});

test("delete gives Live's error for an item it cannot remove, and carries on with the rest", async (t) => {
    const { remove, names, ids } = await setup(t);

    const [main, pad] = await remove([ids.mainTrack, ids.padTrack]);

    assert.equal(main.id, ids.mainTrack);
    assert.match(main.error, /Main cannot be deleted/);
    assert.equal(pad.name, "Pad");
    assert.deepEqual(
        (await names()).map(([name]) => name),
        ["Bass", "A-Reverb", "Main"],
    );
});

test("delete reports an object the user deleted in Live meanwhile as gone, and says to read again", async (t) => {
    const { live, remove, client, ids } = await setup(t);
    live.delete(client.scriptId(ids.eq));

    const [gone] = await remove([ids.eq]);

    assert.match(gone.error, new RegExp(`${ids.eq} is no longer in the Live Set.*read again`, "i"));
});

test("delete refuses an id that is not a track, device, clip or note", async (t) => {
    const { remove } = await setup(t);

    const results = await remove(["song", "ch1", "x3"]);

    for (const result of results) assert.match(result.error, /track, device, clip or note/i);
});

test("delete needs a list of object ids", async (t) => {
    const { tool } = await setup(t);

    for (const ids of [undefined, [], "t1", [1]]) {
        await assert.rejects(async () => tool.run({ ids }), /ids must be a list of one or more object ids/i);
    }
});

test("delete is marked as needing approval, and a refusal leaves the Live Set unchanged", async (t) => {
    const { tool, names, ids } = await setup(t);
    const before = await names();
    const replies: Message[][] = [
        [{ type: "tool_call", id: "1", name: "delete", args: { ids: [ids.padTrack, ids.eq] } }],
        [{ type: "assistant", text: "Left as it is." }],
    ];
    const model: Model = { call: async () => ({ messages: replies.shift() ?? [], cutOff: false }) };
    const agent = createAgent({ model, system: "", tools: [tool] });

    const result = await agent.generate([], "delete Pad", { approve: async () => false });

    assert.equal(tool.needsApproval, true);
    const refused = result.messages.find((message) => message.type === "tool_result");
    assert.equal(refused?.type === "tool_result" && refused.isError, true);
    assert.deepEqual(await names(), before);
});
