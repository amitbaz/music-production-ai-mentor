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

- `src/agent/` is the harness and imports only from itself. It knows about messages, tools and providers, and nothing about music or any tool set.
- `src/tools/` holds the tool sets, as `src/tools/<kind>/<name>/`. They import only from `src/agent/`.
- `src/cli.ts` and `src/system-prompt.ts` are the product, the only place the harness and the tool sets meet.

## Tool sets

A tool set is a group of tools for one outside source. Each kind of source has a folder under `src/tools/` and a heading below.

### Supported DAWs (`src/tools/daws/`)

- **Ableton Live**, in `ableton/`. Its tools act on an in-memory fake until the connection to the real application exists.

## Constraints

- The project has no runtime dependencies, and provider adapters call the HTTP API with `fetch`. Raise a new dependency with the maintainer as a decision.
- `npm run check` runs the type check, the linter and the tests. It passes before every commit.
- API keys and any other sensitive values live in `.env`, which is not committed. Keep their values out of output, logs, tests and commits.

## Testing

There are three kinds of test. Choose by what could be wrong: our code, our reading of a provider's responses, or the model's behaviour.

### Offline tests: is our code right?

- Write them first, and see them fail, before the implementation.
- They run with no network. A scripted provider stands in for the model, and adapter tests replace `fetch`.
- Assert on what a caller can see: the messages returned, the stop reason, the request that was sent.
- `npm test` runs all of them.

### Recorded replies: do we read real responses correctly?

- When a provider sends a response our code handled wrongly, save that real response as the test's input, in place of one written by hand.
- Remove keys and personal data before saving it.

### Evals: does the model behave, given our prompt and tools?

- Use them for anything the model decides: which tool it picks, whether it follows the system prompt. A scripted provider cannot test these, because it does what the script says.
- They call the real API, so they run on demand, apart from `npm test`, and a commit never depends on them.
- Each case states a request and an expectation that can be checked in the conversation, such as which tools were called and in what order.
- Run each case several times and report how many passed. One passing run proves little, because the model varies.
- There is no eval runner yet. Until there is, check model behaviour with a throwaway script outside the repo, and report what you saw as observed, with the number of runs.

## Before changing a design

`docs/adr/` records why the loop, the message format and the provider interface are shaped as they are. Read the records that touch what you are about to change, and write a new one when a decision replaces an old one. Use the terms in `GLOSSARY.md` in code, tests and commit messages.

`docs/reference.md` lists other harnesses to read for ideas when designing a harness feature. The harness itself stays hand-written.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `amitbaz/music-production-ai-mentor`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
