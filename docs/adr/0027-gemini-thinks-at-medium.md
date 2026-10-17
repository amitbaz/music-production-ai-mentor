# 0027 — Gemini thinks at medium

Date: 2026-10-18 · Status: accepted

## Context

ADR 0023 left each model's thinking at its default: "the user picks the model, not its knobs; a knob can join the model id later if a score asks for it." Claude's default is adaptive thinking. Gemini 3.5 Flash-Lite's default is `minimal`, which Google describes as matching "no thinking" for most queries.

A score asked. On `kick-bass-fight-told` with mentor-kb 574a4fa (#126), Haiku passed 9/10 and Gemini 0/10. Gemini read the sub's clip in 4 runs of 10 and never tried the fix the note gives. With `thinkingLevel: "medium"` and nothing else changed, it read the clip in 9 runs and tried the fix in 4. The fix needs several steps of reasoning: the written note, plus every transpose, times the oscillator ratio, gives a frequency to compare with 60 Hz.

## Decision

- Every Gemini request sends `generationConfig.thinkingConfig.thinkingLevel: "medium"`, the summary request included. Google recommends `medium` for agent work, and it is the default of the larger Gemini models.
- The level is set by the adapter, not by the user, as Claude's adaptive thinking is.

Rejected:

- `high`: maximum reasoning depth, slower to the first word on every turn, and no score asks for it yet.
- A thinking setting the user picks: one more choice to explain for a single model, against ADR 0023's "the user picks the model, not its knobs".
- Medium for tool rounds only, and the default for the summary: two settings to keep apart for a request that is rare.

## Consequences

- Gemini turns take longer and cost more, for thinking tokens.
- A Gemini model added later must support `medium`, or the adapter sets its level per model.
