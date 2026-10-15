import type { Message, Tool } from "./types.ts";

// For text no provider has counted. A model that does not give its own number gets four characters to a token (ADR 0018).
export const estimateTokens = (chars: number, charsPerToken = 4) =>
    Math.ceil(chars / charsPerToken);

// The characters of a value written as JSON. A value that cannot be written (a BigInt, a cycle)
// counts as 0: the size is an estimate and must never stop a turn.
function jsonChars(value: unknown): number {
    try {
        return JSON.stringify(value)?.length ?? 0;
    } catch {
        return 0;
    }
}

// The characters a message adds to a request
export function messageChars(message: Message): number {
    switch (message.type) {
        case "user":
        case "assistant":
            return message.text.length;
        case "tool_call":
            return message.name.length + jsonChars(message.args);
        case "tool_result":
            return message.output.length;
    }
}

// The characters of the part of a request that is not the conversation: the system prompt and the tools
export function fixedChars(tools: Tool[], system = ""): number {
    return tools.reduce(
        (sum, tool) =>
            sum + tool.name.length + tool.description.length + jsonChars(tool.params),
        system.length,
    );
}

export const messagesChars = (messages: Message[]) =>
    messages.reduce((sum, message) => sum + messageChars(message), 0);
