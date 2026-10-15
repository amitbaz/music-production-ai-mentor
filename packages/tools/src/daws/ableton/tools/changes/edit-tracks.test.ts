import { test } from "node:test";
import assert from "node:assert/strict";
import type { Tool } from "@mentor/harness";
import { createAbleton } from "../../ableton.ts";
import { ADDRESS, liveSet, type RoutingSpec, StandInSocket, useStandIn } from "../../stand-in-live.ts";

function findTool(tools: Tool[], name: string): Tool {
    const tool = tools.find((tool) => tool.name === name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    return tool;
}

const mixer = { volume: "0.0 dB", pan: "C" } as const;
const routing = (): { input: RoutingSpec; output: RoutingSpec } => ({
    input: { types: { "Ext. In": ["1/2", "3/4"], "No Input": [] }, type: "Ext. In", channel: "1/2" },
    output: { types: { Main: ["Main"], "Drum Bus": ["Track In", "Post Mixer"], "Sends Only": [] }, type: "Main", channel: "Main" },
});

// A Live Set with an audio track Kick, a MIDI track Bass, a return track and Main, read once, so
// they have the object ids t1, t2, t3 and t4. The tools to read and to edit tracks come with it.
async function withTracks(t: Parameters<typeof useStandIn>[0]) {
    const { live, track, set } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
    const kick = track({ name: "Kick", type: "audio", ...mixer, routing: routing() });
    const bass = track({ name: "Bass", type: "midi", ...mixer, routing: routing() });
    const reverb = track({ name: "A-Reverb", type: "return", ...mixer, routing: routing() });
    const main = track({ name: "Main", type: "main", ...mixer });
    set({ tracks: [kick, bass], return_tracks: [reverb], master_track: main });
    useStandIn(t, live);
    const tools = createAbleton({ address: ADDRESS });
    const readSet = findTool(tools, "read_set");
    await readSet.run({});
    const song = live.get("song") as { tracks: { id: string; name: string }[]; return_tracks: { id: string; name: string }[] };
    return { live, set, song, kick, bass, reverb, main, readSet, editTracks: findTool(tools, "edit_tracks") };
}

const edit = async (editTracks: Tool, ...changes: unknown[]) => JSON.parse(await editTracks.run({ changes })).changes;

test("edit_tracks creates an audio, a MIDI and a return track with a name, and gives their object ids", async (t) => {
    const { song, readSet, editTracks } = await withTracks(t);

    const changes = await edit(
        editTracks,
        { action: "create", kind: "midi", name: "Lead" },
        { action: "create", kind: "audio", name: "Vox" },
        { action: "create", kind: "return", name: "B-Delay" },
    );

    assert.deepEqual(changes, [
        { action: "create", track: "t5", kind: "midi", name: "Lead" },
        { action: "create", track: "t6", kind: "audio", name: "Vox" },
        { action: "create", track: "t7", kind: "return", name: "B-Delay" },
    ]);
    // Audio and MIDI tracks go after the last track, a return track after the last return.
    assert.deepEqual(song.tracks.map((track) => track.name), ["Kick", "Bass", "Lead", "Vox"]);
    assert.deepEqual(song.return_tracks.map((track) => track.name), ["A-Reverb", "B-Delay"]);
    // The ids are the ones read_set gives from now on.
    const read = JSON.parse(await readSet.run({})).tracks.map((track: { id: string; name: string }) => [track.id, track.name]);
    assert.deepEqual(read, [["t1", "Kick"], ["t2", "Bass"], ["t5", "Lead"], ["t6", "Vox"], ["t3", "A-Reverb"], ["t7", "B-Delay"], ["t4", "Main"]]);
});

test("edit_tracks creates a track without a name, and gives the name Live gave it", async (t) => {
    const { editTracks } = await withTracks(t);

    assert.deepEqual(await edit(editTracks, { action: "create", kind: "midi" }), [{ action: "create", track: "t5", kind: "midi", name: "MIDI" }]);
});

test("edit_tracks duplicates a track, with a new name if one is given", async (t) => {
    const { song, readSet, editTracks } = await withTracks(t);

    const changes = await edit(editTracks, { action: "duplicate", track: "t1" }, { action: "duplicate", track: "t2", name: "Bass 2" });

    assert.deepEqual(changes, [
        { action: "duplicate", from: "t1", track: "t5", name: "Kick" },
        { action: "duplicate", from: "t2", track: "t6", name: "Bass 2" },
    ]);
    assert.deepEqual(song.tracks.map((track) => track.name), ["Kick", "Kick", "Bass", "Bass 2"]);
    const read = JSON.parse(await readSet.run({})).tracks.map((track: { id: string }) => track.id);
    assert.deepEqual(read, ["t1", "t5", "t2", "t6", "t3", "t4"]);
});

test("edit_tracks duplicates a track after creating one in the same call, and finds the copy, not the new track", async (t) => {
    const { song, editTracks } = await withTracks(t);

    const changes = await edit(editTracks, { action: "create", kind: "midi", name: "Lead" }, { action: "duplicate", track: "t2" });

    assert.equal(changes[1].track, "t6");
    assert.deepEqual(song.tracks.map((track) => track.name), ["Kick", "Bass", "Bass", "Lead"]);
});

test("edit_tracks, when a track is made but cannot be named, still gives its object id", async (t) => {
    const { live, song, editTracks } = await withTracks(t);
    const original = (live.get("song") as Record<string, (args: { index: number }) => { id: string }>).create_midi_track as (args: { index: number }) => { id: string };
    (live.get("song") as Record<string, unknown>).create_midi_track = (args: { index: number }) => {
        const made = original(args);
        (live.get(made.id) as Record<string, unknown>).refuses = "name";
        return made;
    };

    const [change] = await edit(editTracks, { action: "create", kind: "midi", name: "Lead" });

    assert.deepEqual(change.track, "t5");
    assert.match(change.error, /made, but could not be named.*name could not be set/);
    assert.equal(song.tracks.length, 3);
});

test("edit_tracks refuses to duplicate a return track or Main", async (t) => {
    const { song, editTracks } = await withTracks(t);

    const changes = await edit(editTracks, { action: "duplicate", track: "t3" }, { action: "duplicate", track: "t4" });

    assert.match(changes[0].error, /t3 is a return track.*only audio, MIDI and group tracks can be duplicated/);
    assert.match(changes[1].error, /t4 is Main/);
    assert.equal(song.tracks.length, 2);
});

test("edit_tracks renames a track and sets mute, solo and arm, reporting each before and after", async (t) => {
    const { kick, live, editTracks } = await withTracks(t);

    const changes = await edit(editTracks, { action: "edit", track: "t1", name: "Kick Drum", mute: true, solo: true, arm: true });

    assert.deepEqual(changes, [
        {
            action: "edit",
            track: "t1",
            name: "Kick Drum",
            changed: {
                name: { before: "Kick", after: "Kick Drum" },
                mute: { before: false, after: true },
                solo: { before: false, after: true },
                arm: { before: false, after: true },
            },
        },
    ]);
    assert.deepEqual(
        ["name", "mute", "solo", "arm"].map((prop) => live.get(kick.id)?.[prop]),
        ["Kick Drum", true, true, true],
    );
});

test("edit_tracks reports only what was asked, and changes a return track like another", async (t) => {
    const { editTracks } = await withTracks(t);

    const changes = await edit(editTracks, { action: "edit", track: "t3", mute: true }, { action: "edit", track: "t3", mute: true });

    assert.deepEqual(changes[0], { action: "edit", track: "t3", name: "A-Reverb", changed: { mute: { before: false, after: true } } });
    // Asked again, nothing changes and the report says so.
    assert.deepEqual(changes[1].changed, { mute: { before: true, after: true } });
});

test("edit_tracks sets the output routing by the names Live shows, a type and then a channel", async (t) => {
    const { editTracks } = await withTracks(t);

    const changes = await edit(
        editTracks,
        { action: "edit", track: "t1", output: { type: "Drum Bus", channel: "Post Mixer" } },
        { action: "edit", track: "t2", output: { type: "Drum Bus" } },
        { action: "edit", track: "t3", output: { type: "Sends Only" } },
    );

    assert.deepEqual(changes[0].changed, {
        output: { before: { type: "Main", channel: "Main" }, after: { type: "Drum Bus", channel: "Post Mixer" } },
    });
    // A new type brings the first of its channels.
    assert.deepEqual(changes[1].changed.output.after, { type: "Drum Bus", channel: "Track In" });
    assert.deepEqual(changes[2].changed.output.after, { type: "Sends Only", channel: "" });
});

test("edit_tracks sets the input routing, and a channel alone changes the channel of the type it has", async (t) => {
    const { editTracks } = await withTracks(t);

    const changes = await edit(editTracks, { action: "edit", track: "t1", input: { channel: "3/4" } }, { action: "edit", track: "t2", input: { type: "No Input" } });

    assert.deepEqual(changes[0].changed, { input: { before: { type: "Ext. In", channel: "1/2" }, after: { type: "Ext. In", channel: "3/4" } } });
    assert.deepEqual(changes[1].changed.input.after, { type: "No Input", channel: "" });
});

test("edit_tracks refuses a routing that does not exist, and names the ones that do, changing nothing", async (t) => {
    const { kick, live, editTracks } = await withTracks(t);

    const changes = await edit(
        editTracks,
        { action: "edit", track: "t1", name: "Renamed", output: { type: "Bus" } },
        { action: "edit", track: "t1", input: { channel: "9/10" } },
    );

    assert.match(changes[0].error, /Output type Bus does not exist\. The output types are: Main, Drum Bus, Sends Only/);
    assert.match(changes[1].error, /Ext\. In has no input channel 9\/10\. Its channels are: 1\/2, 3\/4/);
    // The name is changed after the routing is checked, so a refusal leaves the track as it was.
    assert.equal(live.get(kick.id)?.name, "Kick");
    assert.equal(changes[0].changed, undefined);
});

test("edit_tracks, when the channel is not one of the new type, says what changed before it refused", async (t) => {
    const { editTracks } = await withTracks(t);

    const [change] = await edit(editTracks, { action: "edit", track: "t1", output: { type: "Drum Bus", channel: "Pre" } });

    assert.match(change.error, /Drum Bus has no output channel Pre\. Its channels are: Track In, Post Mixer/);
    // The type could only be checked against its channels once it was set, so it stays set, and the result says so.
    assert.deepEqual(change.changed.output, {
        before: { type: "Main", channel: "Main" },
        after: { type: "Drum Bus", channel: "Track In" },
    });
});

test("edit_tracks, when Live refuses the channel after the type was set, reports the type that changed", async (t) => {
    const { live, kick, editTracks } = await withTracks(t);
    (live.get(kick.id) as Record<string, unknown>).refuses = "output_routing_channel";

    const [change] = await edit(editTracks, { action: "edit", track: "t1", output: { type: "Drum Bus", channel: "Post Mixer" } });

    assert.match(change.error, /output_routing_channel could not be set/);
    assert.deepEqual(change.changed.output.after, { type: "Drum Bus", channel: "Track In" });
});

test("edit_tracks refuses what a kind of track does not have, and says which tracks do", async (t) => {
    const { editTracks } = await withTracks(t);

    const changes = await edit(
        editTracks,
        { action: "edit", track: "t3", arm: true },
        { action: "edit", track: "t3", input: { type: "No Input" } },
        { action: "edit", track: "t4", mute: true },
    );

    assert.match(changes[0].error, /t3 is a return track, and only audio and MIDI tracks can be armed/);
    assert.match(changes[1].error, /t3 is a return track, and only audio and MIDI tracks have an input/);
    assert.match(changes[2].error, /t4 is Main, which edit_tracks cannot change/);
});

test("edit_tracks cannot delete a track", async (t) => {
    const { song, editTracks } = await withTracks(t);

    const changes = await edit(editTracks, { action: "delete", track: "t1" });

    assert.match(changes[0].error, /action must be create, duplicate or edit, not delete\. edit_tracks cannot delete a track/);
    assert.equal(song.tracks.length, 2);
    assert.deepEqual(
        (editTracks.params as { properties: { changes: { items: { properties: { action: { enum: string[] } } } } } }).properties.changes.items.properties.action.enum,
        ["create", "duplicate", "edit"],
    );
});

test("edit_tracks reports a change that fails and goes on with the others, in order", async (t) => {
    const { song, editTracks } = await withTracks(t);

    const changes = await edit(
        editTracks,
        { action: "create", kind: "synth" },
        { action: "edit", track: "t1", mute: "yes" },
        { action: "edit", track: "t1" },
        { action: "edit", track: "t1", name: "" },
        { action: "create", kind: "audio", name: "Vox" },
    );

    assert.match(changes[0].error, /^kind must be audio, midi or return, not synth/);
    assert.match(changes[1].error, /^mute must be true or false/);
    assert.match(changes[2].error, /^Nothing to change on t1\. Give at least one of name, mute, solo, arm, input, output/);
    assert.match(changes[3].error, /^name must be some text/);
    assert.equal(changes[4].error, undefined);
    assert.equal(changes[4].track, "t5");
    assert.equal(song.tracks.length, 3);
});

test("edit_tracks refuses an object id that is not a track, was never given, or is gone, with a message to read again", async (t) => {
    const { live, kick, main, set, editTracks } = await withTracks(t);
    // The user deletes the kick, and takes the bass out of the list of tracks.
    live.delete(kick.id);
    set({ tracks: [], return_tracks: [], master_track: main });

    const changes = await edit(
        editTracks,
        { action: "edit", track: "d1", mute: true },
        { action: "edit", track: "t9", mute: true },
        { action: "edit", track: "t1", mute: true },
        { action: "edit", mute: true },
        { action: "edit", track: "t2", mute: true },
    );

    assert.match(changes[0].error, /d1 is not a track\. Use an object id such as t1, from read_set/);
    assert.match(changes[1].error, /t9 is not an object id from the current connection/);
    assert.match(changes[2].error, /t1 is no longer in the Live Set\. Read again with read_set/);
    assert.match(changes[3].error, /track is needed: the object id of a track, such as t1/);
    assert.match(changes[4].error, /t2 is no longer in the Live Set/);
});

test("edit_tracks takes a list of changes, and nothing else", async (t) => {
    const { editTracks } = await withTracks(t);

    await assert.rejects(async () => editTracks.run({}), /changes must be a list of one or more changes/);
    await assert.rejects(async () => editTracks.run({ changes: [] }), /changes must be a list of one or more changes/);
    await assert.rejects(async () => editTracks.run({ changes: "mute t1" }), /changes must be a list/);
    const [change] = await edit(editTracks, "mute t1");
    assert.match(change.error, /Each change is an object with an action/);
});

test("edit_tracks is not marked as needing approval", async (t) => {
    const { editTracks } = await withTracks(t);

    assert.notEqual(editTracks.needsApproval, true);
});

// Drums (folded) holds Kicks (folded), which holds Kick, a track the user cannot see; a Snare sits
// in a group that is open. The tracks are read, so Kick is t3 and Snare t5.
async function withFoldedGroups(t: Parameters<typeof useStandIn>[0]) {
    const { live, track, set } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
    const drums = track({ name: "Drums", type: "group", ...mixer, folded: true });
    const kicks = track({ name: "Kicks", type: "group", ...mixer, folded: true, group: drums });
    const kick = track({ name: "Kick", type: "audio", ...mixer, group: kicks, collapsed: true });
    const open = track({ name: "Open", type: "group", ...mixer });
    const snare = track({ name: "Snare", type: "audio", ...mixer, group: open });
    set({ tracks: [drums, kicks, kick, open, snare], return_tracks: [], master_track: track({ name: "Main", type: "main", ...mixer }) });
    useStandIn(t, live);
    const tools = createAbleton({ address: ADDRESS });
    await findTool(tools, "read_set").run({});
    const view = live.get("song-view") as Record<string, unknown>;
    return { live, drums, kicks, kick, open, snare, view, editTracks: findTool(tools, "edit_tracks") };
}

// The writes of the properties asked for, in the order Live got them, such as "fold_state".
const written = (...props: string[]) => sent().filter((name) => props.includes(name));

// What Live was asked to change, in order: a property by its name, a function by its own.
const sent = () =>
    StandInSocket.opened
        .flatMap((socket) => socket.sent.slice(1))
        .flatMap((request) => request.commands)
        .filter((command) => command.name !== "get_prop")
        .map((command) => (command.name === "set_prop" ? (command.args as { prop: string }).prop : command.name));

const folded = (live: Map<string, Record<string, unknown>>, ...tracks: { id: string }[]) => tracks.map((track) => live.get(track.id)?.fold_state);

test("edit_tracks shows the track it changes: the folded groups it is in are opened and it is selected, before the change", async (t) => {
    const { live, drums, kicks, kick, view, editTracks } = await withFoldedGroups(t);

    await edit(editTracks, { action: "edit", track: "t3", mute: true });

    assert.deepEqual(folded(live, drums, kicks), [false, false]);
    assert.equal(view.selected_track, kick.id);
    // The track is selected, scrolled to, and selected again where the scroll left the selection.
    assert.deepEqual(written("fold_state", "focus_view", "selected_track", "scroll_view", "mute"), [
        "fold_state",
        "fold_state",
        "selected_track",
        "focus_view",
        "scroll_view",
        "scroll_view",
        "selected_track",
        "mute",
    ]);
});

test("edit_tracks scrolls to a track by moving the selection one track away and back, the way the view is laid out", async (t) => {
    const { live, editTracks } = await withFoldedGroups(t);
    const application = live.get("application-view") as { scrolls: { direction: string; view: string }[]; focused_document_view: string };

    // A track with another above it: up, then down.
    await edit(editTracks, { action: "edit", track: "t3", mute: true });
    assert.deepEqual(application.scrolls.splice(0), [{ direction: "up", view: "Arranger" }, { direction: "down", view: "Arranger" }]);

    // The first track has nothing above it to move to: down, then up.
    await edit(editTracks, { action: "edit", track: "t1", mute: true });
    assert.deepEqual(application.scrolls.splice(0), [{ direction: "down", view: "Arranger" }, { direction: "up", view: "Arranger" }]);

    // In Session View the tracks are side by side.
    application.focused_document_view = "Session";
    await edit(editTracks, { action: "edit", track: "t5", mute: true });
    assert.deepEqual(application.scrolls.splice(0), [{ direction: "left", view: "Session" }, { direction: "right", view: "Session" }]);
});

test("edit_tracks leaves a group that is open alone, and selects the track", async (t) => {
    const { live, open, snare, view, editTracks } = await withFoldedGroups(t);

    await edit(editTracks, { action: "edit", track: "t5", solo: true });

    assert.deepEqual(folded(live, open), [false]);
    assert.equal(view.selected_track, snare.id);
    assert.deepEqual(written("fold_state"), []);
});

test("edit_tracks selects a track it made or duplicated, and does not move the view for a change it refuses", async (t) => {
    const { live, kick, view, editTracks } = await withFoldedGroups(t);
    const song = live.get("song") as { tracks: { id: string }[] };

    await edit(editTracks, { action: "edit", track: "t3", arm: "yes" });
    assert.equal(view.selected_track, null);

    await edit(editTracks, { action: "create", kind: "midi", name: "Lead" });
    assert.equal(view.selected_track, song.tracks.at(-1)?.id);

    const [copy] = await edit(editTracks, { action: "duplicate", track: "t3" });
    const copied = song.tracks.find((track) => track.id !== kick.id && live.get(track.id)?.name === "Kick");
    assert.equal(copy.track, "t8");
    assert.equal(view.selected_track, copied?.id);
});

test("edit_tracks focuses the view that shows the tracks before it scrolls, since Live may not be where the user is looking", async (t) => {
    const { live, editTracks } = await withFoldedGroups(t);
    const application = live.get("application-view") as { focused: string[]; focused_document_view: string };

    await edit(editTracks, { action: "edit", track: "t3", mute: true });
    assert.deepEqual(application.focused.splice(0), ["Arranger"]);

    application.focused_document_view = "Session";
    await edit(editTracks, { action: "edit", track: "t3", mute: true });
    assert.deepEqual(application.focused.splice(0), ["Session"]);
});

test("edit_tracks makes the change and says so when Live could not be scrolled", async (t) => {
    const { live, kick, editTracks } = await withFoldedGroups(t);
    (live.get("application-view") as Record<string, unknown>).scrollFails = true;

    const output = JSON.parse(await editTracks.run({ changes: [{ action: "edit", track: "t3", mute: true }] }));

    assert.equal(live.get(kick.id)?.mute, true);
    assert.equal(output.changes[0].error, undefined);
    assert.match(output.view_problems[0], /Live could not be scrolled to t3: scroll_view failed/);
});

test("edit_tracks expands a track shown as a thin strip, before it selects it", async (t) => {
    const { live, kick, snare, editTracks } = await withFoldedGroups(t);
    const collapsed = (id: string) => (live.get(id) as { view: { is_collapsed: boolean } }).view.is_collapsed;

    await edit(editTracks, { action: "edit", track: "t3", mute: true });
    assert.equal(collapsed(kick.id), false);
    assert.deepEqual(written("is_collapsed", "selected_track"), ["is_collapsed", "selected_track", "selected_track"]);

    // A track that is not collapsed is left as it is.
    await edit(editTracks, { action: "edit", track: "t5", mute: true });
    assert.equal(written("is_collapsed").length, 1);
    assert.equal(collapsed(snare.id), false);
});
