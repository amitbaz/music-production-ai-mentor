# 0006 — Cancelling a turn keeps what happened and leaves no tool call unanswered

Date: 2026-10-13 · Status: accepted

## Context

A turn can take several rounds, and the user needs a way to stop it. A cancel can arrive while the loop waits for the model or while a tool is running, and the model may have asked for several tools in one reply.

## Decision

- The caller passes an `AbortSignal` in the loop's options. The loop passes it on to the provider, so a model call in flight is stopped.
- A cancelled turn returns `stop: "cancelled"` with the conversation so far, following ADR 0005.
- A tool that is already running is allowed to finish, and its real result is recorded.
- Tool calls from the same reply that had not started are not run. Each gets an error tool result saying it was cancelled before it ran.

Rejected:

- Passing the signal into each tool's `run`: every tool would have to define what a half-finished action means. It can be added later without changing the rest.
- Removing the round's tool calls from the conversation: a tool may already have changed the session, and the record of it would be lost.

## Consequences

- Every tool call in the conversation has a tool result, which providers require.
- A slow tool delays the cancel until it finishes.
- `Provider.generate` takes an optional signal, and each adapter must pass it to its HTTP call.
