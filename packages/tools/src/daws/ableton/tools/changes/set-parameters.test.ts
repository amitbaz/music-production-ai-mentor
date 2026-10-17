import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { Tool } from "@mentor/harness";
import { createAbleton } from "../../ableton.ts";
import { ADDRESS, type DeviceSpec, liveSet, type MixerSpec, type ParameterSpec, StandInSocket, useStandIn } from "../../stand-in-live.ts";

type MakeTrack = ReturnType<typeof liveSet>["track"];
type Track = ReturnType<MakeTrack>;

// A parameter with a number, such as a gain, and one that is a list, such as a filter type.
const gain = (value: number): ParameterSpec => ({ name: "Gain", value, min: -15, max: 15, shown: (v) => `${v.toFixed(1)} dB` });
const filterType: ParameterSpec = { name: "Filter Type", items: ["Low Pass", "High Pass", "Band Pass"], value: 1 };
// Live's own unit differs from the shown one, as Utility's Output runs -1 to 1 and shows dB.
// A plug-in's parameter runs from 0 to 1, and its text is the plug-in's own: Pro-C 2's Threshold
// shows dB without the unit.
const threshold = (value: number): ParameterSpec => ({ name: "Threshold", value, min: 0, max: 1, shown: (v) => (v * 60 - 60).toFixed(2) });
const output = (value: number): ParameterSpec => ({ name: "Output", value, min: -1, max: 1, scale: 35, shown: (v) => `${(v * 35).toFixed(1)} dB` });

// The mixer: a number in dB, a pan from -50 (left) to 50 (right), and a send in dB.
const db = (value: number): MixerSpec => ({ value, min: -70, max: 6, shown: (v) => `${v.toFixed(1)} dB` });
const pan = (value: number): MixerSpec => ({
    value,
    min: -50,
    max: 50,
    shown: (v) => (v === 0 ? "C" : `${Math.abs(v)}${v < 0 ? "L" : "R"}`),
});

const bass = (track: MakeTrack, devices: DeviceSpec[] = []) =>
    track({ name: "Bass", type: "midi", volume: db(-3), pan: pan(0), sends: [db(-12)], devices });
const reverb = (track: MakeTrack) => track({ name: "A-Reverb", type: "return", volume: db(0), pan: pan(0) });

// Opens a Live Set with a Bass track (t1), a return A-Reverb (t2) and Main (t3), and gives the
// tools as the harness would call them. read_set has run, as it does before the mentor has object ids.
async function open(t: TestContext, build: (track: MakeTrack) => Track[] = (track) => [bass(track)]) {
    const { live, track, set } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
    set({ tracks: build(track), return_tracks: [reverb(track)], master_track: track({ name: "Main", type: "main", volume: db(0), pan: pan(0) }) });
    useStandIn(t, live);
    const tools = createAbleton({ address: ADDRESS });
    const find = (name: string): Tool => tools.find((tool) => tool.name === name) as Tool;
    await find("read_set").run({});
    return {
        live,
        setParameters: find("set_parameters"),
        read: async (...ids: string[]) => JSON.parse(await find("read_tracks").run({ tracks: ids })).tracks,
        readSet: async () => JSON.parse(await find("read_set").run({})).tracks,
    };
}

const change = (target: string, parameter: string, value: number | string) => ({ target, parameter, value });
const run = async (tool: Tool, ...changes: unknown[]): Promise<{ changes: string[] }> => JSON.parse(await tool.run({ changes }));

test("set_parameters writes a device parameter in the units Live shows, and reports track / device / parameter: before → after", async (t) => {
    const { setParameters, read } = await open(t, (track) => [bass(track, [{ name: "Utility", class_name: "StereoGain", parameters: [output(-0.1)] }])]);

    const result = await run(setParameters, change("d1", "Output", -6));

    assert.deepEqual(result.changes, ["Bass / Utility / Output: -3.5 dB → -6.0 dB"]);
    const [track] = await read("t1");
    assert.equal(track.devices[0].parameters[0].value, "-6.0 dB");
});

test("set_parameters takes the name of a parameter whatever its case", async (t) => {
    const { setParameters } = await open(t, (track) => [bass(track, [{ name: "EQ Eight", class_name: "Eq8", parameters: [gain(0)] }])]);

    const result = await run(setParameters, change("d1", "gain", 2));

    assert.deepEqual(result.changes, ["Bass / EQ Eight / Gain: 0.0 dB → 2.0 dB"]);
});

