import { test } from "node:test";
import assert from "node:assert/strict";
import type { GenerateOptions, Message, Provider, Tool } from "@mentor/harness";
import { createMentor } from "./mentor.ts";
import { systemPrompt } from "./system-prompt.ts";

type Call = {
    conversation: Message[];
    tools: Tool[];
    options?: GenerateOptions;
};

// A fake provider that hands out prepared replies, one per call,
// and records what it was sent each time.
function scriptedProvider(replies: Message[][]) {
    const calls: Call[] = [];
    const provider: Provider = {
        generate: async (conversation, tools, options) => {
            calls.push({ conversation: [...conversation], tools, options });
            return replies.shift() ?? [];
        },
    };
    return { provider, calls };
}

test("a turn sends the user text after the conversation, with the system prompt and the Ableton tools", async () => {
    const { provider, calls } = scriptedProvider([
        [{ type: "assistant", text: "Hi" }],
    ]);
    const before: Message[] = [
        { type: "user", text: "hello" },
        { type: "assistant", text: "Hello" },
    ];

    const result = await createMentor({ provider }).runTurn(before, "hi again");

    assert.deepEqual(calls[0]?.conversation, [
        ...before,
        { type: "user", text: "hi again" },
    ]);
    assert.equal(calls[0]?.options?.system, systemPrompt);
    assert.ok(calls[0]?.tools.some((tool) => tool.name === "set_tempo"));
    assert.equal(result.stop, "finished");
    assert.deepEqual(result.messages, [
        ...before,
        { type: "user", text: "hi again" },
        { type: "assistant", text: "Hi" },
    ]);
});

test("a turn's tool calls act on the same Ableton session as the turn before", async () => {
    const { provider } = scriptedProvider([
        [{ type: "tool_call", id: "1", name: "set_tempo", args: { bpm: 90 } }],
        [{ type: "assistant", text: "Done" }],
        [{ type: "tool_call", id: "2", name: "get_session", args: {} }],
        [{ type: "assistant", text: "It is 90" }],
    ]);
    const mentor = createMentor({ provider });

    const first = await mentor.runTurn([], "set the tempo to 90");
    const second = await mentor.runTurn(first.messages, "what is the tempo?");

    const session = second.messages.findLast(
        (message) => message.type === "tool_result",
    );
    assert.match(session?.output ?? "", /"tempo":90/);
});

test("a turn reports each new message and asks approval through the app's callbacks", async () => {
    const { provider } = scriptedProvider([
        [{ type: "tool_call", id: "1", name: "delete_track", args: { name: "Bass" } }],
        [{ type: "assistant", text: "Left it alone" }],
    ]);
    const seen: string[] = [];
    const asked: string[] = [];

    await createMentor({ provider }).runTurn([], "delete the bass", {
        onMessage: (message) => seen.push(message.type),
        approve: (call) => {
            asked.push(call.name);
            return false;
        },
    });

    assert.deepEqual(asked, ["delete_track"]);
    assert.deepEqual(seen, ["tool_call", "tool_result", "assistant"]);
});
