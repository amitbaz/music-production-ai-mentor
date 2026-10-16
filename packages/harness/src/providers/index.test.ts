import { test } from "node:test";
import assert from "node:assert/strict";
import { adapters, modelFor } from "./index.ts";

test("every supported model has a context window of at least 1,000,000 tokens and a docs link", () => {
    for (const [provider, { models }] of Object.entries(adapters)) {
        assert.ok(models.length > 0, `${provider} lists no models`);
        for (const model of models) {
            const label = `${provider}:${model.name}`;
            assert.ok(model.contextWindow >= 1_000_000, `${label} has a window under 1,000,000`);
            assert.equal(URL.canParse(model.docs) && new URL(model.docs).protocol, "https:", `${label} has no docs link`);
        }
    }
});

test("gemini starts its list with gemini-3.5-flash-lite at 1,048,576 tokens", () => {
    assert.equal(adapters.gemini?.models[0]?.name, "gemini-3.5-flash-lite");
    assert.equal(adapters.gemini?.models[0]?.contextWindow, 1_048_576);
});

test("claude lists claude-haiku-5-5 at 1,000,000 tokens, about 3.5 characters per token, with a docs link", () => {
    const entry = adapters.claude?.models.find((model) => model.name === "claude-haiku-5-5");

    assert.equal(adapters.claude?.models.length, 1);
    assert.equal(entry?.contextWindow, 1_000_000);
    assert.equal(entry?.charsPerToken, 3.5);
    assert.ok(entry?.docs.startsWith("https://"));
});

test("claude:claude-haiku-5-5 with a key gives a model that calls the Claude API", async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response(`data: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 1 } } })}\n\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`));

    const model = modelFor("claude:claude-haiku-5-5", { claude: "test-key" }, {});
    await model.call([{ type: "user", text: "Hi" }], []);

    assert.equal(model.charsPerToken, 3.5);
    const [url, options] = (fetchMock.mock.calls[0]?.arguments ?? []) as unknown as [string, RequestInit];
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    assert.equal((options.headers as Record<string, string>)["x-api-key"], "test-key");
});

test("a claude model that is not supported, or a missing claude key, fails the first call and says which", async () => {
    const hi = [{ type: "user" as const, text: "Hi" }];

    await assert.rejects(
        modelFor("claude:claude-opus-5-5", { claude: "test-key" }, {}).call(hi, []),
        { message: 'Model "claude-opus-5-5" is not supported by provider "claude"' },
    );
    await assert.rejects(
        modelFor("claude:claude-haiku-5-5", { gemini: "test-key" }, {}).call(hi, []),
        { message: 'No API key for provider "claude"' },
    );
});

test("every supported model has a number of characters per token above 0", () => {
    for (const [provider, { models }] of Object.entries(adapters)) {
        for (const model of models) {
            assert.ok(model.charsPerToken > 0, `${provider}:${model.name} has no characters per token`);
        }
    }
});

test("the model the lookup gives carries the characters per token of its entry", (t) => {
    const entry = adapters.gemini?.models[0];
    assert.ok(entry);
    t.mock.property(entry, "charsPerToken", 2.5);
    assert.equal(modelFor("gemini:gemini-3.5-flash-lite", { gemini: "test-key" }, {}).charsPerToken, 2.5);
});
