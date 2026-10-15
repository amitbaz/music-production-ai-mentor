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

// A Live Set at 120 BPM, in the time signature given, and its transport tool.
function withTransport(t: Parameters<typeof useStandIn>[0], numerator = 4, denominator = 4) {
    const { live, track, set } = liveSet({ tempo: 120, numerator, denominator });
    set({ tracks: [], return_tracks: [], master_track: track({ ...main }) });
    useStandIn(t, live);
    const song = live.get("song") as Record<string, unknown>;
    return { song, transport: findTool(createAbleton({ address: ADDRESS }), "transport") };
}

// The names of the commands sent to Live after the handshake, in order, such as "song.set_prop tempo".
function commandsSent() {
    return StandInSocket.opened
        .flatMap((socket) => socket.sent.slice(1))
        .flatMap((request) => request.commands)
        .filter((command) => command.name !== "get_prop")
        .map((command) => `${command.ns}.${command.name}${command.name === "set_prop" ? ` ${(command.args as { prop: string }).prop}` : ""}`);
}

test("transport sets the tempo and reports it before and after", async (t) => {
    const { song, transport } = withTransport(t);

    const output = JSON.parse(await transport.run({ tempo: 128.5 }));

    assert.equal(song.tempo, 128.5);
    assert.deepEqual(output, { tempo: { before: 120, after: 128.5 } });
});

test("transport refuses a tempo outside Live's range, with the range in the message, and changes nothing", async (t) => {
    const { song, transport } = withTransport(t);

    await assert.rejects(async () => transport.run({ tempo: 19.9 }), /tempo must be between 20 and 999 BPM, not 19.9/);
    await assert.rejects(async () => transport.run({ tempo: 1000 }), /between 20 and 999/);
    await assert.rejects(async () => transport.run({ tempo: "fast" }), /tempo must be a number/);
    // The arguments are all checked before the first change.
    await assert.rejects(async () => transport.run({ tempo: 5, jump_to_bar: 9 }), /between 20 and 999/);

    assert.equal(song.tempo, 120);
    assert.equal(song.current_song_time, 0);
    assert.deepEqual(commandsSent(), []);
});

test("transport switches the metronome on and off, and reports it before and after", async (t) => {
    const { song, transport } = withTransport(t);

    assert.deepEqual(JSON.parse(await transport.run({ metronome: true })), { metronome: { before: false, after: true } });
    assert.equal(song.metronome, true);
    assert.deepEqual(JSON.parse(await transport.run({ metronome: false })), { metronome: { before: true, after: false } });
    assert.equal(song.metronome, false);
});

test("transport refuses a metronome that is not true or false, and changes nothing", async (t) => {
    const { song, transport } = withTransport(t);

    await assert.rejects(async () => transport.run({ metronome: "on", tempo: 128 }), /metronome must be true or false/);

    assert.equal(song.metronome, false);
    assert.deepEqual(commandsSent(), []);
});

test("transport plays and stops, and reports whether it was playing", async (t) => {
    const { song, transport } = withTransport(t);

    assert.deepEqual(JSON.parse(await transport.run({ action: "play" })), { playing: { before: false, after: true } });
    assert.equal(song.is_playing, true);
    assert.deepEqual(JSON.parse(await transport.run({ action: "stop" })), { playing: { before: true, after: false } });
    assert.equal(song.is_playing, false);
});

test("transport does not play again while playing, or stop again when stopped, since Live would go back to the start", async (t) => {
    const { song, transport } = withTransport(t);
    song.is_playing = true;

    assert.deepEqual(JSON.parse(await transport.run({ action: "play" })), { playing: { before: true, after: true } });
    song.is_playing = false;
    assert.deepEqual(JSON.parse(await transport.run({ action: "stop" })), { playing: { before: false, after: false } });

    assert.deepEqual(commandsSent(), []);
});

test("transport jumps to a bar, counted from 1 by the time signature, and reports the bar before and after", async (t) => {
    const four = withTransport(t);
    const first = JSON.parse(await four.transport.run({ jump_to_bar: 17 }));
    assert.equal(four.song.current_song_time, 64);
    assert.deepEqual(first, { position: { before: 1, after: 17 } });

    // Half a bar further; 6/8 has 3 beats to a bar, since a beat is a quarter note.
    const six = withTransport(t, 6, 8);
    six.song.current_song_time = 6;
    const second = JSON.parse(await six.transport.run({ jump_to_bar: 5.5 }));
    assert.equal(six.song.current_song_time, 13.5);
    assert.deepEqual(second, { position: { before: 3, after: 5.5 } });
});

