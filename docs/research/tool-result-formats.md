# Research — which format a tool result should use

Date: 2026-10-14 · Status: research note, not a decision

The question: in which text format should a tool hand its result to the model, so that the model reads it correctly and the result costs few tokens? The concrete case is `read_set`, which returns an overview of a Live Set: tempo, time signature, and for each track (often 50–60) its object id (`t17`), name, kind (audio, midi, group, return, main), parent group, volume (`-3.0 dB`), pan (`C`, `25L`), sends, mute and solo, and a list of devices, each with an object id (`d204`), a name and a third-party-plug-in flag. That is a list of records with a nested list in each record, and not every record has every field.

Formats compared: JSON (pretty and minified), TOON (Token-Oriented Object Notation), YAML, CSV and Markdown tables, XML, Markdown lists, and custom plain text with one line per record.

Third-party code was read at these commits: ableton-mcp `9dddc7b` (2026-09-22), ableton-mcp-extended `1116449` (2026-05-06), reaper-mcp `4dcc8f8` (2026-10-07), MCP python-sdk `6f69a37` (v2.0.0), Producer Pal `52a4c21` (2026-10-01), github-mcp-server `c59e8c1` (2026-10-13), Codex `78dc250` (2026-10-14), pi-mono `6374c2b` (2026-10-14), Vercel AI SDK `6ac1ee1` (2026-10-13), toon `e247c42` (2026-10-09), toon spec `d09c3d3` (2026-10-08). This repo was read at `5466fd2`.

Markers: **[verified]** read in an official doc or spec · **[code]** read in source at the commit above · **[third-party]** a claim or benchmark by someone else, reported as they state it · **[local]** measured here · **[inferred]** my conclusion · **[unverified]** could not confirm.

## Short answer

No source settles this for our case. The evidence is thin and points in different directions.

