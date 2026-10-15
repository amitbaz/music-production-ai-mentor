import type { Message, Tool } from "./types.ts";

// For text no provider has counted: one token to four characters (ADR 0018).
const CHARS_PER_TOKEN = 4;

export const estimateTokens = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN);

// The characters a message adds to a request
export function messageChars(message: Message): number {
    switch (message.type) {
        case "user":
        case "assistant":
            return message.text.length;
        case "tool_call":
            return message.name.length + JSON.stringify(message.args).length;
        case "tool_result":
            return message.output.length;
    }
}

// The characters of the part of a request that is not the conversation: the system prompt and the tools
export function fixedChars(tools: Tool[], system = ""): number {
    return tools.reduce(
        (sum, tool) =>
            sum + tool.name.length + tool.description.length + JSON.stringify(tool.params).length,
        system.length,
    );
}
