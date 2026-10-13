# 0005 — The agent loop returns a result and never throws

Date: 2026-10-13 · Status: accepted

## Context

`runAgentLoop` returned `Message[]` and threw when a model call failed. Two problems followed:

- If a tool had already run and the next model call failed, the caller got an exception and no messages, so the tool's effect had no record in the conversation.
- Hitting the round limit was reported by appending an assistant message, which was later sent to the model as if the model had said it.

The caller also saw nothing until the whole turn had finished.

## Decision

- `runAgentLoop` always returns `{ messages, stop }`, where `messages` is the whole conversation so far and `stop` is the stop reason: `"finished"`, `"round_limit"` or `"error"` (with the `error` attached). It does not throw for a failed model call.
- The stop reason is never written into the conversation.
- The caller may pass an `onMessage` callback. The loop calls it with each new message as soon as it exists.
- After a failure the caller keeps everything that was returned, including a user message that got no answer. The user continues by sending another message.

Rejected:

- Throwing an error that carries the messages: two paths for every caller, and a forgotten `try/catch` loses the messages again.
- An async generator that yields messages: its final return value is awkward to read, so the stop reason would have to become a yielded event.
- Dropping an unanswered user message: a second rule for one case, to save retyping.
- Retrying inside the loop: a separate feature, to be added on top.

## Consequences

- Callers must check `stop`; an ignored `"error"` is silent.
- A conversation can hold two user messages in a row, or end on a tool result. Provider adapters must accept both.
- Streaming text will need a second callback or a wider one; `onMessage` reports whole messages only.
