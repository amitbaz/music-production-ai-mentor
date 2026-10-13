import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgentLoop } from "./agent-loop.ts";
import { withRetry } from "./retry.ts";
import { type CallOptions, type Message, ModelCallError, type Model } from "./types.ts";

const hello: Message[] = [{ type: "user", text: "Hello" }];
const reply: Message[] = [{ type: "assistant", text: "Hi there" }];

const busy = () => new ModelCallError("Model is overloaded", { retryable: true });

// A scripted model whose attempts follow a script: an Error is thrown, messages are returned.
// It records the options of each attempt.
function scriptedModel(script: (Error | Message[])[]) {
    const attempts: (CallOptions | undefined)[] = [];
    const model: Model = {
        call: async (_conversation, _tools, options) => {
            attempts.push(options);
            const next = script.shift();
            if (!next) throw new Error("The script ran out of replies");
            if (next instanceof Error) throw next;
            return next;
        },
    };
    return { model, attempts };
}

// Collects the wait of each retry the wrapper reports.
function recordedWaits() {
    const waits: number[] = [];
    return { waits, onRetry: ({ waitMs }: { waitMs: number }) => waits.push(waitMs) };
}

test("returns the reply of a first attempt that works, without a retry", async () => {
    const { model, attempts } = scriptedModel([reply]);
    const { waits, onRetry } = recordedWaits();

    const result = await withRetry(model, { onRetry }).call(hello, []);

    assert.deepEqual(result, reply);
    assert.equal(attempts.length, 1);
    assert.deepEqual(waits, []);
});

test("retries a retryable failure, waiting twice as long each time", async () => {
    const { model, attempts } = scriptedModel([busy(), busy(), busy(), busy(), busy(), reply]);
    const { waits, onRetry } = recordedWaits();

    const result = await withRetry(model, { firstWaitMs: 1, onRetry }).call(hello, []);

    assert.deepEqual(result, reply);
    assert.equal(attempts.length, 6);
    assert.deepEqual(waits, [1, 2, 4, 8, 16]);
});

test("reports the failure and the retry number before each wait", async () => {
    const failure = busy();
    const { model } = scriptedModel([failure, reply]);
    const reports: unknown[] = [];

    await withRetry(model, {
        firstWaitMs: 1,
        onRetry: (report) => reports.push(report),
    }).call(hello, []);

    assert.deepEqual(reports, [{ error: failure, retry: 1, maxRetries: 5, waitMs: 1 }]);
});

test("fails with the last failure when the retries run out", async () => {
    const last = new ModelCallError("Still overloaded", { retryable: true });
    const { model, attempts } = scriptedModel([busy(), busy(), last]);

    await assert.rejects(
        withRetry(model, { maxRetries: 2, firstWaitMs: 1 }).call(hello, []),
        last,
    );
    assert.equal(attempts.length, 3);
});

test("does not retry when maxRetries is 0", async () => {
    const { model, attempts } = scriptedModel([busy(), reply]);

    await assert.rejects(withRetry(model, { maxRetries: 0 }).call(hello, []));
    assert.equal(attempts.length, 1);
});

test("does not retry a failure marked as not retryable", async () => {
    const badKey = new ModelCallError("API key not valid", { retryable: false });
    const { model, attempts } = scriptedModel([badKey, reply]);

    await assert.rejects(withRetry(model, { firstWaitMs: 1 }).call(hello, []), badKey);
    assert.equal(attempts.length, 1);
});

test("does not retry an error that carries no label", async () => {
    const bug = new Error("Cannot read properties of undefined");
    const { model, attempts } = scriptedModel([bug, reply]);

    await assert.rejects(withRetry(model, { firstWaitMs: 1 }).call(hello, []), bug);
    assert.equal(attempts.length, 1);
});

test("waits as long as the provider asks, in place of its own wait", async () => {
    const limited = new ModelCallError("Quota exceeded", { retryable: true, retryAfterMs: 7 });
    const { model } = scriptedModel([limited, reply]);
    const { waits, onRetry } = recordedWaits();

    await withRetry(model, { firstWaitMs: 1, onRetry }).call(hello, []);

    assert.deepEqual(waits, [7]);
});

test("fails without waiting when the provider asks for more than a minute", async () => {
    const limited = new ModelCallError("Quota exceeded", { retryable: true, retryAfterMs: 61_000 });
    const { model, attempts } = scriptedModel([limited, reply]);
    const { waits, onRetry } = recordedWaits();

    await assert.rejects(withRetry(model, { onRetry }).call(hello, []), limited);
    assert.equal(attempts.length, 1);
    assert.deepEqual(waits, []);
});

// Never replies; fails only when its signal fires, as fetch does.
function hangingAttempt(options?: CallOptions) {
    return new Promise<Message[]>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(options.signal?.reason));
    });
}

test("stops an attempt that passes its time limit and retries it", async () => {
    let attempts = 0;
    const model: Model = {
        call: async (_conversation, _tools, options) => {
            attempts++;
            return attempts === 1 ? hangingAttempt(options) : reply;
        },
    };
    const errors: Error[] = [];

    const result = await withRetry(model, {
        timeoutMs: 10,
        firstWaitMs: 1,
        onRetry: ({ error }) => errors.push(error),
    }).call(hello, []);

    assert.deepEqual(result, reply);
    assert.equal(attempts, 2);
    assert.match(errors[0]?.message ?? "", /did not reply within 0\.01s/);
});

test("passes the system prompt on to every attempt", async () => {
    const { model, attempts } = scriptedModel([busy(), reply]);

    await withRetry(model, { firstWaitMs: 1 }).call(hello, [], { system: "You are a test." });

    assert.deepEqual(
        attempts.map((options) => options?.system),
        ["You are a test.", "You are a test."],
    );
});

test("a cancel during a wait ends the turn as cancelled, with no further attempt", async () => {
    const { model, attempts } = scriptedModel([busy(), reply]);
    const controller = new AbortController();

    const result = await runAgentLoop(
        withRetry(model, { firstWaitMs: 60_000, onRetry: () => controller.abort() }),
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
    const model: Model = {
        call: async (_conversation, _tools, options) => {
            attempts++;
            setImmediate(() => controller.abort());
            return hangingAttempt(options);
        },
    };

    const result = await runAgentLoop(withRetry(model, { firstWaitMs: 1 }), [], hello, {
        signal: controller.signal,
    });

    assert.deepEqual(result, { messages: hello, stop: "cancelled" });
    assert.equal(attempts, 1);
});

test("when the retries run out the turn ends with the error and keeps the conversation", async () => {
    const last = new ModelCallError("Still overloaded", { retryable: true });
    const { model } = scriptedModel([busy(), last]);

    const result = await runAgentLoop(
        withRetry(model, { maxRetries: 1, firstWaitMs: 1 }),
        [],
        hello,
    );

    assert.deepEqual(result, { messages: hello, stop: "error", error: last });
});
