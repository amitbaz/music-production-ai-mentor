import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createGeminiModel, toGeminiRequest } from "./gemini.ts";
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

test("translates a conversation and its tools into a Gemini request", () => {
    const conversation: Message[] = [
        { type: "user", text: "Set the tempo to 128" },
        {
            type: "tool_call",
            id: "call_1",
            name: "set_tempo",
            args: { bpm: 128 },
            providerMeta: { provider: "gemini", thoughtSignature: "sig_1" },
        },
        {
            type: "tool_result",
            callId: "call_1",
            name: "set_tempo",
            output: '{"tempo":128}',
            isError: false,
        },
        { type: "assistant", text: "Done." },
    ];

    assert.deepEqual(toGeminiRequest(conversation, [setTempo]), {
        contents: [
            { role: "user", parts: [{ text: "Set the tempo to 128" }] },
            {
                role: "model",
                parts: [
                    {
                        functionCall: { id: "call_1", name: "set_tempo", args: { bpm: 128 } },
                        // The signature Gemini gave us goes back exactly as it came.
                        thoughtSignature: "sig_1",
                    },
                ],
            },
            {
                role: "user",
                parts: [
                    {
                        functionResponse: {
                            id: "call_1",
                            name: "set_tempo",
                            response: { result: '{"tempo":128}' },
                        },
                    },
                ],
            },
            { role: "model", parts: [{ text: "Done." }] },
        ],
        tools: [
            {
                functionDeclarations: [
                    {
                        name: "set_tempo",
                        description: "Sets the tempo of the session",
                        parameters: setTempo.params,
                    },
                ],
            },
        ],
    });
});

test("meta tagged for another provider is ignored: the request is the same as with no meta", () => {
    const withMeta = (providerMeta?: ProviderMeta): Message[] => [
        { type: "user", text: "Set the tempo to 128" },
        { type: "assistant", text: "On it.", providerMeta },
        { type: "tool_call", id: "toolu_1", name: "set_tempo", args: { bpm: 128 }, providerMeta },
    ];
    const withoutMeta = toGeminiRequest(withMeta(), [setTempo]);

    // A conversation that came from Claude.
    const fromClaude = withMeta({ provider: "claude", thoughtSignature: "sig_1" });
    assert.deepEqual(toGeminiRequest(fromClaude, [setTempo]), withoutMeta);
});

test("a request with no tools leaves tools out, as the summary request has none", () => {
    const request = toGeminiRequest([{ type: "user", text: "Summarise" }], [], "Be brief");

    assert.deepEqual(request, {
        systemInstruction: { parts: [{ text: "Be brief" }] },
        contents: [{ role: "user", parts: [{ text: "Summarise" }] }],
    });
});

test("leaves out the $schema key an MCP server's tool sends, which Gemini rejects", () => {
    const kbSearch: Tool = {
        name: "kb_search",
        description: "Searches the knowledge base",
        params: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
            $schema: "https://json-schema.org/draft/2020-12/schema",
        },
        run: () => "",
    };

    const request = toGeminiRequest([{ type: "user", text: "Hi" }], [kbSearch]);

    assert.deepEqual(request.tools?.[0].functionDeclarations[0].parameters, {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
    });
});

test("groups consecutive messages from the same side into one Gemini turn", () => {
    const conversation: Message[] = [
        { type: "user", text: "Set the tempo and add a track" },
        { type: "assistant", text: "On it." },
        { type: "tool_call", id: "call_1", name: "set_tempo", args: { bpm: 128 } },
        { type: "tool_call", id: "call_2", name: "create_track", args: { name: "Lead" } },
        { type: "tool_result", callId: "call_1", name: "set_tempo", output: "ok", isError: false },
        { type: "tool_result", callId: "call_2", name: "create_track", output: "ok", isError: false },
    ];

    const { contents } = toGeminiRequest(conversation, [setTempo]);

    assert.deepEqual(
        contents.map((content) => [content.role, content.parts.length]),
        [
            ["user", 1],
            ["model", 3],
            ["user", 2],
        ],
    );
});

