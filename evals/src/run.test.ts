import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { Message, Model, Tool } from "@mentor/harness";
import { createMentor } from "@mentor/mentor";
import { createAbleton } from "@mentor/tools/daws/ableton";
import { ADDRESS, liveSet, type MixerSpec, useStandIn } from "@mentor/tools/daws/ableton/stand-in-live";
import type { Case } from "./run.ts";
import { type Run, runCase } from "./run.ts";
import { snapshot } from "./snapshot.ts";

const db = (value: number): MixerSpec => ({ value, min: -70, max: 6, shown: (v) => `${v.toFixed(1)} dB` });
const pan: MixerSpec = { value: 0, min: -50, max: 50, shown: () => "C" };

const lowEndHot: Case = {
    name: "low-end-hot",
    plant: { name: "low-end-hot", title: "Low end too hot", bars: "25–33", says: "Too loud.", changes: [{ track: "Sub Sub Bass", parameter: "volume", before: -1, after: 5 }] },
    message: "The sub bass is way too loud, can you fix it?",
};

// A scripted model: one list of replies per model call, in order.
function scripted(replies: Message[][]): Model {
    return { call: async () => ({ messages: replies.shift() ?? [], cutOff: false }) };
}
const call = (name: string, args: Record<string, unknown>): Message[] => [{ type: "tool_call", id: name, name, args }];
const say = (text: string): Message[] => [{ type: "assistant", text }];
// The mentor's own connection reads Sub Sub Bass as t1 and its Utility as d1.
const fix = [call("read_set", {}), call("set_parameters", { changes: [{ target: "t1", parameter: "volume", value: -1 }] }), say("Down to -1 dB.")];

// A stand-in Live Set with the sub bass at its base volume and a Utility on it, and a way to connect
// that gives the runner's tools and a mentor with a scripted model, each pair on its own connection.
// `used` lists every tool the runner's tools ran and every call of the mentor's model, by the pair that did it.
function open(t: TestContext, replies: Message[][] | Model) {
    const { live, track, set } = liveSet({ tempo: 167, numerator: 4, denominator: 4 });
    const gain = { name: "Gain", value: 0, min: -35, max: 35, shown: (v: number) => `${v.toFixed(1)} dB` };
    set({
        tracks: [track({ name: "Sub Sub Bass", type: "midi", volume: db(-1), pan, sends: [], devices: [{ name: "Utility", class_name: "StereoGain", parameters: [gain] }] })],
        return_tracks: [],
        master_track: track({ name: "Main", type: "main", volume: db(0), pan }),
    });
    useStandIn(t, live);
    const model = Array.isArray(replies) ? scripted(replies) : replies;
    const used: { pair: number; tool: string }[] = [];
    let pairs = 0;
    const connect = () => {
        const pair = pairs++;
        const tools: Tool[] = createAbleton({ address: ADDRESS }).map((tool) => ({
            ...tool,
            run: async (args: Record<string, unknown>) => {
                used.push({ pair, tool: tool.name });
                return tool.run(args);
            },
        }));
        const mentor = createMentor({
            model: {
                call: async (...args) => {
                    used.push({ pair, tool: "model" });
                    return model.call(...args);
                },
            },
            abletonAddress: ADDRESS,
        });
        return { tools, mentor };
    };
    // The test's own view of the Set, on a connection of its own.
    const tools: Tool[] = createAbleton({ address: ADDRESS });
    const runs: Run[] = [];
    return { connect, tools, runs, used, onRun: async (run: Run) => void runs.push(run) };
}

test("a run passes when the mentor puts the planted value back, and is kept in full", async (t) => {
    const { connect, tools, runs, onRun } = open(t, [...fix, ...fix]);
    const base = await snapshot(tools);

    const result = await runCase({ connect, model: "gemini:test", case: lowEndHot, runs: 2, onRun });

    assert.deepEqual(result, { passed: 2, runs: 2 });
    assert.equal(runs.length, 2);
    const [first] = runs as [Run];
    assert.deepEqual([first.case, first.run, first.model, first.message, first.passed, first.difference], ["low-end-hot", 1, "gemini:test", lowEndHot.message, true, []]);
    assert.equal(first.stop, "finished");
    assert.deepEqual(first.messages[0], { type: "user", text: lowEndHot.message });
    assert.deepEqual(first.messages.at(-1), { type: "assistant", text: "Down to -1 dB." });
    assert.deepEqual(await snapshot(tools), base);
});

