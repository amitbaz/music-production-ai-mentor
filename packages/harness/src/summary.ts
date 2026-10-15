import { estimateTokens, messageChars } from "./conversation-size.ts";
import type { Message, ModelReply } from "./types.ts";

// Defaults until an eval tunes them (ADR 0018, #18)
// The conversation size past which the harness summarises, the same for every model
export const SUMMARY_THRESHOLD = 100_000;
// About how many tokens of the newest messages stay word for word
export const SUMMARY_KEEP = 20_000;

// The system prompt of the summary request
export const SUMMARY_INSTRUCTIONS = `You write the summary of the earlier part of a conversation between a music producer and an AI mentor that works with them in their DAW. The mentor will read your summary in place of those messages and carry on from it, so write for the mentor.

Do not continue the conversation, answer anything in it, or call tools. Write only the summary, under these headings:

## Goal
What the producer is trying to make or learn, and what they asked for most recently.

## Preferences
How the producer likes to work, what they like and dislike, and anything they told the mentor to do or not to do.

## Changes made (and why)
Each change made in the Live Set, with the reason for it.

## Open questions
What is still unanswered or undecided, and what was about to happen next.

Keep the exact track and plug-in names, as they were written. Values read from the Live Set, such as volumes, tempo or device settings, may have changed since: say that they are old, and that the mentor must read the Live Set again before acting on them.

If the conversation starts with an earlier summary, update it instead of copying it. Where the newer conversation disagrees with the earlier summary, the newer conversation wins. Drop details that no longer matter.`;

// The last message of the summary request
export const SUMMARY_REQUEST = "Write the summary now.";

// Where the part kept word for word starts: the index of its first message, walking back from the newest until about SUMMARY_KEEP tokens are held.
// It starts at a user message or at the first message of a model reply, never at a tool result, so a tool call stays with its result.
// Only messages after the latest summary count. Undefined when nothing older is left to summarise.
export function keptStart(messages: Message[], charsPerToken?: number): number | undefined {
    const first = messages.findLastIndex((m) => m.type === "summary") + 1;
    let chars = 0;
    let start = messages.length;
    while (start > first && estimateTokens(chars, charsPerToken) < SUMMARY_KEEP) {
        start--;
        chars += messageChars(messages[start] as Message);
    }
    while (start > first && !startsPart(messages, start)) start--;
    return start > first ? start : undefined;
}

// A message the kept part may start at: the user's, or the first of a model reply (after the user's message or a tool result)
function startsPart(messages: Message[], index: number): boolean {
    const message = messages[index];
    if (message?.type === "user") return true;
    if (message?.type !== "assistant" && message?.type !== "tool_call") return false;
    const before = messages[index - 1]?.type;
    return before === "user" || before === "tool_result";
}

// The text of a summary reply, or undefined when it cannot be used: cut off, empty, or asking for a tool call
export function summaryText(reply: ModelReply): string | undefined {
    if (reply.cutOff || reply.messages.some((m) => m.type === "tool_call")) return undefined;
    const text = reply.messages
        .flatMap((m) => (m.type === "assistant" ? [m.text] : []))
        .join("\n\n")
        .trim();
    return text === "" ? undefined : text;
}
