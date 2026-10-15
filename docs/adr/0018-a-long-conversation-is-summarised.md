# 0018 — A long conversation is summarised, and the model sees only the latest summary on

Date: 2026-10-15 · Status: accepted · Adds a fifth kind of message to [0003](0003-own-neutral-message-format.md) and a stop reason to [0005](0005-the-loop-returns-a-result-and-never-throws.md)

## Context

The whole conversation is re-sent on every model call, so a long session costs more with every question, and answers get worse as the conversation grows. The harness could not see how big the conversation was: the Gemini adapter dropped the token counts Gemini sends back, and a reply cut off by the output limit looked like a finished one. Every supported model takes at least 1,000,000 tokens ([0019](0019-only-supported-models-with-a-1m-window.md)), so cost and answer quality set the limit, not the context window. Research note: `docs/research/keeping-a-long-conversation-inside-the-context-window.md`.

## Decision

Measuring:

- Each provider adapter turns its provider's token counts into one neutral form. Each turn result reports the conversation size: the count from the last model call plus characters ÷ 4 for what was added since.
- A reply cut off by the output limit keeps its text. Its tool calls are not run; each gets the tool result "Not run: the reply was cut off". The turn ends with the stop reason `"cut_off"`.

Keeping tool results small:

- A tool result has a result limit of 40,000 characters, the same for every tool. Past it, the harness keeps the start and adds a note saying how much was cut.
- A tool whose answer grows with the Live Set keeps itself under the limit, by answering short and taking arguments for more. The harness cut is only a safety net.

Summarising:

- Before every model call, including in the middle of a turn, the harness checks the conversation size against the summary threshold of 100,000 tokens, the same for every model.
- Past it, the same model writes a summary of everything except the newest ~20,000 tokens. The cut never separates a tool call from its tool result.
- The summary is a fifth kind of message, `summary`. It goes into the conversation before the messages kept word for word. Older messages stay in the conversation for the app; the model is sent only the latest summary and what follows it. An adapter sends a summary as user text framed as history, not new instructions.
- The summary has fixed headings: Goal, Preferences, Changes made (and why), Open questions. It keeps exact track and plug-in names, and tells the model to read the Live Set again instead of trusting old values.
- A second summary is written from the previous one plus what followed. Where they disagree, the newer conversation wins, and details that no longer matter are dropped.
- If summarising fails (an error, an empty or cut-off summary, a tool call in place of one), the turn carries on with the full conversation. It is tried at most once per turn. A cancel while summarising adds no summary and ends the turn as cancelled.
- The app gets an update when summarising starts, then the summary as a message update.
- The threshold, the amount kept and the headings are defaults until an eval tunes them.

Rejected:

- Summarising at a share of the context window, as coding agents do: on a 1,000,000-token model that means 900,000 tokens re-sent with every question before anything happens.
- Checking only at the start of a turn: a turn of several big reads would re-send them all for the rest of the turn.
- Replacing the old messages with the summary: an app that reloads a saved conversation could show only the summary of its early part.
- A user message with a summary flag: any code that forgets the flag treats the summary as something the user typed.
- The providers' own server-side compaction: Anthropic's is in beta, and OpenAI's returns an encrypted item only OpenAI can read, which breaks switching provider in the middle of a conversation.
- Keeping the whole of an oversized tool result aside for a "read more" tool: new storage the app would have to keep with the conversation.
- Asking the model to continue a cut-off reply: an extra model call that can be cut off again.
- Preserving everything from the previous summary: opencode found its summaries grew on every update and kept stale details.

## Consequences

- `Model.call` returns token counts and a cut-off flag along with the messages, and every provider adapter and every app handles the `summary` kind.
- The conversation an app saves keeps growing; what the model is sent stays near the threshold.
- Preferences last only as long as the conversation, until memory across conversations exists.
- A summary is lossy: a detail that mattered later can be gone. The eval of the summary is what shows how often.
- Every edit to old messages throws away a provider's prompt cache from that point. Summarising is rare, so this is accepted without special handling.
