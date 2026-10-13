# Glossary

- **Agent loop** — the cycle at the centre of the harness: send the conversation to the model; if the reply asks for tool calls, run them, append the results, and send again; stop when the model replies with text only (or the round limit is hit).
- **Harness** — everything around the model that makes it an agent: the agent loop, the tools, the conversation, and the provider adapters.
- **Conversation** — the ordered list of messages the harness keeps and re-sends in full on every model call. The model has no memory; the conversation is the memory.
- **Message** — one entry in the conversation, in our own neutral format. Four kinds: user text, assistant text, tool call, tool result.
- **Provider meta** — an optional slot on a model-produced message where a provider adapter stores provider-specific values (e.g. Gemini's `thoughtSignature`). The agent loop carries it without reading it.
- **Provider** — a company's model API (Gemini, Anthropic, …).
- **Provider adapter** — the one module that knows a provider's HTTP API. It translates the conversation into that provider's request and the reply back. The agent loop never sees provider-specific shapes.
- **Scripted provider** — a fake provider adapter that returns canned replies, used to test the agent loop without a network.
- **Tool** — a named function the model can ask the harness to run, described to the model by a name, a description and an argument schema.
- **Tool call** — the model's request to run a tool with given arguments.
- **Tool result** — what the harness sends back after running a tool call, including errors.
- **Fake Ableton** — an in-memory stand-in for Ableton Live (tempo and named tracks) that the tools act on until the real bridge exists. Resets on every run.
- **Round** — one model call plus the tool calls it triggers. The agent loop is capped at 10 rounds per turn.
- **Turn** — everything the agent loop does in answer to one user message: one or more rounds, ending with a stop reason.
- **Stop reason** — why a turn ended: the model finished, the model replied with nothing, the round limit was hit, a model call failed, or the user cancelled. It is reported next to the conversation, never as a message inside it.
- **Cancel** — the user stopping a turn before it ends. What already happened stays in the conversation; a tool that is running finishes, and tool calls that had not started get a tool result saying so.
- **Approval** — the user's yes or no to one tool call, asked before it runs. Only tools marked as needing approval are asked about. A refusal becomes the tool result, and the turn continues.
