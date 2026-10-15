import { type TestContext, test } from "node:test";
import assert from "node:assert/strict";
import { createAgent } from "./agent.ts";
import { adapters } from "./providers/index.ts";
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
// `tokens` holds the count each call reports, in order; a call past the end, or an undefined, reports none.
function scriptedModel(replies: Message[][], tokens: (number | undefined)[] = []) {
    const calls: Call[] = [];
    const model: Model = {
        call: async (conversation, tools, options) => {
            calls.push({ conversation: [...conversation], tools, options });
            const count = tokens[calls.length - 1];
            return {
                messages: replies.shift() ?? [],
                ...(count === undefined ? {} : { tokens: count }),
                cutOff: false,
            };
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
        model: "gemini:gemini-3.5-flash-lite",
        keys: { gemini: "test-key" },
        tools,
    });

    const result = await agent.generate([], "Hi");

    assert.deepEqual(result.messages.at(-1), { type: "assistant", text: "Hello!" });
    const [url, options] = sentRequest(fetchMock);
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse");
    assert.equal((options.headers as Record<string, string>)["x-goog-api-key"], "test-key");
});

test("the whole name after the first colon is checked against the list", async (t) => {
    const fetchMock = fakeFetch(t, []);

    // The whole name after the first colon is the model name, colons included.
    assert.equal(
        await firstTurn("gemini:tuned:abc", { gemini: "test-key" }),
        'Model "tuned:abc" is not supported by provider "gemini"',
    );
    assert.equal(fetchMock.mock.callCount(), 0);
});

