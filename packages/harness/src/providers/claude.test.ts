import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createAgent } from "../agent.ts";
import { createClaudeModel, toClaudeRequest } from "./claude.ts";
import { type Message, ModelCallError, type ProviderMeta, type Tool } from "../types.ts";

const setTempo: Tool = {
    name: "set_tempo",
    description: "Sets the tempo of the session",
    params: {
        type: "object",
        properties: { bpm: { type: "number" } },
        required: ["bpm"],
    },
    run: () => "",
};

const createTrack: Tool = {
    name: "create_track",
    description: "Adds a track",
    params: { type: "object", properties: { name: { type: "string" } } },
    run: () => "",
};

// Thinking blocks as Claude sends them, signature included.
const thinkingBlocks = [
    { type: "thinking", thinking: "", signature: "sig_a" },
    { type: "redacted_thinking", data: "opaque_b" },
];

const hi: Message[] = [{ type: "user", text: "Hi" }];

// ---- The request ----

test("translates a conversation and its tools into a Claude request", () => {
    const conversation: Message[] = [
        { type: "user", text: "Set the tempo to 128" },
        {
            type: "assistant",
            text: "On it.",
            providerMeta: { provider: "claude", thinking: thinkingBlocks },
        },
        { type: "tool_call", id: "toolu_1", name: "set_tempo", args: { bpm: 128 } },
        { type: "tool_result", callId: "toolu_1", name: "set_tempo", output: '{"tempo":128}', isError: false },
        { type: "assistant", text: "Done." },
    ];

    assert.deepEqual(toClaudeRequest(conversation, [setTempo, createTrack], "Be brief"), {
        system: "Be brief",
        // Streaming on, a generous output limit, the model's own thinking defaults plus the binding control (ADR 0023).
        stream: true,
        max_tokens: 64_000,
        thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
        tools: [
            { name: "set_tempo", description: "Sets the tempo of the session", input_schema: setTempo.params },
            {
                name: "create_track",
                description: "Adds a track",
                input_schema: createTrack.params,
                // One mark, on the last tool: the tools and the system prompt before it are cached.
                cache_control: { type: "ephemeral" },
            },
        ],
        messages: [
            { role: "user", content: [{ type: "text", text: "Set the tempo to 128" }] },
            {
                role: "assistant",
                content: [
                    // Whole, signatures kept, before the text and the tool call.
                    ...thinkingBlocks,
                    { type: "text", text: "On it." },
                    // The id goes out as it is.
                    { type: "tool_use", id: "toolu_1", name: "set_tempo", input: { bpm: 128 } },
                ],
            },
            {
                role: "user",
                content: [
                    { type: "tool_result", tool_use_id: "toolu_1", content: '{"tempo":128}', is_error: false },
                ],
            },
            { role: "assistant", content: [{ type: "text", text: "Done." }] },
        ],
    });
});

test("the thinking of a reply that was only tool calls rides on its first tool call", () => {
    const conversation: Message[] = [
        { type: "user", text: "Add two tracks" },
        {
            type: "tool_call",
            id: "toolu_1",
            name: "create_track",
            args: { name: "Lead" },
            providerMeta: { provider: "claude", thinking: thinkingBlocks },
        },
        { type: "tool_call", id: "toolu_2", name: "create_track", args: { name: "Bass" } },
        { type: "tool_result", callId: "toolu_1", name: "create_track", output: "ok", isError: false },
        { type: "tool_result", callId: "toolu_2", name: "create_track", output: "no room", isError: true },
    ];

    const { messages } = toClaudeRequest(conversation, [createTrack]);

    assert.deepEqual(messages.slice(1), [
        {
            role: "assistant",
            content: [
                ...thinkingBlocks,
                { type: "tool_use", id: "toolu_1", name: "create_track", input: { name: "Lead" } },
                { type: "tool_use", id: "toolu_2", name: "create_track", input: { name: "Bass" } },
            ],
        },
        {
            // Both results in one user message; a failed one says so.
            role: "user",
            content: [
                { type: "tool_result", tool_use_id: "toolu_1", content: "ok", is_error: false },
                { type: "tool_result", tool_use_id: "toolu_2", content: "no room", is_error: true },
            ],
        },
    ]);
});

