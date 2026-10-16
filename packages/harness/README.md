# @mentor/harness

A small, hand-written agent loop in TypeScript: one model, one system prompt, a set of tools, and a turn that never throws. It knows nothing about music; the mentor builds on it.

> [!NOTE]
> This is a private workspace package of [Music Production AI Mentor](../../README.md). It is not published to npm, and it exports its `.ts` source with no build step.

## Features

- **Provider-agnostic.** One message format for every provider. A model id like `gemini:gemini-3.5-flash-lite` or `claude:claude-haiku-5-5` picks the adapter; a conversation can switch provider between turns.
- **No SDKs, no dependencies.** Each adapter talks to its provider's HTTP API through `fetch`.
- **Never throws.** Every turn ends with a result and a stop reason, including errors, refusals and cancels.
- **Tools that can ask first.** A tool marked `needsApproval` runs only after the caller says yes.
- **Retries and timeouts.** A model call that fails in a way worth retrying, such as a rate limit or a timeout, is tried again after a growing wait (5 retries and a 60 s timeout per attempt by default).
- **Streaming.** Assistant text can be reported as it arrives.
- **Long conversations.** Past 100,000 tokens, the older part is summarised by the model and only the summary is sent from then on.
- **Bounded tool results.** A result past 40,000 characters is cut, with a note to the model to ask for less.

## Usage

```ts
import { createAgent, type Tool } from "@mentor/harness";

const setTempo: Tool = {
    name: "set_tempo",
    description: "Sets the song's tempo in BPM.",
    params: { type: "object", properties: { bpm: { type: "number" } }, required: ["bpm"] },
    run: ({ bpm }) => `Tempo: 120 → ${bpm}`,
};

const agent = createAgent({
    model: "claude:claude-haiku-5-5",
    keys: { claude: process.env.ANTHROPIC_API_KEY },
    tools: [setTempo],
    system: "You are a music production mentor.",
});

const result = await agent.generate([], "Make it 124 BPM", {
    stream: true,
    onUpdate: (update) => {
        if (update.type === "text") process.stdout.write(update.text);
    },
});

if (result.stop === "error") console.error(result.error.message);
// result.messages is the whole conversation: pass it to the next generate() call.
```

The caller keeps the conversation. `generate(conversation, text, options)` adds the user's text, runs the turn, and returns the new conversation with a stop reason.

### Supported models

| Model id | Key |
|---|---|
| `gemini:gemini-3.5-flash-lite` | `keys.gemini` |
| `claude:claude-haiku-5-5` | `keys.claude` |

Only models with a context window of at least 1,000,000 tokens are supported ([ADR 0019](../../docs/adr/0019-only-supported-models-with-a-1m-window.md)). The list lives in each adapter under [`src/providers/`](src/providers/). An unknown model, a model id not written `provider:model`, or a missing key ends the first turn with `stop: "error"` and a plain message.

### How a turn ends

| `stop` | When |
|---|---|
| `finished` | The model answered without calling a tool. |
| `empty` | The model said nothing and called nothing. |
| `cut_off` | The reply hit the model's output limit. Its text is kept; its tool calls do not run. |
| `refused` | The model declined on safety grounds. Comes with `category` and `explanation`. |
| `cancelled` | The caller aborted through `signal`. What already happened is kept. |
| `round_limit` | The model kept calling tools past `maxRounds` (10 by default). |
| `error` | A model call failed after its retries. Comes with `error`. |

Every result also carries `conversationSize`, the tokens the next model call would send, as best the harness knows.

### Options

`createAgent` takes:

| Option | Default | What it does |
|---|---|---|
| `model` | required | A model id, or a ready `Model` (for tests). |
| `keys` | `{}` | One API key per provider name. |
| `tools` | required | The tools the model may call. |
| `system` | none | The system prompt, or a function called at the start of each turn. |
| `maxRounds` | `10` | Most model calls in one turn. |
| `resultLimit` | `40000` | Most characters one tool result may hold. |
| `maxRetries`, `timeoutMs`, `firstWaitMs`, `onRetry` | `5`, `60000`, `1000` | Retry and timeout for each model call. |

`generate` takes, per turn: `onUpdate`, `stream`, `signal` and `approve`. Without an `approve` function, a tool that needs approval is refused.

> [!TIP]
> To test code built on the harness, pass a scripted `Model` instead of a model id: an object whose `call` returns prepared replies. No network, no key. The harness's own tests work this way; see [`src/agent.test.ts`](src/agent.test.ts).

## Development

```sh
pnpm --filter @mentor/harness check   # type check, lint and the offline tests
```

The harness depends on no other package, and nothing in it may mention music or a tool set. The exports are in [`src/index.ts`](src/index.ts).

## Why it's shaped this way

Each design choice has a record in [`docs/adr/`](../../docs/adr/). The ones that shape this package:

- [0003](../../docs/adr/0003-own-neutral-message-format.md) our own neutral message format
- [0005](../../docs/adr/0005-the-loop-returns-a-result-and-never-throws.md) the loop returns a result and never throws
- [0006](../../docs/adr/0006-cancelling-a-turn.md) cancelling a turn
- [0007](../../docs/adr/0007-tools-declare-that-they-need-approval.md) tools declare that they need approval
- [0009](../../docs/adr/0009-retry-is-a-wrapper-around-a-provider.md) retry is a wrapper around a provider
- [0011](../../docs/adr/0011-an-agent-is-created-from-a-model-id.md) an agent is created from a model id
- [0016](../../docs/adr/0016-streaming-is-an-update-the-app-can-turn-off.md) streaming is an update the app can turn off
- [0018](../../docs/adr/0018-a-long-conversation-is-summarised.md) a long conversation is summarised
- [0022](../../docs/adr/0022-one-harness-and-the-user-brings-a-key.md) one harness, and the user brings a key
- [0023](../../docs/adr/0023-the-second-provider-is-claude.md) the second provider is Claude
