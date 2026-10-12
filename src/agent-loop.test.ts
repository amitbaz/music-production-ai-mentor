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
