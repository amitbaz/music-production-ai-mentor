# Evals

The evals say whether Mentor, with the prompt and tools it has, fixes what is planted on a base Set (ADR 0020). They run the real model, on demand, apart from `pnpm test`.

## Don't know what to do? Run the loop

```
1. Take the case with the lowest score, skipping any marked "out of the loop" in scores.md. No cases? Write one: a plant and what the user says.
2. Run it 10 times. Read every failing run under ~/.mentor/evals/runs/.
3. Change ONE thing, cheapest first: system prompt → a tool's description → a tool's shape → a new tool.
4. Run it 30 times, on every model in the panel. Add a line per model to scores.md.
5. Score up on the panel, and no other case down? Keep the change. Otherwise revert it.
6. Back to 1.
```

10 runs is a look: 0/10 says "broken" clearly. 30 runs is a decision: 6/10 against 8/10 can be luck, 18/30 against 24/30 mostly isn't.

## The panel

The user brings the model (ADR 0022), so a case runs on every supported model, not one. Read the matrix:

- Low on all models → a product problem: prompt, tool or knowledge. Fix it.
- Low on one model → a model problem. Don't fix it; the line in `scores.md` records it.
- A change is kept when it lifts the panel, never for one model.

## Judgment plants

A plant with one fix, such as a muted track, passes when its values are back at the base. A judgment plant, such as a level, passes within a range around the base, and the range comes from how far apart good engineers set the same element (ADR 0023). A judgment case with no range yet is marked "out of the loop" in scores.md: its score is a baseline, not something to tune toward.

## scores.md

One line per case, per model, per series. It is the only score the repo keeps; the runs themselves stay outside it. It is internal: nothing in the README says which models score what. When the log gets too long to read the latest score per case and model at a glance, a small matrix goes at its top, kept by hand.

## Running

```
pnpm plant                                   # lists the plants
pnpm plant <name> [--revert]                 # applies or reverts one on the Set open in Live
pnpm eval                                    # lists the cases
pnpm eval <case> [--runs 30] [--model provider:model]
```

The base Sets and their plants are under `sets/`, each with its own README.