test("set_parameters changes the volume, the pan and a send of a track the same way", async (t) => {
    const { setParameters, readSet } = await open(t);

    const result = await run(setParameters, change("t1", "volume", -6), change("t1", "pan", -25), change("t1", "send t2", -3));

    assert.deepEqual(result.changes, [
        "Bass / Volume: -3.0 dB → -6.0 dB",
        "Bass / Pan: C → 25L",
        "Bass / Send to A-Reverb: -12.0 dB → -3.0 dB",
    ]);
    const [bassTrack] = await readSet();
    assert.deepEqual([bassTrack.volume, bassTrack.pan, bassTrack.sends], ["-6.0 dB", "25L", { t2: "-3.0 dB" }]);
});

test("set_parameters ignores a send that has no return track, and refuses it as unknown", async (t) => {
    const { setParameters } = await open(t, (track) => [track({ name: "Bass", type: "midi", volume: db(-3), pan: pan(0), sends: [db(-12), db(-6)] })]);

    const result = await run(setParameters, change("t1", "send t2", -3), change("t1", "send t3", -3));

    assert.equal(result.changes[0], "Bass / Send to A-Reverb: -12.0 dB → -3.0 dB");
    assert.match(result.changes[1] as string, /send t3.*not changed.*volume, pan, send t2 \(A-Reverb\)/);
});

test("set_parameters changes the volume of a return track and of Main", async (t) => {
    const { setParameters } = await open(t);

    const result = await run(setParameters, change("t2", "volume", -2), change("t3", "volume", -1));

    assert.deepEqual(result.changes, ["A-Reverb / Volume: 0.0 dB → -2.0 dB", "Main / Volume: 0.0 dB → -1.0 dB"]);
});

test("set_parameters writes a list parameter by the name of the choice", async (t) => {
    const { setParameters, read } = await open(t, (track) => [bass(track, [{ name: "Auto Filter", class_name: "AutoFilter", parameters: [filterType] }])]);

    const result = await run(setParameters, change("d1", "Filter Type", "band pass"));

    assert.deepEqual(result.changes, ["Bass / Auto Filter / Filter Type: High Pass → Band Pass"]);
    assert.equal((await read("t1"))[0].devices[0].parameters[0].value, "Band Pass");
});

test("set_parameters refuses a choice the list does not have, and names the choices", async (t) => {
    const { setParameters, read } = await open(t, (track) => [bass(track, [{ name: "Auto Filter", class_name: "AutoFilter", parameters: [filterType] }])]);

    const result = await run(setParameters, change("d1", "Filter Type", "Notch"));

    assert.match(result.changes[0] as string, /Filter Type.*not changed.*"Notch".*Low Pass, High Pass, Band Pass/);
    assert.equal((await read("t1"))[0].devices[0].parameters[0].value, "High Pass");
});

test("set_parameters reports a list parameter that kept its choice, as not changed", async (t) => {
    const { setParameters } = await open(t, (track) => [
        bass(track, [{ name: "Auto Filter", class_name: "AutoFilter", parameters: [{ ...filterType, ignoresWrites: true }] }]),
    ]);

    const result = await run(setParameters, change("d1", "Filter Type", "Band Pass"));

    assert.match(result.changes[0] as string, /Filter Type.*not changed.*still High Pass.*Band Pass/);
});

test("set_parameters refuses a number for a list and a choice for a number", async (t) => {
    const { setParameters } = await open(t, (track) => [
        bass(track, [{ name: "Auto Filter", class_name: "AutoFilter", parameters: [filterType, gain(0)] }]),
    ]);

    const result = await run(setParameters, change("d1", "Filter Type", 2), change("d1", "Gain", "loud"));

    assert.match(result.changes[0] as string, /not changed.*choice.*Low Pass, High Pass, Band Pass/);
    assert.match(result.changes[1] as string, /not changed.*number/);
});

// A model may send the untyped value as text, such as "-24" for Transpose (#126).
test("set_parameters takes a number sent as text, and refuses text with a unit or nothing in it", async (t) => {
    const { setParameters } = await open(t, (track) => [bass(track, [{ name: "EQ Eight", class_name: "Eq8", parameters: [gain(0)] }])]);

    const result = await run(setParameters, change("d1", "Gain", " -2.5 "), change("d1", "Gain", "3 dB"), change("d1", "Gain", ""), change("d1", "Gain", "-3"));

    assert.equal(result.changes[0], "Bass / EQ Eight / Gain: 0.0 dB → -2.5 dB");
    assert.match(result.changes[1] as string, /not changed.*number/);
    assert.match(result.changes[2] as string, /not changed.*number/);
    assert.equal(result.changes[3], "Bass / EQ Eight / Gain: -2.5 dB → -3.0 dB");
});