test("sends a failed tool result as an error", () => {
    const conversation: Message[] = [
        {
            type: "tool_result",
            callId: "call_1",
            name: "set_tempo",
            output: "bpm must be a number between 20 and 999",
            isError: true,
        },
    ];

    const { contents } = toGeminiRequest(conversation, [setTempo]);

    assert.deepEqual(contents[0]?.parts[0], {
        functionResponse: {
            id: "call_1",
            name: "set_tempo",
            response: { error: "bpm must be a number between 20 and 999" },
        },
    });
});

// A streamed reply as Gemini sends it: one "data:" line for each piece, with a blank line after.
function streamed(pieces: unknown[]) {
    return pieces.map((piece) => `data: ${JSON.stringify(piece)}\r\n\r\n`).join("");
}

// Replaces the real fetch for one test, so no request leaves the machine.
// A reply that worked is streamed, as Gemini does; a failed one is plain JSON.
function fakeFetch(t: TestContext, status: number, body: unknown) {
    return t.mock.method(globalThis, "fetch", async () =>
        status === 200 ? new Response(streamed([body])) : Response.json(body, { status }),
    );
}

// Replaces fetch with one whose body arrives in the given chunks, cut wherever the test says.
function fakeStream(t: TestContext, chunks: string[]) {
    return t.mock.method(
        globalThis,
        "fetch",
        async () => new Response(new Blob(chunks).stream()),
    );
}

// The url and options of the one request a test sent.
function sentRequest(fetchMock: ReturnType<typeof fakeFetch>) {
    const call = fetchMock.mock.calls[0];
    assert.ok(call, "fetch was not called");
    return call.arguments as unknown as [string, RequestInit];
}

const hi: Message[] = [{ type: "user", text: "Hi" }];

test("translates a text reply into an assistant message", async (t) => {
    fakeFetch(t, 200, {
        candidates: [
            {
                content: {
                    role: "model",
                    parts: [{ text: "The tempo is now 128.", thoughtSignature: "sig_1" }],
                },
                finishReason: "STOP",
            },
        ],
    });

    assert.deepEqual((await createGeminiModel("test-key", "test-model").call(hi, [])).messages, [
        {
            type: "assistant",
            text: "The tempo is now 128.",
            // Kept so it can be sent back to Gemini on the next call, tagged as Gemini's.
            providerMeta: { provider: "gemini", thoughtSignature: "sig_1" },
        },
    ]);
});

// This is the shape Gemini really returned for "set the tempo to 128 and add a track called Lead".
test("translates function calls into tool calls", async (t) => {
    fakeFetch(t, 200, {
        candidates: [
            {
                content: {
                    role: "model",
                    parts: [
                        {
                            functionCall: { name: "set_tempo", args: { bpm: 128 }, id: "call_68471" },
                            thoughtSignature: "sig_1",
                        },
                        { functionCall: { name: "get_session", id: "call_68472" } },
                    ],
                },
                finishReason: "STOP",
            },
        ],
    });

    assert.deepEqual((await createGeminiModel("test-key", "test-model").call(hi, [])).messages, [
        {
            type: "tool_call",
            id: "call_68471",
            name: "set_tempo",
            args: { bpm: 128 },
            providerMeta: { provider: "gemini", thoughtSignature: "sig_1" },
        },
        // No signature on this part, and no args: it becomes an empty args object.
        { type: "tool_call", id: "call_68472", name: "get_session", args: {} },
    ]);
});

test("a prompt Gemini blocks comes back as refused, with the block reason as the category", async (t) => {
    fakeFetch(t, 200, {
        promptFeedback: { blockReason: "SAFETY", blockReasonMessage: "The prompt was blocked." },
    });

    const reply = await createGeminiModel("test-key", "test-model").call(hi, []);

    assert.deepEqual(reply, {
        messages: [],
        cutOff: false,
        refused: { category: "SAFETY", explanation: "The prompt was blocked." },
    });
});

test("a blocked prompt without a message still says it was blocked", async (t) => {
    fakeFetch(t, 200, { promptFeedback: { blockReason: "OTHER" } });

    const reply = await createGeminiModel("test-key", "test-model").call(hi, []);

    assert.equal(reply.refused?.category, "OTHER");
    assert.match(reply.refused?.explanation ?? "", /blocked/);
});

