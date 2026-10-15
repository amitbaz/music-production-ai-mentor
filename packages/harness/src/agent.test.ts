import { type TestContext, test } from "node:test";
import assert from "node:assert/strict";
import { createAgent } from "./agent.ts";
import type { CallOptions, Message, Model, Tool } from "./types.ts";

const tools: Tool[] = [
    {
        name: "shout",
        description: "Returns the text in capitals",
        params: { type: "object", properties: { text: { type: "string" } } },
        run: (args) => String(args.text).toUpperCase(),
    },
];

type Call = { conversation: Message[]; tools: Tool[]; options?: CallOptions };

// A scripted model that hands out prepared replies, one per call,
// and records what it was sent each time.
function scriptedModel(replies: Message[][]) {
    const calls: Call[] = [];
    const model: Model = {
        call: async (conversation, tools, options) => {
            calls.push({ conversation: [...conversation], tools, options });
            return { messages: replies.shift() ?? [], cutOff: false };
        },
    };
    return { model, calls };
}

// Replaces fetch with one that answers each request with the next reply.
function fakeFetch(t: TestContext, replies: { status: number; body: unknown }[]) {
    return t.mock.method(globalThis, "fetch", async () => {
        const reply = replies.shift();
        assert.ok(reply, "fetch was called more often than the test expected");
        // A reply that worked is streamed, as Gemini does.
        return reply.status === 200
            ? new Response(`data: ${JSON.stringify(reply.body)}\n\n`)
            : Response.json(reply.body, { status: reply.status });
    });
}

// The url and options of the first request a test sent.
function sentRequest(fetchMock: { mock: { calls: { arguments: unknown[] }[] } }) {
    const call = fetchMock.mock.calls[0];
    assert.ok(call, "fetch was not called");
    return call.arguments as [string, RequestInit];
}

const hello = { status: 200, body: { candidates: [{ content: { parts: [{ text: "Hello!" }] } }] } };

test("generate runs a turn: the user text follows the conversation, with the tools and the system prompt", async () => {
    const { model, calls } = scriptedModel([
        [{ type: "tool_call", id: "1", name: "shout", args: { text: "hi" } }],
        [{ type: "assistant", text: "HI" }],
    ]);
    const before: Message[] = [
        { type: "user", text: "hello" },
        { type: "assistant", text: "Hello" },
    ];
    const agent = createAgent({ model, tools, system: "You are a test." });

    const result = await agent.generate(before, "shout hi");

    assert.deepEqual(calls[0]?.conversation, [...before, { type: "user", text: "shout hi" }]);
    assert.equal(calls[0]?.tools, tools);
    assert.equal(calls[0]?.options?.system, "You are a test.");
    assert.equal(result.stop, "finished");
    assert.deepEqual(result.messages, [
        ...before,
        { type: "user", text: "shout hi" },
        { type: "tool_call", id: "1", name: "shout", args: { text: "hi" } },
        { type: "tool_result", callId: "1", name: "shout", output: "HI", isError: false },
        { type: "assistant", text: "HI" },
    ]);
});

test("generate keeps nothing between turns", async () => {
    const { model, calls } = scriptedModel([
        [{ type: "assistant", text: "One" }],
        [{ type: "assistant", text: "Two" }],
    ]);
    const agent = createAgent({ model, tools });

    await agent.generate([], "first");
    await agent.generate([], "second");

    assert.deepEqual(calls[1]?.conversation, [{ type: "user", text: "second" }]);
});

test("a system prompt given as a function is built again for each turn", async () => {
    const { model, calls } = scriptedModel([
        [{ type: "assistant", text: "One" }],
        [{ type: "assistant", text: "Two" }],
    ]);
    let turn = 0;
    const agent = createAgent({ model, tools, system: () => `Turn ${++turn}` });

    await agent.generate([], "first");
    await agent.generate([], "second");

    assert.deepEqual(
        calls.map((call) => call.options?.system),
        ["Turn 1", "Turn 2"],
    );
});

test("generate passes the turn's options to the agent loop", async () => {
    const { model } = scriptedModel([[{ type: "assistant", text: "Hi" }]]);
    const seen: string[] = [];

    await createAgent({ model, tools }).generate([], "hi", {
        onUpdate: (update) => {
            if (update.type === "message") seen.push(update.message.type);
        },
    });

    assert.deepEqual(seen, ["assistant"]);
});

test("a model id picks the provider adapter, the model name and the key", async (t) => {
    const fetchMock = fakeFetch(t, [hello]);
    const agent = createAgent({
        model: "gemini:test-model",
        keys: { gemini: "test-key" },
        tools,
    });

    const result = await agent.generate([], "Hi");

    assert.deepEqual(result.messages.at(-1), { type: "assistant", text: "Hello!" });
    const [url, options] = sentRequest(fetchMock);
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/test-model:streamGenerateContent?alt=sse");
    assert.equal((options.headers as Record<string, string>)["x-goog-api-key"], "test-key");
});

test("a model id is split on its first colon only", async (t) => {
    const fetchMock = fakeFetch(t, [hello]);
    const agent = createAgent({
        model: "gemini:tuned:abc",
        keys: { gemini: "test-key" },
        tools,
    });

    await agent.generate([], "Hi");

    const [url] = sentRequest(fetchMock);
    assert.match(url, /\/models\/tuned:abc:streamGenerateContent\?alt=sse$/);
});