test("set_parameters applies several changes in the order given and reports each", async (t) => {
    const { setParameters } = await open(t, (track) => [bass(track, [{ name: "EQ Eight", class_name: "Eq8", parameters: [gain(0)] }])]);

    const result = await run(setParameters, change("d1", "Gain", 3), change("t1", "volume", -4), change("d1", "Gain", 5));

    assert.deepEqual(result.changes, [
        "Bass / EQ Eight / Gain: 0.0 dB → 3.0 dB",
        "Bass / Volume: -3.0 dB → -4.0 dB",
        "Bass / EQ Eight / Gain: 3.0 dB → 5.0 dB",
    ]);
});

test("set_parameters reports a change that failed and still applies the others", async (t) => {
    const { setParameters } = await open(t, (track) => [bass(track, [{ name: "EQ Eight", class_name: "Eq8", parameters: [gain(0)] }])]);

    const result = await run(setParameters, change("d1", "Gain", 1), change("d1", "Nope", 1), change("t99", "volume", -1), change("t1", "volume", -5));

    assert.equal(result.changes.length, 4);
    assert.equal(result.changes[0], "Bass / EQ Eight / Gain: 0.0 dB → 1.0 dB");
    assert.match(result.changes[1] as string, /Nope.*not changed/);
    assert.match(result.changes[2] as string, /t99.*not changed.*read again/i);
    assert.equal(result.changes[3], "Bass / Volume: -3.0 dB → -5.0 dB");
});

test("set_parameters refuses a value outside the range, names the range, and leaves the value as it was", async (t) => {
    const { setParameters, read } = await open(t, (track) => [bass(track, [{ name: "EQ Eight", class_name: "Eq8", parameters: [gain(2)] }])]);

    const result = await run(setParameters, change("d1", "Gain", 40), change("d1", "Gain", -16));

    assert.match(result.changes[0] as string, /Gain.*not changed.*40.*-15\.0 dB to 15\.0 dB/);
    assert.match(result.changes[1] as string, /not changed.*-16.*-15\.0 dB to 15\.0 dB/);
    assert.equal((await read("t1"))[0].devices[0].parameters[0].value, "2.0 dB");
});

test("set_parameters takes a value at either end of the range, and one outside the range of a mixer number is refused", async (t) => {
    const { setParameters, readSet } = await open(t, (track) => [bass(track, [{ name: "EQ Eight", class_name: "Eq8", parameters: [gain(0)] }])]);

    const result = await run(setParameters, change("d1", "Gain", 15), change("d1", "Gain", -15), change("t1", "volume", 10));

    assert.equal(result.changes[0], "Bass / EQ Eight / Gain: 0.0 dB → 15.0 dB");
    assert.equal(result.changes[1], "Bass / EQ Eight / Gain: 15.0 dB → -15.0 dB");
    assert.match(result.changes[2] as string, /not changed.*-70\.0 dB to 6\.0 dB/);
    assert.equal((await readSet())[0].volume, "-3.0 dB");
});

test("set_parameters refuses a value just past an end of the range, and takes one within rounding of it", async (t) => {
    const { setParameters, readSet } = await open(t, (track) => [bass(track, [{ name: "EQ Eight", class_name: "Eq8", parameters: [gain(0)] }])]);

    const result = await run(setParameters, change("d1", "Gain", 15.05), change("d1", "Gain", 15.01), change("t1", "volume", -70.2));

    assert.match(result.changes[0] as string, /not changed.*15\.05.*-15\.0 dB to 15\.0 dB/);
    assert.equal(result.changes[1], "Bass / EQ Eight / Gain: 0.0 dB → 15.0 dB");
    assert.match(result.changes[2] as string, /not changed.*-70\.2.*-70\.0 dB to 6\.0 dB/);
    assert.equal((await readSet())[0].volume, "-3.0 dB");
});

test("set_parameters checks the range in shown units, not in Live's own", async (t) => {
    const { setParameters } = await open(t, (track) => [bass(track, [{ name: "Utility", class_name: "StereoGain", parameters: [output(0)] }])]);

    // 20 dB is inside Live's own -1 to 1 once shown, so it is the shown number that is checked.
    const result = await run(setParameters, change("d1", "Output", 20), change("d1", "Output", 50));

    assert.equal(result.changes[0], "Bass / Utility / Output: 0.0 dB → 20.0 dB");
    assert.match(result.changes[1] as string, /not changed.*50.*-35\.0 dB to 35\.0 dB/);
});