test("transport refuses a bar before bar 1", async (t) => {
    const { transport } = withTransport(t);

    await assert.rejects(async () => transport.run({ jump_to_bar: 0 }), /jump_to_bar must be 1 or more/);
    await assert.rejects(async () => transport.run({ jump_to_bar: "drop" }), /jump_to_bar must be a number/);
});

test("transport sets the loop region from bar to bar and switches the loop on", async (t) => {
    const { song, transport } = withTransport(t);

    const output = JSON.parse(await transport.run({ loop_from_bar: 17, loop_to_bar: 25 }));

    // Bars 17 to 25 end where bar 25 begins: eight bars of four beats.
    assert.equal(song.loop_start, 64);
    assert.equal(song.loop_length, 32);
    assert.equal(song.loop, true);
    assert.deepEqual(output, {
        loop: { before: { on: false, from_bar: 1, to_bar: 2 }, after: { on: true, from_bar: 17, to_bar: 25 } },
    });
});

test("transport switches the loop off without touching its region, and on again with loop", async (t) => {
    const { song, transport } = withTransport(t);
    song.loop = true;
    song.loop_start = 8;
    song.loop_length = 16;

    const off = JSON.parse(await transport.run({ loop: false }));
    assert.equal(song.loop, false);
    assert.deepEqual(off, { loop: { before: { on: true, from_bar: 3, to_bar: 7 }, after: { on: false, from_bar: 3, to_bar: 7 } } });

    // A region given with loop: false is set and left off.
    await transport.run({ loop_from_bar: 1, loop_to_bar: 5, loop: false });
    assert.equal(song.loop, false);
    assert.equal(song.loop_start, 0);
});

test("transport refuses a loop region that is not from one bar to a later one, and says what it takes", async (t) => {
    const { song, transport } = withTransport(t);

    await assert.rejects(async () => transport.run({ loop_from_bar: 5 }), /loop_from_bar and loop_to_bar go together/);
    await assert.rejects(async () => transport.run({ loop_to_bar: 5 }), /loop_from_bar and loop_to_bar go together/);
    await assert.rejects(async () => transport.run({ loop_from_bar: 9, loop_to_bar: 9 }), /loop_to_bar must be after loop_from_bar/);
    await assert.rejects(async () => transport.run({ loop_from_bar: 0, loop_to_bar: 4 }), /loop_from_bar must be 1 or more/);
    await assert.rejects(async () => transport.run({ loop: "yes" }), /loop must be true or false/);

    assert.equal(song.loop_start, 0);
});

test("transport does several things in one call, in the order tempo, metronome, loop, jump, play, and reports each", async (t) => {
    const { song, transport } = withTransport(t);

    const output = JSON.parse(await transport.run({ action: "play", jump_to_bar: 17, loop_from_bar: 17, loop_to_bar: 21, tempo: 126, metronome: true }));

    assert.deepEqual(Object.keys(output), ["tempo", "metronome", "loop", "position", "playing"]);
    assert.deepEqual(output.playing, { before: false, after: true });
    assert.equal(song.current_song_time, 64);
    assert.equal(song.is_playing, true);
    // Playing comes last, so it starts from where it was sent.
    assert.deepEqual(commandsSent(), [
        "song.set_prop tempo",
        "song.set_prop metronome",
        "song.set_prop loop_start",
        "song.set_prop loop_length",
        "song.set_prop loop",
        "song.set_prop current_song_time",
        "song.continue_playing",
    ]);
});

test("transport with nothing to do says what it can do", async (t) => {
    const { transport } = withTransport(t);

    await assert.rejects(async () => transport.run({}), /Nothing to do.*action, jump_to_bar, loop_from_bar and loop_to_bar, loop, tempo, metronome/);
    await assert.rejects(async () => transport.run({ action: "pause" }), /action must be play or stop, not pause/);
});

test("transport is not marked as needing approval", async (t) => {
    const { transport } = withTransport(t);

    assert.notEqual(transport.needsApproval, true);
});