test("a run fails when the mentor changes anything else, and the Set is restored before the next run", async (t) => {
    const { connect, tools, runs, onRun } = open(t, [
        call("read_set", {}),
        call("set_parameters", { changes: [{ target: "t1", parameter: "volume", value: -1 }, { target: "d1", parameter: "Gain", value: 3 }] }),
        call("edit_devices", { edits: [{ action: "add", name: "EQ Eight", to: "t1" }] }),
        say("Fixed, and shaped it."),
        ...fix,
    ]);
    const base = await snapshot(tools);

    const result = await runCase({ connect, model: "gemini:test", case: lowEndHot, runs: 2, onRun });

    assert.deepEqual(result, { passed: 1, runs: 2 });
    const [first, second] = runs as [Run, Run];
    assert.equal(first.passed, false);
    assert.ok(first.difference.some((line) => /Utility .* \/ Gain: 0\.0 dB → 3\.0 dB/.test(line)), first.difference.join("\n"));
    assert.ok(first.difference.some((line) => /EQ Eight/.test(line)), first.difference.join("\n"));
    // An added device is one line, not one per parameter.
    assert.equal(first.difference.filter((line) => /EQ Eight \(d\d+\) \//.test(line)).length, 0, first.difference.join("\n"));
    assert.deepEqual(first.left, []);
    assert.equal(second.passed, true);
    assert.deepEqual(await snapshot(tools), base);
});

test("a refused run is a failed run, though the Set was left as it was", async (t) => {
    // The model fixes the Set, then declines on the next round: the Set equals its base, the turn was refused.
    const replies = [call("read_set", {}), call("set_parameters", { changes: [{ target: "t1", parameter: "volume", value: -1 }] })];
    const refusesLast: Model = {
        call: async () => replies.length ? { messages: replies.shift() ?? [], cutOff: false } : { messages: [], cutOff: false, refused: { category: "cyber", explanation: "No." } },
    };
    const { connect, runs, onRun } = open(t, refusesLast);

    const result = await runCase({ connect, model: "gemini:test", case: lowEndHot, runs: 1, onRun });

    assert.deepEqual(result, { passed: 0, runs: 1 });
    const [only] = runs as [Run];
    assert.equal(only.stop, "refused");
    assert.equal(only.passed, false);
});

test("the mentor's removals are approved, and a change the runner cannot undo stops the series", async (t) => {
    const { connect, runs, onRun } = open(t, [
        call("read_set", {}),
        call("delete", { ids: ["d1"] }),
        call("set_parameters", { changes: [{ target: "t1", parameter: "volume", value: -1 }] }),
        say("Removed the Utility and brought it down."),
    ]);

    const result = await runCase({ connect, model: "gemini:test", case: lowEndHot, runs: 3, onRun });

    assert.equal(result.passed, 0);
    assert.equal(result.runs, 1);
    assert.ok(result.left?.some((line) => /Utility/.test(line)), String(result.left));
    const [only] = runs as [Run];
    assert.equal(runs.length, 1);
    const deleted = only.messages.find((message) => message.type === "tool_result" && message.name === "delete");
    assert.match(deleted?.type === "tool_result" ? deleted.output : "", /Utility/);
    assert.deepEqual(only.left, result.left);
});

test("each run connects afresh, so ids read in the first run are never sent in the second", async (t) => {
    const { connect, runs, used, onRun } = open(t, [...fix, ...fix]);

    await runCase({ connect, model: "gemini:test", case: lowEndHot, runs: 2, onRun });

    assert.equal(runs.length, 2);
    // Every use of the first pair comes before every use of the second, and each pair starts by reading.
    const pairs = used.map(({ pair }) => pair);
    assert.deepEqual(pairs, [...pairs].sort());
    assert.deepEqual([...new Set(pairs)], [0, 1]);
    for (const pair of [0, 1]) assert.equal(used.find((use) => use.pair === pair && use.tool !== "model")?.tool, "read_set");
});