1. **Accuracy.** Published tests disagree on which format is read best, and the winner changes with the model and with the shape of the data. HTML won in one table study, JSON in another, Markdown key-value lists for flat records and YAML for deeply nested data in a third. Larger models are less sensitive to format than small ones. No published test used a Gemini 3.x Flash Lite model on data shaped like `read_set`. **[third-party]**, see [Accuracy benchmarks](#accuracy-benchmarks)
2. **Tokens.** On a 53-track sample shaped like `read_set`, one line per track (plain text) or a table with devices in one cell cost about half the tokens of minified JSON and about a quarter to a third of pretty JSON. TOON cost about the same as minified JSON, because the nested device list stops TOON from using its compact table form. **[local]**, see [Token counts](#token-counts)
3. **Providers.** None names a best format for tool results. Anthropic says to choose by your own evaluation. OpenAI says the format is "up to you". Gemini's `generateContent` API requires the function response to be a JSON object, so any text format travels as a string value inside that object, which is what our Gemini adapter does today. **[verified]**, see [What providers recommend](#what-providers-recommend)
4. **Practice.** The DAW MCP servers read here return pretty-printed JSON (ableton-mcp, its fork, reaper-mcp) or a compact JavaScript-style literal (Producer Pal). The general harnesses return compact JSON (GitHub MCP server, Codex for structured MCP results) or plain text (Codex shell output, pi). Producer Pal and the GitHub server save more by leaving fields out than by changing the format. **[code]**, see [What other tool sets return](#what-other-tool-sets-return)
5. **TOON** is `@toon-format/toon` 4.4.0, MIT, no runtime dependencies. Its own README says to use something else for nested or non-uniform data. Its own benchmark shows a small accuracy lead that is inside its confidence intervals. **[verified]** / **[third-party]**, see [TOON](#toon)

Options the evidence supports:

- **A. Minified JSON, with false and empty fields left out.** The safe default. Every model is trained on it, it needs no legend, and it keeps nesting. About 15 % fewer tokens than plain minified JSON on our sample. **[local]**
- **B. One line per track in a custom plain-text form**, with devices inline and a legend in the tool description. About half the tokens of minified JSON. Needs a written legend and escaping rules for names, and no benchmark tested a custom format like it. **[inferred]**
- **C. Two flat tables** (tracks, then devices keyed by track id) as Markdown or TOON tables. In between on tokens, but splits each track's devices away from the track.
- **D. Keep JSON and cut content instead**: an `include` option or a short and a detailed view, as Producer Pal and Anthropic's tool-writing post do. This works with any of A–C.

What a local eval would need to settle it: the same `read_set` result rendered in two or three candidate formats; 15–25 questions with answers that can be checked in the reply text (a track's volume, which devices are plug-ins, which tracks are in a group, the id of a device to act on next, a follow-up tool call with the right `t`/`d` id); gemini-3.5-flash-lite through our own adapter; five or more runs per question per format; and a report of correct answers and input tokens per format. The repo has no eval runner, so this would be a throwaway script outside the repo, with results reported as observed.

## What our harness sends today

A tool returns a string. The `tool_result` message holds `output: string` and `isError: boolean`. **[code]** [`packages/harness/src/types.ts`](../../packages/harness/src/types.ts)

The Gemini adapter puts that string in a JSON object: `functionResponse.response` is `{ result: output }`, or `{ error: output }` when the tool failed. **[code]** [`packages/harness/src/providers/gemini.ts` L69–78](../../packages/harness/src/providers/gemini.ts)

The fake Ableton tools return `JSON.stringify(session)`, minified JSON. **[code]** [`packages/tools/src/daws/ableton/fake-ableton.ts` at `5466fd2`](https://github.com/amitbaz/music-production-ai-mentor/blob/5466fd2/packages/tools/src/daws/ableton/fake-ableton.ts), since deleted

So whatever format `read_set` picks, the model receives it as one JSON string value. Inside the request body, quotes and newlines in that string are escaped. How Google turns a `functionResponse` into tokens for the model is not documented. **[unverified]**

## Accuracy benchmarks

All of these measure reading accuracy by format. None tested Gemini 3.x Flash Lite, and none tested tool results inside a multi-turn agent, except the "Notation Matters" paper (abstract only).

| Study | Runner, stake | Models | Data and size | Result |
| --- | --- | --- | --- | --- |
| He et al., "Does Prompt Formatting Have Any Impact on LLM Performance?" (arXiv 2411.10541, 2024-11) | Microsoft and MIT; no stake | gpt-35-turbo (2 versions), gpt-4-32k, gpt-4-1106-preview | The whole prompt template as plain text, Markdown, YAML or JSON. MMLU, NER Finance (500 samples), HumanEval, FIND (500 functions), two code translation sets | No format wins. On MMLU, GPT-3.5 does best with JSON (59.7) and worst with Markdown (50.0); GPT-4-1106 is the reverse (81.2 vs 73.9). "GPT-3.5-turbo's performance varies by up to 40% in a code translation task depending on the prompt template, while larger models like GPT-4 are more robust." This formats instructions, not a data payload. |
| Sui et al., "Table Meets LLM" (WSDM 2024, arXiv 2305.13062) | Microsoft; no format stake | text-davinci-003; GPT-4 on 300 samples per task | 7 table-structure tasks, 1,500 tables per task, one-shot | HTML best on most tasks, e.g. size detection HTML 67.0 %, JSON 42.7 %, Markdown 40.7 % on GPT-3.5. "using markup languages, specifically HTML, outperforms 'NL+Sep' with a 6.76% improvement". No token counts. |
| Singha et al., "Tabular Representation, Noisy Operators…" (arXiv 2310.10358, 2023-10) | Microsoft; no stake | text-davinci-003 | 8 table formats, 100 tests per combination | Fact-finding pass@1: pandas-code 79.8, JSON 77.9, CSV/TSV about 75.8, HTML 71.4, Markdown 67.3. "we found that the HTML format underperforms alternatives like the JSON and DFLoader formats." |
| Improving Agents, "Which Table Format Do LLMs Understand Best?" (2025-09, updated 2025-11) | Blog, no named author; no format stake | GPT-4.1-nano | 1,000 flat employee records, 8 fields, 1,000 lookup questions per format | Markdown key-value 60.7 % (52,104 tokens), XML 56.0 % (76,114), YAML 54.7 % (55,395), JSON 52.3 % (66,396), Markdown table 51.9 % (25,140), TOON 47.5 % (21,518), CSV 44.3 % (19,524). |
| Improving Agents, "Which Nested Data Format…" (2025-10) | Same | GPT-5 Nano, Gemini 2.5 Flash Lite, Llama 3.2 3B | Config nested 6–7 levels, 1,000 questions per format | GPT-5 Nano: YAML 62.1 %, Markdown 54.3 %, JSON 50.3 %, XML 44.4 %, TOON 43.1 %. **Gemini 2.5 Flash Lite: YAML 51.9 %, Markdown 48.2 %, JSON 43.1 %, XML 33.8 %.** Llama: no significant difference. "XML required 80% more tokens than Markdown." |
| Improving Agents, "TOON Benchmarks" (2025-10) | Same | — | Reran TOON's tests | "we failed to find circumstances where TOON was the best-performing format." |
| TOON's own benchmark (toon README at `e247c42`) | **The format's authors; high stake** | claude-haiku-4-5, gemini-3.6-flash, gpt-5.4-nano, grok-4.5; reasoning off | 244 generated questions × 6 formats × 4 models = 5,856 calls, checked without an LLM judge | TOON 72.2 % (2,474 tokens), JSON 71.4 % (4,308), XML 70.7 %, YAML 70.1 %, JSON compact 69.0 % (2,892). The README says overlapping ±2.8 intervals mean the difference "is not statistically meaningful". On deep config: JSON 94.8, TOON 91.4. |
| Kutschka and Geiger, "Notation Matters" (arXiv 2605.29676, 2026-05), abstract only | No stake | 5 open-weight setups (Qwen3-32B, DeepSeek-R1-Distill, Mistral, Llama-4-Scout) | BFCL, MCPToolBench++, MCP-Universe, StableToolBench | "TOON achieves up to 18% reduction at a similar 9pp accuracy cost, but additionally cascades on multi-turn parsing failures"; "the format–model interaction is comparable in magnitude to the format choice itself". |

All rows **[third-party]**. Sources: [arXiv 2411.10541](https://arxiv.org/abs/2411.10541), [arXiv 2305.13062](https://arxiv.org/abs/2305.13062), [arXiv 2310.10358](https://arxiv.org/abs/2310.10358), [Improving Agents table formats](https://www.improvingagents.com/blog/best-input-data-format-for-llms), [nested formats](https://www.improvingagents.com/blog/best-nested-data-format), [TOON benchmarks](https://www.improvingagents.com/blog/toon-benchmarks), [toon README](https://github.com/toon-format/toon/blob/e247c423e0a38bca3477b17fecdf6ef4feeb5584/packages/toon/README.md), [arXiv 2605.29676](https://arxiv.org/abs/2605.29676).

Notes on these results:

- TOON's overall lead rests partly on 5 "structural validation" questions built around TOON's declared lengths, where TOON scores 100 % and JSON 50 % ([README L294](https://github.com/toon-format/toon/blob/e247c423e0a38bca3477b17fecdf6ef4feeb5584/packages/toon/README.md#L294)). Taking those 20 evaluations out of the per-model totals leaves TOON and JSON at about 71.7 % and 71.9 %. **[inferred]** from the README's tables; the arithmetic was not rechecked against the raw results files.
- Two 2026 papers propose competing formats (JTON, arXiv 2604.05865; ONTO, arXiv 2604.17512) and test their own. They have a stake, and only their abstracts were read. **[third-party]**
- "Are LLMs Ready for TOON?" (arXiv 2601.12014) tests TOON as model output, not as input to read, so it does not apply to tool results. **[third-party]**, abstract only.
- The one row closest to our model is Gemini 2.5 Flash Lite on nested data, where YAML and Markdown beat JSON by 5–9 points and XML trailed. It is an older model, a different data shape (deep config, not a list of records), and one blog's test. **[inferred]**
- Anthropic, OpenAI and Google publish no format benchmark with numbers. OpenAI's GPT-4.1 guide reports results from its own "long context testing" without method or numbers (see below). **[verified]**

## Token counts

### Published

- Improving Agents, flat records: CSV 19,524, TOON 21,518, Markdown table 25,140, Markdown key-value 52,104, YAML 55,395, JSON 66,396, XML 76,114 tokens for the same 1,000 records. "the top-performing Markdown-KV format used 2.7 times as many tokens as … CSV." **[third-party]**
- TOON's benchmark, all datasets (o200k_base): TOON 2,474, JSON compact 2,892, YAML 3,487, JSON 4,308, XML 4,909 average tokens. On its mixed-structure track TOON is +1.6 % against compact JSON overall, +5.6 % on nested e-commerce orders and +19.9 % on semi-uniform event logs. **[third-party]** [README L459–471](https://github.com/toon-format/toon/blob/e247c423e0a38bca3477b17fecdf6ef4feeb5584/packages/toon/README.md#L459-L471)
- Anthropic's tool-writing post: the same result as "detailed" was 206 tokens and as "concise" 72 tokens, "~⅓ of the tokens". This changes content, not format. **[verified]**

### Measured here

A throwaway script (in the session scratchpad, not in the repo) built a synthetic Set shaped like `read_set`: tempo, time signature, 53 tracks (5 groups, 45 tracks, 2 returns, main), 129 devices, about 30 % third-party plug-ins, two sends per track. Every format held the same facts. Formats were written by hand except TOON (`@toon-format/toon` 4.4.0, `encode`) and YAML (`yaml` 2.9.1). Node 22.23.3. **[local]**

Tokenizers: o200k_base and cl100k_base from `gpt-tokenizer` 4.0.0, and the Gemma 3 tokenizer (`tokenizer.json` from `unsloth/gemma-3-1b-it`, an ungated copy of Google's, revision `5b11413`). The Gemma 3 report says "We use the same tokenizer as Gemini 2.0", with 262k entries ([arXiv 2503.19786](https://arxiv.org/abs/2503.19786)). **[verified]** Whether Gemini 3.5 Flash Lite still uses that tokenizer is **[unverified]**, so every count below is an approximation for our model.

| Format | Gemma 3 | vs JSON min | o200k | vs JSON min | Notes |
| --- | ---: | ---: | ---: | ---: | --- |
| CSV, devices in one cell | 2,537 | 0.49 | 2,223 | 0.43 | Flattened; devices as `d204 EQ Eight; d205 Serum [plug-in]` |
| Plain text, one line per track | 2,809 | 0.54 | 2,571 | 0.50 | `t1 Drums \| group \| -5.4 dB \| pan C \| sends A -inf dB, B -9.5 dB \| d200 Compressor, d201 Glue Compressor` |
| Markdown table, devices in one cell | 3,063 | 0.59 | 2,799 | 0.55 | |
| Markdown list, devices as sub-items | 3,226 | 0.62 | 3,000 | 0.59 | |
| TOON, two flat tables (tracks, devices) | 3,768 | 0.72 | 3,141 | 0.61 | Data reshaped so TOON can use its table form |
| JSON minified, false and empty fields left out | 4,467 | 0.86 | 4,366 | 0.85 | |
| XML, attributes | 5,036 | 0.97 | 4,546 | 0.89 | `<track id="t1" …><device …/></track>` |
| **JSON minified** | **5,216** | **1.00** | **5,116** | **1.00** | |
| TOON, false fields left out | 5,391 | 1.03 | 4,901 | 0.96 | |
| TOON (default) | 5,813 | 1.11 | 5,204 | 1.02 | Falls back to list form, 739 lines |
| TOON, tab delimiter | 5,866 | 1.12 | 5,257 | 1.03 | |
| JSON minified, two flat tables | 5,779 | 1.11 | 5,516 | 1.08 | |
| YAML | 6,414 | 1.23 | 6,075 | 1.19 | |
| JSON pretty (2 spaces) | 10,014 | 1.92 | 8,525 | 1.67 | |

cl100k counts were within 5 % of o200k for every format. **[local]**

What the numbers show:

- **TOON gains nothing on this shape.** The `devices` field is an array, so the `tracks` array cannot use TOON's table form and is written as a YAML-like list with one key per line. Values that start with `-`, such as `-5.4 dB`, are quoted, which adds tokens. **[local]** This matches the spec: any array value in a column "disqualifies the whole array". **[verified]** [SPEC §9.3](https://github.com/toon-format/spec/blob/d09c3d33e37389345a74bd96981eb96dd9be6c5e/SPEC.md#L477-L494)
- **Most of the saving comes from dropping repeated keys and punctuation**, which every row-per-track format does. Leaving out false and empty fields saves another 15 % in JSON. **[local]**
- **The JSON string wrapper costs little.** Wrapping the result as `{"result": "<escaped text>"}` changed the Gemma 3 count from 5,216 to 5,506 for minified JSON (escaped quotes), from 2,809 to 2,802 for plain text, and from 5,813 to 6,455 for TOON (escaped newlines and quotes). **[local]** Whether the model sees the escaped form at all is **[unverified]**.
- For scale: the cheapest and the dearest form differ by about 7,500 tokens per call on this sample (Gemma 3 counts). **[local]**

## What providers recommend

**Anthropic**

- A `tool_result` content can be "a string … a list of nested content blocks … or a list of document blocks", with `text`, `image`, `document` or `search_result` blocks. The page says nothing about which text format to use. **[verified]** [Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)
- "Even your tool response structure—for example XML, JSON, or Markdown—can have an impact on evaluation performance: there is no one-size-fits-all solution. … The optimal response structure will vary widely by task and agent. We encourage you to select the best response structure based on your own evaluation." **[verified]** [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) (2025-09-11)
- The same post: return "only high signal information", avoid "low-level technical identifiers (for example: `uuid` …)", and resolving UUIDs to meaningful names "(or even a 0-indexed ID scheme) significantly improves Claude's precision in retrieval tasks by reducing hallucinations". It suggests a `response_format` enum (`"concise"` or `"detailed"`), and pagination, filtering or truncation; "For Claude Code, we restrict tool responses to 25,000 tokens by default." **[verified]** Our short ids (`t17`, `d204`) are close to what it recommends. **[inferred]**
- For data in prompts generally: "XML tags help Claude parse complex prompts unambiguously", and put long data at the top with the query last. **[verified]** [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)

**Google Gemini**

- `FunctionResponse.response` is "The function response in JSON object format. Callers can use any keys of their choice that fit the function's syntax to return the function output, e.g. "output", "result", etc. In particular, if the function call failed to execute, the response can have an "error" key". **[verified]** [generateContent reference](https://ai.google.dev/api/generate-content). A bare string is not allowed there, so a text result has to sit under a key, as our adapter does with `result`. **[inferred]**
- The newer Interactions API accepts a function result that is "array (ImageContent or TextContent) or object or string", with an `is_error` flag. **[verified]** [Interactions reference](https://ai.google.dev/api/interactions). Our adapter uses `generateContent`. **[code]**
- The function calling guide's best practices cover descriptions, typing, keeping 10–20 tools and error handling, and say nothing about the result's format. **[verified]** [Function calling](https://ai.google.dev/gemini-api/docs/function-calling)
- For prompts: "XML-style tags (e.g., `<context>`, `<task>`) or Markdown headings are effective. Choose one format and use it consistently within a single prompt", and supply large context first with the question at the end. **[verified]** [Prompt design strategies](https://ai.google.dev/gemini-api/docs/prompting-strategies)
- No Google page found compares formats for tool results or data. **[unverified]** that none exists.

**OpenAI**

- "The result you pass in the `function_call_output` message should typically be a string, where the format is up to you (JSON, error codes, plain text, etc.). The model will interpret that string as needed." **[verified]** [Function calling guide](https://platform.openai.com/docs/guides/function-calling)
- GPT-4.1 guide, for many documents in context: "XML performed well in our long context testing", the pipe form `ID: 1 | TITLE: The Fox | CONTENT: …` "also performed well", and "JSON performed particularly poorly". It also says JSON "can be more verbose, and require character escaping that can add overhead". No method or numbers are given. **[verified]** [GPT-4.1 prompting guide](https://cookbook.openai.com/examples/gpt4-1_prompting_guide). This is about long documents, not short records, and about an OpenAI model. **[inferred]**

**MCP**

- A tool result holds `content` (text, image, audio, resource link, embedded resource) and optionally `structuredContent`, "any JSON value". "For backwards compatibility, a tool that returns structured content SHOULD also return the serialized JSON in a TextContent block." **[verified]** [MCP spec, tools, revision 2026-07-28](https://modelcontextprotocol.io/specification/latest/server/tools). The spec does not say which format the text should use. **[verified]**

## What other tool sets return

Every project read sends the model text. The differences are in what the text is, and in how much is left out.

| Project | What the read tool returns | Saving measures | Source |
| --- | --- | --- | --- |
| ahujasid/ableton-mcp | `json.dumps(result, indent=2)`, pretty JSON; every field, defaults included; errors as a plain string | None | [`server.py` L420–432](https://github.com/ahujasid/ableton-mcp/blob/9dddc7bd5b95412510fdeb745949e3bf23f3fd8a/MCP_Server/server.py#L420-L432), [L460–474](https://github.com/ahujasid/ableton-mcp/blob/9dddc7bd5b95412510fdeb745949e3bf23f3fd8a/MCP_Server/server.py#L460-L474) |
| uisato/ableton-mcp-extended | Same as above (a fork) | None | [`server.py` L385–410](https://github.com/uisato/ableton-mcp-extended/blob/11164498a31e782ca3d3f4ac67cbb526df0166e7/MCP_Server/server.py#L385-L410) |
| bonfire-systems/reaper-mcp | A Python dict, serialised by the MCP SDK as `to_json(result, indent=2)`, pretty JSON | None seen | [`project_tools.py` L135–149](https://github.com/bonfire-systems/reaper-mcp/blob/4dcc8f8f5a7a2d41076e41c3fd4dd9487d950c63/src/reaper_mcp/project_tools.py#L135-L149), [python-sdk `func_metadata.py` L571–575](https://github.com/modelcontextprotocol/python-sdk/blob/6f69a3758ebf2ee55ce050f58b470ce11af71133/src/mcp/server/mcpserver/utilities/func_metadata.py#L571-L575) |
| adamjmurray/producer-pal | A compact JavaScript-style literal: unquoted keys, no whitespace, `undefined` dropped, e.g. `{tempo:120,timeSignature:"4/4",…}`. Default everywhere except its REST API | `include` lists on read tools; defaults left out (`isPlaying` only when true); write results report only what Live changed (ADR-0044); small-model mode trims by whole `include` options (ADR-0026) | [`compact-serializer.ts` L6–62](https://github.com/adamjmurray/producer-pal/blob/52a4c219eca338b95e94dbfddcffeeb303ff8dd3/src/shared/compact/compact-serializer.ts#L6-L62), [`live-api-adapter.ts` L551–567](https://github.com/adamjmurray/producer-pal/blob/52a4c219eca338b95e94dbfddcffeeb303ff8dd3/src/live-api-adapter/live-api-adapter.ts#L551-L567), [`read-live-set.def.ts` L10–46](https://github.com/adamjmurray/producer-pal/blob/52a4c219eca338b95e94dbfddcffeeb303ff8dd3/src/tools/live-set/read-live-set.def.ts#L10-L46) |
| github/github-mcp-server | `json.Marshal`, compact JSON, in one text block; errors flagged `IsError` | `minimal_output` (default true), trimmed `Minimal*` types with `omitempty`, a `fields` parameter, and an experimental CSV output for `list_*` tools "to reduce response context for agents" | [`utils/result.go` L5–24](https://github.com/github/github-mcp-server/blob/c59e8c199efbf14467211861de44afaeeb6873e3/pkg/utils/result.go#L5-L24), [`minimal_types.go` L166–183](https://github.com/github/github-mcp-server/blob/c59e8c199efbf14467211861de44afaeeb6873e3/pkg/github/minimal_types.go#L166-L183), [`csv_output.go` L45–84](https://github.com/github/github-mcp-server/blob/c59e8c199efbf14467211861de44afaeeb6873e3/pkg/github/csv_output.go#L45-L84) |
| openai/codex | Shell: plain text with a header (`Exit code: 0`, `Wall time: …`, `Output:`), truncated by policy. MCP results with `structuredContent`: compact JSON | Truncation | [`tools/mod.rs` L87–113](https://github.com/openai/codex/blob/78dc2503840d05f4411ae184bb5560ef327fce3c/codex-rs/core/src/tools/mod.rs#L87-L113), [`protocol/models.rs` L2448–2465](https://github.com/openai/codex/blob/78dc2503840d05f4411ae184bb5560ef327fce3c/codex-rs/protocol/src/models.rs#L2448-L2465) |
| badlogic/pi-mono | Plain text: raw file lines, one directory entry per line, `path:line: text` for grep. A result has `content` for the model and `details` for logs and UI only | Truncation with a hint such as `[Showing lines 1-2000 of 5000. Use offset=2001 to continue.]` | [`read.ts` L178–204](https://github.com/badlogic/pi-mono/blob/6374c2baf432419ccb4541a99ce4958ecd03dae0/packages/coding-agent/src/core/tools/read.ts#L178-L204), [`agent/types.ts` L423–432](https://github.com/badlogic/pi-mono/blob/6374c2baf432419ccb4541a99ce4958ecd03dae0/packages/agent/src/types.ts#L423-L432) |
| vercel/ai | A string result is sent as text; any other value as JSON. Anthropic and OpenAI get `JSON.stringify` (compact). For Gemini the JSON value is placed as an object, not a string: `response: {name, content: <value>}` | — | [`create-tool-model-output.ts` L17–30](https://github.com/vercel/ai/blob/6ac1ee115c4e287be43ebb0e86d884033d85b0cd/packages/ai/src/prompt/create-tool-model-output.ts#L17-L30), [`convert-to-google-messages.ts` L690–716](https://github.com/vercel/ai/blob/6ac1ee115c4e287be43ebb0e86d884033d85b0cd/packages/google/src/convert-to-google-messages.ts#L690-L716) |

All rows **[code]**.

Producer Pal is the only project that explains its choice, and the explanation is modest: "toCompactJSLiteral() doesn't save us a ton of tokens in most tools, so if we see any issues with any LLMs, we can go back to omitting toCompactJSLiteral() here." **[code]** [`live-api-adapter.ts` L551–556](https://github.com/adamjmurray/producer-pal/blob/52a4c219eca338b95e94dbfddcffeeb303ff8dd3/src/live-api-adapter/live-api-adapter.ts#L551-L556). No project read uses TOON. **[code]**

The Vercel AI SDK shows a second way to talk to Gemini: hand it the structured value as the `response` object, and let Google render it. Our harness types the result as a string, so that would be a change to the harness. **[inferred]**

## TOON

- **Package:** `@toon-format/toon`, version 4.4.0, published 2026-10-08, MIT. `package.json` has no `dependencies`, only `devDependencies` (`@toon-format/spec`). No `engines` field. ESM only (`"type": "module"`). **[verified]** npm registry and the package's `package.json`; the installed copy showed version 4.4.0, licence MIT, no dependencies **[local]**. The older name `@byjohann/toon` is deprecated in favour of it. **[verified]**
- **Spec:** toon-format/spec, "Version: 4.4", "Date: 2026-10-08", "Status: Working Draft", MIT. Spec 4.0 (2026-07-22) was a breaking change that removed key folding. **[verified]** [SPEC.md](https://github.com/toon-format/spec/blob/d09c3d33e37389345a74bd96981eb96dd9be6c5e/SPEC.md)
- **Its own limits.** The README's "When Not to Use TOON": "Structures are deeply nested or non-uniform (tabular eligibility ≈ 0%) – compact JSON often wins outright"; "Arrays are semi-uniform (~40–60% eligibility) – savings shrink; stay on JSON if your pipeline already speaks it"; "Data is purely tabular – CSV is smaller"; and some local or quantised models "process compact JSON faster despite the higher token count". **[verified]** [README L152–159](https://github.com/toon-format/toon/blob/e247c423e0a38bca3477b17fecdf6ef4feeb5584/packages/toon/README.md#L152-L159). The spec says TOON is not meant to replace "JSON for non-uniform or deeply nested structures where repeated keys are not dominant, CSV for flat, strictly tabular data". **[verified]** [SPEC L101–104](https://github.com/toon-format/spec/blob/d09c3d33e37389345a74bd96981eb96dd9be6c5e/SPEC.md#L101-L104)
- **How it handles `read_set`.** A column holding "any array value or empty object – disqualifies the whole array (encode via §9.4)", the list form. A device list inside each track can still be a small table under that track. **[verified]** [SPEC §9.3–9.4](https://github.com/toon-format/spec/blob/d09c3d33e37389345a74bd96981eb96dd9be6c5e/SPEC.md#L477-L519). The encoder did exactly this on our sample. **[local]** The tracks array is also not uniform (main and returns have no group or sends), which disqualifies it too. **[inferred]**
- **Use with models.** The README says to "use JSON programmatically, and encode it as TOON for LLM input", and to wrap it in a code block marked `toon`. Neither the spec nor the guide says anything about tool results or MCP. **[verified]** [README](https://github.com/toon-format/toon/blob/e247c423e0a38bca3477b17fecdf6ef4feeb5584/packages/toon/README.md)
- Adding it would be the project's first runtime dependency, which AGENTS.md says to raise with the maintainer. **[inferred]**

## What this means for read_set

All **[inferred]** from the sections above.

- The data has one level of nesting and a few missing fields. That is the case TOON's own README steers away from, and the measured counts agree.
- A row-per-track format (CSV, Markdown table, plain lines) is the cheapest. It squeezes devices into one cell or one line, so the model must split them itself, and names that contain the separator (`|`, `,`, `;`) need a rule. No benchmark tested a custom format, so its accuracy is unknown.
- A Markdown list keeps devices as their own lines and costs about 60 % of minified JSON. It is close to the "Markdown key-value" form that read best in one flat-record test, and Markdown did well on Gemini 2.5 Flash Lite in the nested test. Both are single third-party tests.
- Minified JSON costs more but has the widest model familiarity and needs no legend. Leaving out false and empty fields recovers 15 %.
- A custom format needs a legend (what each field means, units, how plug-ins are marked). In the tool description it is sent with every request, so its tokens count against the saving. In the result it is sent with every call.
- The ids matter more than the format for acting: the model must copy `t17` or `d204` into the next tool call. An eval should check that directly.

## What was not verified

- Whether gemini-3.5-flash-lite reads any of these formats more accurately than another. No published test used it, and no local eval was run.
- Which tokenizer Gemini 3.5 Flash Lite uses. The counts here use Gemini 2.0's tokenizer (through Gemma 3) and OpenAI's; the real counts may differ.
- How Google renders a `functionResponse` object, and its string values, into the model's input.
- The full texts of "Notation Matters", "Are LLMs Ready for TOON?", JTON and ONTO; only abstracts were read. Two 2026 TOON papers found by search (McMillan, Matveev) were not opened.
- The arithmetic that removes TOON's structural-validation questions from its overall score was not rechecked against its raw results files.
- Whether reaper-mcp also sends `structuredContent`; and other DAW MCP servers found by search (dschuler36/reaper-mcp-server, two Logic Pro servers, WeModulate/bitwig-mcp-server) were not read.
- Claude Code's own tool result formats; no public documentation describes them.
- The GPT-5 prompting guide was opened but not searched for advice on delimiters.
- The local sample is synthetic and one size (53 tracks). Real Sets have other names, lengths and device counts.

## Sources

Papers and benchmarks
- He et al., [Does Prompt Formatting Have Any Impact on LLM Performance?](https://arxiv.org/abs/2411.10541) (2024)
- Sui et al., [Table Meets LLM](https://arxiv.org/abs/2305.13062) (WSDM 2024)
- Singha et al., [Tabular Representation, Noisy Operators, and Impacts on Table Structure Understanding Tasks in LLMs](https://arxiv.org/abs/2310.10358) (2023)
- Kutschka and Geiger, [Notation Matters](https://arxiv.org/abs/2605.29676) (2026, abstract); Masciari et al., [Are LLMs Ready for TOON?](https://arxiv.org/abs/2601.12014) (2026, abstract); [JTON](https://arxiv.org/abs/2604.05865) and [ONTO](https://arxiv.org/abs/2604.17512) (abstracts)
- Improving Agents: [Which Table Format Do LLMs Understand Best?](https://www.improvingagents.com/blog/best-input-data-format-for-llms), [Which Nested Data Format Do LLMs Understand Best?](https://www.improvingagents.com/blog/best-nested-data-format), [TOON Benchmarks](https://www.improvingagents.com/blog/toon-benchmarks)
- Gemma Team, [Gemma 3 Technical Report](https://arxiv.org/abs/2503.19786) (tokenizer)

Providers
- Anthropic: [Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls), [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents), [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- Google: [generateContent reference](https://ai.google.dev/api/generate-content), [Interactions reference](https://ai.google.dev/api/interactions), [Function calling](https://ai.google.dev/gemini-api/docs/function-calling), [Prompt design strategies](https://ai.google.dev/gemini-api/docs/prompting-strategies)
- OpenAI: [Function calling guide](https://platform.openai.com/docs/guides/function-calling), [GPT-4.1 prompting guide](https://cookbook.openai.com/examples/gpt4-1_prompting_guide)
- [MCP specification: tools](https://modelcontextprotocol.io/specification/latest/server/tools) (revision 2026-07-28)

TOON
- [toon-format/toon](https://github.com/toon-format/toon), [toon-format/spec](https://github.com/toon-format/spec), [@toon-format/toon on npm](https://www.npmjs.com/package/@toon-format/toon)

Projects (source read at the commits named at the top)
- [ahujasid/ableton-mcp](https://github.com/ahujasid/ableton-mcp), [uisato/ableton-mcp-extended](https://github.com/uisato/ableton-mcp-extended), [bonfire-systems/reaper-mcp](https://github.com/bonfire-systems/reaper-mcp), [modelcontextprotocol/python-sdk](https://github.com/modelcontextprotocol/python-sdk), [adamjmurray/producer-pal](https://github.com/adamjmurray/producer-pal)
- [github/github-mcp-server](https://github.com/github/github-mcp-server), [openai/codex](https://github.com/openai/codex), [badlogic/pi-mono](https://github.com/badlogic/pi-mono), [vercel/ai](https://github.com/vercel/ai)

Tools used for local counts
- [gpt-tokenizer](https://www.npmjs.com/package/gpt-tokenizer) 4.0.0 (o200k_base, cl100k_base), [Hugging Face tokenizers](https://github.com/huggingface/tokenizers) with the Gemma 3 `tokenizer.json` from [unsloth/gemma-3-1b-it](https://huggingface.co/unsloth/gemma-3-1b-it), [yaml](https://www.npmjs.com/package/yaml) 2.9.1
