import assert from "node:assert/strict";
import { test } from "node:test";
import type { Tool } from "@mentor/harness";
import { createAbleton } from "@mentor/tools/daws/ableton";
import { ADDRESS, type DeviceSpec, liveSet, useStandIn } from "@mentor/tools/daws/ableton/stand-in-live";
import { snapshot } from "./snapshot.ts";

// A device with enough parameters that two of them pass the 40,000-character result limit.
const big = (name: string, count = 400): DeviceSpec => ({
    name,
    class_name: "InstrumentVector",
    parameters: Array.from({ length: count }, (_, i) => ({ name: `${name} modulation amount ${i}`, value: i, min: 0, max: 1000, shown: (v: number) => `${v} %` })),
});

test("a snapshot reads every parameter of a track too long to read in one go", async (t) => {
    const { live, track, set } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
    set({
        tracks: [track({ name: "Strum", type: "midi", volume: "0.0 dB", pan: "C", devices: [big("Wavetable"), big("Drift")] })],
        return_tracks: [],
        master_track: track({ name: "Main", type: "main", volume: "0.0 dB", pan: "C" }),
    });
    useStandIn(t, live);

    const shot = await snapshot(createAbleton({ address: ADDRESS }));

    for (const device of ["Wavetable", "Drift"]) {
        const values = Object.keys(shot).filter((key) => key.includes(`/ ${device} modulation amount`));
        assert.equal(values.length, 400, device);
    }
});

test("a snapshot reads every clip of a track whose devices leave no room for them all", async (t) => {
    const { live, track, set } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
    set({
        tracks: [
            track({
                name: "Rose Bass",
                type: "midi",
                volume: "0.0 dB",
                pan: "C",
                // A Wavetable this size still fits a read, but leaves room for only about half of the clips.
                devices: [big("Wavetable", 450)],
                arrangement: Array.from({ length: 40 }, (_, i) => ({ name: `Bass ${i + 1}`, kind: "midi" as const, start: i * 4, end: i * 4 + 4 })),
            }),
        ],
        return_tracks: [],
        master_track: track({ name: "Main", type: "main", volume: "0.0 dB", pan: "C" }),
    });
    useStandIn(t, live);

    const tools = createAbleton({ address: ADDRESS });
    const shot = await snapshot(tools);

    // The track's own read does cut clips, or this test proves nothing.
    const read = JSON.parse(await (tools.find((tool) => tool.name === "read_tracks") as Tool).run({ tracks: ["t1"] }));
    assert.ok(read.left_out?.clips, "the first read cuts no clips");
    assert.equal(Object.keys(shot).filter((key) => / \/ Bass \d+ \(/.test(key)).length, 40);
    assert.equal(Object.keys(shot).filter((key) => key.includes("/ Wavetable modulation amount")).length, 450);
});
