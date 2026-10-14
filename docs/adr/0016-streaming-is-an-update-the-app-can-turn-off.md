# 0012 — Streaming is an update the app can turn off

Date: 2026-10-13 · Status: accepted

## Context

The app saw a message only when it was whole (ADR 0005), so a long explanation showed nothing for many seconds. ADR 0005 said streaming would need "a second callback or a wider one". The app must also be able to turn streaming off for its user.

A streamed Gemini reply was recorded before deciding. It is the shape of a whole reply cut into pieces: text arrives in several pieces, each tool call arrives whole in one piece, and the last piece can hold an empty text.

## Decision

- A provider adapter always calls its provider's streaming endpoint. There is no second request path.
- Only assistant text is streamed. A tool call is reported once, whole.
- `onMessage` is replaced by one callback, `onUpdate`. An update is `{ type: "text", text }` for a piece of text, or `{ type: "message", message }` for a whole message. Every message added to the conversation is reported as one message update, an assistant message included, after its pieces.
- `stream` is an option of a turn, next to `onUpdate`, and is off when left out. It changes only whether text updates are sent.
- A model receives `onText` in its call options and calls it with each piece. The agent loop collects the pieces itself.
- A cancel while a reply is arriving keeps the text that arrived, as an assistant message. A tool call from the unfinished reply is dropped. This extends ADR 0006.
- An attempt whose text has started to arrive is never retried. The model call fails, the turn ends with `"error"`, and the text that arrived is kept. This narrows ADR 0009; a failure before any text is retried as before.
- The time limit of an attempt measures silence: it restarts with each piece of text. This replaces the 60s for a whole reply in ADR 0009.
- These three rules are the same with `stream` on or off.
- The terminal app sets `stream` from a constant. A command to change it waits for the app's settings file.

Rejected:

- Off calling the non-streaming endpoint: a real fallback, but two request paths and two parsers in every adapter, and two meanings of the time limit.
- Streaming tool calls: Gemini has nothing to stream, and the mentor has no long tool arguments.
- A second callback, `onText`, next to `onMessage`: two callbacks for one stream of news.
- An async generator: rejected in ADR 0005 for the same reason, the stop reason has no place.
- Retrying a reply that had started: the user reads two different openings, and every app must take back text it showed. The Anthropic, OpenAI and Vercel SDKs also stop retrying once a reply starts.
- Leaving the kept text out of the next model call, as pi does: the user read it, so "go on" should work.
- Different rules when `stream` is off: a second behaviour in the loop and the retry wrapper. No harness we read does it.
- A total time limit next to the silence limit: the user can cancel.

## Consequences

- The conversation can hold an assistant message cut off in the middle, with nothing telling the model it was cut.
- A connection that drops in the middle of a reply ends the turn where a retry might have saved it. With `stream` off the app then gets a half message it never showed arriving.
- A reply that is only a tool call sends no text, so it still has the whole time limit and no more.
- A streamed Gemini text is stored as one assistant message. A `thoughtSignature` that arrives on a later piece is stored on that message; text cut short has none, which Gemini accepts for text.
- Every adapter must call `onText` for each piece of text, and return the same text in its messages.
- A scripted model that never calls `onText` behaves as a reply that arrives all at once.
