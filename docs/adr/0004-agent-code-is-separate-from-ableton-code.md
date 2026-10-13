# 0004 — Agent code is separate from Ableton code, as a folder and not yet a package

Date: 2026-10-13 · Status: accepted

## Context

The agent loop, message types and provider adapters are meant to be reusable for other products later, in the way a harness library is. A separate package was considered.

## Decision

- `src/agent/` holds the harness: types, agent loop, provider adapters. It must not import anything from outside itself, and must not mention Ableton.
- `src/ableton/` holds the Ableton-specific tools. It may import from `src/agent/`.
- `src/cli.ts` is the only place that joins the two.
- No separate package yet. Extract `src/agent/` into one when a second product needs it.

## Why not a package now

There is one consumer, and the interface (`Provider`, `Message`, `runAgentLoop`) will still change with streaming, a second provider and conversation trimming. A package would add a workspace, a build step and versioning before the interface has settled.

## Consequences

Extracting later is a folder move plus a `package.json`. The agent loop's tests use their own generic tool instead of the fake Ableton.
