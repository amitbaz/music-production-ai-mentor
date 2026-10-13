# 0008 — The system prompt is passed to the loop and is not part of the conversation

Date: 2026-10-13 · Status: accepted

## Context

The model needs standing rules, such as checking the session before changing it and only claiming actions that a tool performed. Providers disagree on where such text goes: Gemini and Anthropic take it in a separate field, OpenAI takes it as the first message.

## Decision

- The caller passes the system prompt to `runAgentLoop` as an option. The loop hands it to the provider on every model call, and each adapter puts it where its provider expects it.
- The conversation keeps its four kinds of message. The system prompt is never stored in it.
- The prompt text describes the mentor, which is the product, so it lives outside both `src/agent/` (the harness) and `src/tools/` (the tool sets), in `src/system-prompt.ts`.

Rejected:

- A fifth kind of message at the top of the conversation: the prompt is configuration for the next call, not a record of something said. Trimming old messages would have to know to skip it, and a saved conversation would keep an outdated prompt.
- Giving the prompt to the provider when it is created: it would tie a product decision to a provider, and it could not change between turns.

## Consequences

- The prompt can be rebuilt for each turn, for example to include the date or the open project.
- Saving a conversation does not save the prompt; a loaded conversation runs with the current one.
- `Provider.generate` takes its optional extras (system prompt, cancel signal) as one options object.
