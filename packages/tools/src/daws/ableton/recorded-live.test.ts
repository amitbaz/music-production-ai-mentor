// The reads against replies a real Live 12.4.6 sent, recorded with the ableton-js script 5.0.4 and
// our file at version 3. Track, clip, chain, locator and rack names were replaced before saving.
// A change to which commands a read sends breaks the replay: record the reads again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAbleton } from "./ableton.ts";
import { ADDRESS, useRecording } from "./stand-in-live.ts";

function tools() {
    return Object.fromEntries(createAbleton({ address: ADDRESS }).map((tool) => [tool.name, tool]));
}

test("read_set, read_tracks, read_arrangement and read_clip read what a real Live sent", async (t) => {
    useRecording(t, "recorded-reads.json");
    const { read_set, read_tracks, read_arrangement, read_clip } = tools();

    const set = JSON.parse(await read_set.run({}));
    assert.equal(set.tempo, 124);
    assert.equal(set.time_signature, "4/4");
    assert.equal(set.tracks.length, 21);
    // Two plug-ins, marked as such, and sends named by their return tracks.
    assert.deepEqual(set.tracks[0], {
        id: "t1",
        name: "Track 1",
        kind: "midi",
        volume: "0.0 dB",
        pan: "C",
        sends: { t19: "-inf dB", t20: "-inf dB" },
        devices: [
            { id: "d1", name: "Splice Bridge", plugin: true },
            { id: "d2", name: "FabFilter Pro-Q 3", plugin: true },
        ],
    });
    assert.deepEqual(set.tracks[3].group, "t3");
    assert.deepEqual(
        set.tracks.slice(-3).map((track: { kind: string }) => track.kind),
        ["return", "return", "main"],
    );

    // A rack whose chain holds a Simpler, with its values in Live's units, and a plug-in without parameters.
    const kick = JSON.parse(await read_tracks.run({ tracks: ["t6"] })).tracks[0];
    const [rack, utility, proQ] = kick.devices;
    const simpler = rack.chains[0].devices[0];
    assert.deepEqual(
        simpler.parameters.find((parameter: { name: string }) => parameter.name === "Volume"),
        { name: "Volume", value: "-9.10 dB", range: ["-36.0 dB", "36.0 dB"] },
    );
    assert.deepEqual(
        simpler.parameters.find((parameter: { name: string }) => parameter.name === "Pe Mode"),
        { name: "Pe Mode", value: "None", choices: ["None", "Loop", "Beat", "Sync", "Trigger"] },
    );
    assert.equal(utility.name, "Utility");
    assert.deepEqual(proQ, { id: "d6", name: "FabFilter Pro-Q 3", plugin: true });

    // Clips from beat 64 to 128 in 4/4 run from bar 17 to bar 33, where the locator is.
    assert.deepEqual(JSON.parse(await read_arrangement.run({})), {
        locators: [{ id: "l1", name: "Locator 1", bar: 17 }],
        tracks: [
            { id: "t2", name: "Track 2", clips: [["c2", "", 17, 33]] },
            { id: "t6", name: "Track 6", clips: [["c1", "", 17, 33]] },
        ],
    });

    assert.deepEqual(JSON.parse(await read_clip.run({ clip: "c2" })), {
        id: "c2",
        name: "",
        kind: "midi",
        notes: [
            ["n1", 60, 0, 1, 100, 1],
            ["n2", 60, 1, 1, 100, 1],
            ["n3", 60, 2, 1, 100, 1],
            ["n4", 60, 3, 1, 100, 1],
        ],
    });
});