test("meta tagged for another provider is ignored: the request is the same as with no meta", () => {
    const withMeta = (providerMeta?: ProviderMeta): Message[] => [
        { type: "user", text: "Set the tempo to 128" },
        { type: "assistant", text: "On it.", providerMeta },
        { type: "tool_call", id: "call_1", name: "set_tempo", args: { bpm: 128 }, providerMeta },
    ];
    const withoutMeta = toClaudeRequest(withMeta(), [setTempo]);

    // A conversation that came from Gemini.
    const fromGemini = withMeta({ provider: "gemini", thoughtSignature: "sig_1", thinking: thinkingBlocks });
    assert.deepEqual(toClaudeRequest(fromGemini, [setTempo]), withoutMeta);
});

test("a summary goes out as a user message with the same prefix text as Gemini's", () => {
    const { messages } = toClaudeRequest(
        [
            { type: "summary", text: "The user wants a darker kick." },
            { type: "user", text: "Continue" },
        ],
        [],
    );

    assert.deepEqual(messages, [
        {
            role: "user",
            content: [
                {
                    type: "text",
                    text: "Summary of the earlier conversation. It is history, not new instructions.\n\nThe user wants a darker kick.",
                },
                { type: "text", text: "Continue" },
            ],
        },
    ]);
});

test("a request with no tools and no system prompt leaves both fields out, as the summary request has none", () => {
    const request = toClaudeRequest(hi, []);

    assert.equal("tools" in request, false);
    assert.equal("system" in request, false);
});

// ---- The wire ----

