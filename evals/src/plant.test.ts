import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { Tool } from "@mentor/harness";
import { createAbleton } from "@mentor/tools/daws/ableton";
import { ADDRESS, type DeviceSpec, liveSet, type MixerSpec, type ParameterSpec, useStandIn } from "@mentor/tools/daws/ableton/stand-in-live";
import { applyPlant, type Plant, revertPlant } from "./plant.ts";

const db = (value: number): MixerSpec => ({ value, min: -70, max: 6, shown: (v) => `${v.toFixed(1)} dB` });
const pan: MixerSpec = { value: 0, min: -50, max: 50, shown: () => "C" };
const transpose = (value: number): ParameterSpec => ({ name: "Transpose", value, min: -48, max: 48, shown: (v) => `${v} st` });
const mono = (value: number): ParameterSpec => ({ name: "Mono", items: ["Off", "On"], value });
const utility = (on: number): DeviceSpec => ({ name: "Utility", class_name: "StereoGain", parameters: [mono(on)] });
const operator = (st: number): DeviceSpec => ({ name: "Operator", class_name: "Operator", parameters: [transpose(st)] });
const rack = (inner: DeviceSpec): DeviceSpec => ({ name: "Sub Sub Bass", class_name: "InstrumentGroupDevice", chains: [{ name: "Bassline", devices: [inner] }] });

// A plant across the mixer, a device on the track, and a device inside a rack chain.
const plant: Plant = {
    name: "kick-bass-fight",
    title: "Kick and bass fight",
    bars: "25–33",
    says: "The sub sits on the kick.",
    changes: [
        { track: "Sub Sub Bass", parameter: "volume", before: -1, after: 5 },
        { track: "Coffee Leaf", device: ["Utility"], parameter: "Mono", before: "Off", after: "On" },
        { track: "Sub Sub Bass", device: ["Sub Sub Bass", "Bassline", "Operator"], parameter: "Transpose", before: -24, after: -12 },
    ],
};

// Opens a stand-in Live Set shaped like the corner of Patience the plant touches.
function open(t: TestContext, { subVolume = -1, mono = 0, st = -24 } = {}) {
    const { live, track, set } = liveSet({ tempo: 167, numerator: 4, denominator: 4 });
    set({
        tracks: [
            track({ name: "Coffee Leaf", type: "midi", volume: db(-4), pan, sends: [], devices: [utility(mono)] }),
            track({ name: "Sub Sub Bass", type: "midi", volume: db(subVolume), pan, sends: [], devices: [rack(operator(st))] }),
        ],
        return_tracks: [],
        master_track: track({ name: "Main", type: "main", volume: db(0), pan }),
    });
    useStandIn(t, live);
    const tools = createAbleton({ address: ADDRESS });
    const find = (name: string): Tool => tools.find((tool) => tool.name === name) as Tool;
    return {
        tools,
        values: async () => {
            const set = JSON.parse(await find("read_set").run({}));
            const sub = set.tracks.find((track: { name: string }) => track.name === "Sub Sub Bass");
            const [leaf] = JSON.parse(await find("read_tracks").run({ tracks: [set.tracks[0].id] })).tracks;
            const [subDetail] = JSON.parse(await find("read_tracks").run({ tracks: [sub.id] })).tracks;
            return {
                volume: sub.volume,
                mono: leaf.devices[0].parameters[0].value,
                transpose: subDetail.devices[0].chains[0].devices[0].parameters[0].value,
            };
        },
    };
}

test("applyPlant writes the after values, on the mixer, a device and a device inside a rack, and reports each change", async (t) => {
    const { tools, values } = open(t);

    const lines = await applyPlant(tools, plant);

    assert.deepEqual(lines, [
        "Sub Sub Bass / Volume: -1.0 dB → 5.0 dB",
        "Coffee Leaf / Utility / Mono: Off → On",
        "Sub Sub Bass / Operator / Transpose: -24 st → -12 st",
    ]);
    assert.deepEqual(await values(), { volume: "5.0 dB", mono: "On", transpose: "-12 st" });
});

test("applyPlant refuses when the Set does not hold a before value, and writes nothing", async (t) => {
    const { tools, values } = open(t, { st: -12 });

    await assert.rejects(applyPlant(tools, plant), /Sub Sub Bass \/ Operator \/ Transpose is -12 st, not -24/);

    assert.deepEqual(await values(), { volume: "-1.0 dB", mono: "Off", transpose: "-12 st" });
});

test("revertPlant writes the before values back", async (t) => {
    const { tools, values } = open(t, { subVolume: 5, mono: 1, st: -12 });

    const lines = await revertPlant(tools, plant);

    assert.equal(lines[0], "Sub Sub Bass / Volume: 5.0 dB → -1.0 dB");
    assert.deepEqual(await values(), { volume: "-1.0 dB", mono: "Off", transpose: "-24 st" });
});
