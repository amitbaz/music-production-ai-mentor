# 0009 — Retry is a wrapper around a provider

Date: 2026-10-13 · Status: accepted

## Context

A failed model call ended the turn at once (ADR 0005), so every overloaded-provider blip made the user type again. There was also no time limit of our own: a hung request waited about five minutes for Node to give up. ADR 0002 chose plain `fetch` and named retries as a cost we own; ADR 0005 left retry "to be added on top" of the loop.

## Decision

- `withRetry(provider, options)` takes a provider and returns a provider. The agent loop is unchanged and knows nothing about retries; the product wraps the provider it builds.
- A provider adapter never retries. It labels a failed attempt by throwing a `ModelCallError` with `retryable` set, and `retryAfterMs` when the provider says how long to wait. The Gemini adapter marks 408, 429, 500, 502, 503, 504 and a dropped connection as retryable.
- Only a retryable failure is retried. Any other error, including one without the label, fails the model call at once.
- Defaults: 5 retries, waiting 1s, 2s, 4s, 8s, 16s, with no jitter. `maxRetries` is a setting; 0 turns retry off.
- A wait given by the provider replaces our own. If it is longer than 60s the model call fails without waiting.
- Each attempt has a time limit of 60s (`timeoutMs`). A timeout is a retryable failure.
- A cancel during an attempt or a wait ends the turn as cancelled (ADR 0006).
- The wrapper reports each retry through `onRetry`. Nothing about a retry is written into the conversation, and there is no new stop reason: when the retries run out the turn ends with `"error"` and the last failure.

Rejected:

- Retrying inside the agent loop, as the Vercel AI SDK does: no caller can forget it, but the loop gains a second job.
- Retrying inside each adapter: every adapter writes and tests the same loop.
- Using the Gemini SDK's retry: covers one provider, retries silently, and is a runtime dependency (ADR 0002).
- The wrapper deciding from the HTTP status: the harness would learn status codes, and providers give them different meanings.
- Jitter: it spreads out many clients, and this is one user in one terminal.

## Consequences

- A caller that does not wrap its provider gets no retry and no timeout.
- When a provider hangs on every attempt, the error arrives after about six minutes unless the user cancels.
- A reply that would have arrived after the time limit is thrown away.
- Every adapter must throw `ModelCallError` for failures worth retrying; a plain `Error` is never retried.
- A retry sends the same conversation again, so tools that already ran are not run again.