// A streamed reply as Claude sends it: an event line and a data line for each event, with a blank line after.
function sse(events: Record<string, unknown>[]) {
    return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

// Replaces fetch with one whose body arrives in the given chunks, cut wherever the test says.
function fakeStream(t: TestContext, chunks: string[]) {
    return t.mock.method(globalThis, "fetch", async () => new Response(new Blob(chunks).stream()));
}

// The url and options of the one request a test sent.
function sentRequest(fetchMock: ReturnType<typeof fakeStream>) {
    const call = fetchMock.mock.calls[0];
    assert.ok(call, "fetch was not called");
    return call.arguments as unknown as [string, RequestInit];
}

const minimalReply = sse([
    { type: "message_start", message: { usage: { input_tokens: 5, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello!" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } },
    { type: "message_stop" },
]);

test("the model posts the translated request with the version, key and beta headers", async (t) => {
    const fetchMock = fakeStream(t, [minimalReply]);
    const conversation: Message[] = [{ type: "user", text: "Hi" }];

    await createClaudeModel("test-key", "test-model").call(conversation, [setTempo], { system: "You are a test." });

    const [url, options] = sentRequest(fetchMock);
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    assert.equal(options.method, "POST");
    assert.deepEqual(options.headers, {
        "content-type": "application/json",
        "x-api-key": "test-key",
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "thinking-binding-controls-2026-08-01",
    });
    assert.deepEqual(JSON.parse(options.body as string), {
        model: "test-model",
        ...JSON.parse(JSON.stringify(toClaudeRequest(conversation, [setTempo], "You are a test."))),
    });
});

test("the model passes the cancel signal to fetch", async (t) => {
    const fetchMock = fakeStream(t, [minimalReply]);
    const controller = new AbortController();

    await createClaudeModel("test-key", "test-model").call(hi, [], { signal: controller.signal });

    assert.equal(sentRequest(fetchMock)[1].signal, controller.signal);
});

test("the model does not relabel a cancelled request", async (t) => {
    const cancelled = new DOMException("This operation was aborted", "AbortError");
    t.mock.method(globalThis, "fetch", async () => {
        throw cancelled;
    });

    await assert.rejects(createClaudeModel("test-key", "test-model").call(hi, []), cancelled);
});

// What a failed attempt threw, for asserting on its label.
async function failureOf(attempt: Promise<unknown>) {
    const error = await attempt.then(
        () => undefined,
        (e: unknown) => e,
    );
    assert.ok(error instanceof ModelCallError, `expected a ModelCallError, got ${error}`);
    return error;
}

// ---- The reply ----

// The events of a reply as the Messages API streams it, in the shapes its streaming page shows:
// thinking with display omitted (an empty thinking_delta, then a signature_delta), text in pieces, and two
// tool calls whose input arrives as partial JSON. Usage on message_start, and cumulative on message_delta.
const recordedEvents: Record<string, unknown>[] = [
    {
        type: "message_start",
        message: {
            id: "msg_01A",
            type: "message",
            role: "assistant",
            model: "claude-haiku-5-5",
            content: [],
            stop_reason: null,
            input_transformations: [{ type: "thinking_dropped", path: "messages.1.content.0", reason: "prefix_binding_mismatch" }],
            usage: { input_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 300, output_tokens: 1 },
        },
    },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
    { type: "ping" },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig_a" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "redacted_thinking", data: "opaque_b" } },
    { type: "content_block_stop", index: 1 },
    { type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "I am" } },
    { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: " about to set the tempo." } },
    { type: "content_block_stop", index: 2 },
    {
        type: "content_block_start",
        index: 3,
        content_block: { type: "tool_use", id: "toolu_01AbC", name: "set_tempo", input: {} },
    },
    { type: "content_block_delta", index: 3, delta: { type: "input_json_delta", partial_json: "" } },
    { type: "content_block_delta", index: 3, delta: { type: "input_json_delta", partial_json: '{"bpm"' } },
    { type: "content_block_delta", index: 3, delta: { type: "input_json_delta", partial_json: ": 128}" } },
    { type: "content_block_stop", index: 3 },
    {
        type: "content_block_start",
        index: 4,
        content_block: { type: "tool_use", id: "toolu_02DeF", name: "get_session", input: {} },
    },
    { type: "content_block_stop", index: 4 },
    {
        type: "message_delta",
        delta: { stop_reason: "tool_use", stop_sequence: null },
        usage: { output_tokens: 89 },
    },
    { type: "message_stop" },
];

const recordedStream = sse(recordedEvents);

const recordedMessages: Message[] = [
    {
        type: "assistant",
        text: "I am about to set the tempo.",
        // Every block whole, signature included, tagged as Claude's.
        providerMeta: {
            provider: "claude",
            thinking: [
                { type: "thinking", thinking: "", signature: "sig_a" },
                { type: "redacted_thinking", data: "opaque_b" },
            ],
        },
    },
    { type: "tool_call", id: "toolu_01AbC", name: "set_tempo", args: { bpm: 128 } },
    // A tool with no input streams no partial JSON: the arguments are empty.
    { type: "tool_call", id: "toolu_02DeF", name: "get_session", args: {} },
];

test("reads a streamed reply, reporting each piece of text as it arrives", async (t) => {
    fakeStream(t, [recordedStream]);
    const pieces: string[] = [];

    const reply = await createClaudeModel("test-key", "test-model").call(hi, [setTempo], {
        onText: (text) => pieces.push(text),
    });

    assert.deepEqual(reply.messages, recordedMessages);
    assert.deepEqual(pieces, ["I am", " about to set the tempo."]);
    assert.equal(reply.cutOff, false);
    assert.equal(reply.refused, undefined);
});

test("reads the same reply whichever way the network cuts the stream", async (t) => {
    // Cuts at many points, so some fall in the middle of a line and some between two lines.
    for (let cut = 1; cut < recordedStream.length; cut += 37) {
        fakeStream(t, [recordedStream.slice(0, cut), recordedStream.slice(cut)]);
        const pieces: string[] = [];

        const reply = await createClaudeModel("test-key", "test-model").call(hi, [setTempo], {
            onText: (text) => pieces.push(text),
        });

        assert.deepEqual(reply.messages, recordedMessages, `cut at ${cut}`);
        assert.equal(pieces.join(""), "I am about to set the tempo.", `cut at ${cut}`);
    }
});

test("tokens are input, output, cache creation and cache read, with the output count from the last event", async (t) => {
    fakeStream(t, [recordedStream]);

    const reply = await createClaudeModel("test-key", "test-model").call(hi, [setTempo]);

    assert.equal(reply.tokens, 100 + 89 + 20 + 300);
});

test("a reply with no text and thinking gives the thinking to its first tool call", async (t) => {
    fakeStream(t, [
        sse([
            { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 1 } } },
            { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
            { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig_a" } },
            { type: "content_block_stop", index: 0 },
            { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "get_session", input: {} } },
            { type: "content_block_stop", index: 1 },
            { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } },
            { type: "message_stop" },
        ]),
    ]);

    const reply = await createClaudeModel("test-key", "test-model").call(hi, []);

    assert.deepEqual(reply.messages, [
        {
            type: "tool_call",
            id: "toolu_1",
            name: "get_session",
            args: {},
            providerMeta: { provider: "claude", thinking: [{ type: "thinking", thinking: "", signature: "sig_a" }] },
        },
    ]);
});

