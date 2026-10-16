# Contributing

The mentor is built in the open, mostly by coding agents working under the rules in [`AGENTS.md`](AGENTS.md). This page is for anyone who wants to read the code or work on it.

## Run the checks

```sh
pnpm install
pnpm check   # type check, linter and tests in every package
```

The tests need no network and no API key. `pnpm check` passes before every commit.

## How it's put together

A pnpm workspace. Packages export their TypeScript source; there is no build step.

| Path | What it holds |
|---|---|
| [`packages/harness/`](packages/harness/README.md) | The agent loop, the message format, tools, and the provider adapters. Knows nothing about music. |
| [`packages/tools/`](packages/tools/README.md) | Tool sets, one per outside source, such as `src/daws/ableton/`. |
| [`packages/mentor/`](packages/mentor/README.md) | The product: the system prompt, the model and the tool sets, joined by `createMentor`. The only place the harness and the tool sets meet. |
| [`apps/cli/`](apps/cli/README.md) | The terminal app. Owns what the user sees and keeps the conversation. |
| [`evals/`](evals/README.md) | The evals: base Live Sets, the faults planted on them, and the runner (`pnpm eval <case>`). |

The harness is written by hand on purpose, to keep every request, reply and stop reason in view, and it is the only thing the mentor runs on: the user brings an API key for the model they pick ([ADR 0022](docs/adr/0022-one-harness-and-the-user-brings-a-key.md)). A dependency is taken when it saves real code that would teach nothing ([ADR 0021](docs/adr/0021-a-dependency-is-allowed-when-it-saves-real-code.md)). [`docs/reference.md`](docs/reference.md) lists the harnesses read for ideas along the way.

## How it's made

Each feature goes through the same steps:

1. Open questions are researched against primary sources, and the findings are kept in [`docs/research/`](docs/research/).
2. Each design question is settled with the maintainer and recorded in [`docs/adr/`](docs/adr/), with new terms added to [`GLOSSARY.md`](GLOSSARY.md).
3. The work is written up as a spec issue and split into issues marked `ready-for-agent`.
4. An agent builds each issue test-first, under the rules in [`AGENTS.md`](AGENTS.md).

## Reading the project

1. [`GLOSSARY.md`](GLOSSARY.md): the words used in the code, the tests and the docs.
2. [`docs/adr/`](docs/adr/): one record per decision, in order. Each says what was chosen, what else was considered and why. Records that were replaced stay, marked as superseded.
3. [`docs/research/`](docs/research/): the notes written before a decision, with their sources, the versions checked, and which facts are verified and which are not.
4. The code, from the inside out: `packages/harness` → `packages/tools` → `packages/mentor` → `apps/cli`.
5. [`AGENTS.md`](AGENTS.md): the working rules: package boundaries, test-first, and the three kinds of test.

Some trails from question to decision to work:

- **How a turn ends:** [ADR 0005](docs/adr/0005-the-loop-returns-a-result-and-never-throws.md) (the loop never throws) → [ADR 0006](docs/adr/0006-cancelling-a-turn.md) (cancelling) → [`agent-loop.ts`](packages/harness/src/agent-loop.ts).
- **How the mentor reaches Live:** [connecting to Ableton Live](docs/research/connecting-to-ableton-live.md) → [ADR 0012](docs/adr/0012-live-is-reached-through-the-ableton-js-remote-script.md) → [#2](https://github.com/amitbaz/music-production-ai-mentor/issues/2).
- **What the first real tool set covers:** [what Live lets a script do](docs/research/what-live-lets-a-script-do.md) and [reaching third-party plug-ins](docs/research/reaching-third-party-plug-ins.md) → [ADR 0013](docs/adr/0013-ableton-tools-are-a-short-named-list-plus-two-general-tools.md) and [ADR 0015](docs/adr/0015-the-first-real-ableton-tool-set-has-a-narrow-scope.md) → the issues split from [#2](https://github.com/amitbaz/music-production-ai-mentor/issues/2).
- **Hearing the audio:** [how the agent can hear Live](docs/research/hearing-live-audio-and-where-the-agent-runs.md), researched and left for later by [ADR 0015](docs/adr/0015-the-first-real-ableton-tool-set-has-a-narrow-scope.md).
