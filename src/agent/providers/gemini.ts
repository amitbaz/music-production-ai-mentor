import {
    type GenerateOptions,
    type Message,
    ModelCallError,
    type Provider,
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
    candidates?: { content?: { parts: GeminiReplyPart[] } }[];
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

// Translates the body of a Gemini generateContent reply into our messages.
export function fromGeminiResponse(response: GeminiResponse): Message[] {
    const candidate = response.candidates?.[0];
    if (!candidate) {
        // Happens when Gemini refuses the prompt; the reply then says why.
        throw new Error(
            `Gemini returned no reply: ${JSON.stringify(response)}`,
        );
    }

    const messages: Message[] = [];
    for (const part of candidate.content?.parts ?? []) {
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
            messages.push({
                type: "assistant",
                text: part.text,
                ...meta,
            });
        }
    }
    return messages;
}

// A Provider backed by the real Gemini API: translate, send, translate back.
export function createGeminiProvider(apiKey: string, model: string): Provider {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    return {
        generate: async (
            conversation: Message[],
            tools: Tool[],
            options?: GenerateOptions,
        ) => {
            let response: Response;
            try {
                response = await fetch(url, {
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
            } catch (e) {
                // fetch reports a dropped connection as a TypeError; a cancel is not one.
                if (!(e instanceof TypeError)) throw e;
                throw new ModelCallError(
                    `Gemini request failed: ${e.message}`,
                    { retryable: true, cause: e },
                );
            }

            // Read the status before the body: a failed reply may not be JSON.
            if (!response.ok) {
                throw failedRequest(response.status, await response.text());
            }
            const body = (await response.json()) as GeminiResponse;
            return fromGeminiResponse(body);
        },
    };
}
