import { type RetryOptions, withRetry } from "../retry.ts";
import type { Model } from "../types.ts";
import { createGeminiModel } from "./gemini.ts";

// One API key per provider name. A provider whose key is missing cannot be used.
export type Keys = Record<string, string | undefined>;

// Every provider adapter, under the name a model id starts with.
const adapters: Record<string, (apiKey: string, name: string) => Model> = {
    gemini: createGeminiModel,
};

// The provider lookup: gives the model for a model id, written provider:model.
// Never throws: a model id it cannot use gives a model whose every call fails.
export function modelFor(
    modelId: string,
    keys: Keys,
    retry: RetryOptions,
): Model {
    // Only the first colon divides; a provider's own model name may hold more.
    const colon = modelId.indexOf(":");
    const provider = modelId.slice(0, colon);
    const name = modelId.slice(colon + 1);
    if (colon < 1 || name === "") {
        return broken(`Model id "${modelId}" is not written provider:model`);
    }

    const adapter = Object.hasOwn(adapters, provider)
        ? adapters[provider]
        : undefined;
    if (!adapter) {
        return broken(`Unknown provider "${provider}" in model id "${modelId}"`);
    }

    const key = Object.hasOwn(keys, provider) ? keys[provider] : undefined;
    if (!key) return broken(`No API key for provider "${provider}"`);

    return withRetry(adapter(key, name), retry);
}

// A model whose every call fails with a plain Error, so it is never retried.
export function broken(reason: string): Model {
    return {
        call: async () => {
            throw new Error(reason);
        },
    };
}
