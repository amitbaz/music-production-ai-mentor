# 0011 — An agent is created from a model id

Date: 2026-10-13 · Status: accepted

## Context

The product built its provider by hand: it imported the Gemini adapter, called its create function, wrapped the result with `withRetry` (ADR 0009) and passed it to `runAgentLoop` with the tools and the system prompt. A second provider would have meant a second import and a second call in every product, and a caller could forget the retry wrapper. Users will also hold different keys, some Gemini and some Anthropic, so the model has to become a value that can be chosen and not a line of code.

## Decision

- The harness has one public way to run the agent loop: `createAgent({ model, keys, tools, system, onRetry })`. It returns an agent with one method, `generate(conversation, text, options)`, which runs one turn and returns the same result as the loop (ADR 0005).
- `model` is a model id, a string written `provider:model` and split on the first colon, such as `gemini:gemini-3.5-flash-lite`. The part after the colon is sent to the provider untouched.
- The provider lookup is an inner part of the harness: a fixed table from provider name to provider adapter. Gemini is its only entry today.
- The caller passes `keys`, one API key per provider name. The harness never reads the environment.
- The lookup wraps the adapter with retry. This replaces the part of ADR 0009 that left the wrapping to the product. `withRetry` is unchanged and is no longer exported, and the package entry `@mentor/harness/providers/gemini` is removed.
- `createAgent` never throws. An unknown provider, a model id with no colon or a missing key fails the first model call, so the first turn ends with stop reason `"error"`. It is not retried.
- The object the loop calls is a model, and its method is `call`: one model call. The type `Provider` is renamed `Model`. `generate` now names what an agent does, a whole turn.
- `model` also accepts a ready model in place of a model id. Tests pass a scripted model this way; it gets no retry.
- `system` is a string, or a function that returns one and is called at the start of each turn. This keeps the reason in ADR 0008: the prompt can be rebuilt for each turn.
- The agent keeps nothing between turns. The conversation is passed in and the new one is returned.
- `createMentor` is `createAgent` with the mentor's model id, tools and system prompt filled in. The model id is a constant in the mentor package.

Rejected:

- A public lookup function that returns a model, with the loop called separately: two things to join in every product, and the product could still skip retry.
- A bare model name with the provider guessed from how it starts: the lookup would hold a table of name patterns, and some names do not start with their provider.
- The lookup reading the environment for keys: it hides where keys come from and fails in an app with no environment.
- A lookup class holding the keys: it has no state of its own and one method.
- Failing when the agent is created: every app would have to handle a throwing `createMentor`. The cost of the choice made is listed below.
- A scripted model as an entry in the lookup: canned replies do not fit in a string, so tests would have to register them and the table would change while the program runs.
- The agent holding the conversation: two apps each have their own agent, so it would not give them a shared memory, and saving and loading would be harder.

## Consequences

- A wrong model id or a missing key is only seen after the user sends a first message, and it reads like a failed model call.
- Adding a provider is one adapter file and one line in the lookup's table.
- Nothing outside the harness can use an adapter without the lookup, or the loop without an agent.
- Letting the user choose the model is a matter of passing a different string. A switch happens between turns, by creating a new agent and giving it the same conversation.
- Provider meta does not say which provider wrote it. With one provider this does not matter. Before a second adapter exists it needs an owner tag, so that an adapter ignores extras it did not write, and tool call ids made by one provider must be checked against the rules of the other.
- Sharing a conversation between apps needs a store that both can read. The mentor would own it. It is not built; the agent passing the conversation in and out is what it will plug into.
