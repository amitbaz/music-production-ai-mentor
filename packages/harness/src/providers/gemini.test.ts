import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createGeminiProvider, fromGeminiResponse, toGeminiRequest } from "./gemini.ts";
import { type Message, ModelCallError, type Tool } from "../types.ts";

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
            providerMeta: { thoughtSignature: "sig_1" },
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

test("translates a text reply into an assistant message", () => {
    const reply = {
        candidates: [
            {
                content: {
                    role: "model",
                    parts: [{ text: "The tempo is now 128.", thoughtSignature: "sig_1" }],
                },
                finishReason: "STOP",
            },
        ],
    };

    assert.deepEqual(fromGeminiResponse(reply), [
        {
            type: "assistant",
            text: "The tempo is now 128.",
            // Kept so it can be sent back to Gemini on the next call.
            providerMeta: { thoughtSignature: "sig_1" },
        },
    ]);
});

// This is the shape Gemini really returned for "set the tempo to 128 and add a track called Lead".
test("translates function calls into tool calls", () => {
    const reply = {
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
    };

    assert.deepEqual(fromGeminiResponse(reply), [
        {
            type: "tool_call",
            id: "call_68471",
            name: "set_tempo",
            args: { bpm: 128 },
            providerMeta: { thoughtSignature: "sig_1" },
        },
        // No signature on this part, and no args: it becomes an empty args object.
        { type: "tool_call", id: "call_68472", name: "get_session", args: {} },
    ]);
});

test("throws when Gemini returns no reply", () => {
    const reply = { promptFeedback: { blockReason: "SAFETY" } };

    assert.throws(() => fromGeminiResponse(reply), /Gemini returned no reply.*SAFETY/);
});

// Replaces the real fetch for one test, so no request leaves the machine.
function fakeFetch(t: TestContext, status: number, body: unknown) {
    return t.mock.method(globalThis, "fetch", async () => Response.json(body, { status }));
}

// The url and options of the one request a test sent.
function sentRequest(fetchMock: ReturnType<typeof fakeFetch>) {
    const call = fetchMock.mock.calls[0];
    assert.ok(call, "fetch was not called");
    return call.arguments as unknown as [string, RequestInit];
}

test("the provider posts the translated request and returns the translated reply", async (t) => {
    const fetchMock = fakeFetch(t, 200, {
        candidates: [{ content: { role: "model", parts: [{ text: "Hello!" }] } }],
    });
    const provider = createGeminiProvider("test-key", "test-model");
    const conversation: Message[] = [{ type: "user", text: "Hi" }];

    const reply = await provider.generate(conversation, [setTempo]);

    assert.deepEqual(reply, [{ type: "assistant", text: "Hello!" }]);

    const [url, options] = sentRequest(fetchMock);
    assert.equal(
        url,
        "https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent",
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

test("the provider throws Gemini's own message when a request fails", async (t) => {
    fakeFetch(t, 429, { error: { code: 429, message: "Quota exceeded" } });
    const provider = createGeminiProvider("test-key", "test-model");

    await assert.rejects(
        provider.generate([{ type: "user", text: "Hi" }], [setTempo]),
        /Gemini request failed \(429\): Quota exceeded/,
    );
});

test("the provider passes the cancel signal to fetch", async (t) => {
    const fetchMock = fakeFetch(t, 200, {
        candidates: [{ content: { role: "model", parts: [{ text: "Hello!" }] } }],
    });
    const provider = createGeminiProvider("test-key", "test-model");
    const controller = new AbortController();

    await provider.generate([{ type: "user", text: "Hi" }], [], {
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

test("the provider sends the system prompt it is given", async (t) => {
    const fetchMock = fakeFetch(t, 200, {
        candidates: [{ content: { role: "model", parts: [{ text: "Hello!" }] } }],
    });
    const provider = createGeminiProvider("test-key", "test-model");

    await provider.generate([{ type: "user", text: "Hi" }], [], {
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

test("the provider marks an overloaded reply as retryable", async (t) => {
    fakeFetch(t, 503, { error: { code: 503, message: "The model is overloaded." } });
    const provider = createGeminiProvider("test-key", "test-model");

    const error = await failureOf(provider.generate([{ type: "user", text: "Hi" }], []));

    assert.equal(error.retryable, true);
    assert.equal(error.retryAfterMs, undefined);
    assert.match(error.message, /Gemini request failed \(503\): The model is overloaded\./);
});

test("the provider marks a rejected request as not retryable", async (t) => {
    fakeFetch(t, 400, { error: { code: 400, message: "API key not valid." } });
    const provider = createGeminiProvider("test-key", "test-model");

    const error = await failureOf(provider.generate([{ type: "user", text: "Hi" }], []));

    assert.equal(error.retryable, false);
});

test("the provider reads how long Gemini asks to wait", async (t) => {
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
    const provider = createGeminiProvider("test-key", "test-model");

    const error = await failureOf(provider.generate([{ type: "user", text: "Hi" }], []));

    assert.equal(error.retryable, true);
    assert.equal(error.retryAfterMs, 12_500);
});

test("the provider keeps the status of a failure whose body is not JSON", async (t) => {
    t.mock.method(
        globalThis,
        "fetch",
        async () => new Response("<html>Service Unavailable</html>", { status: 503 }),
    );
    const provider = createGeminiProvider("test-key", "test-model");

    const error = await failureOf(provider.generate([{ type: "user", text: "Hi" }], []));

    assert.equal(error.retryable, true);
    assert.match(error.message, /Gemini request failed \(503\): <html>Service Unavailable<\/html>/);
});

test("the provider marks a dropped connection as retryable", async (t) => {
    t.mock.method(globalThis, "fetch", async () => {
        throw new TypeError("fetch failed");
    });
    const provider = createGeminiProvider("test-key", "test-model");

    const error = await failureOf(provider.generate([{ type: "user", text: "Hi" }], []));

    assert.equal(error.retryable, true);
    assert.match(error.message, /Gemini request failed: fetch failed/);
});

test("the provider does not relabel a cancelled request", async (t) => {
    const cancelled = new DOMException("This operation was aborted", "AbortError");
    t.mock.method(globalThis, "fetch", async () => {
        throw cancelled;
    });
    const provider = createGeminiProvider("test-key", "test-model");

    await assert.rejects(provider.generate([{ type: "user", text: "Hi" }], []), cancelled);
});