test("throws when Gemini returns no reply and gives no block reason", async (t) => {
    fakeFetch(t, 200, {});

    await assert.rejects(
        createGeminiModel("test-key", "test-model").call(hi, []),
        /Gemini returned no reply/,
    );
});

// What Gemini really streamed for "Tell me in one sentence what you are about to do,
// then set the tempo to 128", with the usage counts left out.
const recordedStream = [
    'data: {"candidates": [{"content": {"parts": [{"text": "I am"}],"role": "model"},"index": 0}],"modelVersion": "gemini-3.5-flash-lite","responseId": "fGzOasCEJN3Yxs0PzNaCoQ0"}\r\n\r\n',
    'data: {"candidates": [{"content": {"parts": [{"text": " about to set the tempo of our session to 128 BPM."}],"role": "model"},"index": 0}],"modelVersion": "gemini-3.5-flash-lite","responseId": "fGzOasCEJN3Yxs0PzNaCoQ0"}\r\n\r\n',
    'data: {"candidates": [{"content": {"parts": [{"functionCall": {"name": "set_tempo","args": {"bpm": 128},"id": "call_138479"},"thoughtSignature": "EmAKXgFpFH0TIpx89cj80niIuK2X+xM2BFzqlrzQfYhcAj2771fvDmBUqnzuBtfXDhi6dSD1SWHlOY2oxRv9bVJTxeCwfxrw0UwHhtbjppiAtSkykPf0OiKoScmJF3cQZxM="}],"role": "model"},"index": 0}],"modelVersion": "gemini-3.5-flash-lite","responseId": "fGzOasCEJN3Yxs0PzNaCoQ0"}\r\n\r\n',
    'data: {"candidates": [{"content": {"parts": [{"text": ""}],"role": "model"},"finishReason": "STOP","index": 0}],"modelVersion": "gemini-3.5-flash-lite","responseId": "fGzOasCEJN3Yxs0PzNaCoQ0"}\r\n\r\n',
];

const recordedReply: Message[] = [
    // The pieces of one text become one message.
    { type: "assistant", text: "I am about to set the tempo of our session to 128 BPM." },
    {
        type: "tool_call",
        id: "call_138479",
        name: "set_tempo",
        args: { bpm: 128 },
        providerMeta: {
            provider: "gemini",
            thoughtSignature:
                "EmAKXgFpFH0TIpx89cj80niIuK2X+xM2BFzqlrzQfYhcAj2771fvDmBUqnzuBtfXDhi6dSD1SWHlOY2oxRv9bVJTxeCwfxrw0UwHhtbjppiAtSkykPf0OiKoScmJF3cQZxM=",
        },
    },
    // The empty text Gemini ends with is not a message.
];

test("reads a streamed reply, reporting each piece of text as it arrives", async (t) => {
    fakeStream(t, recordedStream);
    const pieces: string[] = [];

    const { messages: reply } = await createGeminiModel("test-key", "test-model").call(hi, [setTempo], {
        onText: (text) => pieces.push(text),
    });

    assert.deepEqual(reply, recordedReply);
    assert.deepEqual(pieces, ["I am", " about to set the tempo of our session to 128 BPM."]);
});

// The tool call id rule (types.ts): a user may switch provider between turns, so every provider must accept every id.
const toolCallIdRule = /^[A-Za-z0-9_-]+$/;

test("the tool call ids it reads from a reply fit the id rule", async (t) => {
    fakeStream(t, recordedStream);
    const { messages: recorded } = await createGeminiModel("test-key", "test-model").call(hi, [setTempo]);

    // The ids in the shape Gemini returned for two calls at once.
    fakeFetch(t, 200, {
        candidates: [
            {
                content: {
                    role: "model",
                    parts: [
                        { functionCall: { name: "set_tempo", args: { bpm: 128 }, id: "call_68471" } },
                        { functionCall: { name: "get_session", id: "call_68472" } },
                    ],
                },
                finishReason: "STOP",
            },
        ],
    });
    const { messages: two } = await createGeminiModel("test-key", "test-model").call(hi, []);

    const ids = [...recorded, ...two].flatMap((m) => (m.type === "tool_call" ? [m.id] : []));
    assert.equal(ids.length, 3);
    for (const id of ids) assert.match(id, toolCallIdRule);
});

