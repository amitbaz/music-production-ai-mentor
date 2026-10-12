# 0002 — Gemini first, called with plain fetch

Date: 2026-10-12 · Status: accepted

## Context

The agent loop is provider-agnostic, but one real provider adapter must exist to run it and to ground the design of the internal message format.

## Decision

- The first provider adapter targets Gemini (free tier, existing credit). Anthropic is the planned second adapter.
- Adapters call the provider's HTTP API with `fetch`, not the official SDK, so the request and response shapes stay visible.
- The internal message format is **not yet decided**. It will be settled after the first raw Gemini reply has been inspected, and recorded in a follow-up ADR. (Settled in ADR 0003.)

## Consequences

- We own request/response types, retries on rate limits, and (later) stream parsing.
- API changes are tracked by hand.
- Reversible: the HTTP call lives in one adapter file, so switching to an SDK changes only that file.
