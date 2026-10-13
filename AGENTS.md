# Music production AI mentor

A mentor for music production that the user talks to, built on its own provider-agnostic agent harness. Ableton is its first set of tools, and for now those tools act on an in-memory fake. Amit builds it to learn how agents work and to use in his own productions.

## Working mode

Amit types the implementation himself, because understanding it is the point. For each step:

1. Write the failing tests in the repo.
2. Prove the implementation in a scratch copy outside the repo: all tests green, and a run against the real API where behaviour depends on the model.
3. Hand him the full code to type, with a plain-language explanation of each part that is new to him.

Apply a change yourself when he says to, or when it is prose (docs, the system prompt). Settle design questions with him before step 1, one question at a time.

Commit only when he asks, straight to `main`, one commit per step.

## Boundaries

- `src/agent/` is the harness and imports only from itself. It knows about messages, tools and providers, and nothing about music or Ableton.
- `src/ableton/` is one set of tools.
- `src/cli.ts` and `src/system-prompt.ts` are the product, the only place the two meet.

## Constraints

- The project has no runtime dependencies, and provider adapters call the HTTP API with `fetch`. Raise a new dependency with Amit as a decision.
- Tests run offline: a scripted provider for the loop, a mocked `fetch` for adapters. Tests in `src/agent/` define their own generic tools.
- There is no type-check command. The tests are the verification; treat a type error the editor shows as real.
- `GEMINI_API_KEY` lives in `.env`. Keep its value out of output, logs and commits.

## Before changing a design

`docs/adr/` records why the loop, the message format and the provider interface are shaped as they are. Read the records that touch what you are about to change, and write a new one when a decision replaces an old one. Use the terms in `GLOSSARY.md` in code, tests and commit messages.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `amitbaz/music-production-ai-mentor`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