test("reads a streamed reply whose lines are cut in the middle", async (t) => {
    const whole = recordedStream.join("");
    // The network cuts where it likes, not at the end of a line.
    fakeStream(t, [whole.slice(0, 40), whole.slice(40, 300), whole.slice(300)]);

    const { messages: reply } = await createGeminiModel("test-key", "test-model").call(hi, [setTempo]);

    assert.deepEqual(reply, recordedReply);
});

test("reads the last line of a stream that ends without a newline", async (t) => {
    const last = `data: ${JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } })}`;
    fakeStream(t, [last]);

    const reply = await createGeminiModel("test-key", "test-model").call(hi, []);

    assert.equal(reply.refused?.category, "SAFETY");
});

test("the model marks a connection dropped in the middle of a reply as retryable", async (t) => {
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(recordedStream[0]));
        },
        pull(controller) {
            // What fetch reports when the connection is lost while the body is read.
            controller.error(new TypeError("terminated"));
        },
    });
    t.mock.method(globalThis, "fetch", async () => new Response(body));
    const pieces: string[] = [];

    const error = await failureOf(
        createGeminiModel("test-key", "test-model").call(hi, [], {
            onText: (text) => pieces.push(text),
        }),
    );

    assert.equal(error.retryable, true);
    assert.match(error.message, /Gemini request failed: terminated/);
    assert.deepEqual(pieces, ["I am"]);
});

test("the model posts the translated request and returns the translated reply", async (t) => {
    const fetchMock = fakeFetch(t, 200, {
        candidates: [{ content: { role: "model", parts: [{ text: "Hello!" }] } }],
    });
    const model = createGeminiModel("test-key", "test-model");
    const conversation: Message[] = [{ type: "user", text: "Hi" }];

    const { messages: reply } = await model.call(conversation, [setTempo]);

    assert.deepEqual(reply, [{ type: "assistant", text: "Hello!" }]);

    const [url, options] = sentRequest(fetchMock);
    assert.equal(
        url,
        "https://generativelanguage.googleapis.com/v1beta/models/test-model:streamGenerateContent?alt=sse",
    );
    assert.equal(options.method, "POST");
    assert.deepEqual(options.headers, {
        "Content-Type": "application/json",
        "x-goog-api-key": "test-key",
    });
    assert.deepEqual(
        JSON.parse(options.body as string),
        JSON.parse(JSON.stringify(toGeminiRequest(conversation, [setTempo]))),
    );
});

test("the model throws Gemini's own message when a request fails", async (t) => {
    fakeFetch(t, 429, { error: { code: 429, message: "Quota exceeded" } });
    const model = createGeminiModel("test-key", "test-model");

    await assert.rejects(
        model.call([{ type: "user", text: "Hi" }], [setTempo]),
        /Gemini request failed \(429\): Quota exceeded/,
    );
});

test("the model passes the cancel signal to fetch", async (t) => {
    const fetchMock = fakeFetch(t, 200, {
        candidates: [{ content: { role: "model", parts: [{ text: "Hello!" }] } }],
    });
    const model = createGeminiModel("test-key", "test-model");
    const controller = new AbortController();

    await model.call([{ type: "user", text: "Hi" }], [], {
        signal: controller.signal,
    });

    const [, options] = sentRequest(fetchMock);
    assert.equal(options.signal, controller.signal);
});

test("sends the system prompt in Gemini's own field, not as a message", () => {
    const request = toGeminiRequest(
        [{ type: "user", text: "Hi" }],
        [],
        "You are a test.",
    );

    assert.deepEqual(request.systemInstruction, {
        parts: [{ text: "You are a test." }],
    });
    assert.deepEqual(request.contents, [{ role: "user", parts: [{ text: "Hi" }] }]);
});

test("leaves the system field out when there is no system prompt", () => {
    const request = toGeminiRequest([{ type: "user", text: "Hi" }], []);

    assert.equal("systemInstruction" in request, false);
});

