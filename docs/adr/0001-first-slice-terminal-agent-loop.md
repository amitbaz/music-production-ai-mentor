# 0001 — First slice: a terminal agent loop against a fake Ableton

Date: 2026-10-12 · Status: accepted

## Context

The project has three goals: learn how model calls and agent harnesses work by writing them, serve as a portfolio piece, and eventually be used in real music production. Most of the product (desktop shell, real Ableton connection, features) is still unknown.

## Decision

Build only this first:

- An agent loop in TypeScript, driven from a minimal terminal chat.
- Tools that act on a fake Ableton: an in-memory object with tempo and named tracks, exposed as `get_session`, `set_tempo`, `create_track`.
- Node 22 running `.ts` files directly, with the built-in test runner and `--env-file`. No dependencies.
- Whole responses, no streaming.
- Test-first throughout; the agent loop is tested against a scripted provider. The one exception is the initial exploratory call to Gemini.
- The loop stops after 10 rounds per user message. A failing tool returns its error as the tool result rather than throwing.
- The maintainer types all the code; the assistant supplies full code with explanation and reviews.

## Deferred

Desktop app (Tauri/Electron), real Ableton bridge, streaming, a second provider, trimming long conversations.

## Consequences

The fake Ableton sits behind the tool interface, so the real bridge later replaces tool implementations without touching the loop.
