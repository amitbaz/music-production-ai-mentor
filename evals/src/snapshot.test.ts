import assert from "node:assert/strict";
import { test } from "node:test";
import { createAbleton } from "@mentor/tools/daws/ableton";
import { ADDRESS, type DeviceSpec, liveSet, useStandIn } from "@mentor/tools/daws/ableton/stand-in-live";
import { snapshot } from "./snapshot.ts";

// A device with enough parameters that two of them pass the 40,000-character result limit.
const big = (name: string): DeviceSpec => ({
    name,
    class_name: "InstrumentVector",
    parameters: Array.from({ length: 400 }, (_, i) => ({ name: `${name} modulation amount ${i}`, value: i, min: 0, max: 1000, shown: (v: number) => `${v} %` })),
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
