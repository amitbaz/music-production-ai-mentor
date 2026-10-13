import { setTimeout as wait } from "node:timers/promises";
import { ModelCallError, type Model } from "./types.ts";

// A provider that asks for a longer wait than this fails the model call instead.
const MAX_PROVIDER_WAIT_MS = 60_000;

export type RetryReport = {
    // The failed attempt that is about to be retried
    error: Error;
    // Which retry comes next, counting from 1
    retry: number;
    maxRetries: number;
    waitMs: number;
};

export type RetryOptions = {
    // How many more attempts follow a first failed one; 0 turns retry off
    maxRetries?: number;
    // How long one attempt may go without text arriving
    timeoutMs?: number;
    // The wait before the first retry; it doubles for each one after
    firstWaitMs?: number;
    // Called before each wait
    onRetry?: (report: RetryReport) => void;
};

// Wraps a model so that a model call retries its retryable failures and times out a hung attempt.
export function withRetry(
    model: Model,
    options: RetryOptions = {},
): Model {
    const { maxRetries = 5, timeoutMs = 60_000, firstWaitMs = 1000 } = options;

    return {
        call: async (conversation, tools, callOptions) => {
            const cancel = callOptions?.signal;

            for (let retry = 0; ; retry++) {
                // Not AbortSignal.timeout: its timer does not keep the program alive.
                const timeout = new AbortController();
                let timer = setTimeout(() => timeout.abort(), timeoutMs);
                // Whether text of this attempt's reply has reached the caller
                let started = false;
                let error: ModelCallError;
                try {
                    return await model.call(conversation, tools, {
                        ...callOptions,
                        signal: cancel
                            ? AbortSignal.any([cancel, timeout.signal])
                            : timeout.signal,
                        onText: (text) => {
                            started = true;
                            // The time limit measures silence, so each piece restarts it.
                            clearTimeout(timer);
                            timer = setTimeout(() => timeout.abort(), timeoutMs);
                            callOptions?.onText?.(text);
                        },
                    });
                } catch (e) {
                    // A cancel is passed on as it is; the agent loop reports it.
                    if (cancel?.aborted) throw e;
                    if (timeout.signal.aborted) {
                        error = new ModelCallError(
                            `The model sent nothing for ${timeoutMs / 1000}s`,
                            { retryable: true, cause: e },
                        );
                    } else if (e instanceof ModelCallError) {
                        error = e;
                    } else {
                        throw e;
                    }
                } finally {
                    clearTimeout(timer);
                }

                const waitMs = error.retryAfterMs ?? firstWaitMs * 2 ** retry;
                // A reply the caller has begun to receive is never started again.
                if (
                    started ||
                    !error.retryable ||
                    retry >= maxRetries ||
                    waitMs > MAX_PROVIDER_WAIT_MS
                ) {
                    throw error;
                }

                options.onRetry?.({
                    error,
                    retry: retry + 1,
                    maxRetries,
                    waitMs,
                });
                await wait(waitMs, undefined, { signal: cancel });
            }
        },
    };
}
