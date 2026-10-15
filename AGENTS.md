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

The repo is a pnpm workspace. Packages export their `.ts` source; there is no build step.

- `packages/harness/` is `@mentor/harness` and depends on no other package. It knows about messages, tools and providers, and nothing about music or any tool set.
- `packages/tools/` is `@mentor/tools` and holds the tool sets, as `src/<kind>/<name>/`, each with its own entry such as `@mentor/tools/daws/ableton`. It depends only on the harness.
- `packages/mentor/` is `@mentor/mentor`, the product: the system prompt, the model and the tool sets, joined by `createMentor`. It is the only place the harness and the tool sets meet.
- `apps/` holds the apps. `apps/cli/` is the terminal. An app depends only on `@mentor/mentor` and owns what the user sees.

A package can import another only by name, and only when it lists it as a dependency. `pnpm check` fails on an import that breaks this, including a relative path into another package.

## Tool sets

A tool set is a group of tools for one outside source. Each kind of source has a folder under `packages/tools/src/` and a heading below.

A tool whose answer grows with its source, such as one that reads the whole Live Set, keeps that answer under the result limit of 40,000 characters itself (ADR 0018). It answers short by default and takes arguments for more. The harness cuts anything past the limit, but only as a safety net.

### Supported DAWs (`packages/tools/src/daws/`)

- **Ableton Live**, in `ableton/`. Its tools reach the Live Set open in Live through the ableton-js Remote Script.
  - `ableton.ts` makes the client and lists the tools; `ableton.test.ts` tests what belongs to the whole tool set (the connection, object ids, batching) through a tool.
  - `client.ts` is the connection to the Remote Script; `live.ts` holds what Live sends back; `stand-in-live.ts` is the stand-in WebSocket the tests use.
  - `remote-script.ts` installs and removes the Remote Script; the pinned ableton-js copy it installs lives outside `src`, in `packages/tools/remote-scripts/ableton-js/`.
  - `tools/index.ts` exports every tool, for `ableton.ts` to import in one line.
  - Each tool has one file and its test under `tools/`, in the folder of its group from ADR 0013: `reads/`, `changes/`, `removals/` or `general/`. The file exports a function that takes the client and returns the tool.

## Constraints

- The project has no runtime dependencies, and provider adapters call the HTTP API with `fetch`. Raise a new dependency with the maintainer as a decision.
- `pnpm check` runs the type check, the linter and the tests in every package. It passes before every commit.
- API keys and any other sensitive values live in a `.env` file inside each app (`apps/cli/.env`), which is not committed. Keep their values out of output, logs, tests and commits.
- When a change adds, removes or replaces something a user can do, or starts or finishes an item under Planned, update the Status, What it does today and Planned sections of `README.md` in the same commit.

## Testing

There are three kinds of test. Choose by what could be wrong: our code, our reading of a provider's responses, or the model's behaviour.

### Offline tests: is our code right?

- Write them first, and see them fail, before the implementation.
- They run with no network. A scripted model stands in for the model, and adapter tests replace `fetch`.
- Assert on what a caller can see: the messages returned, the stop reason, the request that was sent.
- `pnpm test` runs all of them.

### Recorded replies: do we read real responses correctly?

- When a provider sends a response our code handled wrongly, save that real response as the test's input, in place of one written by hand.
- Remove keys and personal data before saving it.

### Evals: does the model behave, given our prompt and tools?

- Use them for anything the model decides: which tool it picks, whether it follows the system prompt. A scripted model cannot test these, because it does what the script says.
- They call the real API, so they run on demand, apart from `pnpm test`, and a commit never depends on them.
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
