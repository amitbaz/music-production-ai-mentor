# 0017 — Read results are compact JSON for now

Date: 2026-10-14 · Status: accepted · Replaces the format of read results in [0013](0013-ableton-tools-are-a-short-named-list-plus-two-general-tools.md)

## Context

ADR 0013 said read results are compact text, without saying which text or why. Building `read_set` (#4) needed a choice. The mentor runs on Gemini by default, and users will later pick their own model from Gemini or Anthropic, so the format has to suit every model, small ones most of all. Research note: `docs/research/tool-result-formats.md`.

- Published tests disagree on which format models read best, and none used our models or data shaped like `read_set`.
- On a 53-track sample, one line per track costs about half the tokens of minified JSON; TOON costs a little more than minified JSON, because each track holds a list of devices; YAML costs more still.
- No provider names a best format. Gemini sends a tool result as a string inside a JSON object, whatever the string holds.

## Decision

- Read results are minified JSON of our own shape, not Live's raw replies. A field that is false or empty is left out.
- The format is chosen for now. An eval that compares formats across the models a user can pick (#16) decides whether it stays.

Rejected for now:

- One line per track, in a format of our own: half the tokens, but every model must learn it from the tool description, and no test has shown that small models read it well.
- YAML: read best on nested data in one third-party test on Gemini 2.5 Flash Lite, but about a quarter more tokens than minified JSON.
- TOON: saves tokens only on lists of records with the same flat fields, which `read_set` is not.

## Consequences

- An overview costs more tokens than it could: about 4,500 for the 53-track sample, against about 2,800 for one line per track.
- Changing the format later changes only how each read builds its result and the tests that check it.
