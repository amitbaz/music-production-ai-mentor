# 0023 — The second provider is Claude, reached with `fetch`, its thinking replayed and dropped on mismatch

Date: 2026-10-16 · Status: accepted · Amends [0003](0003-own-neutral-message-format.md) (provider meta carries an owner tag), [0005](0005-the-loop-returns-a-result-and-never-throws.md) (a seventh stop reason, `refused`) and [0011](0011-an-agent-is-created-from-a-model-id.md) (the owner tag and the id rule it asked for before a second adapter)

## Context

The evals test the product, not the model, so a case runs on a panel of supported models (ADR 0022, `evals/README.md`). The panel has one model, Gemini. The second is Claude, and ADR 0011 named two things to settle before a second adapter exists: provider meta has no owner tag, and tool call ids made by one provider must be valid for the other when the user switches model between turns.

Claude adds its own. Its replies carry hidden thinking blocks, which the API wants back on every tool round of a turn, and across turns for the best answers. Each block is signed with everything before it in the request: change the system prompt, the tools or an earlier message, and replaying the block is a 400 on accounts created from 31 August 2026. Our summarising (ADR 0018) does exactly that: the older messages become a summary and the newest ones stay word for word, with their blocks. The summary request itself, with its own system prompt and no tools, changes the prefix too. The mentor's system prompt is a constant, so between ordinary turns nothing changes. Claude can also decline a request on safety grounds, with a stop reason `refusal` and a category, which the loop's stop reasons have no slot for. And dependencies are now allowed (ADR 0021), so the Anthropic SDK was an option.

## Decision

- The provider is named `claude`: model id `claude:claude-haiku-5-5`, key `keys.claude`, owner tag `"claude"`. Haiku 5.5 is the only model on its supported list for now (ADR 0019); Sonnet and Opus are added when a user asks.
- The adapter calls the HTTP API with `fetch` and reads the SSE stream itself, like the Gemini adapter. The harness keeps one retry (ADR 0009) and one stream layer (ADR 0016).
- Thinking blocks are stored in provider meta and replayed on every request, in the turn and across turns. Every request to Claude sends the `thinking-binding-controls-2026-08-01` beta header with `thinking.block_binding.prefix_mismatch_behavior: "drop_block"`, so a block that no longer fits its prefix, after a summary or in the summary request, is dropped by the API and the request goes on. The harness never strips a block itself.
- Provider meta carries an owner tag: `{ provider: "gemini", thoughtSignature }`, `{ provider: "claude", … }`. An adapter reads provider meta only when the tag is its own, and ignores the rest.
- A tool call id is letters, digits, `_` and `-`. Each adapter has an offline test that the ids it makes fit, and sends ids from the conversation as they are. Gemini's `call_…` and Claude's `toolu_…` both fit.
- A safety refusal ends the turn with a new stop reason, `refused`, carrying the category and the model's explanation. Text that arrived before it is kept, as with `cut_off`. Gemini's safety block lands on the same stop reason.
- The adapter sends no thinking or effort field: the model's defaults. The user picks the model, not its knobs; a knob can join the model id later if a score asks for it.
- The adapter puts one `cache_control` mark on the last tool definition, so the system prompt and the tool list are read from Claude's cache on every round and every eval run. The prefix is byte-identical between requests, since the prompt is a constant and the tool list is fixed.

Rejected:

- Replaying thinking only within the turn: never fails, but Claude starts every turn without its earlier reasoning, and spends thinking tokens again.
- Stripping blocks from the kept part when a summary is written: the same result without the beta header, but summarising would read provider meta, which ADR 0003 says the loop never does.
- Our own tool call id format, translated per adapter: works for any provider ever; built for a provider that does not exist. Provider meta is the slot for a provider's own id if one arrives that does not fit the rule.
- A refusal as a failed model call: nothing new in the loop, but an app could not tell a refusal from a broken network except by its text.
- The Anthropic SDK: typed errors and stream parsing for free, but a second retry and timeout layer to switch off, tests that mock the SDK instead of `fetch`, and the adapter's translation half inside the SDK, which ADR 0021 keeps hand-written.
- `anthropic` as the provider name: the company, as in the API URL, but users think "Claude", and `gemini` set the pattern of the model family's name.
- Effort `high` always: better on hard turns, more tokens on every turn, and a choice made for the user.
- Vendor fallbacks on refusal: the model is interchangeable, and a fallback runs without the blocks anyway.

## Consequences

- Two pieces of work, in order: the harness first (owner tag written and checked by the Gemini adapter, the id rule and its tests, `refused` in the loop and the CLI), then the adapter, its lookup line, and the first Claude line in `evals/scores.md`.
- After a summary, Claude continues from the summary and the kept messages' text and tool calls, without their thinking; the API reports each drop in `input_transformations`, which the adapter ignores.
- A beta header is in every request to Claude. When the control leaves beta, the header goes and the field stays.
- Retryable failures are 429, 5xx and overloaded, with the wait the provider gives; other 4xx are not retried. `tokens` is input, output and cache tokens from `usage`. `charsPerToken` is an estimate of about 3.5 until measured. The adapter streams every call.
- Conversations are not saved yet, so provider meta written before the tag needs no migration.