// The tool call id rule (types.ts): a user may switch provider between turns, so every provider must accept every id.
const toolCallIdRule = /^[A-Za-z0-9_-]+$/;

test("the tool call ids it reads from a reply fit the id rule", async (t) => {
    fakeStream(t, [recordedStream]);

    const { messages } = await createClaudeModel("test-key", "test-model").call(hi, [setTempo]);

    const ids = messages.flatMap((m) => (m.type === "tool_call" ? [m.id] : []));
    assert.equal(ids.length, 2);
    for (const id of ids) assert.match(id, toolCallIdRule);
});

test("a reply with stop reason max_tokens is cut off, and its text is kept", async (t) => {
    fakeStream(t, [
        sse([
            { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 1 } } },
            { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
            { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "The kick is too loud and" } },
            { type: "content_block_stop", index: 0 },
            // A tool call cut in the middle of its input
            { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "set_tempo", input: {} } },
            { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"bpm": 1' } },
            { type: "content_block_stop", index: 1 },
            { type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 64000 } },
            { type: "message_stop" },
        ]),
    ]);

    const reply = await createClaudeModel("test-key", "test-model").call(hi, [setTempo]);

    assert.equal(reply.cutOff, true);
    // The call whose arguments are incomplete is not a tool call.
    assert.deepEqual(reply.messages, [{ type: "assistant", text: "The kick is too loud and" }]);
});

test("a reply that ends with another stop reason is not cut off", async (t) => {
    fakeStream(t, [minimalReply]);

    const reply = await createClaudeModel("test-key", "test-model").call(hi, []);

    assert.equal(reply.cutOff, false);
    assert.deepEqual(reply.messages, [{ type: "assistant", text: "Hello!" }]);
    assert.equal(reply.tokens, 8);
});

test("a refusal comes back as refused, with the category and explanation, and the text before it is kept", async (t) => {
    fakeStream(t, [
        sse([
            { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 1 } } },
            { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
            { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me look at" } },
            { type: "content_block_stop", index: 0 },
            {
                type: "message_delta",
                delta: {
                    stop_reason: "refusal",
                    stop_details: { type: "refusal", category: "cyber", explanation: "This request was declined." },
                },
                usage: { output_tokens: 6 },
            },
            { type: "message_stop" },
        ]),
    ]);

    const reply = await createClaudeModel("test-key", "test-model").call(hi, []);

    assert.deepEqual(reply.messages, [{ type: "assistant", text: "Let me look at" }]);
    assert.deepEqual(reply.refused, { category: "cyber", explanation: "This request was declined." });
});

test("a refusal with no category still says it was a refusal", async (t) => {
    fakeStream(t, [
        sse([
            { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 0 } } },
            {
                type: "message_delta",
                delta: { stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: null } },
                usage: { output_tokens: 0 },
            },
            { type: "message_stop" },
        ]),
    ]);

    const reply = await createClaudeModel("test-key", "test-model").call(hi, []);

    assert.deepEqual(reply.messages, []);
    assert.equal(typeof reply.refused?.category, "string");
    assert.match(reply.refused?.explanation ?? "", /declined/);
});

test("an assistant message with no text sends no empty text block", () => {
    const { messages } = toClaudeRequest(
        [
            { type: "user", text: "Hi" },
            { type: "assistant", text: "", providerMeta: { provider: "claude", thinking: thinkingBlocks } },
            { type: "user", text: "Well?" },
        ],
        [],
    );

    assert.deepEqual(messages[1], { role: "assistant", content: thinkingBlocks });
});

// ---- Errors ----

