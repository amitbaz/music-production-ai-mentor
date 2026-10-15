# 0020 — Evals grade the Live Set against its base

Date: 2026-10-16 · Status: accepted

## Context

AGENTS.md says evals check what the model decides and run apart from `pnpm test`, and that until a runner exists, behaviour is checked with a throwaway script outside the repo. ADRs 0017 and 0018 each leave a choice open "until an eval" settles it. Patience is the first base Set (#65) and its plants are being written (#75). Before a runner is built, three things had to be chosen: what a run is graded on, who decides what counts as right, and where the runner lives.

- Mixing is partly taste. Two engineers can disagree on the right fix for a planted fault, and a fault can be fixed several ways: a sidechain, an EQ cut or a volume change can all end a kick and bass clash.
- The mentor's tools can read every parameter of every native device back from Live. They cannot hear, and none opens a Live Set file.
- An app may depend only on `@mentor/mentor` (0010). A runner that plants, snapshots and restores needs the Ableton tools directly, as well as `createMentor`.

## Decision

- A run passes when the Live Set is back to its base: the planted values are at their before values, and nothing else differs from the base anywhere in the Set. The runner reads the Set back through the tools and compares. It does not grade on which tools the mentor called, and no second model judges.
- The answer key is the base Set itself. A plant is a change to a Set a person mixed, so what counts as right is given by the plant's before values, not by anyone's opinion of the fix.
- A case is a plant and a user message, nothing more. Any case with an opinion of its own, such as "advice about the mix is good", is not written.
- The result of a case is a rate, how many of its runs passed. No case carries a pass threshold until a few cases have a history to set one from.
- Every run is kept in full, pass or fail: the conversation, the verdict, the model id and the difference from the base, in a folder git ignores. A failing run is read before anything is changed, to tell a prompt problem from a tool problem or a model problem.
- Between runs the runner restores the Set to the snapshot it took before planting: parameters put back, devices the mentor added removed, with the mentor's removal tools approved by the runner. It then reads the Set again, and stops the series if anything still differs, since some changes cannot be put back.
- The evals live in `evals/` at the repo root, as the workspace package `@mentor/evals`, next to the Sets they use. It depends on `@mentor/mentor` and `@mentor/tools`. It is a development package, not an app, and AGENTS.md says so.
- The model is chosen per run. `createMentor` takes an optional model id, defaulting to the one it uses today, so the same case can be run against another model, which is how a prompt problem is told from a model problem.

Rejected:

- Grading on tool calls. Cheap, and the harness already records them, but it ties a case to one fix and fails a mentor that found another valid one. A tool-call check remains allowed for a case about process, such as "it read the Set before changing it".
- A judge model. Needed for anything that is not visible in the Set, but it brings taste back through a model nobody prompted, and nothing in the first cases needs it.
- Pass thresholds per case. The rates to expect are unknown, so any number would be a guess.
- Ignoring changes the mentor made outside the plant. A mentor that fixes one thing and breaks three others would score the same as one that does not.
- Reopening the base Set by hand between runs. Always clean, but ten runs means ten reopens.
- A third-party eval framework. The hard part, planting, running the mentor and reading Live back, is ours either way; the framework would cover only the loop and the report, and the leading ones are Python. Run records are plain files so one can be added later.
- Putting the runner inside `packages/mentor`. No new package, but the Sets would stay at the root while the runner lived elsewhere, and the mentor package would grow a second purpose.

## Consequences

- A fault that cannot be seen in the Set, such as two sounds clashing with no device between them, cannot yet be graded. A case for it will score low, and that low score is the evidence for giving the mentor and the runner a way to measure audio.
- A run that changes anything the runner cannot restore, such as a deleted clip, stops the series and needs a reopen by hand.
- The runner depends on the plant script from #75, so #75 is finished first and the first case is whichever of its plants is a single parameter change, told to the mentor outright.
- The first time `createMentor` can be told a model is for the evals; the CLI keeps its default.
