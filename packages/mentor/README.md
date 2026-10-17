# @mentor/mentor

The product: the mentor's system prompt, its default model and its tool sets, joined into one agent by `createMentor`. It is the only place the [harness](../harness/README.md) and the [tool sets](../tools/README.md) meet, so every app gets the same mentor.

> [!NOTE]
> This is a private workspace package of [Music Production AI Mentor](../../README.md). It is not published to npm, and it exports its `.ts` source with no build step. An app depends on this package only.

## Usage

```ts
import { connectKnowledgeBase, createMentor, keysFromEnv } from "@mentor/mentor";

const mentor = createMentor({
    keys: keysFromEnv(process.env),          // GEMINI_API_KEY, ANTHROPIC_API_KEY
    model: "claude:claude-haiku-5-5",         // optional; MODEL_ID when left out
    abletonAddress: process.env.ABLETON_ADDRESS,
    abletonPassword: process.env.ABLETON_PASSWORD,
    // optional; starts the server in the background, and the first turn waits for it
    knowledgeBase: process.env.KB_PATH ? connectKnowledgeBase(process.env.KB_PATH) : undefined,
});

const result = await mentor.generate([], "Why does my kick sound weak?", {
    approve: (call) => call.name === "delete", // asked before delete and live_change; false refuses
});
```

`mentor.generate` is the harness's turn: the caller keeps the conversation and gets back the new one with a stop reason. See the [harness README](../harness/README.md#how-a-turn-ends) for the stop reasons and turn options.

## What it exports

| Export | What it is |
|---|---|
| `createMentor(options)` | The mentor agent. Takes `keys` and `model`, or a ready `Model` for tests, plus the Live address and password, and optionally a knowledge base connection. |
| `connectKnowledgeBase(clone)` | Starts the knowledge base server in a mentor-kb clone. Its tools join the mentor's, and a section joins the system prompt. Close it when done. |
| `MODEL_ID` | The default model, `gemini:gemini-3.5-flash-lite`. |
| `keysFromEnv(env)` | Maps `GEMINI_API_KEY` and `ANTHROPIC_API_KEY` to the harness's `keys`. |
| `installRemoteScript`, `removeRemoteScript`, `remoteScriptsFolder`, `REMOTE_SCRIPT_NAME` | Pairing Ableton Live, passed through from the tool set. |
| `Message`, `LoopResult`, `ToolCall`, `RetryReport` | The harness types an app needs, so it never imports the harness itself. |
| `Update`, `TurnOptions` | The harness's, plus two knowledge base updates: `knowledge_base_loading` when the first turn waits for it, and `knowledge_base_unavailable` with its reason when it can't be reached. |

## The system prompt

[`src/system-prompt.ts`](src/system-prompt.ts) tells the model how to work in Live:

- Tell explaining from acting by how the user asks.
- Read before changing anything, and name objects by the ids of the latest read.
- After a change, give each one as `before → after`, such as `Kick / Volume: 0.0 dB → -3.0 dB`, then say why.
- For what the tools cannot do, give the user the exact steps.
- Say it cannot hear the audio, rather than claim to.

With a knowledge base, a short section is added: search it before advising on a mix, an arrangement or a sound, and say so when it has nothing.

Whether a model follows these rules is not something a unit test can show. That is measured by the [evals](../../evals/README.md), on every supported model.

## Development

```sh
pnpm --filter @mentor/mentor check   # type check, lint and the offline tests
```

## Why it's shaped this way

- [0008](../../docs/adr/0008-the-system-prompt-is-not-part-of-the-conversation.md) the system prompt is not part of the conversation
- [0011](../../docs/adr/0011-an-agent-is-created-from-a-model-id.md) an agent is created from a model id
- [0019](../../docs/adr/0019-only-supported-models-with-a-1m-window.md) only supported models with a 1M window
- [0022](../../docs/adr/0022-one-harness-and-the-user-brings-a-key.md) one harness, and the user brings a key
- [0026](../../docs/adr/0026-the-knowledge-base-is-an-optional-mcp-server.md) the knowledge base is an optional MCP server
