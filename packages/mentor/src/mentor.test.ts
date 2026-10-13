import { type TestContext, test } from "node:test";
import assert from "node:assert/strict";
import type { CallOptions, Message, Model, Tool } from "@mentor/harness";
import { createMentor } from "./mentor.ts";
import { systemPrompt } from "./system-prompt.ts";

type Call = {
    conversation: Message[];
    tools: Tool[];
    options?: CallOptions;
};

// A scripted model that hands out prepared replies, one per call,
// and records what it was sent each time.
function scriptedModel(replies: Message[][]) {
    const calls: Call[] = [];
    const model: Model = {
        call: async (conversation, tools, options) => {
            calls.push({ conversation: [...conversation], tools, options });
            return replies.shift() ?? [];
        },
    };
    return { model, calls };
}

// The url and options of the first request a test sent.
function sentRequest(fetchMock: { mock: { calls: { arguments: unknown[] }[] } }) {
    const call = fetchMock.mock.calls[0];
    assert.ok(call, "fetch was not called");
    return call.arguments as [string, RequestInit];
}

test("a turn sends the user text after the conversation, with the system prompt and the Ableton tools", async () => {
    const { model, calls } = scriptedModel([
        [{ type: "assistant", text: "Hi" }],
    ]);
    const before: Message[] = [
        { type: "user", text: "hello" },
        { type: "assistant", text: "Hello" },
    ];

    const result = await createMentor({ model }).generate(before, "hi again");

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
    const { model } = scriptedModel([
        [{ type: "tool_call", id: "1", name: "set_tempo", args: { bpm: 90 } }],
        [{ type: "assistant", text: "Done" }],
        [{ type: "tool_call", id: "2", name: "get_session", args: {} }],
        [{ type: "assistant", text: "It is 90" }],
    ]);
    const mentor = createMentor({ model });

    const first = await mentor.generate([], "set the tempo to 90");
    const second = await mentor.generate(first.messages, "what is the tempo?");

    const session = second.messages.findLast(
        (message) => message.type === "tool_result",
    );
    assert.match(session?.output ?? "", /"tempo":90/);
});

test("a turn reports each new message and asks approval through the app's callbacks", async () => {
    const { model } = scriptedModel([
        [{ type: "tool_call", id: "1", name: "delete_track", args: { name: "Bass" } }],
        [{ type: "assistant", text: "Left it alone" }],
    ]);
    const seen: string[] = [];
    const asked: string[] = [];

    await createMentor({ model }).generate([], "delete the bass", {
        onMessage: (message) => seen.push(message.type),
        approve: (call) => {
            asked.push(call.name);
            return false;
        },
    });

    assert.deepEqual(asked, ["delete_track"]);
    assert.deepEqual(seen, ["tool_call", "tool_result", "assistant"]);
});

test("with keys, a turn goes to the mentor's own model with the key for its provider", async (t: TestContext) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async () =>
        Response.json({ candidates: [{ content: { parts: [{ text: "Hi" }] } }] }),
    );

    const result = await createMentor({ keys: { gemini: "test-key" } }).generate([], "hi");

    assert.equal(result.stop, "finished");
    const [url, options] = sentRequest(fetchMock);
    assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\/.*\/models\/gemini-/);
    assert.equal((options.headers as Record<string, string>)["x-goog-api-key"], "test-key");
});
