# Evals

The evals check whether the mentor, with the prompt and tools it has, fixes a fault planted on a base Set. A **base Set** is a finished Live Set that sounds right. A **plant** is a fault applied to it, such as the sub bass turned up 6 dB. A **case** is a plant plus what the user says about it. A run passes when the Set read back after the mentor's turn equals the base ([ADR 0020](../docs/adr/0020-evals-grade-the-set-against-its-base.md)).

The evals call the real model, so they run on demand and cost API credit. `pnpm test` never runs them.

## Before you run

- Ableton Live 12 Suite, 12.4 or newer, paired with the mentor (`pnpm pair ableton`, see the [quick start](../README.md#quick-start)).
- The base Set open in Live: [*Patience*](sets/patience/README.md#where-it-is), Ableton's demo song. Never save over it.
- A key in `apps/cli/.env` for each model you run on: `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`. The eval scripts read that file.

## Running

Run from the repo root:

```sh
pnpm plant                                   # lists the plants
pnpm plant <name> [--revert]                 # applies or reverts one on the Set open in Live, without saving
pnpm eval                                    # lists the cases
pnpm eval <case> [--runs 30] [--model provider:model]
```

`pnpm eval` runs the case 30 times by default, on the mentor's default model unless `--model` names another. Each run plants the fault, gives the mentor one turn, reads the Set back, grades it against the base and restores it:

```text
run 1: fail (1 differences, stop finished)
run 2: pass
...
low-end-hot-told on claude:claude-haiku-5-5: 0/30 passed. Runs in ~/.mentor/evals/runs/<date>-low-end-hot-told
```

Every run is saved in full under `~/.mentor/evals/runs/`, outside the repo: the conversation, the verdict, and how the Set differed from its base. If a run leaves the Set in a state the runner cannot undo, the series stops and says what still differs; reopen *Patience* without saving.

## Don't know what to do? Run the loop

```text
1. Take the case with the lowest score in scores.md, skipping any marked "out of the loop".
   No cases? Write one: a plant in sets/<set>/plants.ts and what the user says in sets/<set>/cases.ts.
2. Run it 10 times. Read every failing run under ~/.mentor/evals/runs/.
3. Change ONE thing, cheapest first: system prompt → a tool's description → a tool's shape → a new tool.
4. Run it 30 times, on every model in the panel. Add a line per model to scores.md.
5. Score up on the panel, and no other case down? Keep the change. Otherwise revert it.
6. Back to 1.
```

10 runs is a look: 0/10 says "broken" clearly. 30 runs is a decision: 6/10 against 8/10 can be luck, 18/30 against 24/30 mostly isn't.

## The panel

The user brings the model ([ADR 0022](../docs/adr/0022-one-harness-and-the-user-brings-a-key.md)), so a case runs on every supported model, not one. Today the panel is:

- `gemini:gemini-3.5-flash-lite` (the default)
- `claude:claude-haiku-5-5`

The supported models are listed in each provider adapter under [`packages/harness/src/providers/`](../packages/harness/src/providers/). Read the scores as a matrix:

- Low on all models → a product problem: prompt, tool or knowledge. Fix it.
- Low on one model → a model problem. Don't fix it; the line in `scores.md` records it.
- A change is kept when it lifts the panel, never for one model.

## Judgment plants

A plant with one right fix, such as a muted track, passes when its values are back at the base. A judgment plant, such as a level, passes within a range around the base, and the range comes from how far apart good engineers set the same element ([ADR 0024](../docs/adr/0024-a-judgment-plant-passes-within-a-range.md)). A judgment case with no range yet is marked "out of the loop" in `scores.md`: its score is a baseline, not something to tune toward.

## scores.md

[`scores.md`](scores.md) has one line per case, per model, per series. It is the only score the repo keeps; the runs themselves stay outside it. It is internal: nothing in the README says which models score what. When the log gets too long to read the latest score per case and model at a glance, a small matrix goes at its top, kept by hand.

## Layout

```text
evals/
├── src/           # the runner: plant, snapshot, grade, restore
├── sets/
│   └── patience/  # the first base Set: its README, plants.ts and cases.ts
└── scores.md
```