test("set_parameters refuses an unknown parameter and names the parameters that exist", async (t) => {
    const { setParameters } = await open(t, (track) => [bass(track, [{ name: "Auto Filter", class_name: "AutoFilter", parameters: [filterType, gain(0)] }])]);

    const result = await run(setParameters, change("d1", "Cutoff", 100), change("t1", "reverb", 1), change("t1", "send t9", 0));

    assert.match(result.changes[0] as string, /Cutoff.*not changed.*Filter Type, Gain/);
    assert.match(result.changes[1] as string, /reverb.*not changed.*volume, pan, send t2 \(A-Reverb\)/);
    assert.match(result.changes[2] as string, /send t9.*not changed.*volume, pan, send t2 \(A-Reverb\)/);
});

test("set_parameters refuses a parameter that two parameters of a device share the name of", async (t) => {
    const { setParameters } = await open(t, (track) => [bass(track, [{ name: "Operator", class_name: "Operator", parameters: [gain(0), gain(1)] }])]);

    const result = await run(setParameters, change("d1", "Gain", 3));

    assert.match(result.changes[0] as string, /Gain.*not changed.*more than one/i);
});

test("set_parameters writes a plug-in's number as the plug-in's text shows it, and reports before → after", async (t) => {
    const { setParameters, read } = await open(t, (track) => [bass(track, [{ name: "Pro-C 2", class_name: "AuPluginDevice", parameters: [threshold(0.7)] }])]);

    const result = await run(setParameters, change("d1", "Threshold", -25), change("d1", "Threshold", "-40"));

    assert.deepEqual(result.changes, ["Bass / Pro-C 2 / Threshold: -18.00 → -25.00", "Bass / Pro-C 2 / Threshold: -25.00 → -40.00"]);
    const [track] = await read("t1");
    assert.equal(track.devices[0].parameters[0].value, "-40.00");
});

test("set_parameters writes a plug-in's list control by the name its text shows, with no choices from Live", async (t) => {
    // A control such as Pro-C 2's Style: a number from 0 to 1 to Live, with a name for each stretch.
    const style: ParameterSpec = { name: "Style", value: 0, min: 0, max: 1, shown: (v) => ["Clean", "Classic", "Opto"][Math.min(2, Math.floor(v * 3))] as string };
    const { setParameters } = await open(t, (track) => [bass(track, [{ name: "Pro-C 2", class_name: "AuPluginDevice", parameters: [style] }])]);

    const result = await run(setParameters, change("d1", "Style", "opto"));

    assert.deepEqual(result.changes, ["Bass / Pro-C 2 / Style: Clean → Opto"]);
});

test("set_parameters writes a plug-in's list control that Live gives choices for, by the name of the choice", async (t) => {
    const deviceOn: ParameterSpec = { name: "Device On", items: ["Off", "On"], value: 0 };
    const { setParameters } = await open(t, (track) => [bass(track, [{ name: "Pro-C 2", class_name: "AuPluginDevice", parameters: [deviceOn] }])]);

    const result = await run(setParameters, change("d1", "Device On", "On"));

    assert.deepEqual(result.changes, ["Bass / Pro-C 2 / Device On: Off → On"]);
});

test("set_parameters refuses a plug-in number past what its text shows, and a text it never shows, and runs the other changes", async (t) => {
    const { setParameters, read } = await open(t, (track) => [bass(track, [{ name: "Pro-C 2", class_name: "AuPluginDevice", parameters: [threshold(0.7)] }])]);

    const result = await run(setParameters, change("d1", "Threshold", 6), change("d1", "Threshold", "-30 dB"), change("d1", "Threshold", -30));

    assert.match(result.changes[0] as string, /Threshold: not changed\. 6 is outside the range of Threshold, which is -60\.00 to 0\.00\. Its value is still -18\.00/);
    assert.match(result.changes[1] as string, /Threshold: not changed\. .*"-30 dB".*-60\.00 to 0\.00\. Its value is still -18\.00/);
    assert.equal(result.changes[2], "Bass / Pro-C 2 / Threshold: -18.00 → -30.00");
    const [track] = await read("t1");
    assert.equal(track.devices[0].parameters[0].value, "-30.00");
});