test("a model found by its model id retries a retryable failure", async (t) => {
    const busy = {
        status: 429,
        body: { error: { message: "Quota exceeded", details: [{ retryDelay: "0.001s" }] } },
    };
    const fetchMock = fakeFetch(t, [busy, hello]);
    const retries: number[] = [];
    const agent = createAgent({
        model: "gemini:gemini-3.5-flash-lite",
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
        await firstTurn("gemini:gemini-3.5-flash-lite", { gemini: undefined }),
        'No API key for provider "gemini"',
    );
    assert.equal(await firstTurn("gemini:gemini-3.5-flash-lite"), 'No API key for provider "gemini"');
    assert.equal(fetchMock.mock.callCount(), 0);
});

test("a model not on its provider's list ends the first turn with an error, without a request or a retry", async (t) => {
    const fetchMock = fakeFetch(t, []);
    // firstTurn also checks that nothing was retried.
    assert.equal(
        await firstTurn("gemini:gemini-1.5-flash", { gemini: "test-key" }),
        'Model "gemini-1.5-flash" is not supported by provider "gemini"',
    );
    // A name every object has must not be taken for a supported model.
    assert.equal(
        await firstTurn("gemini:constructor", { gemini: "test-key" }),
        'Model "constructor" is not supported by provider "gemini"',
    );
    assert.equal(fetchMock.mock.callCount(), 0);
});

test("a ready model is not checked against the list", async () => {
    const { model } = scriptedModel([[{ type: "assistant", text: "Hi" }]]);
    const result = await createAgent({ model, tools }).generate([], "hi");
    assert.equal(result.stop, "finished");
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
    for (const modelId of ["gemini-3.5-flash-lite", ":gemini-3.5-flash-lite", "gemini:"]) {
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

test("a cut never splits an emoji: the half at the limit is dropped, and the note counts what is shown", async () => {
    // The emoji takes two characters, the 40,000th and the 40,001st.
    const result = await toolResultFor(() => `${"a".repeat(39_999)}😀${"b".repeat(100)}`);
    assert.equal(
        result.output,
        `${"a".repeat(39_999)}\n\n[Cut: showing the first 39999 of 40101 characters. Ask the tool for less.]`,
    );
});

test("an error past 40,000 characters is cut, with a note that gives no advice, and stays an error", async () => {
    const result = await toolResultFor(() => {
        throw new Error("e".repeat(50_000));
    });
    assert.equal(
        result.output,
        `${"e".repeat(40_000)}\n\n[Cut: showing the first 40000 of 50000 characters.]`,
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

const overloaded = { status: 503, body: { error: { message: "The model is overloaded" } } };

test("an agent made with maxRetries 0 does not retry a failed model call", async (t) => {
    const fetchMock = fakeFetch(t, [overloaded]);
    const agent = createAgent({
        model: "gemini:gemini-3.5-flash-lite",
        keys: { gemini: "test-key" },
        tools,
        maxRetries: 0,
    });
    const result = await agent.generate([], "hi");
    assert.equal(result.stop, "error");
    assert.equal(fetchMock.mock.callCount(), 1);
});

test("an agent made with firstWaitMs waits that long before the first retry", async (t) => {
    fakeFetch(t, [overloaded, hello]);
    const waits: number[] = [];
    const agent = createAgent({
        model: "gemini:gemini-3.5-flash-lite",
        keys: { gemini: "test-key" },
        tools,
        firstWaitMs: 7,
        onRetry: (report) => waits.push(report.waitMs),
    });
    const result = await agent.generate([], "hi");
    assert.equal(result.stop, "finished");
    assert.deepEqual(waits, [7]);
});

test("an agent made with timeoutMs gives up on an attempt that sends nothing for that long", { timeout: 2000 }, async (t) => {
    // Never replies; fails only when its signal fires, as fetch does.
    t.mock.method(
        globalThis,
        "fetch",
        (_url: unknown, init?: RequestInit) =>
            new Promise((_resolve, reject) =>
                init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
            ),
    );
    const agent = createAgent({
        model: "gemini:gemini-3.5-flash-lite",
        keys: { gemini: "test-key" },
        tools,
        maxRetries: 0,
        timeoutMs: 20,
    });
    const result = await agent.generate([], "hi");
    assert.equal(result.stop, "error");
    assert.equal(result.stop === "error" && result.error.message, "The model sent nothing for 0.02s");
});

test("a number option that makes no sense ends the first turn with an error, without a model call", async () => {
    const cases: [Partial<Parameters<typeof createAgent>[0]>, string][] = [
        [{ resultLimit: -5 }, "resultLimit must be a whole number above 0, got -5"],
        [{ resultLimit: 0 }, "resultLimit must be a whole number above 0, got 0"],
        [{ resultLimit: Number.NaN }, "resultLimit must be a whole number above 0, got NaN"],
        [{ maxRounds: 2.5 }, "maxRounds must be a whole number above 0, got 2.5"],
        [{ maxRetries: -1 }, "maxRetries must be a whole number, 0 or more, got -1"],
        [{ timeoutMs: 0 }, "timeoutMs must be a number above 0, got 0"],
        [{ timeoutMs: Number.POSITIVE_INFINITY }, "timeoutMs must be a number above 0, got Infinity"],
        [{ firstWaitMs: -1 }, "firstWaitMs must be a number, 0 or more, got -1"],
    ];
    for (const [bad, message] of cases) {
        const { model, calls } = scriptedModel([[{ type: "assistant", text: "Hi" }]]);
        // Creating the agent must not throw.
        const agent = createAgent({ model, tools, ...bad });

        const result = await agent.generate([], "Hi");

        assert.equal(result.stop, "error");
        assert.equal(result.stop === "error" && result.error.message, message);
        assert.deepEqual(result.messages, [{ type: "user", text: "Hi" }]);
        assert.equal(calls.length, 0);
    }
});

// Runs one turn on a scripted model and returns the conversation size it reports.
async function sizeAfter(
    replies: Message[][],
    tokens: (number | undefined)[],
    options: Partial<Parameters<typeof createAgent>[0]> = {},
    turn: Parameters<ReturnType<typeof createAgent>["generate"]>[2] = {},
) {
    const { model } = scriptedModel(replies, tokens);
    return createAgent({ model, tools: [], ...options }).generate([], "u".repeat(80), turn);
}

test("with no count reported, the size estimates everything sent at characters / 4: system prompt, tool descriptions and messages", async () => {
    // system 40 + tool (name 2 + description 38 + params "{}" 2) + user 80 + reply 120 = 282 characters
    const noop: Tool = { name: "ab", description: "d".repeat(38), params: {}, run: () => "" };
    const result = await sizeAfter([[{ type: "assistant", text: "r".repeat(120) }]], [], {
        system: "s".repeat(40),
        tools: [noop],
    });
    assert.equal(result.stop, "finished");
    assert.equal(result.conversationSize, Math.ceil(282 / 4));
});

test("a reported count is the size, as it already holds the request and the reply", async () => {
    const result = await sizeAfter([[{ type: "assistant", text: "r".repeat(120) }]], [5_000]);
    assert.equal(result.conversationSize, 5_000);
});

test("messages added after the last count are added at characters / 4", async () => {
    // The count of round 1 holds the tool call; the tool result of 400 characters comes after it, then the round limit ends the turn.
    const result = await sizeAfter(
        [[{ type: "tool_call", id: "1", name: "shout", args: { text: "x".repeat(400) } }]],
        [1_000],
        { tools, maxRounds: 1 },
    );
    assert.equal(result.stop, "round_limit");
    assert.equal(result.conversationSize, 1_000 + 400 / 4);
});

test("the last count wins: a later call that reports none adds its reply to the count before", async () => {
    // Round 1 reports 1,000; its tool result is 400 characters; round 2 reports nothing and replies with 200 characters.
    const result = await sizeAfter(
        [
            [{ type: "tool_call", id: "1", name: "shout", args: { text: "x".repeat(400) } }],
            [{ type: "assistant", text: "r".repeat(200) }],
        ],
        [1_000, undefined],
        { tools },
    );
    assert.equal(result.stop, "finished");
    assert.equal(result.conversationSize, 1_000 + (400 + 200) / 4);
});

test("a later count replaces the one before", async () => {
    const result = await sizeAfter(
        [
            [{ type: "tool_call", id: "1", name: "shout", args: { text: "x".repeat(400) } }],
            [{ type: "assistant", text: "r".repeat(200) }],
        ],
        [1_000, 1_700],
        { tools },
    );
    assert.equal(result.conversationSize, 1_700);
});

test("a count never carries over from one turn to the next", async () => {
    const { model } = scriptedModel(
        [[{ type: "assistant", text: "a".repeat(40) }], [{ type: "assistant", text: "b".repeat(40) }]],
        [9_000],
    );
    const agent = createAgent({ model, tools: [] });

    const first = await agent.generate([], "u".repeat(40));
    // 40 + 40 from the first turn, the new user text 40 and the reply 40
    const second = await agent.generate(first.messages, "u".repeat(40));

    assert.equal(first.conversationSize, 9_000);
    assert.equal(second.conversationSize, Math.ceil(160 / 4));
});

test("a tool call counts its name and its arguments as JSON, a tool result its output", async () => {
    // No count, no tools given. The call is its name "shout" 5 + its arguments {"text":"hi"} 13 = 18.
    // Its result is "Tool shout not found", 20.
    const result = await sizeAfter(
        [[{ type: "tool_call", id: "1", name: "shout", args: { text: "hi" } }]],
        [],
        { tools: [], maxRounds: 1 },
    );
    // plus the user text, 80
    assert.equal(result.conversationSize, Math.ceil((80 + 18 + 20) / 4));
});

test("the size is on every stop reason", async () => {
    const sizes: Record<string, number> = {};

    // empty: the model says nothing, so nothing is kept; with no count, only the user text is estimated
    const empty = await sizeAfter([[{ type: "assistant", text: "" }]], []);
    sizes[empty.stop] = empty.conversationSize;

    // error: the first call fails, so the conversation is just the user text
    const failing: Model = { call: async () => { throw new Error("down"); } };
    const error = await createAgent({ model: failing, tools: [] }).generate([], "u".repeat(80));
    sizes[error.stop] = error.conversationSize;

    // cancelled: text that arrived before the cancel is kept and counted
    const controller = new AbortController();
    const cut: Model = {
        call: async (_conversation, _tools, options) => {
            options?.onText?.("a".repeat(40));
            controller.abort();
            throw new Error("aborted");
        },
    };
    const cancelled = await createAgent({ model: cut, tools: [] }).generate([], "u".repeat(80), { signal: controller.signal });
    sizes[cancelled.stop] = cancelled.conversationSize;

    const limit = await sizeAfter(
        [[{ type: "tool_call", id: "1", name: "shout", args: { text: "hi" } }]],
        [700],
        { tools, maxRounds: 1 },
    );
    sizes[limit.stop] = limit.conversationSize;

    assert.deepEqual(sizes, { empty: 20, error: 20, cancelled: 30, round_limit: 701 });
});

// Replaces fetch with one that streams the given pieces as one reply, as Gemini does.
function streamedFetch(t: TestContext, pieces: unknown[]) {
    return t.mock.method(
        globalThis,
        "fetch",
        async () => new Response(pieces.map((piece) => `data: ${JSON.stringify(piece)}\n\n`).join("")),
    );
}

const geminiAgent = () =>
    createAgent({ model: "gemini:gemini-3.5-flash-lite", keys: { gemini: "test-key" }, tools });

test("the Gemini adapter reports the prompt count, which holds the cached tokens, plus the reply, and leaves thinking out", async (t) => {
    streamedFetch(t, [
        {
            candidates: [{ content: { parts: [{ text: "Hello!" }] } }],
            usageMetadata: {
                promptTokenCount: 10_000,
                cachedContentTokenCount: 8_000,
                candidatesTokenCount: 200,
                thoughtsTokenCount: 3_000,
                totalTokenCount: 13_200,
            },
        },
    ]);
    const result = await geminiAgent().generate([], "Hi");
    assert.equal(result.conversationSize, 10_200);
});

test("the Gemini adapter reads the count from the last piece, which may hold no candidate", async (t) => {
    streamedFetch(t, [
        {
            candidates: [{ content: { parts: [{ text: "Hel" }] } }],
            usageMetadata: { promptTokenCount: 10_000, candidatesTokenCount: 1 },
        },
        { candidates: [{ content: { parts: [{ text: "lo!" }] } }] },
        { usageMetadata: { promptTokenCount: 10_000, candidatesTokenCount: 5 } },
    ]);
    const result = await geminiAgent().generate([], "Hi");
    assert.equal(result.conversationSize, 10_005);
});

test("a Gemini reply with no usage metadata leaves the size estimated", async (t) => {
    fakeFetch(t, [hello]);
    const result = await geminiAgent().generate([], "Hi");
    // The tool is described to the model too: its name, its description and its params as JSON.
    const toolChars = JSON.stringify(tools[0]?.params).length + "shout".length + (tools[0]?.description.length ?? 0);
    assert.equal(result.conversationSize, Math.ceil((toolChars + 2 + 6) / 4));
});

test("a Gemini count is followed by the tool result added after it", async (t) => {
    const calls = [
        {
            candidates: [{ content: { parts: [{ functionCall: { id: "1", name: "shout", args: { text: "x".repeat(400) } } }] } }],
            usageMetadata: { promptTokenCount: 1_000, candidatesTokenCount: 50 },
        },
    ];
    streamedFetch(t, calls);
    const agent = createAgent({ model: "gemini:gemini-3.5-flash-lite", keys: { gemini: "test-key" }, tools, maxRounds: 1 });
    const result = await agent.generate([], "Hi");
    assert.equal(result.stop, "round_limit");
    assert.equal(result.conversationSize, 1_050 + 400 / 4);
});

test("a count that came before is kept when the turn ends in an error, a cancel or an empty reply", async () => {
    const call = { type: "tool_call" as const, id: "1", name: "shout", args: { text: "x".repeat(400) } };

    // Error: round 2 fails; the 400-character tool result came after the count.
    let round = 0;
    const failsSecond: Model = {
        call: async () => {
            if (++round === 2) throw new Error("down");
            return { messages: [call], tokens: 1_000, cutOff: false };
        },
    };
    const error = await createAgent({ model: failsSecond, tools }).generate([], "go");
    assert.equal(error.stop, "error");
    assert.equal(error.conversationSize, 1_000 + 400 / 4);

    // Cancel after the tools of a round ran
    const controller = new AbortController();
    const cancelTool: Tool = { ...tools[0] as Tool, run: () => { controller.abort(); return "x".repeat(400); } };
    const { model } = scriptedModel([[call]], [1_000]);
    const cancelled = await createAgent({ model, tools: [cancelTool] }).generate([], "go", { signal: controller.signal });
    assert.equal(cancelled.stop, "cancelled");
    assert.equal(cancelled.conversationSize, 1_000 + 400 / 4);

    // Empty: the count covers an empty reply, which is not kept
    const empty = await sizeAfter([[{ type: "assistant", text: "" }]], [3_000]);
    assert.equal(empty.stop, "empty");
    assert.equal(empty.conversationSize, 3_000);
});

test("the Gemini adapter keeps the counts of earlier pieces when a later piece brings only some", async (t) => {
    streamedFetch(t, [
        {
            candidates: [{ content: { parts: [{ text: "Hello!" }] } }],
            usageMetadata: { promptTokenCount: 10_000, candidatesTokenCount: 5 },
        },
        { usageMetadata: { totalTokenCount: 10_005 } },
    ]);
    const result = await geminiAgent().generate([], "Hi");
    assert.equal(result.conversationSize, 10_005);
});

test("the estimate uses the model's characters per token, 4 when it has none", async () => {
    const reply = () => [[{ type: "assistant" as const, text: "r".repeat(120) }]];
    // 80 + 120 = 200 characters
    const withNumber: Model = { ...scriptedModel(reply()).model, charsPerToken: 2 };
    const two = await createAgent({ model: withNumber, tools: [] }).generate([], "u".repeat(80));
    assert.equal(two.conversationSize, 100);

    const none = await createAgent({ model: scriptedModel(reply()).model, tools: [] }).generate([], "u".repeat(80));
    assert.equal(none.conversationSize, 50);
});

test("the number also applies to what comes after a reported count", async () => {
    const { model } = scriptedModel(
        [[{ type: "tool_call", id: "1", name: "shout", args: { text: "x".repeat(400) } }]],
        [1_000],
    );
    const result = await createAgent({ model: { ...model, charsPerToken: 2 }, tools, maxRounds: 1 }).generate([], "go");
    assert.equal(result.conversationSize, 1_000 + 400 / 2);
});

test("a model found by its model id estimates with its entry's number", async (t) => {
    const entry = adapters.gemini?.models[0];
    assert.ok(entry);
    t.mock.property(entry, "charsPerToken", 2);
    fakeFetch(t, [hello]);
    const result = await geminiAgent().generate([], "Hi");
    const toolChars = JSON.stringify(tools[0]?.params).length + "shout".length + (tools[0]?.description.length ?? 0);
    assert.equal(result.conversationSize, Math.ceil((toolChars + 2 + 6) / 2));
});

test("a tool call whose arguments cannot be written as JSON still gets a size, counting only its name", async () => {
    // 10n cannot be written as JSON
    const call = { type: "tool_call" as const, id: "1", name: "shout", args: { n: 10n } };
    const { model } = scriptedModel([[call]]);

    const result = await createAgent({ model, tools, maxRounds: 1 }).generate([], "go");

    assert.equal(result.stop, "round_limit");
    // The tool as described, "go" 2, the call's name 5, and the result "UNDEFINED" 9
    const toolChars = JSON.stringify(tools[0]?.params).length + "shout".length + (tools[0]?.description.length ?? 0);
    assert.equal(result.conversationSize, Math.ceil((toolChars + 2 + 5 + 9) / 4));
});

test("a tool whose params cannot be written as JSON still gets a size, counting only its name and description", async () => {
    const odd: Tool = { name: "odd", description: "d".repeat(10), params: { n: 10n }, run: () => "" };
    const { model } = scriptedModel([[{ type: "assistant", text: "hi" }]]);

    const result = await createAgent({ model, tools: [odd] }).generate([], "go");

    assert.equal(result.stop, "finished");
    assert.equal(result.conversationSize, Math.ceil((3 + 10 + 2 + 2) / 4));
});

test("a Gemini reply cut off by MAX_TOKENS keeps its text, runs no tool and stops as cut_off", async (t) => {
    let ran = 0;
    const counting: Tool[] = [
        { ...tools[0] as Tool, run: () => String(++ran) },
    ];
    // Gemini ends a stream with a piece that holds the finish reason and no parts.
    const pieces = [
        { candidates: [{ content: { role: "model", parts: [{ text: "Let me shout" }] } }] },
        {
            candidates: [
                {
                    content: {
                        role: "model",
                        parts: [{ functionCall: { id: "call_1", name: "shout", args: { text: "hi" } } }],
                    },
                },
            ],
        },
        { candidates: [{ finishReason: "MAX_TOKENS" }] },
    ];
    const fetchMock = t.mock.method(
        globalThis,
        "fetch",
        async () => new Response(pieces.map((p) => `data: ${JSON.stringify(p)}\n\n`).join("")),
    );
    const agent = createAgent({
        model: "gemini:gemini-3.5-flash-lite",
        keys: { gemini: "test-key" },
        tools: counting,
    });

    const result = await agent.generate([], "Shout hi");

    assert.equal(result.stop, "cut_off");
    assert.equal(ran, 0);
    assert.deepEqual(result.messages, [
        { type: "user", text: "Shout hi" },
        { type: "assistant", text: "Let me shout" },
        { type: "tool_call", id: "call_1", name: "shout", args: { text: "hi" } },
        {
            type: "tool_result",
            callId: "call_1",
            name: "shout",
            output: "Not run: the reply was cut off",
            isError: true,
        },
    ]);
    // A cut-off reply is not a failure, so it is not tried again.
    assert.equal(fetchMock.mock.calls.length, 1);
});

test("a cut-off reply reports the size: its count, then the 'Not run' result added after it", async (t) => {
    streamedFetch(t, [
        {
            candidates: [{ content: { parts: [{ functionCall: { id: "1", name: "shout", args: { text: "hi" } } }] } }],
            usageMetadata: { promptTokenCount: 1_000, candidatesTokenCount: 50 },
        },
        { candidates: [{ finishReason: "MAX_TOKENS" }] },
    ]);

    const result = await geminiAgent().generate([], "Hi");

    assert.equal(result.stop, "cut_off");
    // "Not run: the reply was cut off" is 30 characters
    assert.equal(result.conversationSize, 1_050 + Math.ceil(30 / 4));
});

test("a cut-off reply with no count reports an estimate of everything sent", async (t) => {
    streamedFetch(t, [
        { candidates: [{ content: { parts: [{ text: "Let me" }] } }] },
        { candidates: [{ finishReason: "MAX_TOKENS" }] },
    ]);

    const result = await geminiAgent().generate([], "Hi");

    const toolChars = JSON.stringify(tools[0]?.params).length + "shout".length + (tools[0]?.description.length ?? 0);
    assert.equal(result.conversationSize, Math.ceil((toolChars + 2 + 6) / 4));
});

// A conversation as a saved one would hold it: a summary in the middle, with the older messages still before it.
const withSummary: Message[] = [
    { type: "user", text: "old question" },
    { type: "assistant", text: "old answer" },
    { type: "summary", text: "First summary" },
    { type: "user", text: "kept question" },
    { type: "assistant", text: "kept answer" },
    { type: "summary", text: "Latest summary" },
    { type: "user", text: "recent question" },
    { type: "assistant", text: "recent answer" },
];

test("the model is sent only the latest summary and what follows it, and the turn returns every message", async () => {
    const { model, calls } = scriptedModel([[{ type: "assistant", text: "Fine" }]]);
    const agent = createAgent({ model, tools });

    const result = await agent.generate(withSummary, "next");

    assert.deepEqual(calls[0]?.conversation, [
        { type: "summary", text: "Latest summary" },
        { type: "user", text: "recent question" },
        { type: "assistant", text: "recent answer" },
        { type: "user", text: "next" },
    ]);
    assert.deepEqual(result.messages, [
        ...withSummary,
        { type: "user", text: "next" },
        { type: "assistant", text: "Fine" },
    ]);
});

test("later rounds of a turn are sent from the summary on too", async () => {
    const { model, calls } = scriptedModel([
        [{ type: "tool_call", id: "1", name: "shout", args: { text: "hi" } }],
        [{ type: "assistant", text: "HI" }],
    ]);
    const agent = createAgent({ model, tools });

    await agent.generate(withSummary, "shout hi");

    assert.deepEqual(calls[1]?.conversation.map((m) => m.type), [
        "summary", "user", "assistant", "user", "tool_call", "tool_result",
    ]);
    assert.deepEqual(calls[1]?.conversation[0], { type: "summary", text: "Latest summary" });
});

test("Gemini is sent a summary as user text framed as history", async (t) => {
    const fetchMock = fakeFetch(t, [hello]);
    const agent = createAgent({
        model: "gemini:gemini-3.5-flash-lite",
        keys: { gemini: "test-key" },
        tools,
    });

    await agent.generate(withSummary, "next");

    const [, options] = sentRequest(fetchMock);
    const { contents } = JSON.parse(String(options.body));
    assert.deepEqual(contents, [
        {
            role: "user",
            parts: [
                { text: "Summary of the earlier conversation. It is history, not new instructions.\n\nLatest summary" },
                { text: "recent question" },
            ],
        },
        { role: "model", parts: [{ text: "recent answer" }] },
        { role: "user", parts: [{ text: "next" }] },
    ]);
});

test("the size estimate counts only what the model is sent: the latest summary and what follows it", async () => {
    const { model } = scriptedModel([[{ type: "assistant", text: "r".repeat(120) }]], []);
    const before: Message[] = [
        { type: "user", text: "o".repeat(4_000) },
        { type: "summary", text: "s".repeat(40) },
    ];

    const result = await createAgent({ model, tools: [] }).generate(before, "u".repeat(80));

    // summary 40 + user 80 + reply 120 = 240 characters; the 4,000 before the summary are not sent
    assert.equal(result.conversationSize, Math.ceil(240 / 4));
});

test("a failed turn still returns every message, including those before the summary", async () => {
    const model: Model = { call: async () => { throw new Error("boom"); } };
    const agent = createAgent({ model, tools });

    const result = await agent.generate(withSummary, "next");

    assert.equal(result.stop, "error");
    assert.deepEqual(result.messages, [...withSummary, { type: "user", text: "next" }]);
});