test("a model found by its model id retries a retryable failure", async (t) => {
    const busy = {
        status: 429,
        body: { error: { message: "Quota exceeded", details: [{ retryDelay: "0.001s" }] } },
    };
    const fetchMock = fakeFetch(t, [busy, hello]);
    const retries: number[] = [];
    const agent = createAgent({
        model: "gemini:test-model",
        keys: { gemini: "test-key" },
        tools,
        onRetry: (report) => retries.push(report.retry),
    });

    const result = await agent.generate([], "Hi");

    assert.equal(result.stop, "finished");
    assert.equal(fetchMock.mock.callCount(), 2);
    assert.deepEqual(retries, [1]);
});

// What a model id the lookup cannot use does to the first turn.
async function firstTurn(model: string, keys?: Record<string, string | undefined>) {
    const retries: number[] = [];
    // Creating the agent must not throw.
    const agent = createAgent({ model, keys, tools, onRetry: (report) => retries.push(report.retry) });

    const result = await agent.generate([], "Hi");

    assert.deepEqual(retries, []);
    assert.deepEqual(result.messages, [{ type: "user", text: "Hi" }]);
    assert.equal(result.stop, "error");
    return result.stop === "error" ? result.error.message : "";
}

test("a missing key ends the first turn with an error, without a request", async (t) => {
    const fetchMock = fakeFetch(t, []);
    assert.equal(
        await firstTurn("gemini:test-model", { gemini: undefined }),
        'No API key for provider "gemini"',
    );
    assert.equal(await firstTurn("gemini:test-model"), 'No API key for provider "gemini"');
    assert.equal(fetchMock.mock.callCount(), 0);
});

test("an unknown provider ends the first turn with an error", async (t) => {
    const fetchMock = fakeFetch(t, []);
    assert.equal(
        await firstTurn("nobody:some-model", { nobody: "test-key" }),
        'Unknown provider "nobody" in model id "nobody:some-model"',
    );
    // A name every object has must not be taken for a provider.
    assert.equal(
        await firstTurn("constructor:some-model", { constructor: "test-key" }),
        'Unknown provider "constructor" in model id "constructor:some-model"',
    );
    assert.equal(fetchMock.mock.callCount(), 0);
});

test("a model id with no provider or no model name ends the first turn with an error", async (t) => {
    const fetchMock = fakeFetch(t, []);
    for (const modelId of ["test-model", ":test-model", "gemini:"]) {
        assert.equal(
            await firstTurn(modelId, { gemini: "test-key" }),
            `Model id "${modelId}" is not written provider:model`,
        );
    }
    assert.equal(fetchMock.mock.callCount(), 0);
});

// Runs one turn in which the model calls a tool that runs `run`,
// and returns the tool result the model was sent back.
async function toolResultFor(run: Tool["run"]) {
    const { model } = scriptedModel([
        [{ type: "tool_call", id: "1", name: "big", args: {} }],
        [{ type: "assistant", text: "ok" }],
    ]);
    const big: Tool = { name: "big", description: "", params: { type: "object" }, run };
    const result = await createAgent({ model, tools: [big] }).generate([], "go");
    const toolResult = result.messages.find((m) => m.type === "tool_result");
    assert.ok(toolResult?.type === "tool_result");
    return toolResult;
}

test("a tool result of 40,000 characters reaches the conversation unchanged", async () => {
    const output = "a".repeat(40_000);
    const result = await toolResultFor(() => output);
    assert.equal(result.output, output);
    assert.equal(result.isError, false);
});

test("a tool result past 40,000 characters keeps its first 40,000, then a note with both counts", async () => {
    const result = await toolResultFor(() => "a".repeat(40_000) + "b".repeat(5_000));
    assert.equal(
        result.output,
        `${"a".repeat(40_000)}\n\n[Cut: showing the first 40000 of 45000 characters. Ask the tool for less.]`,
    );
    // Being cut does not make it an error.
    assert.equal(result.isError, false);
});

test("an error past 40,000 characters is cut the same way and stays an error", async () => {
    const result = await toolResultFor(() => {
        throw new Error("e".repeat(50_000));
    });
    assert.equal(
        result.output,
        `${"e".repeat(40_000)}\n\n[Cut: showing the first 40000 of 50000 characters. Ask the tool for less.]`,
    );
    assert.equal(result.isError, true);
});

test("an agent made with a result limit cuts tool results at that limit", async () => {
    const { model } = scriptedModel([
        [{ type: "tool_call", id: "1", name: "shout", args: { text: "x".repeat(25) } }],
        [{ type: "assistant", text: "ok" }],
    ]);
    const result = await createAgent({ model, tools, resultLimit: 10 }).generate([], "go");
    const toolResult = result.messages.find((m) => m.type === "tool_result");
    assert.ok(toolResult?.type === "tool_result");
    assert.equal(
        toolResult.output,
        `${"X".repeat(10)}\n\n[Cut: showing the first 10 of 25 characters. Ask the tool for less.]`,
    );
});

test("an agent made with a round limit stops after that many model calls", async () => {
    const { model, calls } = scriptedModel(
        Array.from({ length: 5 }, (_, i) => [
            { type: "tool_call" as const, id: String(i), name: "shout", args: { text: "hi" } },
        ]),
    );
    const result = await createAgent({ model, tools, maxRounds: 2 }).generate([], "go");
    assert.equal(result.stop, "round_limit");
    assert.equal(calls.length, 2);
});