test("set_parameters names the track of a device inside racks, however deep", async (t) => {
    const inner: DeviceSpec = { name: "Saturator", class_name: "Saturator", parameters: [gain(0)] };
    const { setParameters, read } = await open(t, (track) => [
        bass(track, [
            {
                name: "Audio Effect Rack",
                class_name: "AudioEffectGroupDevice",
                chains: [{ name: "A", devices: [{ name: "Inner Rack", class_name: "AudioEffectGroupDevice", chains: [{ name: "B", devices: [inner] }] }] }],
            },
        ]),
    ]);

    // The ids of the devices inside the racks come from reading the track.
    await read("t1");

    const result = await run(setParameters, change("d3", "Gain", 4));

    assert.deepEqual(result.changes, ["Bass / Saturator / Gain: 0.0 dB → 4.0 dB"]);
});

test("set_parameters names the track of a device on a return track and on Main", async (t) => {
    const { live, track, set } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
    const returnTrack = track({ name: "A-Reverb", type: "return", volume: db(0), pan: pan(0), devices: [{ name: "Hybrid Reverb", class_name: "Hybrid", parameters: [gain(1)] }] });
    const main = track({ name: "Main", type: "main", volume: db(0), pan: pan(0), devices: [{ name: "Limiter", class_name: "Limiter", parameters: [gain(-1)] }] });
    set({ tracks: [bass(track)], return_tracks: [returnTrack], master_track: main });
    useStandIn(t, live);
    const tools = createAbleton({ address: ADDRESS });
    await (tools.find((tool) => tool.name === "read_set") as Tool).run({});
    const setParameters = tools.find((tool) => tool.name === "set_parameters") as Tool;

    const result = await run(setParameters, change("d1", "Gain", 2), change("d2", "Gain", 0));

    assert.deepEqual(result.changes, ["A-Reverb / Hybrid Reverb / Gain: 1.0 dB → 2.0 dB", "Main / Limiter / Gain: -1.0 dB → 0.0 dB"]);
});

test("set_parameters refuses an object that is not a track or a device, and an id it never gave out", async (t) => {
    const { setParameters } = await open(t);

    const result = await run(setParameters, change("c1", "volume", 0), change("ch1", "volume", 0), change("d99", "Gain", 0));

    assert.match(result.changes[0] as string, /c1.*not changed.*track or a device/);
    assert.match(result.changes[1] as string, /ch1.*not changed.*track or a device/);
    assert.match(result.changes[2] as string, /d99.*not changed.*read again/i);
});

test("set_parameters refuses a track or a device deleted in Live since it was read, and says to read again", async (t) => {
    const { setParameters } = await open(t, (track) => [bass(track, [{ name: "EQ Eight", class_name: "Eq8", parameters: [gain(0)] }])]);
    const { live } = StandInSocket;
    // The first object the stand-in made is the track; Live no longer knows it.
    live.delete("live_1");

    const result = await run(setParameters, change("t1", "volume", 0));

    assert.match(result.changes[0] as string, /t1.*not changed.*no longer.*read again/i);
});

test("set_parameters refuses a call with no changes, and a change without a target, a parameter or a value", async (t) => {
    const { setParameters } = await open(t);

    await assert.rejects(async () => setParameters.run({}), /changes/);
    await assert.rejects(async () => setParameters.run({ changes: [] }), /changes/);
    const result = await run(setParameters, { parameter: "volume", value: 1 }, { target: "t1", value: 1 }, { target: "t1", parameter: "volume" }, "t1");
    assert.equal(result.changes.length, 4);
    for (const line of result.changes) assert.match(line, /not changed/);
});

test("set_parameters is not marked as needing approval", async (t) => {
    const { setParameters } = await open(t);

    assert.notEqual(setParameters.needsApproval, true);
});

test("set_parameters sends the same number of messages to read a device whatever the number of parameters on it", async (t) => {
    async function messagesFor(parameterCount: number) {
        const parameters = Array.from({ length: parameterCount }, (_, i): ParameterSpec => ({ ...gain(0), name: `P${i}` }));
        const { setParameters } = await open(t, (track) => [bass(track, [{ name: "EQ Eight", class_name: "Eq8", parameters }])]);
        const before = StandInSocket.opened.flatMap((socket) => socket.sent).length;
        await run(setParameters, change("d1", "P0", 1));
        return StandInSocket.opened.flatMap((socket) => socket.sent).length - before;
    }

    assert.equal(await messagesFor(80), await messagesFor(1));
});

