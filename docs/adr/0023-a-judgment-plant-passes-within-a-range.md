# 0023 — A judgment plant passes within a range

Date: 2026-10-16 · Status: accepted · Amends 0020

## Context

ADR 0020 passes a run when the Live Set reads back equal to its base. The first case, `low-end-hot-told`, plants Sub Sub Bass at +5 dB where the base has -1 dB. In all ten runs the mentor read the Set, set the fader to -6 dB and said only that it "sits better in the mix". Nothing in the system prompt names a level. The model chose a round number from habit and compared the sub with nothing. Score 0/10 (#77, #79).

Some plants have one fix: a muted track is fixed by making it audible, and that can be checked exactly. Others need judgment: how loud the sub should be. A producer decides that by listening to the balance, against the standard of the genre, and then by taste. Taste cannot be guessed. The genre's standard can be learned from knowledge and references, and good engineers in a genre converge on it. Requiring the base value exactly would fail a mentor that hears well and lands at -1.5 dB.

## Decision

- A plant with one fix keeps ADR 0020's grade: the planted values back at their before values.
- A judgment plant, such as a level, passes when each planted value lands within a range around its before value. The rest of the Set must still equal the base.
- The width of a range comes from evidence: how far apart skilled engineers set the same element when they mix the same song in the same genre (#83; the evidence and proposed ranges are in `docs/research/how-far-apart-good-mixes-set-one-element.md`). It is not set by anyone's ear, since that would put one person's taste in the answer key.
- A judgment case with no range yet stays out of the evals loop. Its score is kept as a baseline, so listening and knowledge can later show what they add.

Rejected:

- Exact grading for every plant: simple, but a level case could never pass, even for a mentor that hears.
- A range set per plant by the maintainer's ear: quick, but it is taste.
- A third grade such as "right control, wrong amount": the saved run already shows the difference, and two numbers per case are harder to read than one.

## Consequences

- A plant change gains an optional range, added to the runner when the research gives numbers.
- `low-end-hot-told` leaves the loop until then. The next case to drive the loop is one with one fix.
- Landing in the range needs listening and the genre's standard, which belong to the listening map (#50) and the knowledge base. Until both exist, judgment cases are expected to score low.
