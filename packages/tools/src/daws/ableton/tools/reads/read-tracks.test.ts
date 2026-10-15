import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { Tool } from "@mentor/harness";
import { createAbleton } from "../../ableton.ts";
import { ADDRESS, type DeviceSpec, liveSet, type ParameterSpec, StandInSocket, useStandIn } from "../../stand-in-live.ts";

type Track = ReturnType<ReturnType<typeof liveSet>["track"]>;

// A parameter with a number, such as a frequency, and one that is a list, such as a filter type.
const gain = (value: number): ParameterSpec => ({ name: "Gain", value, min: -15, max: 15, shown: (v) => `${v.toFixed(1)} dB` });
const filterType: ParameterSpec = { name: "Filter Type", items: ["Low Pass", "High Pass", "Band Pass"], value: 1 };

// Opens a Live Set with the tracks the test builds, and gives the tools as the harness would
// call them. read_set has run, as it does before the mentor has any object ids to give.
async function open(t: TestContext, build: (track: ReturnType<typeof liveSet>["track"]) => Track[]) {
    const { live, track, set } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
    const tracks = build(track);
    set({ tracks, return_tracks: [], master_track: track({ name: "Main", type: "main", volume: "0.0 dB", pan: "C" }) });
    useStandIn(t, live);
    const tools = createAbleton({ address: ADDRESS });
    const find = (name: string): Tool => tools.find((tool) => tool.name === name) as Tool;
    await find("read_set").run({});
    return { readTracks: find("read_tracks"), readSet: find("read_set"), live };
}

const reverb = (track: ReturnType<typeof liveSet>["track"]) =>
    track({ name: "A-Reverb", type: "return", volume: "0.0 dB", pan: "C", devices: [{ name: "Hybrid Reverb", class_name: "Hybrid", parameters: [gain(2)] }] });

const bass = (track: ReturnType<typeof liveSet>["track"], extra: Partial<Parameters<typeof track>[0]> = {}) =>
    track({ name: "Bass", type: "midi", volume: "0.0 dB", pan: "C", ...extra });

test("read_tracks gives every parameter of a native device with its shown value and range", async (t) => {
    const { readTracks } = await open(t, (track) => [
        bass(track, { devices: [{ name: "EQ Eight", class_name: "Eq8", parameters: [gain(-3)] }] }),
    ]);

    const result = JSON.parse(await readTracks.run({ tracks: ["t1"] }));

    assert.deepEqual(result.tracks, [
        {
            id: "t1",
            name: "Bass",
            devices: [{ id: "d1", name: "EQ Eight", parameters: [{ name: "Gain", value: "-3.0 dB", range: ["-15.0 dB", "15.0 dB"] }] }],
        },
    ]);
});

test("read_tracks gives a list parameter its current choice and the choices it has, and no range", async (t) => {
    const { readTracks } = await open(t, (track) => [
        bass(track, { devices: [{ name: "Auto Filter", class_name: "AutoFilter", parameters: [filterType] }] }),
    ]);

    const result = JSON.parse(await readTracks.run({ tracks: ["t1"] }));

    assert.deepEqual(result.tracks[0].devices[0].parameters, [
        { name: "Filter Type", value: "High Pass", choices: ["Low Pass", "High Pass", "Band Pass"] },
    ]);
});

test("read_tracks shows a rack's chains under it, and gives their devices object ids", async (t) => {
    const inner: DeviceSpec = { name: "Saturator", class_name: "Saturator", parameters: [gain(0)] };
    const { readTracks } = await open(t, (track) => [
        bass(track, {
            devices: [
                {
                    name: "Audio Effect Rack",
                    class_name: "AudioEffectGroupDevice",
                    chains: [
                        { name: "Clean", devices: [{ name: "Utility", class_name: "StereoGain" }] },
                        { name: "Dirty", mute: true, devices: [inner, { name: "Nested", class_name: "InstrumentGroupDevice", chains: [{ name: "Deep", devices: [inner] }] }] },
                    ],
                },
            ],
        }),
    ]);

    const [rack] = JSON.parse(await readTracks.run({ tracks: ["t1"] })).tracks[0].devices;

    assert.equal(rack.id, "d1");
    assert.equal(rack.parameters, undefined);
    assert.deepEqual(
        rack.chains.map((chain: { id: string; name: string; mute?: boolean; devices: { id: string; name: string }[] }) => [
            chain.id,
            chain.name,
            chain.mute,
            chain.devices.map((device) => [device.id, device.name]),
        ]),
        [
            ["ch1", "Clean", undefined, [["d2", "Utility"]]],
            [
                "ch2",
                "Dirty",
                true,
                [
                    ["d3", "Saturator"],
                    ["d4", "Nested"],
                ],
            ],
        ],
    );
    assert.equal(rack.chains[1].devices[0].parameters[0].value, "0.0 dB");
    assert.equal(rack.chains[1].devices[1].chains[0].devices[0].name, "Saturator");
});

