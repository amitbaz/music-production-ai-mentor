# 0019 — Only supported models run, each with a context window of at least 1,000,000 tokens

Date: 2026-10-15 · Status: accepted · Narrows [0011](0011-an-agent-is-created-from-a-model-id.md), which sent any model name to its provider

## Context

Users will pick their model from more than one provider, and context windows differ: current Gemini and Anthropic models take about 1,000,000 tokens, older or smaller ones 128,000 to 200,000. Summarising ([0018](0018-a-long-conversation-is-summarised.md)) starts at a fixed size chosen for cost and answer quality. That only works if no model's window is smaller than the size a conversation can reach before and during a turn. Knowing each model's window at run time would mean a lookup per provider, and OpenAI has no API that returns it.

## Decision

- The harness keeps a fixed list of supported models, one list per provider adapter, next to the provider lookup.
- Every model on the list has a context window of at least 1,000,000 tokens. Each entry holds its window and a link to the provider's documentation page that states it. An offline test fails if any entry is under 1,000,000.
- A model id not on the list fails the first model call, the same way an unknown provider does. It is not retried.
- The harness never asks a provider for a model's window while it runs.

Rejected:

- Any model a provider serves, with summarising placed at the smaller of the threshold and the window: needs every model's window, from a lookup or a hand-kept table, for models nobody has tried with the mentor.
- Saving each provider's model-info reply in the repo as proof: stronger evidence, but a file per model, and OpenAI has no such reply.
- Asking the provider at run time: an extra request each session and a new way to fail.

## Consequences

- Adding a model means checking its documentation page, adding one entry, and the test passing.
- A user can't try a model that isn't on the list, even one that would work.
- The window number is typed by hand from the documentation, so the test checks what was typed, not the provider.
- With a 1,000,000 floor and a 100,000 threshold, a "conversation too long" error should not happen, so the harness has no special handling for it.
