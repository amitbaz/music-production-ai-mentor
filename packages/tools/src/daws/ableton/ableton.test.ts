import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { Tool } from "@mentor/harness";
import { createAbleton } from "./ableton.ts";
import type { Command } from "./client.ts";

type Request = { uuid: string; commands: Command[] };

// A stand-in Live Set: the objects the script would answer for, keyed by the script's own ids.
// The song is under "song". Each object holds the namespace it belongs to and maps a
// property to its value; a parameter also holds the text Live shows for it, which is
// what str_for_value answers.
type LiveSet = Map<string, Record<string, unknown>>;

// A stand-in for the global WebSocket that answers like the ableton-js Remote Script.
class StandInSocket extends EventTarget {
    static opened: StandInSocket[] = [];
    static live: LiveSet = new Map();

    url: string;
    sent: Request[] = [];

    constructor(url: string) {
        super();
        this.url = url;
        StandInSocket.opened.push(this);
        setTimeout(() => {
            this.dispatchEvent(new Event("open"));
            this.reply({ event: "connect", data: { port: 39031, requiresAuth: false }, uuid: null });
        });
    }

    send(text: string) {
        const request = JSON.parse(text) as Request;
        this.sent.push(request);
        const data = request.commands.map((command) => answer(StandInSocket.live, command));
        setTimeout(() => this.reply({ event: "result", data, uuid: request.uuid }));
    }

    close() {
        setTimeout(() => this.dispatchEvent(new Event("close")));
    }

    reply(message: unknown) {
        this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) }));
    }
}

function answer(live: LiveSet, { ns, nsid, name, args }: Command) {
    const object = live.get(ns === "song" ? "song" : (nsid ?? ""));
    if (!object) return { ok: false, error: `Unknown object id: ${nsid}`, errorType: "Exception" };
    // The script would look the name up on the wrong kind of object and fail.
    if (object.ns !== ns) return { ok: false, error: `${nsid} is not a ${ns}`, errorType: "Exception" };
    if (name === "get_prop") {
        const { prop } = args as { prop: string };
        return { ok: true, data: object[prop] ?? null };
    }
    if (name === "str_for_value") return { ok: true, data: object.shown };
    return { ok: false, error: `Function call failed: ${name} doesn't exist`, errorType: "Exception" };
}

const realWebSocket = globalThis.WebSocket;

// Puts the stand-in in place of the global WebSocket for one test.
function useStandIn(t: TestContext, live: LiveSet) {
    StandInSocket.opened = [];
    StandInSocket.live = live;
    globalThis.WebSocket = StandInSocket as unknown as typeof WebSocket;
    t.after(() => {
        globalThis.WebSocket = realWebSocket;
    });
}

type TrackSpec = {
    name: string;
    type: "audio" | "midi" | "group" | "return" | "main";
    volume: string;
    pan: string;
    sends?: string[];
    mute?: boolean;
    solo?: boolean;
    group?: { id: string };
    devices?: { name: string; class_name: string }[];
};

// Builds a stand-in Live Set the way the script describes one.
function liveSet(song: { tempo: number; numerator: number; denominator: number }) {
    const live: LiveSet = new Map();
    let next = 1;
    const id = () => `live_${next++}`;

    function parameter(shown: string) {
        const paramId = id();
        live.set(paramId, { ns: "device-parameter", shown });
        return { id: paramId, name: "", value: 0, is_quantized: false };
    }

    function track(spec: TrackSpec) {
        const trackId = id();
        const mixerId = id();
        const serialized = {
            id: trackId,
            name: spec.name,
            solo: spec.solo ?? false,
            mute: spec.mute ?? false,
            color: 0,
            color_index: 0,
            is_grouped: spec.group !== undefined,
            type: spec.type,
        };
        live.set(trackId, {
            ns: "track",
            devices: (spec.devices ?? []).map((device) => {
                const deviceId = id();
                live.set(deviceId, { ns: "device" });
                return { id: deviceId, name: device.name, type: "audio_effect", class_name: device.class_name };
            }),
            mixer_device: { id: mixerId },
            group_track: spec.group ?? null,
        });
        live.set(mixerId, {
            ns: "mixer-device",
            volume: parameter(spec.volume),
            panning: parameter(spec.pan),
            sends: (spec.sends ?? []).map(parameter),
        });
        return serialized;
    }

    const set = { ns: "song", tempo: song.tempo, signature_numerator: song.numerator, signature_denominator: song.denominator };
    live.set("song", set);
    return { live, track, set: (props: Record<string, unknown>) => Object.assign(set, props) };
}

function findTool(tools: Tool[], name: string): Tool {
    const tool = tools.find((tool) => tool.name === name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    return tool;
}

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

    const output = await findTool(createAbleton(), "read_set").run({});

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

test("read_set keeps each object's id across reads, and gives a new object a new id", async (t) => {
    const { live, track, set } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
    const bass = track({ name: "Bass", type: "midi", volume: "0.0 dB", pan: "C", devices: [{ name: "Operator", class_name: "Operator" }] });
    const main = track({ name: "Main", type: "main", volume: "0.0 dB", pan: "C" });
    set({ tracks: [bass], return_tracks: [], master_track: main });
    useStandIn(t, live);
    const readSet = findTool(createAbleton(), "read_set");

    await readSet.run({});
    // The user adds a track above, then renames the bass.
    const lead = track({ name: "Lead", type: "midi", volume: "0.0 dB", pan: "C", devices: [{ name: "Wavetable", class_name: "InstrumentVector" }] });
    set({ tracks: [lead, { ...bass, name: "Sub" }] });
    const second = JSON.parse(await readSet.run({}));

    assert.deepEqual(
        second.tracks.map((track: { id: string; name: string; devices?: { id: string }[] }) => [
            track.id,
            track.name,
            track.devices?.map((device) => device.id),
        ]),
        [
            ["t3", "Lead", ["d2"]],
            ["t1", "Sub", ["d1"]],
            ["t2", "Main", undefined],
        ],
    );
});

test("no connection is opened before a tool is first used, and later calls reuse it", async (t) => {
    const { live, track, set } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
    set({ tracks: [], return_tracks: [], master_track: track({ name: "Main", type: "main", volume: "0.0 dB", pan: "C" }) });
    useStandIn(t, live);

    const readSet = findTool(createAbleton(), "read_set");
    assert.equal(StandInSocket.opened.length, 0);

    await readSet.run({});
    await readSet.run({});
    assert.deepEqual(
        StandInSocket.opened.map((socket) => socket.url),
        ["ws://127.0.0.1:39031"],
    );
});

test("read_set sends the same number of messages for a large Live Set as for a small one", async (t) => {
    async function messagesFor(trackCount: number) {
        const { live, track, set } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
        const reverb = track({ name: "A-Reverb", type: "return", volume: "0.0 dB", pan: "C" });
        const tracks = Array.from({ length: trackCount }, (_, i) =>
            track({ name: `Track ${i}`, type: "audio", volume: "0.0 dB", pan: "C", sends: ["-inf dB"], devices: [{ name: "EQ Eight", class_name: "Eq8" }] }),
        );
        set({ tracks, return_tracks: [reverb], master_track: track({ name: "Main", type: "main", volume: "0.0 dB", pan: "C" }) });
        useStandIn(t, live);
        await findTool(createAbleton(), "read_set").run({});
        return StandInSocket.opened.flatMap((socket) => socket.sent).length;
    }

    const small = await messagesFor(2);
    const large = await messagesFor(60);

    assert.equal(large, small);
    assert.ok(large <= 4, `sent ${large} messages`);
});
