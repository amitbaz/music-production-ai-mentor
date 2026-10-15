import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { Tool } from "@mentor/harness";
import { createAbleton } from "../../ableton.ts";
import { ADDRESS, liveSet, StandInSocket, useStandIn } from "../../stand-in-live.ts";

function findTool(tools: Tool[], name: string): Tool {
    const tool = tools.find((tool) => tool.name === name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    return tool;
}

const note = (pitch: number, start_time: number) => ({ pitch, start_time, duration: 0.5, velocity: 100, probability: 1 });

type Arrangement = { locators: { id: string; name: string; bar: number }[]; tracks: { id: string; name: string; clips: [string, string, number, number][] }[] };

// A Live Set in 4/4 with a MIDI track Bass holding Riff in bars 1 to 5 and Hook in bars 9 to 13, an
// empty MIDI track Lead, an audio track Drums holding Break, and the locators Intro at bar 1 and Drop
// at bar 17, with the playback position at bar 3. Read first, as the mentor does, so the tool is
// given object ids.
async function setup(t: TestContext) {
    const { live, track, cue, set } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
    const midi = (name: string, arrangement: Parameters<typeof track>[0]["arrangement"] = []) =>
        track({ name, type: "midi", volume: "0.0 dB", pan: "C", arrangement });
    const bass = midi("Bass", [
        { name: "Riff", kind: "midi", start: 0, end: 16, notes: [note(36, 0), note(43, 2)] },
        { name: "Hook", kind: "midi", start: 32, end: 48 },
    ]);
    const lead = midi("Lead");
    const drums = track({ name: "Drums", type: "audio", volume: "0.0 dB", pan: "C", arrangement: [{ name: "Break", kind: "audio", start: 0, end: 16 }] });
    set({
        tracks: [bass, lead, drums],
        return_tracks: [],
        master_track: track({ name: "Main", type: "main", volume: "0.0 dB", pan: "C" }),
        cue_points: [cue("Intro", 0), cue("Drop", 64)],
        current_song_time: 8,
        song_length: 256,
    });
    useStandIn(t, live);
    const tools = createAbleton({ address: ADDRESS });
    const tool = findTool(tools, "edit_arrangement");
    const read = async () => JSON.parse(await findTool(tools, "read_arrangement").run({})) as Arrangement;
    const first = await read();
    const [bassTrack] = first.tracks;
    const clipsOf = async (name: string) => (await read()).tracks.find((track) => track.name === name)?.clips ?? [];
    const edit = async (edits: unknown[]) => JSON.parse(await tool.run({ edits })).edits;
    return {
        live,
        tool,
        edit,
        read,
        clipsOf,
        song: () => live.get("song") as Record<string, unknown>,
        cue,
        bass: bassTrack?.id as string,
        lead: "t2",
        drums: "t3",
        riff: bassTrack?.clips[0]?.[0] as string,
        hook: bassTrack?.clips[1]?.[0] as string,
        // Lead has no clips, so read_arrangement leaves it out.
        breakClip: first.tracks.find((track) => track.name === "Drums")?.clips[0]?.[0] as string,
        intro: first.locators[0]?.id as string,
        drop: first.locators[1]?.id as string,
        readSet: () => findTool(tools, "read_set").run({}),
        readClip: async (clip: string) => JSON.parse(await findTool(tools, "read_clip").run({ clip })),
    };
}

// The commands sent after the handshake, as each Live function was called.
const sentNames = () => StandInSocket.opened.flatMap((socket) => socket.sent.flatMap((request) => request.commands.map((command) => command.name)));

test("edit_arrangement creates a MIDI clip on a track at a bar with a length in bars, and gives its object id", async (t) => {
    const { edit, clipsOf, lead } = await setup(t);

    const [created] = await edit([{ action: "create_clip", track: lead, bar: 9, bars: 4, name: "Answer" }]);

    assert.match(created.clip, /^c\d+$/);
    assert.deepEqual(created, { action: "create_clip", clip: created.clip, track: lead, name: "Answer", from_bar: 9, to_bar: 13 });
    assert.deepEqual(await clipsOf("Lead"), [[created.clip, "Answer", 9, 13]]);
});

test("edit_arrangement duplicates a clip to another bar, on its own track or another of the same kind", async (t) => {
    const { edit, clipsOf, readClip, riff, bass, lead } = await setup(t);

    const [here, there] = await edit([
        { action: "duplicate", clip: riff, bar: 17 },
        { action: "duplicate", clip: riff, bar: 5, track: lead },
    ]);

    assert.deepEqual(here, { action: "duplicate", from: riff, clip: here.clip, track: bass, name: "Riff", from_bar: 17, to_bar: 21 });
    assert.deepEqual(there, { action: "duplicate", from: riff, clip: there.clip, track: lead, name: "Riff", from_bar: 5, to_bar: 9 });
    assert.deepEqual(
        (await clipsOf("Bass")).map((clip) => clip[0]),
        [riff, "c2", here.clip],
    );
    assert.deepEqual(await clipsOf("Lead"), [[there.clip, "Riff", 5, 9]]);
    // The copy holds the notes.
    assert.equal((await readClip(there.clip)).notes.length, 2);
});

test("edit_arrangement moves a clip as a copy at the new bar and the original removed, without asking, and gives the new object id", async (t) => {
    const { tool, edit, clipsOf, riff, hook, lead } = await setup(t);

    const [moved, across] = await edit([
        { action: "move", clip: hook, bar: 25 },
        { action: "move", clip: riff, bar: 1, track: lead },
    ]);

    assert.equal(tool.needsApproval, undefined);
    assert.deepEqual(moved, { action: "move", from: hook, clip: moved.clip, track: "t1", name: "Hook", from_bar: 25, to_bar: 29 });
    assert.notEqual(moved.clip, hook);
    assert.equal(across.track, lead);
    assert.deepEqual(await clipsOf("Bass"), [[moved.clip, "Hook", 25, 29]]);
    assert.deepEqual(await clipsOf("Lead"), [[across.clip, "Riff", 1, 5]]);
    assert.ok(sentNames().includes("delete_clip"));
});

test("edit_arrangement does not remove the original of a move when the copy fails", async (t) => {
    const { edit, clipsOf, riff, drums } = await setup(t);

    const [moved] = await edit([{ action: "move", clip: riff, bar: 1, track: drums }]);

    assert.match(moved.error, /MIDI clip.*MIDI track/);
    assert.match(moved.error, /t3 is an audio track/);
    assert.deepEqual((await clipsOf("Bass")).map((clip) => clip[1]), ["Riff", "Hook"]);
});

test("edit_arrangement changes the name, mute and loop of a clip and reports each before and after", async (t) => {
    const { edit, clipsOf, riff } = await setup(t);

    const [changed] = await edit([{ action: "edit_clip", clip: riff, name: "Riff A", muted: true, looping: false, loop_start: 4, loop_end: 12 }]);

    assert.deepEqual(changed, {
        action: "edit_clip",
        clip: riff,
        name: "Riff A",
        changed: {
            name: { before: "Riff", after: "Riff A" },
            muted: { before: false, after: true },
            looping: { before: true, after: false },
            loop_start: { before: 0, after: 4 },
            loop_end: { before: 16, after: 12 },
        },
    });
    assert.equal((await clipsOf("Bass"))[0]?.[1], "Riff A");
});

test("edit_arrangement moves a loop past its old end by setting the end first", async (t) => {
    const { edit, riff } = await setup(t);

    const [changed] = await edit([{ action: "edit_clip", clip: riff, loop_start: 20, loop_end: 24 }]);

    assert.deepEqual(changed.changed, { loop_start: { before: 0, after: 20 }, loop_end: { before: 16, after: 24 } });
});

test("edit_arrangement changes the warp, gain in dB and pitch of an audio clip, reported as Live shows them", async (t) => {
    const { edit, readClip, breakClip } = await setup(t);

    const [changed] = await edit([{ action: "edit_clip", clip: breakClip, warp: "complex", gain: -6.2, pitch_semitones: -2, pitch_cents: 15 }]);
    const [louder, unwarped] = await edit([
        { action: "edit_clip", clip: breakClip, gain: 12 },
        { action: "edit_clip", clip: breakClip, warp: "off" },
    ]);

    assert.deepEqual(changed.changed, {
        warp: { before: "beats", after: "complex" },
        gain: { before: "0.00 dB", after: "-6.20 dB" },
        pitch_semitones: { before: 0, after: -2 },
        pitch_cents: { before: 0, after: 15 },
    });
    assert.deepEqual(louder.changed, { gain: { before: "-6.20 dB", after: "12.0 dB" } });
    assert.deepEqual(unwarped.changed, { warp: { before: "complex", after: "off" } });
    const read = await readClip(breakClip);
    assert.deepEqual([read.warp, read.gain, read.pitch_semitones], ["off", "12.0 dB", -2]);
});

test("edit_arrangement refuses clip settings out of range or for the wrong kind of clip, and changes nothing", async (t) => {
    const { edit, riff, breakClip } = await setup(t);

    const results = await edit([
        { action: "edit_clip", clip: riff, gain: -3 },
        { action: "edit_clip", clip: breakClip, gain: 30 },
        { action: "edit_clip", clip: breakClip, warp: "rex" },
        { action: "edit_clip", clip: breakClip, pitch_semitones: 60 },
        { action: "edit_clip", clip: riff, loop_start: 8, loop_end: 4 },
        { action: "edit_clip", clip: riff },
    ]);

    assert.match(results[0].error, /gain.*audio clip/);
    assert.match(results[1].error, /gain must be from -?\d+(\.\d+)? to 24 dB/);
    assert.match(results[2].error, /warp must be one of off, beats, tones, texture, repitch, complex, complex_pro/);
    assert.match(results[3].error, /pitch_semitones must be a whole number from -48 to 48/);
    assert.match(results[4].error, /loop_end must be after loop_start/);
    assert.match(results[5].error, /Nothing to change/);
    assert.ok(results.every((result: { changed?: unknown }) => result.changed === undefined));
});

test("edit_arrangement adds a locator at a bar, names it, gives its object id, and puts the playback position back", async (t) => {
    const { edit, read, song } = await setup(t);

    const [added] = await edit([{ action: "add_locator", bar: 9, name: "Break" }]);

    assert.match(added.locator, /^l\d+$/);
    assert.deepEqual(added, { action: "add_locator", locator: added.locator, name: "Break", bar: 9 });
    assert.deepEqual((await read()).locators.map((locator) => [locator.id, locator.name, locator.bar]), [
        ["l1", "Intro", 1],
        [added.locator, "Break", 9],
        ["l2", "Drop", 17],
    ]);
    assert.equal(song().current_song_time, 8);
});

test("edit_arrangement renames a locator and reports the name before and after", async (t) => {
    const { edit, read, drop } = await setup(t);

    const [renamed] = await edit([{ action: "rename_locator", locator: drop, name: "Drop 1" }]);

    assert.deepEqual(renamed, { action: "rename_locator", locator: drop, bar: 17, changed: { name: { before: "Drop", after: "Drop 1" } } });
    assert.equal((await read()).locators[1]?.name, "Drop 1");
});

test("edit_arrangement removes a locator, and puts the playback position back", async (t) => {
    const { edit, read, song, intro } = await setup(t);

    const [removed] = await edit([{ action: "remove_locator", locator: intro }]);

    assert.deepEqual(removed, { action: "remove_locator", locator: intro, name: "Intro", bar: 1 });
    assert.deepEqual((await read()).locators.map((locator) => locator.name), ["Drop"]);
    assert.equal(song().current_song_time, 8);
});

test("edit_arrangement refuses a locator where one is, past the end of the arrangement, or inside a bar, and changes nothing", async (t) => {
    const { edit, read, song } = await setup(t);

    const results = await edit([
        { action: "add_locator", bar: 17 },
        { action: "add_locator", bar: 70 },
        { action: "add_locator", bar: 9.5 },
    ]);

    assert.match(results[0].error, /already a locator at bar 17: l2, Drop/);
    assert.match(results[1].error, /ends at bar 65/);
    assert.match(results[2].error, /start of a bar/);
    assert.equal((await read()).locators.length, 2);
    assert.equal(song().current_song_time, 8);
    assert.equal(sentNames().includes("set_or_delete_cue"), false);
});

test("edit_arrangement refuses what Live does not offer with the steps for the user, and cannot delete a clip", async (t) => {
    const { edit, clipsOf, riff } = await setup(t);

    const [split, insert, cut, automation, remove] = await edit([
        { action: "split", clip: riff, bar: 3 },
        { action: "insert_time", bar: 9, bars: 8 },
        { action: "cut_time", bar: 9, bars: 8 },
        { action: "automation", track: "t1" },
        { action: "delete", clip: riff },
    ]);

    assert.match(split.error, /cannot split.*bar 3.*Cmd\+E/s);
    assert.match(insert.error, /cannot insert time.*bar 9.*8 bars.*Cmd\+I/s);
    assert.match(cut.error, /cannot cut time.*bar 9.*8 bars.*Cmd\+Shift\+X/s);
    assert.match(automation.error, /cannot write automation.*press A/s);
    assert.match(remove.error, /cannot delete.*delete/);
    assert.deepEqual((await clipsOf("Bass")).map((clip) => clip[0]), [riff, "c2"]);
});

test("edit_arrangement puts the playback position back after Live moves it to a clip it made or copied", async (t) => {
    const { edit, song, riff, lead } = await setup(t);

    await edit([
        { action: "create_clip", track: lead, bar: 33, bars: 1 },
        { action: "duplicate", clip: riff, bar: 41 },
        { action: "move", clip: riff, bar: 49 },
    ]);

    assert.equal(song().current_song_time, 8);
});

test("edit_arrangement says a return track or Main holds no arrangement clips", async (t) => {
    const { edit, readSet, riff } = await setup(t);
    // read_set gives Main its object id, after the three tracks.
    await readSet();

    const [created, copied] = await edit([
        { action: "create_clip", track: "t4", bar: 1, bars: 1 },
        { action: "duplicate", clip: riff, bar: 1, track: "t4" },
    ]);

    assert.match(created.error, /t4 is Main.*no arrangement clips/);
    assert.match(copied.error, /t4 is Main.*no arrangement clips/);
});

test("edit_arrangement says to read the arrangement again for a clip deleted in Live since it was read", async (t) => {
    const { live, edit, riff } = await setup(t);
    for (const [id, object] of live) if (object.ns === "clip") live.delete(id);

    const [changed] = await edit([{ action: "edit_clip", clip: riff, muted: true }]);

    assert.match(changed.error, new RegExp(`${riff} is no longer in the Live Set. Read again with read_arrangement`));
});

test("edit_arrangement refuses to put a clip on bars that hold another clip, which Live would cut, and changes nothing", async (t) => {
    const { edit, clipsOf, riff, hook, bass, lead } = await setup(t);

    const results = await edit([
        { action: "duplicate", clip: riff, bar: 7 },
        { action: "move", clip: riff, bar: 9 },
        { action: "create_clip", track: lead, bar: 1, bars: 2 },
        { action: "create_clip", track: lead, bar: 2, bars: 1 },
    ]);

    assert.match(results[0].error, new RegExp(`bars 7 to 11 of ${bass} hold ${hook}, Hook`));
    assert.match(results[1].error, new RegExp(`${hook}, Hook`));
    assert.equal(results[2].from_bar, 1);
    assert.match(results[3].error, new RegExp(`bars 2 to 3 of ${lead} hold ${results[2].clip}`));
    assert.deepEqual((await clipsOf("Bass")).map((clip) => clip[1]), ["Riff", "Hook"]);
    assert.equal((await clipsOf("Lead")).length, 1);
});

test("edit_arrangement moves a clip onto bars it covers itself", async (t) => {
    const { edit, clipsOf, hook } = await setup(t);

    const [moved] = await edit([{ action: "move", clip: hook, bar: 11 }]);

    assert.equal(moved.error, undefined);
    assert.deepEqual((await clipsOf("Bass")).map((clip) => clip.slice(1)), [
        ["Riff", 1, 5],
        ["Hook", 11, 15],
    ]);
});

test("edit_arrangement refuses to remove a locator inside a bar, which Live would snap to the bar, and gives the steps", async (t) => {
    const { edit, read, song, cue } = await setup(t);
    // Halfway through bar 17, next to Drop at its start.
    (song().cue_points as unknown[]).push(cue("Odd", 66));
    const odd = (await read()).locators.find((locator) => locator.name === "Odd")?.id;

    const [removed] = await edit([{ action: "remove_locator", locator: odd }]);

    assert.match(removed.error, /bar 17.5.*not at the start of a bar.*Delete/s);
    assert.deepEqual((await read()).locators.map((locator) => locator.name), ["Intro", "Drop", "Odd"]);
    assert.equal(sentNames().includes("set_or_delete_cue"), false);
});

test("edit_arrangement reports the clip settings it changed before one that Live refused", async (t) => {
    const { live, edit, riff } = await setup(t);
    for (const object of live.values()) if (object.ns === "clip" && object.name === "Riff") object.refuses = "looping";

    const [changed] = await edit([{ action: "edit_clip", clip: riff, name: "Riff A", looping: false }]);

    assert.match(changed.error, /looping could not be set/);
    assert.deepEqual(changed.changed, { name: { before: "Riff", after: "Riff A" } });
});

test("edit_arrangement refuses to remove a locator past the end of the arrangement, and gives the steps", async (t) => {
    const { edit, read, song, cue } = await setup(t);
    // Placed by hand past the end, at bar 70; the arrangement ends at bar 65.
    (song().cue_points as unknown[]).push(cue("Far", 276));
    const far = (await read()).locators.find((locator) => locator.name === "Far")?.id;

    const [removed] = await edit([{ action: "remove_locator", locator: far }]);

    assert.match(removed.error, /past the end of the arrangement.*Delete/s);
    assert.equal((await read()).locators.length, 3);
    assert.equal(song().current_song_time, 8);
});

test("edit_arrangement says to read again for the object that is gone: the track a clip goes to, or a locator", async (t) => {
    const { edit, song, riff, lead } = await setup(t);
    // Lead deleted in Live since it was read.
    song().tracks = (song().tracks as { name: string }[]).filter((track) => track.name !== "Lead");

    const [copied, renamed] = await edit([
        { action: "duplicate", clip: riff, bar: 17, track: lead },
        { action: "rename_locator", locator: "l9", name: "Gone" },
    ]);

    assert.match(copied.error, new RegExp(`${lead} is no longer in the Live Set. Read again with read_set`));
    assert.match(renamed.error, /l9 is not an object id from the current connection.*read_arrangement/);
});

test("edit_arrangement reads the clips of each track once to duplicate a clip", async (t) => {
    const { edit, riff } = await setup(t);
    const reads = () =>
        StandInSocket.opened.flatMap((socket) => socket.sent.flatMap((request) => request.commands)).filter((command) => (command.args as { prop?: string } | undefined)?.prop === "arrangement_clips").length;
    const before = reads();

    await edit([{ action: "duplicate", clip: riff, bar: 17 }]);

    // Bass, Lead and Drums.
    assert.equal(reads() - before, 3);
});

test("edit_arrangement reports a playback position it could not put back, and the change it made", async (t) => {
    const { tool, song, lead } = await setup(t);
    song().refuses = "current_song_time";

    const result = JSON.parse(await tool.run({ edits: [{ action: "create_clip", track: lead, bar: 33, bars: 1 }] }));

    assert.match(result.edits[0].clip, /^c\d+$/);
    assert.equal(result.edits[0].error, undefined);
    assert.match(result.position_problems[0], /could not be put back to bar 3/);
});
