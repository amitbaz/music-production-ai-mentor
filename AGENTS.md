# Music production AI mentor

An AI mentor that helps music producers deliver more professional productions. The user talks to it; it explains, gives guidance, and acts for them through tool sets. It runs on its own provider-agnostic agent harness.

## Working mode

Build test-first: failing tests go into the repo before the implementation. Settle design questions with the maintainer before writing tests.

### Asking a design question

Ask one question at a time, with your question tool. Write it in simple words, and put the whole explanation inside the question and its options, because the question dialog covers the text before it. Each option says what would happen and what it costs; mark the one you recommend. Where it helps, show a short example of what the user would see or the code would look like.

```
Question: You cancel while set_tempo is running, and create_track has not started. What should happen to the two tools?

1. Finish the running one, skip the rest (Recommended)
   set_tempo finishes and its real result is kept. create_track never starts and is marked as cancelled.
2. Drop both
   Simplest, but the tempo may have changed with no record of it.
```

## Boundaries

A pnpm workspace with no build step: packages export their `.ts` source. Each package's README says what it holds. Who may import whom:

- `@mentor/harness` imports no other package, and knows nothing about music or any tool set.
- `@mentor/tools` imports only the harness.
- `@mentor/mentor` is the only place the harness and the tool sets meet.
- An app in `apps/` imports only `@mentor/mentor`.
- `@mentor/evals` imports `@mentor/mentor` and `@mentor/tools`, because it plants and reads the Live Set itself.

A package imports another by name, and only when it lists it as a dependency; `pnpm check` fails on anything else, including a relative path into another package.

## Tool sets

A tool whose answer grows with its source, such as one that reads the whole Live Set, keeps that answer under the result limit of 40,000 characters itself (ADR 0018). It answers short by default and takes arguments for more. The harness cuts anything past the limit, but only as a safety net.

Before adding a tool or a tool set, read "Adding a tool" in `packages/tools/README.md`.

## Constraints

- A dependency is allowed when it saves real code that would teach nothing (ADR 0021). Raise it with the maintainer first, and say in the pull request what it buys. The agent loop, the message format, summarising and retry stay hand-written.
- `pnpm check` passes before every commit.
- API keys and any other sensitive values live in a `.env` file inside each app (`apps/cli/.env`), which is not committed. Keep their values out of output, logs, tests and commits.
- When a change adds, removes or replaces something a user can do, or starts or finishes an item under Planned, update the What it does today and Planned sections of `docs/features.md` in the same commit. Touch `README.md` only when the change alters its short lists (What it can do, What it can't do yet, Roadmap) or its quick start.

## Testing

There are three kinds of test. Choose by what could be wrong: our code, our reading of a provider's responses, or the model's behaviour.

### Offline tests: is our code right?

- They run with no network. A scripted model stands in for the model, and adapter tests replace `fetch`.
- Assert on what a caller can see: the messages returned, the stop reason, the request that was sent.
- One runs the Remote Script's dispatch, so `pnpm test` needs `python3`.

### Recorded replies: do we read real responses correctly?

- When a provider sends a response our code handled wrongly, save that real response as the test's input, in place of one written by hand.
- Remove keys and personal data before saving it.

### Evals: does the model behave, given our prompt and tools?

- Use them for anything the model decides: which tool it picks, whether it follows the system prompt. A scripted model cannot test these, because it does what the script says.
- They call the real API, so a commit never depends on them.
- Before running, writing or reporting one, read `evals/README.md`. Report every series as runs passed out of runs made.
- A behaviour no case covers yet is checked with a throwaway script outside the repo, and reported as observed, with the number of runs.

## Before changing a design

`docs/adr/` records why the loop, the message format and the provider interface are shaped as they are. Read the records that touch what you are about to change, and write a new one when a decision replaces an old one. Use the terms in `GLOSSARY.md` in code, tests and commit messages.

`docs/reference.md` lists other harnesses to read for ideas when designing a harness feature.

## Agent skills

- Issues: GitHub Issues for `amitbaz/music-production-ai-mentor`, via `gh`. See `docs/agents/issue-tracker.md`.
- Triage labels: the default five. See `docs/agents/triage-labels.md`.
- Domain docs: one `GLOSSARY.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.