test("read_tracks gives each clip of a track an object id, Session clips apart from Arrangement clips", async (t) => {
    const { readTracks } = await open(t, (track) => [
        bass(track, {
            session: [{ name: "Verse", kind: "midi" }, null, { name: "Drop", kind: "midi", muted: true }],
            arrangement: [{ name: "Intro", kind: "audio", start: 0, end: 16 }],
        }),
    ]);

    const [bassTrack] = JSON.parse(await readTracks.run({ tracks: ["t1"] })).tracks;

    assert.deepEqual(bassTrack.session, [
        { id: "c1", scene: 1, name: "Verse", kind: "midi" },
        { id: "c2", scene: 3, name: "Drop", kind: "midi", muted: true },
    ]);
    assert.deepEqual(bassTrack.arrangement, [{ id: "c3", name: "Intro", kind: "audio", start: 0, end: 16 }]);
});

test("read_tracks names a third-party plug-in and marks it, and asks Live nothing about its parameters", async (t) => {
    const { readTracks } = await open(t, (track) => [
        bass(track, { devices: [{ name: "Pro-Q 3", class_name: "PluginDevice", parameters: [gain(0)] }] }),
    ]);

    const result = JSON.parse(await readTracks.run({ tracks: ["t1"] }));

    assert.deepEqual(result.tracks[0].devices, [{ id: "d1", name: "Pro-Q 3", plugin: true }]);
    const asked = StandInSocket.opened.flatMap((socket) => socket.sent.flatMap((request) => request.commands));
    assert.ok(!asked.some((command) => command.ns === "device"));
});

test("read_tracks reads a return track and Main, which have devices but no clips", async (t) => {
    const { live, track, set } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
    const main = track({ name: "Main", type: "main", volume: "0.0 dB", pan: "C", devices: [{ name: "Limiter", class_name: "Limiter", parameters: [gain(-1)] }] });
    set({ tracks: [bass(track)], return_tracks: [reverb(track)], master_track: main });
    useStandIn(t, live);
    const tools = createAbleton({ address: ADDRESS });
    await (tools.find((tool) => tool.name === "read_set") as Tool).run({});

    const result = JSON.parse(await (tools.find((tool) => tool.name === "read_tracks") as Tool).run({ tracks: ["t2", "t3"] }));

    assert.deepEqual(
        result.tracks.map((track: { id: string; name: string; devices: { name: string; parameters: { value: string }[] }[] }) => [
            track.id,
            track.name,
            track.devices[0]?.name,
            track.devices[0]?.parameters[0]?.value,
            (track as { session?: unknown }).session,
            (track as { arrangement?: unknown }).arrangement,
        ]),
        [
            ["t2", "A-Reverb", "Hybrid Reverb", "2.0 dB", undefined, undefined],
            ["t3", "Main", "Limiter", "-1.0 dB", undefined, undefined],
        ],
    );
});

test("read_tracks reads several tracks at once, in the order asked", async (t) => {
    const { readTracks } = await open(t, (track) => [
        bass(track, { devices: [{ name: "EQ Eight", class_name: "Eq8", parameters: [gain(1)] }] }),
        track({ name: "Vocal", type: "audio", volume: "0.0 dB", pan: "C", devices: [{ name: "Compressor", class_name: "Compressor2", parameters: [gain(2)] }] }),
    ]);

    const result = JSON.parse(await readTracks.run({ tracks: ["t2", "t1"] }));

    assert.deepEqual(
        result.tracks.map((track: { id: string; name: string; devices: { id: string }[] }) => [track.id, track.name, track.devices[0]?.id]),
        [
            ["t2", "Vocal", "d2"],
            ["t1", "Bass", "d1"],
        ],
    );
});

test("read_tracks refuses an object id it never gave out, and says to read again", async (t) => {
    const { readTracks } = await open(t, (track) => [bass(track)]);

    await assert.rejects(async () => readTracks.run({ tracks: ["t1", "t99"] }), /t99.*read again/i);
});

test("read_tracks refuses a track deleted in Live since it was read, and says to read again", async (t) => {
    const { readTracks, live } = await open(t, (track) => [bass(track)]);
    // The first object the stand-in made is the track; Live no longer knows it.
    live.delete("live_1");

    await assert.rejects(async () => readTracks.run({ tracks: ["t1"] }), /t1.*no longer.*read again/i);
});

test("read_tracks refuses an id that is not a track, and asks for no track ids that are missing", async (t) => {
    const { readTracks } = await open(t, (track) => [bass(track, { devices: [{ name: "EQ Eight", class_name: "Eq8" }] })]);

    await assert.rejects(async () => readTracks.run({ tracks: ["d1"] }), /d1 is not a track/i);
    await assert.rejects(async () => readTracks.run({}), /tracks/i);
    await assert.rejects(async () => readTracks.run({ tracks: [] }), /tracks/i);
});

