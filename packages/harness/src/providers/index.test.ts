import { test } from "node:test";
import assert from "node:assert/strict";
import { adapters } from "./index.ts";

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
