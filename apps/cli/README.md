# @mentor/cli

The mentor in the terminal. It reads what you type, streams the mentor's reply, shows each tool call as it runs, and asks you before a tool that needs approval.

> [!NOTE]
> This is the app of [Music Production AI Mentor](../../README.md). For install and pairing, follow the [quick start](../../README.md#quick-start). It depends only on `@mentor/mentor`.

## Commands

Run from the repo root:

```sh
pnpm start [--model provider:model]   # talk to the mentor; Gemini unless --model names another
pnpm pair ableton                     # install the Remote Script in Live and write its password
pnpm unpair ableton                   # remove the Remote Script and its password
```

## Configuration

Settings live in `apps/cli/.env`, which is not committed. Copy [`.env.example`](.env.example) to start.

| Variable | What it is |
|---|---|
| `GEMINI_API_KEY` | Key for Gemini models. |
| `ANTHROPIC_API_KEY` | Key for Claude models. |
| `ABLETON_ADDRESS` | Where the Remote Script listens. Default `ws://127.0.0.1:39031`. |
| `ABLETON_PASSWORD` | Written by `pnpm pair ableton`. Don't set it by hand. |

> [!WARNING]
> `.env` holds your API keys. Keep it out of commits, logs and screenshots.

## In the terminal

```text
Music production AI mentor. Type "exit" to quit.

you> turn the bass down 3 dB

⏺ set_parameters({"changes":[{"target":"t2","parameter":"Volume","value":-7}]})
  ⎿  {"changes":["Bass / Volume: -4.0 dB → -7.0 dB"]}

mentor> Done: Bass / Volume: -4.0 dB → -7.0 dB. …
```

- `exit` or Ctrl+C at the prompt quits. Ctrl+C during a reply cancels it; what already happened stays in the conversation.
- A tool that needs approval (`delete`, `live_change`) asks `Run <tool>? (y/n)` first.
- A turn that does not finish says why: `(reply cut off)`, `refused (category): explanation`, `stopped: too many rounds without finishing`, or `error: …`.
- A tool result shows its first line only; the model sees all of it.

## Development

```sh
pnpm --filter @mentor/cli check   # type check, lint and the offline tests
```

| File | What it does |
|---|---|
| [`src/cli.ts`](src/cli.ts) | The entry point: reads `--model` and `.env`, makes the mentor. |
| [`src/run.ts`](src/run.ts) | The conversation loop: prompt, turn, cancel, approval. |
| [`src/render.ts`](src/render.ts) | Turns each update into text on the screen. |
| [`src/pair.ts`](src/pair.ts), [`src/pairing.ts`](src/pairing.ts) | `pnpm pair` and `pnpm unpair`. |