// A failed request as Claude answers it: an error body, and sometimes a retry-after header in seconds.
function fakeFailure(t: TestContext, status: number, type: string, message: string, headers: Record<string, string> = {}) {
    return t.mock.method(globalThis, "fetch", async () =>
        Response.json({ type: "error", error: { type, message } }, { status, headers }),
    );
}

test("429, 500, 503 and 529 are retryable, and the error carries Claude's type and text", async (t) => {
    const cases: [number, string, string][] = [
        [429, "rate_limit_error", "Number of request tokens has exceeded your limit"],
        [500, "api_error", "Internal server error"],
        [503, "api_error", "Service unavailable"],
        [529, "overloaded_error", "Overloaded"],
    ];
    for (const [status, type, message] of cases) {
        fakeFailure(t, status, type, message);

        const error = await failureOf(createClaudeModel("test-key", "test-model").call(hi, []));

        assert.equal(error.retryable, true, `${status}`);
        assert.equal(error.retryAfterMs, undefined);
        assert.equal(error.message, `Claude request failed (${status}): ${type}: ${message}`);
    }
});

test("the model reads how long Claude asks to wait from retry-after", async (t) => {
    fakeFailure(t, 429, "rate_limit_error", "Slow down", { "retry-after": "12" });

    const error = await failureOf(createClaudeModel("test-key", "test-model").call(hi, []));

    assert.equal(error.retryable, true);
    assert.equal(error.retryAfterMs, 12_000);
});

test("a retry-after that is not a number of seconds is not a wait", async (t) => {
    fakeFailure(t, 529, "overloaded_error", "Overloaded", { "retry-after": "soon" });

    const error = await failureOf(createClaudeModel("test-key", "test-model").call(hi, []));

    assert.equal(error.retryable, true);
    assert.equal(error.retryAfterMs, undefined);
});

test("400 and 401 are not retryable", async (t) => {
    for (const [status, type, message] of [
        [400, "invalid_request_error", "messages: roles must alternate"],
        [401, "authentication_error", "invalid x-api-key"],
    ] as const) {
        fakeFailure(t, status, type, message);

        const error = await failureOf(createClaudeModel("test-key", "test-model").call(hi, []));

        assert.equal(error.retryable, false, `${status}`);
        assert.match(error.message, new RegExp(`${type}: ${message}`));
    }
});

test("the model keeps the status of a failure whose body is not JSON", async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response("<html>Bad Gateway</html>", { status: 502 }));

    const error = await failureOf(createClaudeModel("test-key", "test-model").call(hi, []));

    assert.equal(error.retryable, true);
    assert.match(error.message, /Claude request failed \(502\): <html>Bad Gateway<\/html>/);
});

test("the model marks a dropped connection as retryable", async (t) => {
    t.mock.method(globalThis, "fetch", async () => {
        throw new TypeError("fetch failed");
    });

    const error = await failureOf(createClaudeModel("test-key", "test-model").call(hi, []));

    assert.equal(error.retryable, true);
    assert.match(error.message, /Claude request failed: fetch failed/);
});

test("the model marks a connection dropped in the middle of a reply as retryable, after the text that arrived", async (t) => {
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(sse(recordedEvents.slice(0, 11))));
        },
        pull(controller) {
            // What fetch reports when the connection is lost while the body is read.
            controller.error(new TypeError("terminated"));
        },
    });
    t.mock.method(globalThis, "fetch", async () => new Response(body));
    const pieces: string[] = [];

    const error = await failureOf(
        createClaudeModel("test-key", "test-model").call(hi, [], { onText: (text) => pieces.push(text) }),
    );

    assert.equal(error.retryable, true);
    assert.match(error.message, /Claude request failed: terminated/);
    assert.deepEqual(pieces, ["I am", " about to set the tempo."]);
});

test("a stream that ends without its final event is retryable", async (t) => {
    // Everything up to the last message_delta, and no message_stop.
    fakeStream(t, [sse(recordedEvents.slice(0, -1))]);

    const error = await failureOf(createClaudeModel("test-key", "test-model").call(hi, [setTempo]));

    assert.equal(error.retryable, true);
    assert.match(error.message, /ended before the reply was whole/);
});

