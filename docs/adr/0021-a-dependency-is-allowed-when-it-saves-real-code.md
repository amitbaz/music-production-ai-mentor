# 0021 — A dependency is allowed when it saves real code

Date: 2026-10-16 · Status: accepted · Replaces the rule in ADR 0001 and ADR 0012 that the project keeps zero runtime dependencies

## Context

The project had no runtime dependencies: provider adapters call the HTTP API with `fetch`, the Ableton client is our own on the built-in `WebSocket`. The rule made sense while the harness was the thing to learn and every piece of it was small. The next pieces are not all like that: an MCP client for the knowledge base, images and audio in tool results, a desktop app. Writing those by hand teaches nothing the maintainer wants to learn, and the rule was starting to decide designs for us. The maintainer chose to drop it.

## Decision

- A dependency is allowed when it saves real code that would teach nothing. The pull request that adds one says what it buys.
- The parts of the harness the project wants to understand stay hand-written: the agent loop, the message format, summarising, retry, the provider adapters' translation of the conversation.
- A dependency is a decision like any other: it is raised with the maintainer before it is added, and the ADR of the feature that needs it names it.

Rejected:

- Keeping the rule: the MCP client, image handling and a desktop shell would all be written by hand, for no understanding gained.
- Any dependency freely: version churn and supply-chain risk in a project with one maintainer. The rule above asks for a reason each time.

## Consequences

- `pnpm-lock.yaml` and `node_modules` grow with each one; upgrades are reviewed.
- AGENTS.md and README no longer say the project has no runtime dependencies.
- Whether the second provider adapter uses `fetch` or the provider's SDK is decided in its own ADR, not here.