// The writes of the properties asked for, in the order Live got them.
const written = (...props: string[]) =>
    StandInSocket.opened
        .flatMap((socket) => socket.sent.slice(1))
        .flatMap((request) => request.commands)
        .map((command) => (command.name === "set_prop" ? (command.args as { prop: string }).prop : command.name))
        .filter((name) => props.includes(name));

// A Bass track in a folded group, with a device, read so that Bass is t2 and the device d1.
async function openInFoldedGroup(t: TestContext) {
    let group: Track | undefined;
    let inside: Track | undefined;
    const made = await open(t, (track) => {
        group = track({ name: "Synths", type: "group", volume: db(0), pan: pan(0), folded: true });
        inside = track({
            name: "Bass",
            type: "midi",
            volume: db(-3),
            pan: pan(0),
            sends: [db(-12)],
            group,
            collapsed: true,
            devices: [
                { name: "EQ Eight", class_name: "Eq8", parameters: [gain(0), { name: "Other", value: 1, min: 0, max: 2, shown: (v) => `${v}` }] },
                { name: "Utility", class_name: "StereoGain", parameters: [gain(0)] },
            ],
        });
        return [group, inside];
    });
    const view = made.live.get("song-view") as Record<string, unknown>;
    const application = made.live.get("application-view") as { views: string[]; scrolls: { direction: string; view: string }[] };
    const deviceId = [...made.live].find(([, object]) => object.ns === "device")?.[0];
    return { ...made, group: group as Track, bassTrack: inside as Track, view, views: application.views, scrolls: application.scrolls, deviceId };
}

test("set_parameters shows the track of a device first: the group is opened, then the track and the device are selected, and the device view opens", async (t) => {
    const { setParameters, live, group, bassTrack, view, views, deviceId } = await openInFoldedGroup(t);

    await run(setParameters, change("d1", "Gain", 2));

    assert.equal(live.get(group.id)?.fold_state, false);
    // The track of the device is shown as a thin strip until it is expanded.
    assert.equal((live.get(bassTrack.id) as { view: { is_collapsed: boolean } }).view.is_collapsed, false);
    assert.equal(view.selected_track, bassTrack.id);
    assert.equal(view.selected_device, deviceId);
    assert.deepEqual(views, ["Detail/DeviceChain"]);
    // The device is shown before its parameter changes.
    // Shown and scrolled to, track first, and selected again where the scroll left the selection.
    assert.deepEqual(written("fold_state", "focus_view", "selected_track", "select_device", "scroll_view", "display_value"), [
        "fold_state",
        "selected_track",
        "focus_view",
        "scroll_view",
        "scroll_view",
        "selected_track",
        "select_device",
        "scroll_view",
        "scroll_view",
        "select_device",
        "display_value",
    ]);
});

test("set_parameters scrolls the device chain to a device by moving the selection one device away and back", async (t) => {
    const { setParameters, scrolls } = await openInFoldedGroup(t);
    const chain = (...directions: string[]) => directions.map((direction) => ({ direction, view: "Detail/DeviceChain" }));
    const inChain = () => scrolls.splice(0).filter((scroll) => scroll.view === "Detail/DeviceChain");

    // A device with another before it: left, then right.
    await run(setParameters, change("d2", "Gain", 1));
    assert.deepEqual(inChain(), chain("left", "right"));

    // The first device has none before it: right, then left.
    await run(setParameters, change("d1", "Gain", 1));
    assert.deepEqual(inChain(), chain("right", "left"));
});

test("set_parameters shows the track of a mixer change, and shows a device once however many of its parameters change", async (t) => {
    const { setParameters, group, bassTrack, view, live, scrolls } = await openInFoldedGroup(t);

    await run(setParameters, change("t2", "volume", -6));
    assert.equal(live.get(group.id)?.fold_state, false);
    assert.equal(view.selected_track, bassTrack.id);

    scrolls.length = 0;
    await run(setParameters, change("d1", "Gain", 1), change("d1", "Other", 2), change("d1", "Gain", 3));
    // Shown once: a scroll away and back for the track and one for the device, not one for each change.
    assert.equal(scrolls.length, 4);
});

test("set_parameters does not move the view for a change it refuses", async (t) => {
    const { setParameters, view } = await openInFoldedGroup(t);

    await run(setParameters, change("d1", "Nothing", 2));

    assert.equal(view.selected_track, null);
    assert.equal(view.selected_device, null);
});
