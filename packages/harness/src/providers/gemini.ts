import {
    type CallOptions,
    type Message,
    ModelCallError,
    type Model,
    type ModelReply,
    type SupportedModel,
    type Tool,
} from "../types.ts";

// The shapes Gemini expects. A "content" is one turn and "parts" are the pieces of that turn.
type GeminiPart = Record<string, unknown>;
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

export function toGeminiRequest(
    conversation: Message[],
    tools: Tool[],
    system?: string,
) {
    const contents: GeminiContent[] = [];

    for (const message of conversation) {
        //Gemini has two sides only: user and model. Tool results count as user messages.
        const role =
            message.type === "user" || message.type === "tool_result"
                ? "user"
                : "model";
        const part = toGeminiPart(message);

        const last = contents.at(-1);
        if (last?.role === role) {
            last.parts.push(part);
        } else {
            contents.push({ role, parts: [part] });
        }
    }

    return {
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents,
        tools: [
            {
                functionDeclarations: tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.params,
                })),
            },
        ],
    };
}

function toGeminiPart(message: Message): GeminiPart {
    switch (message.type) {
        case "user":
            return { text: message.text };
        case "assistant":
            return {
                text: message.text,
                ...signtatureFrom(message.providerMeta),
            };
        case "tool_call":
            return {
                functionCall: {
                    id: message.id,
                    name: message.name,
                    args: message.args,
                },
                ...signtatureFrom(message.providerMeta),
            };
        case "tool_result":
            return {
                functionResponse: {
                    id: message.callId,
                    name: message.name,
                    response: message.isError
                        ? { error: message.output }
                        : { result: message.output },
                },
            };
    }
}

// Reads back the thoughtSignature this adapter stored in providerMeta, if there is one.
function signtatureFrom(providerMeta: unknown): GeminiPart {
    if (
        typeof providerMeta === "object" &&
        providerMeta !== null &&
        "thoughtSignature" in providerMeta
    ) {
        return { thoughtSignature: providerMeta.thoughtSignature };
    }

    return {};
}

type GeminiResponse = {
    candidates?: {
        content?: { parts: GeminiReplyPart[] };
        // Sent on the last piece of a reply; MAX_TOKENS means the output limit cut it off
        finishReason?: string;
    }[];
    // Present instead of candidates when Gemini refuses the prompt
    promptFeedback?: { blockReason?: string };
    // Present instead of candidates when the request itself was rejected
    error?: {
        message?: string;
        // On a rate limit, one entry says how long to wait, e.g. retryDelay "12s"
        details?: { retryDelay?: string }[];
    };
};

// The statuses worth another attempt; the same list the Gemini SDK retries.
const RETRYABLE_STATUSES = [408, 429, 500, 502, 503, 504];

// Turns a failed HTTP reply into a labelled failure. The body is not always JSON.
function failedRequest(status: number, text: string): ModelCallError {
    let body: GeminiResponse = {};
    try {
        body = JSON.parse(text);
    } catch {
        // An error page from a proxy; the raw text is the reason.
    }

    const delay = body.error?.details?.find((d) => d.retryDelay)?.retryDelay;
    return new ModelCallError(
        `Gemini request failed (${status}): ${body.error?.message ?? text}`,
        {
            retryable: RETRYABLE_STATUSES.includes(status),
            ...(delay ? { retryAfterMs: Number.parseFloat(delay) * 1000 } : {}),
        },
    );
}

type GeminiReplyPart = {
    text?: string;
    functionCall?: { id: string; name: string; args?: Record<string, unknown> };
    thoughtSignature?: string;
};

// Adds the parts of one piece of a streamed reply to the messages read so far.
function addParts(
    messages: Message[],
    parts: GeminiReplyPart[],
    onText?: (text: string) => void,
) {
    for (const part of parts) {
        const meta = part.thoughtSignature
            ? { providerMeta: { thoughtSignature: part.thoughtSignature } }
            : {};

        if (part.functionCall) {
            messages.push({
                type: "tool_call",
                id: part.functionCall.id,
                name: part.functionCall.name,
                args: part.functionCall.args ?? {},
                ...meta,
            });
        } else if (part.text !== undefined) {
            // Text that follows text is more of the same message. Its signature comes on a
            // later piece, and is stored as if the text had come whole.
            const last = messages.at(-1);
            if (last?.type === "assistant") {
                last.text += part.text;
                Object.assign(last, meta);
            } else if (part.text !== "") {
                // Gemini ends a reply with an empty text; on its own that is not a message.
                messages.push({ type: "assistant", text: part.text, ...meta });
            }
            if (part.text !== "") onText?.(part.text);
        }
    }
}

// Reads a streamed Gemini reply. Each "data:" line holds one piece, in the shape of a whole reply.
async function readReply(
    body: ReadableStream<Uint8Array>,
    onText?: (text: string) => void,
): Promise<ModelReply> {
    const messages: Message[] = [];
    let piece: GeminiResponse = {};
    let replied = false;
    let cutOff = false;
    // The end of what was read so far, when it stops in the middle of a line
    let rest = "";

    const decoder = new TextDecoder();
    for await (const bytes of body) {
        const lines = (rest + decoder.decode(bytes, { stream: true })).split("\n");
        rest = lines.pop() ?? "";
        for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            piece = JSON.parse(line.slice("data:".length));
            const candidate = piece.candidates?.[0];
            if (!candidate) continue;
            replied = true;
            if (candidate.finishReason === "MAX_TOKENS") cutOff = true;
            addParts(messages, candidate.content?.parts ?? [], onText);
        }
    }

    if (!replied) {
        // Happens when Gemini refuses the prompt; the reply then says why.
        throw new Error(`Gemini returned no reply: ${JSON.stringify(piece)}`);
    }
    // Token counts are not read yet.
    return { messages, cutOff };
}

// Every window is at least 1,000,000 tokens (ADR 0019). Add a model after checking its docs page.
export const geminiModels: SupportedModel[] = [
    {
        name: "gemini-3.5-flash-lite",
        contextWindow: 1_048_576,
        docs: "https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite",
    },
];

// A Model backed by the real Gemini API: translate, send, translate back.
export function createGeminiModel(apiKey: string, model: string): Model {
    // Always the streaming endpoint; the caller decides whether to show the pieces.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;

    return {
        call: async (
            conversation: Message[],
            tools: Tool[],
            options?: CallOptions,
        ) => {
            try {
                const response = await fetch(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-goog-api-key": apiKey,
                    },
                    body: JSON.stringify(
                        toGeminiRequest(conversation, tools, options?.system),
                    ),
                    signal: options?.signal,
                });

                // Read the status before the body: a failed reply may not be JSON.
                if (!response.ok || !response.body) {
                    throw failedRequest(response.status, await response.text());
                }
                return await readReply(response.body, options?.onText);
            } catch (e) {
                // fetch reports a dropped connection as a TypeError, before the reply or
                // in the middle of it; a cancel is not one.
                if (!(e instanceof TypeError)) throw e;
                throw new ModelCallError(
                    `Gemini request failed: ${e.message}`,
                    { retryable: true, cause: e },
                );
            }
        },
    };
}
