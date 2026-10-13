import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgentLoop } from "./agent-loop.ts";
import type { Message, Provider, Tool } from "./types.ts";

// One generic tool, so these tests depend on nothing outside the agent folder.
const tools: Tool[] = [
    {
        name: "shout",
        description: "Returns the given text in upper case",
        params: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
        },
        run: ({ text }) => {
            if (typeof text !== "string") throw new Error("text must be a string");
            return text.toUpperCase();
        },
    },
];

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

    const conversation = await runAgentLoop(provider, tools, [
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
        [{ type: "tool_call", id: "call_1", name: "shout", args: { text: "hello" } }],
        [{ type: "assistant", text: "It says HELLO." }],
    ]);

    const conversation = await runAgentLoop(provider, tools, [
        { type: "user", text: "Shout hello" },
    ]);

    assert.deepEqual(conversation, [
        { type: "user", text: "Shout hello" },
        { type: "tool_call", id: "call_1", name: "shout", args: { text: "hello" } },
        {
            type: "tool_result",
            callId: "call_1",
            name: "shout",
            output: "HELLO",
            isError: false,
        },
        { type: "assistant", text: "It says HELLO." },
    ]);
    // On its second call the model must have seen the tool result.
    assert.equal(calls.length, 2);
    assert.equal(calls[1]?.at(-1)?.type, "tool_result");
});

test("a failing tool becomes an error result the model can read", async () => {
    const { provider } = scriptedProvider([
        [{ type: "tool_call", id: "call_1", name: "shout", args: { text: 5 } }],
        [{ type: "assistant", text: "I need text to shout." }],
    ]);

    const conversation = await runAgentLoop(provider, tools, [
        { type: "user", text: "Shout 5" },
    ]);

    assert.deepEqual(conversation[2], {
        type: "tool_result",
        callId: "call_1",
        name: "shout",
        output: "text must be a string",
        isError: true,
    });
    assert.equal(conversation.at(-1)?.type, "assistant");
});

test("a tool the model invented becomes an error result", async () => {
    const { provider } = scriptedProvider([
        [{ type: "tool_call", id: "call_1", name: "delete_everything", args: {} }],
        [{ type: "assistant", text: "I can't do that." }],
    ]);

    const conversation = await runAgentLoop(provider, tools, [
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
        { type: "tool_call", id: `call_${i}`, name: "shout", args: { text: "again" } },
    ]);
    const { provider, calls } = scriptedProvider(endlessToolCalls);

    const conversation = await runAgentLoop(provider, tools, [
        { type: "user", text: "Loop forever" },
    ]);

    assert.equal(calls.length, 10);
    const last = conversation.at(-1);
    assert.equal(last?.type, "assistant");
    assert.match(last?.type === "assistant" ? last.text : "", /Stopped after 10 rounds/);
});