test("read_tracks sends the same number of messages for a big Live Set as for a small one", async (t) => {
    async function messagesFor(trackCount: number) {
        const { readTracks } = await open(t, (track) =>
            Array.from({ length: trackCount }, (_, i) =>
                bass(track, {
                    session: [{ name: `Clip ${i}`, kind: "midi" }],
                    arrangement: [{ name: `Clip ${i}`, kind: "midi" }],
                    devices: [
                        { name: "EQ Eight", class_name: "Eq8", parameters: [gain(0), filterType] },
                        { name: "Rack", class_name: "AudioEffectGroupDevice", chains: [{ name: "A", devices: [{ name: "EQ Eight", class_name: "Eq8", parameters: [gain(0)] }] }] },
                    ],
                }),
            ),
        );
        const before = StandInSocket.opened.flatMap((socket) => socket.sent).length;
        await readTracks.run({ tracks: Array.from({ length: trackCount }, (_, i) => `t${i + 1}`) });
        return StandInSocket.opened.flatMap((socket) => socket.sent).length - before;
    }

    const small = await messagesFor(1);
    const large = await messagesFor(30);

    assert.equal(large, small);
});

// A track whose devices each hold many parameters, so that together they pass the result limit.
const manyDevices = (count: number): DeviceSpec[] =>
    Array.from({ length: count }, (_, i) => ({
        name: `EQ Eight ${i}`,
        class_name: "Eq8",
        parameters: Array.from({ length: 84 }, (_, p) => ({ name: `${p + 1} Frequency`, value: 100, min: 10, max: 22000, shown: (v: number) => `${v} Hz` })),
    }));

test("read_tracks stays under 40,000 characters, and says which devices it left out and how to read them", async (t) => {
    const { readTracks } = await open(t, (track) => [bass(track, { devices: manyDevices(10) })]);

    const output = await readTracks.run({ tracks: ["t1"] });
    const result = JSON.parse(output);

    assert.ok(output.length <= 40_000, `${output.length} characters`);
    const devices: { id: string; parameters?: unknown[] }[] = result.tracks[0].devices;
    assert.equal(devices.length, 10);
    const cut = devices.filter((device) => device.parameters === undefined).map((device) => device.id);
    assert.ok(cut.length > 0 && cut.length < 10);
    assert.deepEqual(result.left_out.devices, cut);
    assert.match(result.left_out.note, /devices/);
    // What is kept is in order, from the first device on.
    assert.deepEqual(
        devices.filter((device) => device.parameters).map((device) => device.id),
        ["d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9", "d10"].slice(0, 10 - cut.length),
    );
});

test("read_tracks with devices gives parameters only for those devices, and lists the others by name", async (t) => {
    const { readTracks } = await open(t, (track) => [bass(track, { devices: manyDevices(10) })]);

    const result = JSON.parse(await readTracks.run({ tracks: ["t1"], devices: ["d9", "d10"] }));

    const devices: { id: string; name: string; parameters?: unknown[] }[] = result.tracks[0].devices;
    assert.deepEqual(
        devices.filter((device) => device.parameters).map((device) => device.id),
        ["d9", "d10"],
    );
    assert.deepEqual(devices[0], { id: "d1", name: "EQ Eight 0" });
    assert.equal(result.left_out, undefined);
});

test("read_tracks with devices still opens racks, so a device inside one can be asked for", async (t) => {
    const { readTracks } = await open(t, (track) => [
        bass(track, {
            devices: [
                { name: "EQ Eight", class_name: "Eq8", parameters: [gain(0)] },
                { name: "Rack", class_name: "AudioEffectGroupDevice", chains: [{ name: "A", devices: [{ name: "Saturator", class_name: "Saturator", parameters: [gain(5)] }] }] },
            ],
        }),
    ]);

    const result = JSON.parse(await readTracks.run({ tracks: ["t1"], devices: ["d3"] }));

    const [eq, rack] = result.tracks[0].devices;
    assert.deepEqual(eq, { id: "d1", name: "EQ Eight" });
    assert.equal(rack.parameters, undefined);
    assert.equal(rack.chains[0].devices[0].parameters[0].value, "5.0 dB");
});

test("read_tracks counts clips in the 40,000 character limit, and says how many of each track's it left out", async (t) => {
    const { readTracks } = await open(t, (track) => [
        bass(track, { arrangement: Array.from({ length: 800 }, (_, i) => ({ name: `Clip number ${i}`, kind: "midi" as const, start: i * 4, end: i * 4 + 4 })) }),
    ]);

    const output = await readTracks.run({ tracks: ["t1"] });
    const result = JSON.parse(output);

    assert.ok(output.length <= 40_000, `${output.length} characters`);
    const kept = result.tracks[0].arrangement;
    assert.ok(kept.length > 0 && kept.length < 800);
    assert.equal(kept[0].name, "Clip number 0");
    assert.deepEqual(result.left_out.clips, { t1: 800 - kept.length });
    assert.equal(result.left_out.devices, undefined);
});
