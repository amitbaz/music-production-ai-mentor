# Music production AI mentor

An AI mentor for music producers. You talk to it in plain language: it explains when you ask how or why, and it acts in your DAW when you ask it to do something, then says what it did and why. It runs on its own provider-agnostic agent harness, written in TypeScript.

## Status

Early. The mentor runs in the terminal on Gemini. Its Ableton tools act on an in-memory fake of Live, so nothing touches a real Live Set yet. The connection to the real Ableton Live is designed ([ADRs 0012–0015](docs/adr/)) and is the next step.

## What it does today

- Talk to the mentor in the terminal, with its reply shown as it is written.
- It tells explaining from acting by how you ask, and looks at the current state before changing anything.
- Ableton tools, acting on the fake Ableton: `get_session`, `set_tempo`, `create_track`, `delete_track`.
- `delete_track` asks for your approval before it runs. A refusal is passed back to the mentor, and the turn goes on.
- Ctrl+C cancels a turn. What already happened stays in the conversation.
- A failed model call is retried after a growing wait, and an attempt that hangs is timed out.

## Planned

- **The real Ableton Live** ([#2](https://github.com/amitbaz/music-production-ai-mentor/issues/2)): read the Live Set and change tracks, native devices, clips and the arrangement, through a Remote Script.
- **Load a tool set only when the mentor needs it** ([#1](https://github.com/amitbaz/music-production-ai-mentor/issues/1)).
- **Evals** for what the model decides: which tool it picks, and whether it follows the system prompt.
- **Run tools in parallel**: when the model asks for several tools in one reply, run them at the same time instead of one after another.
- **Third-party plug-ins in Ableton**: read and change the settings of plug-ins that are not native devices. Left out of the first tool set by [ADR 0015](docs/adr/0015-the-first-real-ableton-tool-set-has-a-narrow-scope.md); see [reaching third-party plug-ins](docs/research/reaching-third-party-plug-ins.md).
- **A desktop app**, next to the terminal one.
- **Listening**: let the mentor hear your mix, so its advice is based on the sound and not only on the settings. See [how the agent can hear Live](docs/research/hearing-live-audio-and-where-the-agent-runs.md).
- **Stems and sound analysis**: tools that split a track into stems and measure the sound, such as loudness, frequency balance and dynamics.

## Quick start

You need Node 22.18 or newer, pnpm, and a Gemini API key (free from [Google AI Studio](https://aistudio.google.com/apikey)).

```sh
git clone https://github.com/amitbaz/music-production-ai-mentor.git
cd music-production-ai-mentor
pnpm install
cp apps/cli/.env.example apps/cli/.env   # then set GEMINI_API_KEY in it
pnpm start
```

`pnpm check` runs the type check, the linter and the tests in every package. The tests need no network and no key.

## How it's put together

A pnpm workspace. Packages export their TypeScript source; there is no build step.

| Path | What it holds |
|---|---|
| `packages/harness/` | The agent loop, the message format, tools, and the provider adapters. Knows nothing about music. |
| `packages/tools/` | Tool sets, one per outside source, such as `src/daws/ableton/`. |
| `packages/mentor/` | The product: the system prompt, the model and the tool sets, joined by `createMentor`. The only place the harness and the tool sets meet. |
| `apps/cli/` | The terminal app. Owns what the user sees and keeps the conversation. |

The harness is written by hand on purpose, to keep every request, reply and stop reason in view. The project has no runtime dependencies: provider adapters call the HTTP API with `fetch`. [`docs/reference.md`](docs/reference.md) lists the harnesses read for ideas along the way.

## How it's made

The code is written by coding agents. Each feature goes through the same steps:

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

## License

[MIT](LICENSE)
