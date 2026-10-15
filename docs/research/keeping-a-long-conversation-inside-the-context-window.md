# Research — keeping a long conversation inside the model's context window

Date: 2026-10-13 · Status: research note, not a decision

Every source below was retrieved on 2026-10-13. Provider facts come from the providers' own documentation and API references. Harness facts come from source code at the commits pinned in [Sources](#sources); nothing was run.

Markers used below: **[verified]** read in the linked provider documentation during this research · **[code]** read in the linked source file at the pinned commit · **[repo]** read in this repository · **[inferred]** my reasoning from verified facts, not stated by any source · **[unverified]** could not confirm.

How the code was read: three delegated readers went through the harness sources and reported file, line range and a quoted snippet for each claim. I re-checked about forty of the constants and quotes against the same checkouts with grep (thresholds, limits, placeholder strings, beta header names) and found no mismatch. Line numbers may be off by a line or two. Claims I did not re-check myself are still marked **[code]**; the ones a reader flagged as only skimmed are listed under [Could not verify](#could-not-verify).

## Short answer

1. **The harness cannot see how full the window is today.** `Model.call` returns messages only, and the Gemini adapter reads neither `usageMetadata` nor `finishReason` **[repo]**. Every harness read for this note measures fullness the same way: the token count the provider reported on the last reply, plus a characters-divided-by-four estimate for whatever was added since. None of the ones that run in TypeScript use a tokenizer. This is the first thing any design needs, and it needs no dependency.
2. **Client-side compaction is the only technique that works on every provider.** Anthropic and OpenAI both offer server-side compaction, in beta and as an opaque encrypted item respectively. Gemini's `generateContent` API, the only one the harness speaks today, offers nothing: no compaction, no clearing, no truncation option was found in its documentation. A provider-agnostic harness has to own a summarise-and-replace path, and can treat the server-side features as optional per-adapter shortcuts.
3. **The shape of client-side compaction has converged.** Trigger at the window minus a reserve (pi 16,384 tokens, opencode 10% or 16,000, Codex 90% of the window). Keep the newest 15,000 to 20,000 tokens word for word. Summarise the rest with a fixed-heading template, using the same model. Store the summary as a user message with a wrapper that says it is history, not instructions. Never cut between a tool call and its tool result.
4. **Capping one tool result on the way in is cheaper than everything else and every coding harness does it.** The common limit is 2,000 lines or 50 KB, with the full output saved to a file whose path is given to the model. The mentor's tools return short strings today, so this matters only once a tool can return something large (a full Live set dump, an audio analysis).
5. **Every edit to old messages throws away the prompt cache from that point on.** Providers cache by exact prefix. Summarising, clearing tool results, and changing the tool list all invalidate it. The sources handle this by editing rarely and in large steps (Anthropic's `clear_at_least`, Cline's 64 KB batching), by never changing the tool list mid-conversation, and by keeping the system prompt under its own cache breakpoint.
6. **For the mentor as it is, the hard limit is far away; cost and quality arrive first.** The mentor's model, `gemini-3.5-flash-lite`, takes 1,048,576 input tokens **[verified]**, the conversation is re-sent in full on every model call **[repo]**, and Anthropic's documentation states that accuracy and recall degrade as the token count grows **[verified]**. So the threshold worth designing is probably a chosen budget well below the window, not the window itself **[inferred]**.

## What the harness has today

All **[repo]**, from `packages/harness/src/` at `12be09e`.

- `Model.call(conversation, tools, options)` returns `Promise<Message[]>`. There is no place for token usage, a finish reason, or a model's limits (`types.ts`).
- The Gemini adapter is the only provider adapter. Its `GeminiResponse` type has `candidates`, `promptFeedback` and `error`. It does not read `usageMetadata` or `finishReason`, so a reply cut off by the output limit looks like a finished one (`providers/gemini.ts`).
- A failed request becomes a `ModelCallError`. Status 400 is not in the retryable list, so a request that is too long would end the turn with stop reason `"error"` and Gemini's message.
- `Tool.run` returns a string that becomes `tool_result.output` unchanged. Nothing caps its length (`agent-loop.ts`).
- The agent keeps nothing between turns. The app passes the conversation in and takes the new one from the result (ADR 0011). Anything that shortens the conversation therefore has to hand the shorter list back to the app, or be something the app calls.
- The system prompt is not a message (ADR 0008). That ADR already names trimming as a reason: "Trimming old messages would have to know to skip it."
- A turn is capped at 10 rounds, which bounds how much one turn can add.
- Assistant and tool call messages can carry `providerMeta` (Gemini's `thoughtSignature`). Gemini's API reference lists a finish reason `MISSING_THOUGHT_SIGNATURE` **[verified]** ([generate-content][g-api-gen]). Removing a whole message removes its signature with it; rewriting a message in place while keeping the signature has not been tested **[unverified]**.

## Comparison of approaches

| Approach | What the harness must do | What it costs | What it needs from the provider |
| --- | --- | --- | --- |
| Measure fullness from reported usage + chars/4 for the tail | Adapters return usage with each reply; one estimator function; a per-model window number | Nothing at run time. The estimate runs low on dense text | A usage field (all three have one). Window size: Gemini and Anthropic publish it through a models endpoint; OpenAI does not |
| Count tokens with the provider before sending | One extra request per check | Latency of a round trip; separate rate limit | A count endpoint (all three have one, all free or unpriced) |
| Cap a single tool result on entry | Truncate in the loop after `tool.run`; optionally save the full text somewhere the model can read | The model may need a second call to see the rest | Nothing |
| Clear old tool results (client side) | Replace old `tool_result.output` with a placeholder, keep the pair | Breaks the cache from the first cleared message; the model loses the raw result | Nothing |
| Clear old tool results (Anthropic context editing) | Send `context_management.edits`; keep the full conversation locally | Same cache break, done by the server; beta header | Anthropic only |
| Summarise and replace (client side) | Trigger, cut-point rule, summary prompt, a summary message kind or marker, failure handling | One extra model call at full input size; cache rebuilt; summary is lossy | Nothing |
| Server-side compaction (Anthropic) | Send the parameter; store an opaque signed block as a message and send it back unchanged | Billed as a normal call on the same model; beta; block is tied to Anthropic | Anthropic, Claude 4.6 and later |
| Server-side compaction (OpenAI) | Send `context_management` or a `compaction_trigger` item; store an encrypted item | Summary cannot be read or shown; item replays only on OpenAI | OpenAI Responses API |
| Drop oldest messages (truncation) | Cut at a safe boundary | Silent loss of the oldest instructions; cache fully invalidated every time the window slides | Nothing (or OpenAI `truncation: "auto"`) |
| State outside the conversation (notes, memory tool, working memory) | A tool that reads and writes a store; inject or let the model fetch | Extra tool calls; if injected into the system prompt, each update breaks the cache | Nothing (Anthropic ships a ready-made tool schema) |
| Load tool definitions on demand | Send deferred definitions and a search tool | A search round before first use | Anthropic and OpenAI have it server-side; a client-side version needs nothing |
| Sub-agent with its own conversation | Run a second agent loop from a tool; return only its last message | The sub-agent's tokens are still paid for; the parent sees only a summary | Nothing |

## Detail

### 1. Knowing how full the window is

#### What each provider reports

**Gemini (`generateContent`, the API the harness uses).** The response's `usageMetadata` has `promptTokenCount` ("When `cachedContent` is set, this is still the total effective prompt size"), `cachedContentTokenCount`, `candidatesTokenCount`, `toolUsePromptTokenCount`, `thoughtsTokenCount` and `totalTokenCount` **[verified]** ([generate-content][g-api-gen]). pi reads it from each streamed chunk as `chunk.usageMetadata` **[code]** ([google-generative-ai.ts][pi-google]). The newer Interactions API reports `total_input_tokens`, `total_output_tokens`, `total_cached_tokens` and others under `usage` **[verified]** ([tokens][g-tokens]).

**Anthropic.** `usage.input_tokens` counts only the tokens after the last cache breakpoint. The full input is `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`, and all three count toward the window **[verified]** ([context windows][a-context-windows], [prompt caching][a-caching]). With compaction enabled, `usage.iterations` lists each sampling pass and the top-level fields leave the compaction pass out **[verified]** ([threshold compaction][a-compact-threshold]).

**OpenAI (Responses).** `usage.input_tokens` with `input_tokens_details.cached_tokens` and `cache_write_tokens`, `output_tokens` with `output_tokens_details.reasoning_tokens`, and `total_tokens` **[verified]** ([responses create][o-create]). Here `input_tokens` already includes the cached part: the Vercel AI SDK subtracts to get the uncached number, where for Anthropic it adds **[code]** ([convert-openai-responses-usage.ts][ai-usage-openai], [convert-anthropic-usage.ts][ai-usage-anthropic]).

The three providers disagree on whether "input tokens" includes cached tokens. An adapter has to normalise this, and the Vercel AI SDK's shape is one worked example: `inputTokens.{total, noCache, cacheRead, cacheWrite}` and `outputTokens.{total, text, reasoning}` **[code]** ([language-model-v4-usage.ts][ai-usage-shape]).

#### Counting before sending

| Provider | Endpoint | What the docs say about exactness and cost |
| --- | --- | --- |
| Gemini | `POST …/models/{model}:countTokens`, takes `contents` or a whole `generateContentRequest` (system instruction and tools included) | Returns `totalTokens`. Price not stated on the pages read **[unverified]** ([api/tokens][g-api-tokens]) |
| Anthropic | `POST /v1/messages/count_tokens` | "The token count is an **estimate**"; free; its own rate limit; ignores caching **[verified]** ([token counting][a-count]) |
| OpenAI | `POST /v1/responses/input_tokens` | "returns the exact count the model will receive"; says `characters / 4` is inaccurate for images and files **[verified]** ([counting tokens][o-count]) |

Without a tokenizer dependency, an exact count before the request means one extra HTTP request. Google's own rule of thumb is "a token is equivalent to about 4 characters" **[verified]** ([tokens][g-tokens]). The harnesses use that rule only for the part the provider has not yet measured:

- pi: last valid reply's usage plus `chars/4` for later messages; an image counts as 4,800 characters; usage from aborted or errored replies is ignored; usage recorded before a later compaction is not trusted **[code]** ([compaction.ts][pi-compaction] 140-261).
- opencode: the same hybrid, and it notes "The anchor's usage covers its own output, but not its local tool results, which the provider never saw" **[code]** ([compaction.ts][oc-compaction] 873-923).
- Codex: last response's `total_tokens` plus bytes/4 for newer items, "a coarse lower bound, not a tokenizer-accurate count" **[code]** ([history.rs][cx-history] 650-954).
- Cline estimates the whole request at 3 characters per token on purpose, "so trigger thresholds fire before provider rejection rather than after", then scales its budget by how far the previous estimate fell short of the reported number, up to 4x **[code]** ([tokens.ts][cl-tokens], [compaction.ts][cl-compaction] 347-354).
- Aider is the exception: it counts with litellm's tokenizer **[code]** ([models.py][ai-models] 650-653).
- opencode pads the estimated part by 15% when working out how much output room is left, because the estimate "can run low on dense text such as code" **[code]** ([model-request.ts][oc-model-request] 48-97).

#### Where window sizes come from

- Gemini: `models.get` and `models.list` return `inputTokenLimit` and `outputTokenLimit` **[verified]** ([api/models][g-api-models]). `gemini-3.5-flash-lite` is listed at 1,048,576 in and 65,536 out **[verified]** ([model page][g-model]).
- Anthropic: the Models API returns `max_input_tokens` and `max_tokens`, plus a `capabilities` object that includes `context_management` **[verified]** ([models list][a-models-list]). Current models have a 1M-token window and 128k output **[verified]** ([models overview][a-models]).
- OpenAI: the model object has only `id`, `created`, `object`, `owned_by` and `shutdown_date`. Limits are on the documentation pages (GPT-5.6: 1,050,000 window, 128,000 output) **[verified]** ([models retrieve][o-model-object], [gpt-5.6][o-model-56]).
- The harnesses do not ask the provider. pi and opencode ship a generated table built from models.dev; Codex ships a `models.json` with a 272,000 fallback; Aider downloads litellm's JSON; LangChain generates profiles from models.dev **[code]** ([generate-models.ts][pi-genmodels], [models-dev.ts][oc-modelsdev], [model_info.rs][cx-modelinfo], [models.py][ai-models] 161-166, [profile.ts][lc-profile]). The Vercel AI SDK carries no window sizes at all **[code]**.
- When the window is unknown, pi and opencode never auto-compact **[code]** ([agent-session.ts][pi-session] 769, [compaction.ts][oc-compaction] 222).

For a dependency-free harness the options are a small hand-kept table per adapter, or one `models.get` call per model for the providers that have it **[inferred]**.

#### What happens on overflow

- **Anthropic.** Input alone too long: `400 invalid_request_error`, "prompt is too long". Input plus `max_tokens` over the window: accepted on Claude 4.5 and later, and generation stops with `stop_reason: "model_context_window_exceeded"`. A request over 32 MB gets `413 request_too_large` before it reaches the API **[verified]** ([context windows][a-context-windows], [errors][a-errors]).
- **OpenAI.** With `truncation: "disabled"`, which the API reference calls the default, "the request will fail with a 400 error". With `"auto"`, the API drops items "from the beginning of the conversation" **[verified]** ([responses create][o-create]). Codex matches the error code `context_length_exceeded` **[code]** ([responses_error.rs][cx-error]).
- **Gemini.** The pages read do not document the error for an over-long prompt **[unverified]**. pi matches the message with `/input token count.*exceeds the maximum/i`, commented "Google (Gemini)" **[code]** ([overflow.ts][pi-overflow]). The finish reason `MAX_TOKENS` means the output limit was reached **[verified]** ([generate-content][g-api-gen]).
- **Silent overflow exists.** pi handles providers that accept an over-long request and answer anyway: it treats a normal stop whose reported input exceeds the window as overflow, and a `length` stop with zero output at 99% of the window as server-side truncation. It also notes a case it cannot detect **[code]** ([overflow.ts][pi-overflow] 114-167).
- Error text is not standard. pi keeps about 25 message patterns and opencode about 33, each with an exclusion list so that a rate-limit message containing "too many tokens" is not mistaken for overflow **[code]** ([overflow.ts][pi-overflow] 37-80, [provider-error.ts][oc-error] 16-68).

### 2. Server-side features from providers

#### Anthropic

**Compaction on demand** (beta, header `compact-2026-09-04`; Claude Opus 4.6, Sonnet 4.6, Haiku 5.5 and later; not listed for Amazon Bedrock) **[verified]** ([compaction on demand][a-compact-demand]).

- Request: the ordinary Messages request plus `"compaction": {"type": "summarize"}`, optionally with `instructions` (up to 16,384 characters, replaces the default prompt entirely).
- Response: one content block `{"type": "compaction", "content": "<summary text>", "signature": "…"}` and `stop_reason: "compaction"`. The summary is readable text.
- Afterwards the block goes first in `messages` in place of what it summarised, unchanged, with the beta header on every later request. A changed block is rejected (`compaction_signature_invalid`).
- The app chooses the cut: to keep recent turns word for word, leave them out of the compaction request and put them after the block. "Put the cut where no tool call is left open" ([keep recent turns][a-compact-keep]).
- It can run in the background while the conversation continues ([background][a-compact-bg]).
- Cost: "billed and rate-limited like any other request", on the request's own model. There is no option for a cheaper summariser ([threshold compaction][a-compact-threshold]).
- Limits: cannot be combined with `context_management` on one request; the conversation "must still fit the model's context window, so compact before you outgrow it, not after"; images and documents in the summarised range are gone.
- A request can return 200 with no summary. The documented causes are the summary being cut off, no room for the prompt, the model calling a tool instead, a refusal, and an empty reply.

**Compaction at a token threshold** (beta, header `compact-2026-01-12`; same models; also on Bedrock) **[verified]** ([threshold compaction][a-compact-threshold]).

- Request: `context_management.edits: [{"type": "compact_20260112", "trigger": {"type": "input_tokens", "value": 150000}, "pause_after_compaction": false, "instructions": null}]`. The trigger defaults to 150,000 and must be at least 50,000.
- The API summarises inside the request that crosses the trigger, returns a `compaction` block, and on later requests "automatically drops all content blocks prior to the `compaction` block".
- The default prompt "varies by model"; one example is quoted on the page and asks for a summary in `<summary></summary>` tags.
- Documented limitation: with `tools` defined, "the model occasionally calls a tool during the internal summarization step instead of writing a summary", giving a block with `content: null`.

Anthropic's overview says "Use on-demand compaction wherever it is available" ([compaction overview][a-compact]).

**Context editing** (beta, header `context-management-2025-06-27`, "available on all supported Claude models") **[verified]** ([context editing][a-context-editing]).

- `clear_tool_uses_20250919`: replaces the oldest tool results with placeholder text. Options: `trigger` (default 100,000 input tokens, or a count of tool uses), `keep` (default 3 most recent tool use/result pairs), `clear_at_least`, `exclude_tools`, `clear_tool_inputs` (default false).
- `clear_thinking_20251015`: clears old thinking blocks; `keep` is model-specific.
- "Your client application maintains the full, unmodified conversation history." The response reports what was cleared in `context_management.applied_edits`.
- The older client-side SDK compaction (`compaction_control`) is deprecated in TypeScript and Ruby and removed from Python.

**Memory tool** (`{"type": "memory_20250818", "name": "memory"}`). Anthropic supplies the tool schema; the application implements the file commands against its own storage and must reject paths outside `/memories` **[verified]** ([memory tool][a-memory]). The page carries no beta marker; I did not confirm its availability status separately **[unverified]**. The same page says "Context editing clears specific tool results on the client", which contradicts the context editing page's "applied server-side".

**Context awareness.** On some models the API tells the model its remaining budget after each tool call (`<system_warning>Token usage: 35000/200000; 165000 remaining</system_warning>`). The newest models do not receive it and use task budgets (beta) instead **[verified]** ([context windows][a-context-windows]).

#### OpenAI (Responses API)

Three mechanisms are documented **[verified]** ([compaction guide][o-compaction], [responses create][o-create]):

- `context_management: [{"type": "compaction", "compact_threshold": N}]` on an ordinary request. When "the rendered token count crosses the configured threshold" the server compacts and emits a compaction item in the same stream.
- A `{"type": "compaction_trigger"}` input item: "Compacts the current context. Must be the final input item." Codex uses this one, and at the pinned commit does not call the standalone endpoint **[code]** ([compact_remote_v2_attempt.rs][cx-remote] 172).
- `POST /responses/compact`: send a full window, get back "a new compacted context window". "Do not prune `/responses/compact` output." The OpenAI Agents SDK's `OpenAIResponsesCompactionSession` uses this one **[code]** ([openaiResponsesCompactionSession.ts][oa-compaction] 295-304).

In all three the result is an item with `encrypted_content`: "opaque and not intended to be human-interpretable". The harness can store and replay it but cannot show it, edit it, or send it to another provider. opencode notes it "only replays on the endpoint that made it" **[code]** ([compaction.ts][oc-compaction] 321-322). No beta marker appears on these pages. Model support for compaction is not listed on the guide **[unverified]**.

`truncation: "auto"` is the fourth option: no summary, the oldest items are dropped. The API reference says the default is `disabled`; a source comment in the Vercel AI SDK says the default is `auto` **[code]** ([openai options][ai-openai-options] 363). The API reference is the authority.

Server-held state (`previous_response_id`, the Conversations API) moves the conversation to OpenAI. It does not fit this harness as it stands, where the app owns the conversation (ADR 0011) **[inferred]**.

#### Google Gemini

- No compaction, context-editing or truncation feature was found in the `generateContent` reference, the long-context guide, the caching guide, the Interactions API guide or the documentation index **[verified]** as an absence in the pages listed in [Sources](#sources); I did not read every page of the site.
- The long-context guide takes the opposite position to the other two providers: older, smaller windows "often require strategies like arbitrarily dropping old messages, summarizing content", and a large window "invites a more direct approach" **[verified]** ([long context][g-long]).
- The Interactions API can hold history on the server through `previous_interaction_id` (`store=true` by default) **[verified]** ([interactions][g-interactions]). That is state storage, not context reduction.

### 3. Client-side techniques in real harnesses

#### When they compact

| Harness | Trigger | Checked |
| --- | --- | --- |
| pi | `contextTokens > contextWindow - reserveTokens`, reserve 16,384 | Before a user prompt, after tool results, after the run ([compaction.ts][pi-compaction] 126-130, 267-270) |
| opencode | estimate >= window - max(10% of window, 16,000) | Before every step ([compaction.ts][oc-compaction] 905-912) |
| Codex | 90% of the window, hard cap at 95% | Before a turn and mid-turn ([openai_models.rs][cx-models] 393-395, 529-540) |
| Cline | estimated request >= 90% of max input (max input defaults to 90% of the window) | Before each model request ([compaction-shared.ts][cl-shared] 15-37) |
| Aider | finished history > 1/16 of max input, clamped to 1,024 to 8,192 tokens | After each exchange, in a background thread ([models.py][ai-models] 355-358) |
| LangChain `summarizationMiddleware` | No default; the caller sets a fraction, token or message count | Before the model call ([summarization.ts][lc-summarization]) |
| OpenAI Agents JS compaction session | 10 non-user items, not tokens | After a response ([openaiResponsesCompactionSession.ts][oa-compaction] 30) |
| Anthropic server-side | 150,000 input tokens | Inside the request |

All **[code]** except the last. Aider is the outlier in triggering far below the window: it treats old chat as low-value next to the files it has loaded.

#### What is summarised and what is kept

- **pi** keeps about the newest 20,000 estimated tokens as real messages and summarises everything older back to the previous compaction. Its session log is append-only: a compaction entry stores the summary and the id of the first kept entry, and the conversation sent to the model is rebuilt from that. A second compaction re-summarises the previous summary plus what was kept **[code]** ([compaction.ts][pi-compaction] 820-895).
- **opencode** keeps the newest 15,000 tokens, but as flattened text stored beside the summary, in one user message. A code comment calls this a known weakness: "we shouldnt be stringifying the recent history (confuses some models...)". The full transcript stays in its database **[code]** ([compaction.ts][oc-compaction] 74, 698-737).
- **Codex** (local path) keeps only user messages, newest first up to 20,000 tokens, plus one summary message. Assistant messages, tool calls and tool results are all dropped **[code]** ([compact.rs][cx-compact] 63, 393-396).
- **Cline** keeps about 20,000 recent tokens and never summarises away the latest typed user prompt. It also has a strategy with no model call that keeps user prompts and replaces dropped work with a generated notice listing files read, files edited and commands run **[code]** ([compaction-shared.ts][cl-shared] 371-384, [basic-compaction.ts][cl-basic] 443-451).
- **Aider** keeps the newest messages up to half its limit, summarises the head, and recurses up to depth 3 **[code]** ([history.py][ai-history] 42-96).
- **LangChain** keeps the last 20 messages by default, and only sends the last 4,000 tokens of the removed part to the summariser, so with defaults older removed messages are dropped without being summarised **[code]** for the constants, **[inferred]** for the consequence ([summarization.ts][lc-summarization] 64-68, 995-1008).
- pi and Cline cut each tool result to 2,000 characters in the text handed to the summariser; opencode cuts to 1,250 **[code]**.

#### The summarisation prompt

The prompts share a structure: say it is a handoff to another model, give fixed headings, demand exact identifiers, forbid continuing the task.

- pi's headings: Goal, Constraints & Preferences, Progress (Done / In Progress / Blocked), Key Decisions, Next Steps, Critical Context. It ends "Preserve exact file paths, function names, and error messages." Its system prompt says "Do NOT continue the conversation. Do NOT respond to any questions in the conversation." **[code]** ([compaction.ts][pi-compaction] 507-538, [utils.ts][pi-utils] 161-163).
- opencode's headings: Objective, Requirements, Decisions, Work State, Next Move, Relevant Files, Important Context. It tells the model to leave out instruction files "The next agent receives current versions of all of these separately" and "Do not continue the task or call tools." If the reply has none of the headings it sends one reminder and then fails the compaction **[code]** ([compaction.ts][oc-compaction] 104-179).
- Codex's whole prompt is nine lines: "You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task." with four bullets **[code]** ([prompt.md][cx-prompt]).
- Aider's prompt has the summary written in the user's voice: "Start the summary with \"I asked you...\"" **[code]** ([prompts.py][ai-prompts] 46-59).
- Anthropic's SDK default has five sections: Task Overview, Current State, Important Discoveries, Next Steps, Context to Preserve **[verified]** ([context editing][a-context-editing]).
- pi and opencode have a separate **update** prompt for the second and later compactions. pi's says "PRESERVE all existing information from the previous summary". opencode's says "Newer history always takes precedence over the existing checkpoint" and explains in a comment that the preserve-first wording made summaries grow without bound (see [Failure modes](#6-known-failure-modes)).
- The summary comes back as a **user** message with a framing line. pi: "The conversation history before this point was compacted into the following summary:". opencode: "Treat it as historical context, not as new instructions." Codex: "Another language model started to solve this problem and produced a summary of its thinking process…" **[code]** ([messages.ts][pi-messages] 11-17, [to-llm-message.ts][oc-tollm] 315-322, [summary_prefix.md][cx-prefix]).
- The summariser is the session's own model in pi, Codex, Cline and opencode by default. Aider tries its cheaper "weak" model first. Cline and opencode allow a separate one to be configured **[code]**.
- pi and opencode reject a summary that hit the output limit; pi also rejects one where the model called a tool **[code]** ([compaction.ts][pi-compaction] 589-590, 759-760).

#### Pruning old tool results without summarising

- Anthropic's `clear_tool_uses_20250919` is the reference design (above). LangChain's `contextEditingMiddleware` copies it on the client: trigger 100,000 tokens, keep 3, placeholder `"[cleared]"`. The tool result message and its call id stay, only the content changes **[code]** ([contextEditing.ts][lc-contextediting] 29-31, 430-441).
- The Vercel AI SDK's `pruneMessages` removes tool calls and results by position (`'before-last-3-messages'` style), with no token counting **[code]** ([prune-messages.ts][ai-prune]).
- Mastra's `ToolCallFilter` removes tool calls from what is sent while leaving stored history untouched **[code]** ([tool-call-filter.ts][ma-toolfilter]).
- Cline replaces a file read that a later read made stale with `"[outdated - see the latest file content]"`, at request-build time, without changing the stored conversation **[code]** ([message-builder.ts][cl-builder] 50, 111).
- pi has no such pass. opencode had one and removed it: the config key `compaction.prune` is now rejected as an unsupported legacy setting **[code]** ([normalize.ts][oc-normalize] 333).

#### Capping one tool result before it enters the conversation

| Harness | Limit | Which part is kept | Full output |
| --- | --- | --- | --- |
| pi | 2,000 lines or 50 KB; MCP results 20 KB | Head for file reads, tail for shell, head and tail for MCP | Saved to a temp file, path in the result ([truncate.ts][pi-truncate] 11-13, [bash.ts][pi-bash] 350) |
| opencode | 2,000 lines or 50 KiB, applied to every tool in the step runner | Head; tail for shell | Saved for 7 days, path in the result ([tool-output.ts][oc-tooloutput] 13-16, 86-90) |
| Codex | 10,000 tokens (bytes/4) per model policy, times 1.2 | Head and tail, middle replaced by `…N tokens truncated…` | Kept in the session file, not in the live history ([truncate.rs][cx-truncate], [history.rs][cx-history] 517-577) |
| Cline | 48,000 characters at the tool, then 8,000 characters when the request is built | Head and tail | Cached; the model can page through it with its read tool ([output-limits.ts][cl-limits], [message-builder.ts][cl-builder] 29, 275) |
| Aider | None automatic; asks the user "Add 3.2k tokens of command output to the chat?" | All or nothing | ([commands.py][ai-commands] 1022-1029) |

All **[code]**. Cline's comment gives the reason: "Every character returned by an executor is re-sent to the model on each subsequent request, so oversized outputs cost quadratically". The Vercel AI SDK offers a different hook: a tool's `toModelOutput` maps its result to a smaller model-facing form **[code]** ([tool.ts][ai-tool] 151-153).

#### Tool call and tool result pairing

Providers reject a tool call with no result, and a result with no call. The sources guard against it in three ways:

1. **Choose the cut so it cannot split a pair.** pi never cuts at a tool result. opencode moves the cut back to a user message. Cline accepts only an assistant message or a typed user message as a boundary. LangChain moves a cut that lands on a tool message back to the assistant message that issued the call. Anthropic's guide says to "Put the cut where no tool call is left open" **[code]** ([compaction.ts][pi-compaction] 351-392, [compaction.ts][oc-compaction] 727-729, [compaction-shared.ts][cl-shared] 338-350, [summarization.ts][lc-summarization] 850-867).
2. **Group pairs before dropping.** Mastra's token limiter groups a call with its results so they are "always kept or dropped together"; `pruneMessages` keeps any call whose id appears in the kept tail **[code]** ([token-limiter.ts][ma-tokenlimiter] 398-403, [prune-messages.ts][ai-prune] 81-93).
3. **Repair on every request.** pi inserts a synthetic error result "No result provided" for any call left without one. Codex inserts `"aborted"` and removes orphan results. Cline inserts "Tool execution was interrupted before a result was produced." The OpenAI Agents SDK drops orphan calls when loading a session **[code]** ([transform-messages.ts][pi-transform] 158-178, [normalize.rs][cx-normalize] 59-66, [message-builder.ts][cl-builder] 726-740).

Codex's local compaction and opencode's flattening avoid the problem by keeping no tool calls after compaction at all.

This harness already produces a tool result for every tool call, including on cancel (ADR 0006), so only the cut point is new work here **[inferred]**.

#### Recovering from an overflow error

- pi: on an overflow error it removes the failed attempt, compacts, and retries the turn, once. Overflow is excluded from the ordinary retry **[code]** ([agent-session.ts][pi-session] 3049-3076).
- opencode: compact once and rebuild the step, only if no output had started; the compaction request itself shrinks to 70%, 50%, then 35% of the rejected size on repeated rejection **[code]** ([step.ts][oc-step] 160-170, [compaction.ts][oc-compaction] 94-95).
- Cline: compact once and retry, using the strategy that makes no model call, because "the agentic strategy's own summarizer call could overflow the same window" **[code]** ([compaction.ts][cl-compaction] 481-492).
- Codex: no retry in a normal turn; it marks the window full so the next turn compacts first **[code]**, the consequence **[inferred]** ([turn.rs][cx-turn] 1742-1745).
- Aider: stops and tells the user to drop files or clear history **[code]** ([base_coder.py][ai-coder] 1654-1675).

In this harness an overflow would not pass through the retry wrapper, since the adapter would have to label it, and ADR 0009 keeps HTTP status meanings inside the adapter. A distinct label on `ModelCallError` for "too long" would be the matching shape **[inferred]**.

### 4. Interaction with prompt caching

#### What the providers cache, and what breaks it

- **Anthropic.** Opt-in through `cache_control`. The prefix is built in the order `tools`, `system`, `messages`; a change at one level invalidates that level and everything after it. "Cache hits require 100% identical prompt segments". Up to 4 breakpoints; a lookback of 20 blocks; 5-minute lifetime refreshed on use, or 1 hour. A write costs 1.25x base input and a read 0.1x. Minimum cacheable length is 512 to 4,096 tokens by model. Changing tool definitions invalidates everything **[verified]** ([prompt caching][a-caching]).
- **OpenAI.** On by default. "Cache reuse requires the entire rendered prefix to match." Changing tool names, descriptions, schemas or ordering changes the prefix. Minimum 1,024 tokens for GPT-5.6 and later; on those models a write costs 1.25x and a read 0.1x. `prompt_cache_key` groups related requests; explicit breakpoints are available on newer models **[verified]** ([prompt caching][o-caching]).
- **Gemini.** Implicit caching is on by default for 2.5 and newer, with "no cost saving guarantee". The advice is to put "large and common contents at the beginning of your prompt". The listed minimum is 4,096 tokens for current models; `gemini-3.5-flash-lite` is not in the table read **[unverified]** for that model. Explicit cache objects exist on `generateContent` for Gemini 3 and 2.5 models but not for Gemini 4 and later **[verified]** ([caching][g-caching], [explicit caching][g-caching-explicit]). opencode's code says Gemini "uses only the last breakpoint, so a conversation-tail breakpoint writes a new cache every step and costs more than none" **[code]** ([cache-policy.ts][oc-cache] 58-60).

#### What each technique does to the cache

- **Appending** to the conversation keeps the prefix; this is the normal case and why a plain agent loop caches well.
- **Summarise and replace** changes the first message after the system prompt, so the whole message cache is rebuilt once. Anthropic's guidance is to put a breakpoint at the end of the system prompt so that part survives: "The system prompt cache remains valid… Only the compaction summary needs to be written as a new cache entry" **[verified]** ([threshold compaction][a-compact-threshold]).
- **Clearing old tool results** "Invalidates cached prompt prefixes when content is cleared." Anthropic's answer is `clear_at_least`: "clear enough tokens to make the cache invalidation worthwhile" **[verified]** ([context editing][a-context-editing]). Cline applies the same idea on the client: stale-read rewrites wait until 65,536 bytes are pending, and once made are "sticky" so later requests send the same bytes **[code]** ([message-builder.ts][cl-builder] 38-40, 137-138).
- **Dropping the oldest messages** changes the start of the message list every time it happens, so a sliding window never gets a cache hit on messages **[inferred]** from the prefix rule.
- **Changing the tool list** invalidates everything on Anthropic. Both providers' tool search features add discovered tools inline in the conversation so "The prefix is untouched" **[verified]** ([tool search][a-tool-search], [OpenAI tool search][o-tool-search]). pi freezes its tool list for the same reason and opencode keeps tool definitions on the final step "to preserve the provider's cached prefix" **[code]** ([anthropic-messages.ts][pi-anthropic] 1257-1261, [llm.ts][oc-llm] 240-241).
- **State injected into the system prompt** breaks the cache when it changes. Mastra's docs: "Working memory normally lives in the system prompt, so updates can invalidate the prompt cache." **[code]** ([observational-memory.mdx][ma-om-docs] 387). This applies directly to ADR 0008's note that the system prompt "can be rebuilt for each turn, for example to include the date or the open project": on a caching provider that rebuild costs a full cache write whenever the text differs **[inferred]**.
- **The summarisation call itself.** opencode builds it as the normal request plus one appended message **[code]**, which would let it read the session's cached prefix **[inferred]**. pi turns cache writes off for it (`cacheRetention: "none"`) **[code]** ([compaction.ts][pi-compaction] 627-633).
- **Codex** gives synthetic "aborted" results fixed ids because "Changing this value would change model-visible IDs and invalidate prompt caches", and trims from the front during compaction retries "to preserve cache (prefix-based)" **[code]** ([normalize.rs][cx-normalize] 18, [compact.rs][cx-compact] 350).
- **Ordering.** Aider orders its prompt stable-first (system, examples, read-only files, repo map, old history, chat files, current messages) with breakpoints after the stable parts. opencode orders instructions "from most to least shared across sessions" **[code]** ([chat_chunks.py][ai-chunks] 16-41, [context.ts][oc-context] 147-149).

### 5. Keeping it from filling in the first place

- **Cap tool results** (section 3). The only numbers the sources give for effect are the limits themselves; none reports a measured saving.
- **Load tool definitions on demand.** Anthropic: "A typical multiserver setup (GitHub, Slack, Sentry, Grafana, and Splunk) can consume ~55k tokens in definitions before Claude does any work. Tool search typically reduces this by over 85 percent", and "Claude's ability to pick the right tool degrades once you exceed 30–50 available tools" **[verified]** ([tool search][a-tool-search]). Request shape: put every tool in `tools`, mark the deferred ones `defer_loading: true`, add `tool_search_tool_regex_20251119` or `tool_search_tool_bm25_20251119`. OpenAI has `tool_search` with `defer_loading` and namespaces on `gpt-5.4` and later, and recommends under 10 functions per namespace **[verified]** ([OpenAI tool search][o-tool-search]). Both also describe a client-side version where the application does the search. The mentor has one tool set with a handful of tools, well under the range where the sources say this helps **[inferred]**.
- **Sub-agents with their own conversation.** Anthropic: a sub-agent "might explore extensively, using tens of thousands of tokens or more, but returns only a condensed, distilled summary of its work (often 1,000-2,000 tokens)" **[verified]** ([context engineering][a-eng]). In the Claude Agent SDK "intermediate tool calls and results stay inside the subagent; only its final message returns to the parent" **[verified]** ([subagents][a-subagents]). opencode's sub-agent tool says "New child sessions start with fresh context, so include all relevant context and instructions" **[code]** ([subagent.ts][oc-subagent] 56-59). pi ships none by design.
- **State outside the conversation.** Anthropic calls this structured note-taking: "the agent regularly writes notes persisted to memory outside of the context window" **[verified]** ([context engineering][a-eng]). Mastra's working memory stores a document per thread or user, injects it as a system message, and updates it through a tool **[code]** ([working-memory.ts][ma-workingmemory] 100-164). pi appends a file list computed from tool calls to each summary, so that part does not depend on the model remembering **[code]** ([utils.ts][pi-utils] 79-84). For the mentor, the Live set is state that already lives outside the conversation and can be re-read with a tool **[inferred]**.
- **Fetch on demand ("just in time").** Keep "lightweight identifiers (file paths, stored queries, web links, etc.)" in context and load the data with tools when needed **[verified]** ([context engineering][a-eng]).
- **Fit the output request to the room left.** pi and opencode lower the requested output tokens when the input is close to the window, so the request is not rejected for input plus output exceeding it **[code]** ([simple-options.ts][pi-simple] 15-22, [model-request.ts][oc-model-request] 93-97).
- **Let the model see the budget.** Anthropic injects remaining-token warnings on some models; Codex exposes a `get_context_remaining` tool **[verified]** / **[code]**.
- **Observational memory (Mastra).** A background "observer" model turns messages into a dated log of short observations once unobserved messages pass 30,000 tokens, and a "reflector" rewrites the log past 40,000. The docs claim "5-40x compression" and a cacheable prefix. I found no measurement behind either claim in the repository **[code]** for the mechanism, **[unverified]** for the effect ([constants.ts][ma-om-constants], [observational-memory.mdx][ma-om-docs]).

### 6. Known failure modes

- **Quality falls as the window fills.** "As token count grows, accuracy and recall degrade, a phenomenon known as *context rot*" **[verified]** ([context windows][a-context-windows]). Codex shows the user a warning after every local compaction: "Long threads and multiple compactions can cause the model to be less accurate. Start a new thread when possible" **[code]** ([compact.rs][cx-compact] 431-433).
- **The summary loses something that mattered later.** "overly aggressive compaction can result in the loss of subtle but critical context whose importance only becomes apparent later" **[verified]** ([context engineering][a-eng]). Mastra tells the model so directly: "Reflections are lossy… If something is absent from a reflection, that does not mean it did not happen." **[code]** ([constants.ts][ma-om-constants] 196-197).
- **Instructions given mid-conversation stop applying.** Anthropic, on system messages inside the summarised range: "their text instructions stop applying once the block replaces them… If an instruction or effort level still matters, state it again" **[verified]** ([compaction on demand][a-compact-demand]). This harness keeps the system prompt outside the conversation, so it survives any compaction; instructions the user typed as messages do not **[inferred]**.
- **Summary drift over repeated compactions.** opencode's comment: summaries "kept nearly everything: every file touched, per-edit changelogs, restated AGENTS.md conventions, and an \"Additional Context\" section that grew on every update. The preserve-first update prompt would carry that detail forward indefinitely" **[code]** ([compaction.ts][oc-compaction] 161-165). pi still uses the preserve-first wording.
- **The model treats the summary as a request, or continues the task instead of summarising.** Guarded by the wrappers and "do not continue" lines quoted in section 3. Anthropic documents the model calling a tool during summarisation as a current limitation.
- **The summarisation call fails or returns nothing.** Anthropic lists five causes for a 200 with no summary. LangChain does not throw: the string `"Error generating summary: …"` becomes the summary and the old messages are still replaced **[code]**, **[inferred]** for the consequence ([summarization.ts][lc-summarization] 977-980). Cline notes that reasoning models "can spend part of a tight budget on thinking and return no summary text at all" **[code]** ([compaction-shared.ts][cl-shared] 30-33).
- **Compacting too late.** The summarisation request must itself fit the window (Anthropic and OpenAI both say so). opencode's shrink ladder and Cline's no-model fallback exist for this case.
- **Orphaned tool calls and results.** Acknowledged in comments in Mastra, LangChain, Cline, the Vercel AI SDK and the OpenAI Agents SDK; see the pairing section.
- **Emptied messages.** After filtering, an assistant message with nothing left is rejected by providers; Mastra drops such messages **[code]** ([tool-call-filter.ts][ma-toolfilter] 105-109).
- **Estimates run low.** Cline: the character estimate "under-counts dense content (disassembly, image dumps, minified sources)". opencode: "Limits and estimates can be wrong" **[code]**.
- **Stale usage numbers re-trigger compaction** right after one finished; pi and opencode both refuse to compact twice in a row **[code]** ([compaction.ts][pi-compaction] 876-878, [compaction.ts][oc-compaction] 244-246).
- **A reply cut off by the output limit can hold a tool call with incomplete arguments.** pi fails every tool call in such a reply without running it. Anthropic says to retry with a higher limit **[code]** / **[verified]** ([agent-loop.ts][pi-loop] 264-270, [stop reasons][a-stop]). The Gemini adapter does not read `finishReason` today, so the loop cannot tell **[repo]**.
- **Provider-side accounting surprises.** Anthropic's deprecated SDK compaction over-counted with server tools because `cache_read_input_tokens` included several internal calls: "the SDK sees 334k and triggers compaction prematurely" **[verified]** ([context editing][a-context-editing]).
- **Removing thinking breaks later requests.** Removing reasoning items from an OpenAI conversation makes stored message references fail; on the newest Claude models, client-side edits to earlier turns "can invalidate the thinking blocks in every later assistant turn" **[code]** / **[verified]** ([convert-to-openai-responses-input.ts][ai-openai-input] 719-723, [context editing][a-context-editing]).
- **Compaction racing another writer.** The OpenAI Agents SDK skips compaction when the stored history changed underneath it, and documents a double-failure case that needs manual recovery **[code]** ([sessions.mdx][oa-sessions] 211-213). In this harness the app owns the conversation, so the same question arises if compaction ever runs in the background **[inferred]**.

## Open questions

These are for the design discussion; the sources do not settle them.

- Where does a shorter conversation go? The agent returns a new conversation each turn (ADR 0011), so compaction inside a turn would return a list that is not the old list plus new messages. The alternative is a separate call the app makes between turns.
- Does the app keep the full transcript? pi and opencode keep everything and rebuild what is sent; Codex and LangChain replace. What the user sees in the app and what the model is sent stop being the same list either way.
- Is a summary a fifth kind of message, or a user message with a marker? The four-kind format (ADR 0003) has no slot for it. A server-side compaction block would be a sixth thing: an opaque item only one adapter can read, like provider meta but standing alone.
- Should usage be part of what `Model.call` returns, and should the stop reason distinguish "cut off by the output limit" and "conversation too long"?
- Which threshold: a share of the window, or a fixed token budget chosen for cost and quality? At a 1M window, 90% is 940,000 tokens re-sent on every model call.
- Is the summariser the mentor's model or a cheaper one? Every harness except Aider defaults to the same model.
- What must a summary of a music production session keep? Every prompt quoted here is for coding (file paths, function names). Tempo, track names, plug-in settings and what the user said they are going for are the analogues, and that prompt would need its own eval.

## Could not verify

- **Gemini's error for an over-long prompt.** Not documented on the pages read. The only evidence is pi's message pattern.
- **Whether Gemini implicit caching applies to `gemini-3.5-flash-lite`**, and its minimum length for that model.
- **Whether `countTokens` on Gemini is free.**
- **Availability status of Anthropic's memory tool and tool search tool.** Their pages carry no beta marker, unlike the compaction pages; I did not find an explicit "generally available" statement.
- **Which OpenAI models support compaction**, and whether it is in beta. The guide does not say.
- **Measured effect of any technique.** No source read gives a benchmark for compaction quality, cache-hit rates after edits, or Mastra's "5-40x" claim. Anthropic's "over 85 percent" for tool search is a vendor figure with no method given.
- **Claude Code's own compaction.** The Claude Agent SDK repository holds a changelog and examples, no source. The changelog confirms the features exist (`autoCompactWindow`, `getContextUsage()`, `PreCompact` and `PostCompact` hooks in the docs) but not thresholds or prompts. Anthropic's engineering post says Claude Code summarises and keeps "the five most recently accessed files"; I could not check that against code.
- **Parts of the sources the readers only skimmed:** pi `branch-summarization.ts` and `packages/durable`; opencode's per-protocol adapters and model snapshot; Codex `compact_remote_v2_images.rs` and the app server; Cline `basic-compaction.ts` line by line and where it places cache breakpoints; most of Mastra's 180 KB `observational-memory.ts`. The Mastra, LangChain and OpenAI Agents findings were gathered by a second-level reader, and I re-checked only their main constants.
- **Cline's in-repo docs say** "Summarization leverages your existing prompt cache", which does not match the SDK code read (it sends a separately serialised request). One of the two is out of date.
- **A Vercel AI SDK doc line says** OpenAI compaction items come back "as text parts"; its code emits a custom part with `encryptedContent`. The code is the authority.

## Sources

Provider documentation, retrieved 2026-10-13.

Anthropic
- [Context windows][a-context-windows], [Compaction overview][a-compact], [Compaction on demand][a-compact-demand], [Compaction at a token threshold][a-compact-threshold], [Compaction that keeps recent turns][a-compact-keep], [Compaction in the background][a-compact-bg]
- [Context editing][a-context-editing], [Memory tool][a-memory], [Tool search tool][a-tool-search], [Manage tool context](https://platform.claude.com/docs/en/agents-and-tools/tool-use/manage-tool-context)
- [Token counting][a-count], [Prompt caching][a-caching], [Models overview][a-models], [List models][a-models-list], [Errors][a-errors], [Stop reasons][a-stop]
- [Effective context engineering for AI agents][a-eng] (Anthropic engineering, published 2025-09-29), [Agent SDK subagents][a-subagents], [Agent SDK hooks](https://code.claude.com/docs/en/agent-sdk/hooks)

OpenAI
- [Compaction guide][o-compaction], [Responses create reference][o-create], [Responses compact reference](https://developers.openai.com/api/reference/resources/responses/methods/compact), [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state)
- [Prompt caching][o-caching], [Counting tokens][o-count], [Tool search][o-tool-search], [Model object][o-model-object], [GPT-5.6][o-model-56], [Error codes](https://developers.openai.com/api/docs/guides/error-codes)

Google
- [Understand and count tokens][g-tokens], [API: counting tokens][g-api-tokens], [API: generating content][g-api-gen], [API: models][g-api-models], [gemini-3.5-flash-lite][g-model]
- [Context caching (Interactions)][g-caching], [Context caching (generateContent)][g-caching-explicit], [Long context][g-long], [Interactions API][g-interactions], [Troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting), [documentation index](https://ai.google.dev/gemini-api/docs/llms.txt)

Source code, at these commits

| Project | Commit | Commit date |
| --- | --- | --- |
| [badlogic/pi-mono](https://github.com/badlogic/pi-mono/tree/3daa20280f6a7c7cbe0935680c9a38fdc3863005) | `3daa2028` | 2026-10-13 |
| [sst/opencode](https://github.com/sst/opencode/tree/e9def88a7790efc6abace15b67f3625ff4d66237) | `e9def88a` | 2026-10-13 |
| [openai/codex](https://github.com/openai/codex/tree/cf0ed4c600161fcaa18eeac02b5fc715e1076955) | `cf0ed4c6` | 2026-10-13 |
| [cline/cline](https://github.com/cline/cline/tree/ed469c753a0d7a0d41f906cf3fc75a983cd766ac) | `ed469c75` | 2026-10-13 |
| [Aider-AI/aider](https://github.com/Aider-AI/aider/tree/5dc9490bb35f9729ef2c95d00a19ccd30c26339c) | `5dc9490b` | 2026-05-22 |
| [vercel/ai](https://github.com/vercel/ai/tree/c71a1b52cf8a6c78b810c887a32a280f73db9940) | `c71a1b52` | 2026-10-13 |
| [mastra-ai/mastra](https://github.com/mastra-ai/mastra/tree/b9197fdea41a28981ca1a9fc77947ca1bf7d1f90) | `b9197fde` | 2026-10-13 |
| [langchain-ai/langchainjs](https://github.com/langchain-ai/langchainjs/tree/d3e6fe66a5f902fa615f076ca71d9541f1291166) | `d3e6fe66` | 2026-10-13 |
| [langchain-ai/langgraphjs](https://github.com/langchain-ai/langgraphjs/tree/4510774dd362264f44efd34b29b4f5648eeb4c4c) | `4510774d` | 2026-10-12 |
| [openai/openai-agents-js](https://github.com/openai/openai-agents-js/tree/89a9ddf1e241e75f2e0ad4c15d89de9e215ebac6) | `89a9ddf1` | 2026-10-09 |
| [anthropics/claude-agent-sdk-typescript](https://github.com/anthropics/claude-agent-sdk-typescript/tree/85d8f8e0772199ec7965a0c2e874ac88343f2a01) | `85d8f8e0` | 2026-10-09 |

Two of these differ from what older write-ups describe. opencode at this commit is a rewrite with its session code in `packages/core/src/session/`, and its old tool-result prune pass is gone. Cline at this commit is an SDK monorepo, and its old "keep the first pair, drop half" truncation survives only as a migration comment.

[a-context-windows]: https://platform.claude.com/docs/en/build-with-claude/context-windows
[a-compact]: https://platform.claude.com/docs/en/build-with-claude/compaction
[a-compact-demand]: https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand
[a-compact-threshold]: https://platform.claude.com/docs/en/build-with-claude/compaction-threshold
[a-compact-keep]: https://platform.claude.com/docs/en/build-with-claude/compaction-keep-recent-turns
[a-compact-bg]: https://platform.claude.com/docs/en/build-with-claude/compaction-background
[a-context-editing]: https://platform.claude.com/docs/en/build-with-claude/context-editing
[a-memory]: https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool
[a-tool-search]: https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool
[a-count]: https://platform.claude.com/docs/en/build-with-claude/token-counting
[a-caching]: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
[a-models]: https://platform.claude.com/docs/en/about-claude/models/overview
[a-models-list]: https://platform.claude.com/docs/en/api/models/list
[a-errors]: https://platform.claude.com/docs/en/api/errors
[a-stop]: https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons
[a-eng]: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
[a-subagents]: https://code.claude.com/docs/en/agent-sdk/subagents
[o-compaction]: https://developers.openai.com/api/docs/guides/compaction
[o-create]: https://developers.openai.com/api/reference/resources/responses/methods/create
[o-caching]: https://developers.openai.com/api/docs/guides/prompt-caching
[o-count]: https://developers.openai.com/api/docs/guides/token-counting
[o-tool-search]: https://developers.openai.com/api/docs/guides/tools-tool-search
[o-model-object]: https://developers.openai.com/api/reference/resources/models/methods/retrieve
[o-model-56]: https://developers.openai.com/api/docs/models/gpt-5.6
[g-tokens]: https://ai.google.dev/gemini-api/docs/tokens
[g-api-tokens]: https://ai.google.dev/api/tokens
[g-api-gen]: https://ai.google.dev/api/generate-content
[g-api-models]: https://ai.google.dev/api/models
[g-model]: https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite
[g-caching]: https://ai.google.dev/gemini-api/docs/caching
[g-caching-explicit]: https://ai.google.dev/gemini-api/docs/generate-content/caching
[g-long]: https://ai.google.dev/gemini-api/docs/long-context
[g-interactions]: https://ai.google.dev/gemini-api/docs/interactions
[pi-compaction]: https://github.com/badlogic/pi-mono/blob/3daa20280f6a7c7cbe0935680c9a38fdc3863005/packages/coding-agent/src/core/compaction/compaction.ts
[pi-utils]: https://github.com/badlogic/pi-mono/blob/3daa20280f6a7c7cbe0935680c9a38fdc3863005/packages/coding-agent/src/core/compaction/utils.ts
[pi-messages]: https://github.com/badlogic/pi-mono/blob/3daa20280f6a7c7cbe0935680c9a38fdc3863005/packages/coding-agent/src/core/messages.ts
[pi-session]: https://github.com/badlogic/pi-mono/blob/3daa20280f6a7c7cbe0935680c9a38fdc3863005/packages/coding-agent/src/core/agent-session.ts
[pi-truncate]: https://github.com/badlogic/pi-mono/blob/3daa20280f6a7c7cbe0935680c9a38fdc3863005/packages/coding-agent/src/core/tools/truncate.ts
[pi-bash]: https://github.com/badlogic/pi-mono/blob/3daa20280f6a7c7cbe0935680c9a38fdc3863005/packages/coding-agent/src/core/tools/bash.ts
[pi-overflow]: https://github.com/badlogic/pi-mono/blob/3daa20280f6a7c7cbe0935680c9a38fdc3863005/packages/ai/src/utils/overflow.ts
[pi-transform]: https://github.com/badlogic/pi-mono/blob/3daa20280f6a7c7cbe0935680c9a38fdc3863005/packages/ai/src/api/transform-messages.ts
[pi-anthropic]: https://github.com/badlogic/pi-mono/blob/3daa20280f6a7c7cbe0935680c9a38fdc3863005/packages/ai/src/api/anthropic-messages.ts
[pi-google]: https://github.com/badlogic/pi-mono/blob/3daa20280f6a7c7cbe0935680c9a38fdc3863005/packages/ai/src/api/google-generative-ai.ts
[pi-simple]: https://github.com/badlogic/pi-mono/blob/3daa20280f6a7c7cbe0935680c9a38fdc3863005/packages/ai/src/api/simple-options.ts
[pi-genmodels]: https://github.com/badlogic/pi-mono/blob/3daa20280f6a7c7cbe0935680c9a38fdc3863005/packages/ai/scripts/generate-models.ts
[pi-loop]: https://github.com/badlogic/pi-mono/blob/3daa20280f6a7c7cbe0935680c9a38fdc3863005/packages/agent/src/agent-loop.ts
[oc-compaction]: https://github.com/sst/opencode/blob/e9def88a7790efc6abace15b67f3625ff4d66237/packages/core/src/session/compaction.ts
[oc-model-request]: https://github.com/sst/opencode/blob/e9def88a7790efc6abace15b67f3625ff4d66237/packages/core/src/session/model-request.ts
[oc-tollm]: https://github.com/sst/opencode/blob/e9def88a7790efc6abace15b67f3625ff4d66237/packages/core/src/session/runner/to-llm-message.ts
[oc-step]: https://github.com/sst/opencode/blob/e9def88a7790efc6abace15b67f3625ff4d66237/packages/core/src/session/runner/step.ts
[oc-llm]: https://github.com/sst/opencode/blob/e9def88a7790efc6abace15b67f3625ff4d66237/packages/core/src/session/runner/llm.ts
[oc-context]: https://github.com/sst/opencode/blob/e9def88a7790efc6abace15b67f3625ff4d66237/packages/core/src/session/context.ts
[oc-tooloutput]: https://github.com/sst/opencode/blob/e9def88a7790efc6abace15b67f3625ff4d66237/packages/core/src/tool-output.ts
[oc-normalize]: https://github.com/sst/opencode/blob/e9def88a7790efc6abace15b67f3625ff4d66237/packages/core/src/config/normalize.ts
[oc-modelsdev]: https://github.com/sst/opencode/blob/e9def88a7790efc6abace15b67f3625ff4d66237/packages/core/src/models-dev.ts
[oc-subagent]: https://github.com/sst/opencode/blob/e9def88a7790efc6abace15b67f3625ff4d66237/packages/core/src/tool/plugin/subagent.ts
[oc-error]: https://github.com/sst/opencode/blob/e9def88a7790efc6abace15b67f3625ff4d66237/packages/ai/src/provider-error.ts
[oc-cache]: https://github.com/sst/opencode/blob/e9def88a7790efc6abace15b67f3625ff4d66237/packages/ai/src/cache-policy.ts
[cx-compact]: https://github.com/openai/codex/blob/cf0ed4c600161fcaa18eeac02b5fc715e1076955/codex-rs/core/src/compact.rs
[cx-remote]: https://github.com/openai/codex/blob/cf0ed4c600161fcaa18eeac02b5fc715e1076955/codex-rs/core/src/compact_remote_v2_attempt.rs
[cx-history]: https://github.com/openai/codex/blob/cf0ed4c600161fcaa18eeac02b5fc715e1076955/codex-rs/core/src/context_manager/history.rs
[cx-normalize]: https://github.com/openai/codex/blob/cf0ed4c600161fcaa18eeac02b5fc715e1076955/codex-rs/core/src/context_manager/normalize.rs
[cx-turn]: https://github.com/openai/codex/blob/cf0ed4c600161fcaa18eeac02b5fc715e1076955/codex-rs/core/src/session/turn.rs
[cx-models]: https://github.com/openai/codex/blob/cf0ed4c600161fcaa18eeac02b5fc715e1076955/codex-rs/protocol/src/openai_models.rs
[cx-modelinfo]: https://github.com/openai/codex/blob/cf0ed4c600161fcaa18eeac02b5fc715e1076955/codex-rs/models-manager/src/model_info.rs
[cx-error]: https://github.com/openai/codex/blob/cf0ed4c600161fcaa18eeac02b5fc715e1076955/codex-rs/codex-api/src/sse/responses_error.rs
[cx-truncate]: https://github.com/openai/codex/blob/cf0ed4c600161fcaa18eeac02b5fc715e1076955/codex-rs/utils/string/src/truncate.rs
[cx-prompt]: https://github.com/openai/codex/blob/cf0ed4c600161fcaa18eeac02b5fc715e1076955/codex-rs/prompts/templates/compact/prompt.md
[cx-prefix]: https://github.com/openai/codex/blob/cf0ed4c600161fcaa18eeac02b5fc715e1076955/codex-rs/prompts/templates/compact/summary_prefix.md
[cl-shared]: https://github.com/cline/cline/blob/ed469c753a0d7a0d41f906cf3fc75a983cd766ac/sdk/packages/core/src/extensions/context/compaction-shared.ts
[cl-compaction]: https://github.com/cline/cline/blob/ed469c753a0d7a0d41f906cf3fc75a983cd766ac/sdk/packages/core/src/extensions/context/compaction.ts
[cl-basic]: https://github.com/cline/cline/blob/ed469c753a0d7a0d41f906cf3fc75a983cd766ac/sdk/packages/core/src/extensions/context/basic-compaction.ts
[cl-builder]: https://github.com/cline/cline/blob/ed469c753a0d7a0d41f906cf3fc75a983cd766ac/sdk/packages/core/src/session/services/message-builder.ts
[cl-limits]: https://github.com/cline/cline/blob/ed469c753a0d7a0d41f906cf3fc75a983cd766ac/sdk/packages/core/src/extensions/tools/executors/output-limits.ts
[cl-tokens]: https://github.com/cline/cline/blob/ed469c753a0d7a0d41f906cf3fc75a983cd766ac/sdk/packages/shared/src/llms/tokens.ts
[ai-models]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/models.py
[ai-history]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/history.py
[ai-prompts]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/prompts.py
[ai-commands]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/commands.py
[ai-coder]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py
[ai-chunks]: https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/chat_chunks.py
[ai-usage-shape]: https://github.com/vercel/ai/blob/c71a1b52cf8a6c78b810c887a32a280f73db9940/packages/provider/src/language-model/v4/language-model-v4-usage.ts
[ai-usage-anthropic]: https://github.com/vercel/ai/blob/c71a1b52cf8a6c78b810c887a32a280f73db9940/packages/anthropic/src/convert-anthropic-usage.ts
[ai-usage-openai]: https://github.com/vercel/ai/blob/c71a1b52cf8a6c78b810c887a32a280f73db9940/packages/openai/src/responses/convert-openai-responses-usage.ts
[ai-openai-options]: https://github.com/vercel/ai/blob/c71a1b52cf8a6c78b810c887a32a280f73db9940/packages/openai/src/responses/openai-responses-language-model-options.ts
[ai-openai-input]: https://github.com/vercel/ai/blob/c71a1b52cf8a6c78b810c887a32a280f73db9940/packages/openai/src/responses/convert-to-openai-responses-input.ts
[ai-prune]: https://github.com/vercel/ai/blob/c71a1b52cf8a6c78b810c887a32a280f73db9940/packages/ai/src/generate-text/prune-messages.ts
[ai-tool]: https://github.com/vercel/ai/blob/c71a1b52cf8a6c78b810c887a32a280f73db9940/packages/provider-utils/src/types/tool.ts
[ma-tokenlimiter]: https://github.com/mastra-ai/mastra/blob/b9197fdea41a28981ca1a9fc77947ca1bf7d1f90/packages/core/src/processors/processors/token-limiter.ts
[ma-toolfilter]: https://github.com/mastra-ai/mastra/blob/b9197fdea41a28981ca1a9fc77947ca1bf7d1f90/packages/core/src/processors/processors/tool-call-filter.ts
[ma-workingmemory]: https://github.com/mastra-ai/mastra/blob/b9197fdea41a28981ca1a9fc77947ca1bf7d1f90/packages/core/src/processors/memory/working-memory.ts
[ma-om-constants]: https://github.com/mastra-ai/mastra/blob/b9197fdea41a28981ca1a9fc77947ca1bf7d1f90/packages/memory/src/processors/observational-memory/constants.ts
[ma-om-docs]: https://github.com/mastra-ai/mastra/blob/b9197fdea41a28981ca1a9fc77947ca1bf7d1f90/docs/src/content/en/docs/memory/observational-memory.mdx
[lc-summarization]: https://github.com/langchain-ai/langchainjs/blob/d3e6fe66a5f902fa615f076ca71d9541f1291166/libs/langchain/src/agents/middleware/summarization.ts
[lc-contextediting]: https://github.com/langchain-ai/langchainjs/blob/d3e6fe66a5f902fa615f076ca71d9541f1291166/libs/langchain/src/agents/middleware/contextEditing.ts
[lc-profile]: https://github.com/langchain-ai/langchainjs/blob/d3e6fe66a5f902fa615f076ca71d9541f1291166/libs/langchain-core/src/language_models/profile.ts
[oa-compaction]: https://github.com/openai/openai-agents-js/blob/89a9ddf1e241e75f2e0ad4c15d89de9e215ebac6/packages/agents-openai/src/memory/openaiResponsesCompactionSession.ts
[oa-sessions]: https://github.com/openai/openai-agents-js/blob/89a9ddf1e241e75f2e0ad4c15d89de9e215ebac6/docs/src/content/docs/guides/sessions.mdx