test("an error event in the middle of the stream is labelled by its type", async (t) => {
    for (const [type, retryable] of [
        ["overloaded_error", true],
        ["api_error", true],
        ["invalid_request_error", false],
    ] as const) {
        fakeStream(t, [sse([...recordedEvents.slice(0, 3), { type: "error", error: { type, message: "It broke" } }])]);

        const error = await failureOf(createClaudeModel("test-key", "test-model").call(hi, []));

        assert.equal(error.retryable, retryable, type);
        assert.equal(error.message, `Claude request failed: ${type}: It broke`);
    }
});

// ---- A whole turn, through the agent ----

// Replaces fetch with one that answers each request with the next reply on the list.
function fakeReplies(t: TestContext, replies: (() => Response)[]) {
    let next = 0;
    return t.mock.method(globalThis, "fetch", async () => {
        const reply = replies[next++];
        assert.ok(reply, "more requests than replies");
        return reply();
    });
}

// The JSON body of the nth request a test sent.
function bodyOf(fetchMock: ReturnType<typeof fakeReplies>, n: number) {
    const call = fetchMock.mock.calls[n];
    assert.ok(call, "fetch was not called");
    const [, options] = call.arguments as unknown as [string, RequestInit];
    return JSON.parse(options.body as string);
}

test("a turn with a tool: Claude's thinking is sent back with the tool results, and the turn finishes", async (t) => {
    const ran: unknown[] = [];
    const tempo: Tool = {
        ...setTempo,
        run: (args) => {
            ran.push(args);
            return '{"tempo":128}';
        },
    };
    const getSession: Tool = { ...createTrack, name: "get_session", run: () => "{}" };
    const fetchMock = fakeReplies(t, [() => new Response(recordedStream), () => new Response(minimalReply)]);
    const agent = createAgent({
        model: "claude:claude-haiku-5-5",
        keys: { claude: "test-key" },
        tools: [tempo, getSession],
        system: "You are a test.",
    });

    const result = await agent.generate([], "Set the tempo");

    assert.equal(result.stop, "finished");
    assert.deepEqual(ran, [{ bpm: 128 }]);
    // The second request holds the first reply with its thinking whole, then both results.
    const second = bodyOf(fetchMock, 1);
    assert.equal(second.system, "You are a test.");
    assert.deepEqual(second.messages.slice(1), [
        {
            role: "assistant",
            content: [
                { type: "thinking", thinking: "", signature: "sig_a" },
                { type: "redacted_thinking", data: "opaque_b" },
                { type: "text", text: "I am about to set the tempo." },
                { type: "tool_use", id: "toolu_01AbC", name: "set_tempo", input: { bpm: 128 } },
                { type: "tool_use", id: "toolu_02DeF", name: "get_session", input: {} },
            ],
        },
        {
            role: "user",
            content: [
                { type: "tool_result", tool_use_id: "toolu_01AbC", content: '{"tempo":128}', is_error: false },
                { type: "tool_result", tool_use_id: "toolu_02DeF", content: "{}", is_error: false },
            ],
        },
    ]);
});

test("a rate limit is retried with the wait Claude asks for, and the turn goes on", async (t) => {
    const busy = () =>
        Response.json(
            { type: "error", error: { type: "rate_limit_error", message: "Slow down" } },
            { status: 429, headers: { "retry-after": "0" } },
        );
    const fetchMock = fakeReplies(t, [busy, () => new Response(minimalReply)]);
    const agent = createAgent({ model: "claude:claude-haiku-5-5", keys: { claude: "test-key" }, tools: [] });

    const result = await agent.generate([], "Hi");

    assert.equal(result.stop, "finished");
    assert.equal(fetchMock.mock.callCount(), 2);
});

test("a refusal ends the turn as refused, with the text that came before it", async (t) => {
    const refusal = sse([
        { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me look" } },
        { type: "content_block_stop", index: 0 },
        {
            type: "message_delta",
            delta: { stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: "No." } },
            usage: { output_tokens: 3 },
        },
        { type: "message_stop" },
    ]);
    fakeReplies(t, [() => new Response(refusal)]);
    const agent = createAgent({ model: "claude:claude-haiku-5-5", keys: { claude: "test-key" }, tools: [] });

    const result = await agent.generate([], "Hi");

    assert.equal(result.stop, "refused");
    assert.deepEqual(result.messages.at(-1), { type: "assistant", text: "Let me look" });
});
