import { test } from "node:test";
import assert from "node:assert/strict";
import type { Tool } from "@mentor/harness";
import { createAbleton } from "../../ableton.ts";
import { ADDRESS, liveSet, StandInSocket, useStandIn } from "../../stand-in-live.ts";

function findTool(tools: Tool[], name: string): Tool {
    const tool = tools.find((tool) => tool.name === name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    return tool;
}

const main = { name: "Main", type: "main", volume: "0.0 dB", pan: "C" } as const;

// A Live Set with a bass track holding a device and a clip, and the tools to read it and show it.
function withBass(t: Parameters<typeof useStandIn>[0]) {
    const { live, track, set } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
    const bass = track({
        name: "Bass",
        type: "midi",
        volume: "0.0 dB",
        pan: "C",
        devices: [{ name: "EQ Eight", class_name: "Eq8" }],
        arrangement: [{ name: "Bass line", kind: "midi", start: 0, end: 16 }],
    });
    set({ tracks: [bass], return_tracks: [], master_track: track({ ...main }) });
    useStandIn(t, live);
    const tools = createAbleton({ address: ADDRESS });
    const view = live.get("song-view") as Record<string, unknown>;
    const application = live.get("application-view") as { views: string[] };
    return {
        live,
        bass,
        view,
        views: application.views,
        readSet: findTool(tools, "read_set"),
        readArrangement: findTool(tools, "read_arrangement"),
        show: findTool(tools, "show"),
    };
}

test("show selects a track in Live, by the object id read_set gave", async (t) => {
    const { bass, view, views, readSet, show } = withBass(t);
    const trackId = JSON.parse(await readSet.run({})).tracks[0].id;

    const output = JSON.parse(await show.run({ object: trackId }));

    assert.deepEqual(output, { shown: trackId, kind: "track", name: "Bass" });
    assert.equal(view.selected_track, bass.id);
    // A track needs no panel.
    assert.deepEqual(views, []);
});

test("show selects a device and opens the device view, so the user sees it", async (t) => {
    const { live, view, views, readSet, show } = withBass(t);
    const deviceId = JSON.parse(await readSet.run({})).tracks[0].devices[0].id;

    const output = JSON.parse(await show.run({ object: deviceId }));

    assert.deepEqual(output, { shown: deviceId, kind: "device", name: "EQ Eight", panel: "device view" });
    assert.equal(typeof view.selected_device, "string");
    assert.equal(live.get(view.selected_device as string)?.name, "EQ Eight");
    assert.deepEqual(views, ["Detail/DeviceChain"]);
});

test("show selects a clip and opens the clip view", async (t) => {
    const { live, view, views, readArrangement, show } = withBass(t);
    const clipId = JSON.parse(await readArrangement.run({})).tracks[0].clips[0][0];

    const output = JSON.parse(await show.run({ object: clipId }));

    assert.deepEqual(output, { shown: clipId, kind: "clip", name: "Bass line", panel: "clip view" });
    assert.equal(live.get(view.detail_clip as string)?.name, "Bass line");
    assert.deepEqual(views, ["Detail/Clip"]);
});

test("show refuses what is not a track, device or clip, and says what it takes", async (t) => {
    const { readSet, show } = withBass(t);
    await readSet.run({});

    await assert.rejects(async () => show.run({}), /object is needed.*t1, d1 or c1/);
    await assert.rejects(async () => show.run({ object: 7 }), /object is needed/);
    await assert.rejects(async () => show.run({ object: "Bass" }), /Bass is not a track, device or clip.*t1, d1 or c1/);
    // A rack chain has an object id, but show does not select one.
    await assert.rejects(async () => show.run({ object: "ch1" }), /ch1 is not a track, device or clip/);
});

test("show refuses an object id Live never gave, and one whose object is gone, with a message to read again", async (t) => {
    const { live, bass, view, readSet, show } = withBass(t);
    const trackId = JSON.parse(await readSet.run({})).tracks[0].id;

    await assert.rejects(async () => show.run({ object: "t9" }), /t9 is not an object id from the current connection/);

    live.delete(bass.id);
    await assert.rejects(async () => show.run({ object: trackId }), /t1 is no longer in the Live Set.*read_set/);
    // The check comes before the selection, so nothing is selected.
    assert.equal(view.selected_track, null);
});

test("show changes nothing when it cannot find the object, and is not marked as needing approval", async (t) => {
    const { view, views, show } = withBass(t);

    await assert.rejects(async () => show.run({ object: "t1" }));

    assert.equal(view.selected_track, null);
    assert.deepEqual(views, []);
    assert.notEqual(show.needsApproval, true);
    assert.equal(StandInSocket.opened.length, 0);
});

test("show opens the folded group of a track it selects, and of the track of a device", async (t) => {
    const { live, track, set } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
    const synths = track({ name: "Synths", type: "group", volume: "0.0 dB", pan: "C", folded: true });
    const lead = track({ name: "Lead", type: "midi", volume: "0.0 dB", pan: "C", group: synths, devices: [{ name: "Wavetable", class_name: "InstrumentVector" }] });
    set({ tracks: [synths, lead], return_tracks: [], master_track: track({ ...main }) });
    useStandIn(t, live);
    const tools = createAbleton({ address: ADDRESS });
    await findTool(tools, "read_set").run({});
    const show = findTool(tools, "show");

    await show.run({ object: "t2" });
    assert.equal(live.get(synths.id)?.fold_state, 0);
    assert.equal((live.get("song-view") as Record<string, unknown>).selected_track, lead.id);

    (live.get(synths.id) as Record<string, unknown>).fold_state = 1;
    await show.run({ object: "d1" });
    assert.equal(live.get(synths.id)?.fold_state, 0);
    assert.equal((live.get("song-view") as Record<string, unknown>).selected_track, lead.id);
});
