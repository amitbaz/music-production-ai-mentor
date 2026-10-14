import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../../client.ts";
import { ADDRESS, liveSet, useStandIn } from "../../stand-in-live.ts";
import { readSet } from "./read-set.ts";

test("read_set gives an overview of the Live Set as compact JSON", async (t) => {
    const { live, track, set } = liveSet({ tempo: 124, numerator: 6, denominator: 8 });
    const drums = track({ name: "Drums", type: "group", volume: "0.0 dB", pan: "C", sends: ["-inf dB"] });
    const kick = track({
        name: "Kick",
        type: "midi",
        volume: "-3.0 dB",
        pan: "12L",
        sends: ["-12.0 dB"],
        mute: true,
        group: drums,
        devices: [
            { name: "Drum Rack", class_name: "DrumGroupDevice" },
            { name: "Pro-Q 3", class_name: "PluginDevice" },
        ],
    });
    const vocal = track({
        name: "Vocal",
        type: "audio",
        volume: "-6.5 dB",
        pan: "C",
        sends: ["-inf dB"],
        solo: true,
        devices: [{ name: "Smooth Operator", class_name: "AuPluginDevice" }],
    });
    const reverb = track({
        name: "A-Reverb",
        type: "return",
        volume: "-4.0 dB",
        pan: "C",
        devices: [{ name: "Hybrid Reverb", class_name: "Hybrid" }],
    });
    const main = track({ name: "Main", type: "main", volume: "0.0 dB", pan: "C" });
    set({ tracks: [drums, kick, vocal], return_tracks: [reverb], master_track: main });
    useStandIn(t, live);

    const output = await readSet(createClient(ADDRESS)).run({});

    assert.doesNotMatch(output, /\n/);
    assert.deepEqual(JSON.parse(output), {
        tempo: 124,
        time_signature: "6/8",
        tracks: [
            { id: "t1", name: "Drums", kind: "group", volume: "0.0 dB", pan: "C", sends: { t4: "-inf dB" } },
            {
                id: "t2",
                name: "Kick",
                kind: "midi",
                group: "t1",
                volume: "-3.0 dB",
                pan: "12L",
                sends: { t4: "-12.0 dB" },
                mute: true,
                devices: [
                    { id: "d1", name: "Drum Rack" },
                    { id: "d2", name: "Pro-Q 3", plugin: true },
                ],
            },
            {
                id: "t3",
                name: "Vocal",
                kind: "audio",
                volume: "-6.5 dB",
                pan: "C",
                sends: { t4: "-inf dB" },
                solo: true,
                devices: [{ id: "d3", name: "Smooth Operator", plugin: true }],
            },
            {
                id: "t4",
                name: "A-Reverb",
                kind: "return",
                volume: "-4.0 dB",
                pan: "C",
                devices: [{ id: "d4", name: "Hybrid Reverb" }],
            },
            { id: "t5", name: "Main", kind: "main", volume: "0.0 dB", pan: "C" },
        ],
    });
});