test("the model sends the system prompt it is given", async (t) => {
    const fetchMock = fakeFetch(t, 200, {
        candidates: [{ content: { role: "model", parts: [{ text: "Hello!" }] } }],
    });
    const model = createGeminiModel("test-key", "test-model");

    await model.call([{ type: "user", text: "Hi" }], [], {
        system: "You are a test.",
    });

    const [, options] = sentRequest(fetchMock);
    assert.deepEqual(JSON.parse(options.body as string).systemInstruction, {
        parts: [{ text: "You are a test." }],
    });
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

test("the model marks an overloaded reply as retryable", async (t) => {
    fakeFetch(t, 503, { error: { code: 503, message: "The model is overloaded." } });
    const model = createGeminiModel("test-key", "test-model");

    const error = await failureOf(model.call([{ type: "user", text: "Hi" }], []));

    assert.equal(error.retryable, true);
    assert.equal(error.retryAfterMs, undefined);
    assert.match(error.message, /Gemini request failed \(503\): The model is overloaded\./);
});

test("the model marks a rejected request as not retryable", async (t) => {
    fakeFetch(t, 400, { error: { code: 400, message: "API key not valid." } });
    const model = createGeminiModel("test-key", "test-model");

    const error = await failureOf(model.call([{ type: "user", text: "Hi" }], []));

    assert.equal(error.retryable, false);
});

test("the model reads how long Gemini asks to wait", async (t) => {
    fakeFetch(t, 429, {
        error: {
            code: 429,
            message: "Quota exceeded",
            status: "RESOURCE_EXHAUSTED",
            details: [
                { "@type": "type.googleapis.com/google.rpc.Help", links: [] },
                { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "12.5s" },
            ],
        },
    });
    const model = createGeminiModel("test-key", "test-model");

    const error = await failureOf(model.call([{ type: "user", text: "Hi" }], []));

    assert.equal(error.retryable, true);
    assert.equal(error.retryAfterMs, 12_500);
});

test("the model keeps the status of a failure whose body is not JSON", async (t) => {
    t.mock.method(
        globalThis,
        "fetch",
        async () => new Response("<html>Service Unavailable</html>", { status: 503 }),
    );
    const model = createGeminiModel("test-key", "test-model");

    const error = await failureOf(model.call([{ type: "user", text: "Hi" }], []));

    assert.equal(error.retryable, true);
    assert.match(error.message, /Gemini request failed \(503\): <html>Service Unavailable<\/html>/);
});

test("the model marks a dropped connection as retryable", async (t) => {
    t.mock.method(globalThis, "fetch", async () => {
        throw new TypeError("fetch failed");
    });
    const model = createGeminiModel("test-key", "test-model");

    const error = await failureOf(model.call([{ type: "user", text: "Hi" }], []));

    assert.equal(error.retryable, true);
    assert.match(error.message, /Gemini request failed: fetch failed/);
});

test("the model does not relabel a cancelled request", async (t) => {
    const cancelled = new DOMException("This operation was aborted", "AbortError");
    t.mock.method(globalThis, "fetch", async () => {
        throw cancelled;
    });
    const model = createGeminiModel("test-key", "test-model");

    await assert.rejects(model.call([{ type: "user", text: "Hi" }], []), cancelled);
});

// Gemini sends the finish reason on the last piece of a reply, after the text.
test("a reply with finish reason MAX_TOKENS is cut off, and its text is kept", async (t) => {
    fakeStream(t, [
        streamed([
            { candidates: [{ content: { role: "model", parts: [{ text: "The kick is" }] } }] },
            {
                candidates: [
                    {
                        content: { role: "model", parts: [{ text: " too loud and" }] },
                        finishReason: "MAX_TOKENS",
                    },
                ],
            },
        ]),
    ]);

    const reply = await createGeminiModel("test-key", "test-model").call(hi, []);

    assert.equal(reply.cutOff, true);
    assert.deepEqual(reply.messages, [{ type: "assistant", text: "The kick is too loud and" }]);
});

test("a reply that ends with another finish reason is not cut off", async (t) => {
    fakeFetch(t, 200, {
        candidates: [
            { content: { role: "model", parts: [{ text: "Done." }] }, finishReason: "STOP" },
        ],
    });

    const reply = await createGeminiModel("test-key", "test-model").call(hi, []);

    assert.equal(reply.cutOff, false);
});
