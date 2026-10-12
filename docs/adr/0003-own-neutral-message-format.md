# 0003 — The conversation is stored in our own neutral message format

Date: 2026-10-12 · Status: accepted

## Context

ADR 0002 deferred the internal message format until a raw Gemini reply had been inspected. That reply showed Gemini's own naming (`role: "model"`, `parts`, `text`) and a `thoughtSignature`: an opaque, Gemini-only token that must be sent back unchanged in later calls.

## Decision

- The conversation is a flat list of messages in our own format, with four kinds: user text, assistant text, tool call, tool result.
- Each provider adapter translates this list into its provider's request, and the provider's reply back into these messages. The agent loop never sees a provider's shape.
- Messages produced by the model carry an optional `providerMeta` slot. An adapter may store anything there (for Gemini, the `thoughtSignature`); the loop carries it along without reading it, and only the adapter that wrote it reads it back.

Rejected: storing Gemini's shape directly (less code now, but the loop would speak Gemini and every later adapter would convert from it), and borrowing OpenAI's shape (still needs translation for Gemini and inherits its quirks).

## Consequences

- Every adapter does two translations, including grouping the flat list into the provider's per-turn messages.
- `providerMeta` written by one provider is meaningless to another, so switching provider mid-conversation loses it.
