
import type { Message, Tool } from "../types.ts";

// The shapes Gemini expects. A "content" is one turn and "parts" are the pieces of that turn.
type GeminiPart = Record<string, unknown>;
type GeminiContent = {role: "user" | "model", parts: GeminiPart[]};

export function toGeminiRequest(conversation: Message[], tools: Tool[]) {
    const contents: GeminiContent[] = [];

    for (const message of conversation) {
        //Gemini has two sides only: user and model. Tool results count as user messages.
        const role = message.type === "user" || message.type === "tool_result" ? "user" : "model";
        const part = toGeminiPart(message);

        const last = contents.at(-1);
        if(last?.role === role) {
            last.parts.push(part);
        }else{
            contents.push({role, parts: [part]});
        }
    }

    return {
        contents,
        tools: [
            {
                functionDeclarations: tools.map(tool => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.params,
                }))
            }
        ]
    }
}

function toGeminiPart(message: Message): GeminiPart {
    switch(message.type) {
        case "user":
            return {text: message.text};
        case "assistant":
            return {text: message.text, ...signtatureFrom(message.providerMeta)};
        case "tool_call":
            return {
                functionCall: {id: message.id, name: message.name, args: message.args},
                ...signtatureFrom(message.providerMeta)

            };
        case "tool_result":
            return {
                functionResponse: {
                    id: message.callId, 
                    name: message.name,
                    response: message.isError
                        ? {error: message.output}
                        : {result: message.output}
                },
            };
    }
}

// Reads back the thoughtSignature this adapter stored in providerMeta, if there is one.
function signtatureFrom(providerMeta: unknown): GeminiPart {
    if(
        typeof providerMeta === "object" && 
        providerMeta !== null &&
        "thoughtSignature" in providerMeta
    ) {
        return {thoughtSignature: providerMeta.thoughtSignature};
    }

    return {}
}