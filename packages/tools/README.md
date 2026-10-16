# @mentor/tools

The tool sets the mentor acts through: one per outside source. Each tool set is a function that returns a list of [harness](../harness/README.md) `Tool`s, so it plugs into any agent.

> [!NOTE]
> This is a private workspace package of [Music Production AI Mentor](../../README.md). It is not published to npm, and it exports its `.ts` source with no build step. It depends only on `@mentor/harness`.

## Tool sets

| Entry | Source | Tools |
|---|---|---|
| `@mentor/tools/daws/ableton` | The Live Set open in Ableton Live 12.4+, through the [ableton-js](https://github.com/leolabs/ableton-js) Remote Script | 15 |

## Usage

```ts
import { createAgent } from "@mentor/harness";
import { createAbleton } from "@mentor/tools/daws/ableton";

const tools = createAbleton({
    address: process.env.ABLETON_ADDRESS,   // ws://127.0.0.1:39031 by default
    password: process.env.ABLETON_PASSWORD, // written by `pnpm pair ableton`
});

const agent = createAgent({ model: "gemini:gemini-3.5-flash-lite", keys: { gemini: process.env.GEMINI_API_KEY }, tools });
```

The tools share one connection, opened the first time a tool runs. When Live is not paired or not answering, the tool's result is an error that says what is wrong and what to do, which the model can pass on.

## The Ableton tools

Grouped as in [ADR 0013](../../docs/adr/0013-ableton-tools-are-a-short-named-list-plus-two-general-tools.md), each in its own file under [`src/daws/ableton/tools/`](src/daws/ableton/tools/):

| Group | Tools |
|---|---|
| `reads/` | `read_set`, `read_tracks`, `read_arrangement`, `read_clip` |
| `changes/` | `set_parameters`, `edit_tracks`, `edit_devices`, `edit_arrangement`, `write_notes`, `transport`, `show`, `find_in_browser` |
| `removals/` | `delete` (asks first) |
| `general/` | `live_get`, `live_change` (asks first) |

What each tool does, and its limits, is in [docs/features.md](../../docs/features.md). Live's objects are named by short object ids (`t1`, a track) that a read gives out and later calls take back.

The same entry exports `installRemoteScript` and `removeRemoteScript`, which `pnpm pair ableton` and `pnpm unpair ableton` call. The pinned ableton-js copy they install, with our one Python file, lives in [`remote-scripts/ableton-js/`](remote-scripts/ableton-js/).

## Development

```sh
pnpm --filter @mentor/tools check   # type check, lint and the offline tests
```

The tests need no Live. They run against a stand-in WebSocket ([`stand-in-live.ts`](src/daws/ableton/stand-in-live.ts), also exported as `@mentor/tools/daws/ableton/stand-in-live`), and [`recorded-live.test.ts`](src/daws/ableton/recorded-live.test.ts) replays replies recorded from a real Live.

> [!IMPORTANT]
> Before a release, run through [`remote-scripts/checklist.md`](remote-scripts/checklist.md) in a real Live: the stand-in cannot prove Live behaves the same.

## Adding a tool

A tool set lives in `src/<kind>/<name>/`, with its own entry in `package.json`, such as `@mentor/tools/daws/ableton`. For an Ableton tool:

- One file and its test under `tools/<group>/`, in its group from ADR 0013. The file exports a function that takes the client and returns the tool.
- Export it from the group's `index.ts`; `tools/index.ts` re-exports the groups, and `ableton.ts` lists every tool.
- What reading or changing tools share goes in `reading.ts` or `changing.ts`; what Live sends back is typed in `live.ts`.
- The tool's test runs against the stand-in Live. `ableton.test.ts` is only for what belongs to the whole tool set: the connection, object ids, batching.
- A read whose answer grows with the Set keeps it under `RESULT_LIMIT` itself ([ADR 0018](../../docs/adr/0018-a-long-conversation-is-summarised.md)).

`recorded-reads.json` holds replies recorded from a real Live; the header of `recorded-live.test.ts` says how to record them again.

## Why it's shaped this way

- [0004](../../docs/adr/0004-agent-code-is-separate-from-ableton-code.md) agent code is separate from Ableton code
- [0012](../../docs/adr/0012-live-is-reached-through-the-ableton-js-remote-script.md) Live is reached through the ableton-js Remote Script
- [0013](../../docs/adr/0013-ableton-tools-are-a-short-named-list-plus-two-general-tools.md) a short named list plus two general tools
- [0014](../../docs/adr/0014-only-removals-ask-for-approval-and-there-is-no-undo-tool.md) only removals ask for approval, and there is no undo tool
- [0015](../../docs/adr/0015-the-first-real-ableton-tool-set-has-a-narrow-scope.md) the first real Ableton tool set has a narrow scope
- [0017](../../docs/adr/0017-read-results-are-compact-json-for-now.md) read results are compact JSON for now
