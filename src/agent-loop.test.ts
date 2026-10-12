import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgentLoop } from "./agent-loop.ts";
import { createFakeAbleton } from "./fake-ableton.ts";
import type { Message, Provider } from "./types.ts";

// A fake provider that hands out prepared replies, one per call,
// and records what it was sent each time.
function scriptedProvider(replies: Message[][]) {
    const calls: Message[][] = [];
    const provider: Provider = {
        generate: async (conversation) => {
            calls.push([...conversation]);
            const reply = replies.shift();
            if (!reply) throw new Error("The script ran out of replies");
            return reply;
        },
    };
    return { provider, calls };
}

test("returns the model's text when it calls no tools", async () => {
    const { provider, calls } = scriptedProvider([
        [{ type: "assistant", text: "Hi there" }],
    ]);

    const conversation = await runAgentLoop(provider, createFakeAbleton(), [
        { type: "user", text: "Hello" },
    ]);

    assert.deepEqual(conversation, [
        { type: "user", text: "Hello" },
        { type: "assistant", text: "Hi there" },
    ]);
    assert.equal(calls.length, 1);
});

test("runs a tool call and sends the result back to the model", async () => {
    const { provider, calls } = scriptedProvider([
        [{ type: "tool_call", id: "call_1", name: "set_tempo", args: { bpm: 128 } }],
        [{ type: "assistant", text: "The tempo is now 128." }],
    ]);

    const conversation = await runAgentLoop(provider, createFakeAbleton(), [
        { type: "user", text: "Set the tempo to 128" },
    ]);

    assert.deepEqual(conversation, [
        { type: "user", text: "Set the tempo to 128" },
        { type: "tool_call", id: "call_1", name: "set_tempo", args: { bpm: 128 } },
        {
            type: "tool_result",
            callId: "call_1",
            name: "set_tempo",
            output: JSON.stringify({ tempo: 128, tracks: ["Drums", "Bass"] }),
            isError: false,
        },
        { type: "assistant", text: "The tempo is now 128." },
    ]);
    // On its second call the model must have seen the tool result.
    assert.equal(calls.length, 2);
    assert.equal(calls[1]?.at(-1)?.type, "tool_result");
});

test("a failing tool becomes an error result the model can read", async () => {
    const { provider } = scriptedProvider([
        [{ type: "tool_call", id: "call_1", name: "set_tempo", args: { bpm: 5000 } }],
        [{ type: "assistant", text: "That tempo is out of range." }],
    ]);

    const conversation = await runAgentLoop(provider, createFakeAbleton(), [
        { type: "user", text: "Set the tempo to 5000" },
    ]);

    assert.deepEqual(conversation[2], {
        type: "tool_result",
        callId: "call_1",
        name: "set_tempo",
        output: "bpm must be a number between 20 and 999",
        isError: true,
    });
    assert.equal(conversation.at(-1)?.type, "assistant");
});

test("a tool the model invented becomes an error result", async () => {
    const { provider } = scriptedProvider([
        [{ type: "tool_call", id: "call_1", name: "delete_everything", args: {} }],
        [{ type: "assistant", text: "I can't do that." }],
    ]);

    const conversation = await runAgentLoop(provider, createFakeAbleton(), [
        { type: "user", text: "Delete everything" },
    ]);

    assert.deepEqual(conversation[2], {
        type: "tool_result",
        callId: "call_1",
        name: "delete_everything",
        output: "Tool delete_everything not found",
        isError: true,
    });
});

test("stops after 10 rounds when the model never stops calling tools", async () => {
    const endlessToolCalls: Message[][] = Array.from({ length: 20 }, (_, i) => [
        { type: "tool_call", id: `call_${i}`, name: "get_session", args: {} },
    ]);
    const { provider, calls } = scriptedProvider(endlessToolCalls);

    const conversation = await runAgentLoop(provider, createFakeAbleton(), [
        { type: "user", text: "Loop forever" },
    ]);

    assert.equal(calls.length, 10);
    const last = conversation.at(-1);
    assert.equal(last?.type, "assistant");
    assert.match(last?.type === "assistant" ? last.text : "", /Stopped after 10 rounds/);
});
