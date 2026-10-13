import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgentLoop } from "./agent-loop.ts";
import { withRetry } from "./retry.ts";
import { type GenerateOptions, type Message, ModelCallError, type Provider } from "./types.ts";

const hello: Message[] = [{ type: "user", text: "Hello" }];
const reply: Message[] = [{ type: "assistant", text: "Hi there" }];

const busy = () => new ModelCallError("Model is overloaded", { retryable: true });

// A fake provider whose attempts follow a script: an Error is thrown, messages are returned.
// It records the options of each attempt.
function scriptedProvider(script: (Error | Message[])[]) {
    const attempts: (GenerateOptions | undefined)[] = [];
    const provider: Provider = {
        generate: async (_conversation, _tools, options) => {
            attempts.push(options);
            const next = script.shift();
            if (!next) throw new Error("The script ran out of replies");
            if (next instanceof Error) throw next;
            return next;
        },
    };
    return { provider, attempts };
}

// Collects the wait of each retry the wrapper reports.
function recordedWaits() {
    const waits: number[] = [];
    return { waits, onRetry: ({ waitMs }: { waitMs: number }) => waits.push(waitMs) };
}

test("returns the reply of a first attempt that works, without a retry", async () => {
    const { provider, attempts } = scriptedProvider([reply]);
    const { waits, onRetry } = recordedWaits();

    const result = await withRetry(provider, { onRetry }).generate(hello, []);

    assert.deepEqual(result, reply);
    assert.equal(attempts.length, 1);
    assert.deepEqual(waits, []);
});

test("retries a retryable failure, waiting twice as long each time", async () => {
    const { provider, attempts } = scriptedProvider([busy(), busy(), busy(), busy(), busy(), reply]);
    const { waits, onRetry } = recordedWaits();

    const result = await withRetry(provider, { firstWaitMs: 1, onRetry }).generate(hello, []);

    assert.deepEqual(result, reply);
    assert.equal(attempts.length, 6);
    assert.deepEqual(waits, [1, 2, 4, 8, 16]);
});

test("reports the failure and the retry number before each wait", async () => {
    const failure = busy();
    const { provider } = scriptedProvider([failure, reply]);
    const reports: unknown[] = [];

    await withRetry(provider, {
        firstWaitMs: 1,
        onRetry: (report) => reports.push(report),
    }).generate(hello, []);

    assert.deepEqual(reports, [{ error: failure, retry: 1, maxRetries: 5, waitMs: 1 }]);
});

test("fails with the last failure when the retries run out", async () => {
    const last = new ModelCallError("Still overloaded", { retryable: true });
    const { provider, attempts } = scriptedProvider([busy(), busy(), last]);

    await assert.rejects(
        withRetry(provider, { maxRetries: 2, firstWaitMs: 1 }).generate(hello, []),
        last,
    );
    assert.equal(attempts.length, 3);
});

test("does not retry when maxRetries is 0", async () => {
    const { provider, attempts } = scriptedProvider([busy(), reply]);

    await assert.rejects(withRetry(provider, { maxRetries: 0 }).generate(hello, []));
    assert.equal(attempts.length, 1);
});

test("does not retry a failure marked as not retryable", async () => {
    const badKey = new ModelCallError("API key not valid", { retryable: false });
    const { provider, attempts } = scriptedProvider([badKey, reply]);

    await assert.rejects(withRetry(provider, { firstWaitMs: 1 }).generate(hello, []), badKey);
    assert.equal(attempts.length, 1);
});

test("does not retry an error that carries no label", async () => {
    const bug = new Error("Cannot read properties of undefined");
    const { provider, attempts } = scriptedProvider([bug, reply]);

    await assert.rejects(withRetry(provider, { firstWaitMs: 1 }).generate(hello, []), bug);
    assert.equal(attempts.length, 1);
});

test("waits as long as the provider asks, in place of its own wait", async () => {
    const limited = new ModelCallError("Quota exceeded", { retryable: true, retryAfterMs: 7 });
    const { provider } = scriptedProvider([limited, reply]);
    const { waits, onRetry } = recordedWaits();

    await withRetry(provider, { firstWaitMs: 1, onRetry }).generate(hello, []);

    assert.deepEqual(waits, [7]);
});

test("fails without waiting when the provider asks for more than a minute", async () => {
    const limited = new ModelCallError("Quota exceeded", { retryable: true, retryAfterMs: 61_000 });
    const { provider, attempts } = scriptedProvider([limited, reply]);
    const { waits, onRetry } = recordedWaits();

    await assert.rejects(withRetry(provider, { onRetry }).generate(hello, []), limited);
    assert.equal(attempts.length, 1);
    assert.deepEqual(waits, []);
});

// Never replies; fails only when its signal fires, as fetch does.
function hangingAttempt(options?: GenerateOptions) {
    return new Promise<Message[]>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(options.signal?.reason));
    });
}

test("stops an attempt that passes its time limit and retries it", async () => {
    let attempts = 0;
    const provider: Provider = {
        generate: async (_conversation, _tools, options) => {
            attempts++;
            return attempts === 1 ? hangingAttempt(options) : reply;
        },
    };
    const errors: Error[] = [];

    const result = await withRetry(provider, {
        timeoutMs: 10,
        firstWaitMs: 1,
        onRetry: ({ error }) => errors.push(error),
    }).generate(hello, []);

    assert.deepEqual(result, reply);
    assert.equal(attempts, 2);
    assert.match(errors[0]?.message ?? "", /did not reply within 0\.01s/);
});

test("passes the system prompt on to every attempt", async () => {
    const { provider, attempts } = scriptedProvider([busy(), reply]);

    await withRetry(provider, { firstWaitMs: 1 }).generate(hello, [], { system: "You are a test." });

    assert.deepEqual(
        attempts.map((options) => options?.system),
        ["You are a test.", "You are a test."],
    );
});

test("a cancel during a wait ends the turn as cancelled, with no further attempt", async () => {
    const { provider, attempts } = scriptedProvider([busy(), reply]);
    const controller = new AbortController();

    const result = await runAgentLoop(
        withRetry(provider, { firstWaitMs: 60_000, onRetry: () => controller.abort() }),
        [],
        hello,
        { signal: controller.signal },
    );

    assert.deepEqual(result, { messages: hello, stop: "cancelled" });
    assert.equal(attempts.length, 1);
});

test("a cancel during an attempt ends the turn as cancelled, with no retry", async () => {
    let attempts = 0;
    const controller = new AbortController();
    const provider: Provider = {
        generate: async (_conversation, _tools, options) => {
            attempts++;
            setImmediate(() => controller.abort());
            return hangingAttempt(options);
        },
    };

    const result = await runAgentLoop(withRetry(provider, { firstWaitMs: 1 }), [], hello, {
        signal: controller.signal,
    });

    assert.deepEqual(result, { messages: hello, stop: "cancelled" });
    assert.equal(attempts, 1);
});

test("when the retries run out the turn ends with the error and keeps the conversation", async () => {
    const last = new ModelCallError("Still overloaded", { retryable: true });
    const { provider } = scriptedProvider([busy(), last]);

    const result = await runAgentLoop(
        withRetry(provider, { maxRetries: 1, firstWaitMs: 1 }),
        [],
        hello,
    );

    assert.deepEqual(result, { messages: hello, stop: "error", error: last });
});
