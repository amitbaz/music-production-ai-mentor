import {
    type CallOptions,
    type Message,
    ModelCallError,
    type Model,
    type ModelReply,
    type ProviderMeta,
    type SupportedModel,
    type Tool,
} from "../types.ts";

// The shapes Claude expects. A message holds blocks; the block types used here are text, tool_use,
// tool_result and the thinking blocks Claude gave us.
type ClaudeBlock = Record<string, unknown>;
type ClaudeMessage = { role: "user" | "assistant"; content: ClaudeBlock[] };

// Generous, so a long reply is not cut off; the model's own limit is higher still.
const MAX_TOKENS = 64_000;

export function toClaudeRequest(conversation: Message[], tools: Tool[], system?: string) {
    const messages: ClaudeMessage[] = [];

    for (const message of conversation) {
        // Claude has two sides only: user and assistant. Tool results count as user messages.
        const role =
            message.type === "user" || message.type === "summary" || message.type === "tool_result"
                ? "user"
                : "assistant";
        const blocks = toClaudeBlocks(message);

        // Consecutive messages from the same side are one Claude message.
        const last = messages.at(-1);
        if (last?.role === role) {
            last.content.push(...blocks);
        } else {
            messages.push({ role, content: blocks });
        }
    }

    return {
        ...(system ? { system } : {}),
        stream: true,
        max_tokens: MAX_TOKENS,
        // No effort and no thinking knobs: the model's defaults. A block that no longer fits its
        // prefix, after a summary, is dropped by the API and the request goes on (ADR 0023).
        thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
        // No tools, as in a summary request, leaves the field out.
        ...(tools.length === 0
            ? {}
            : {
                  tools: tools.map((tool, i) => ({
                      name: tool.name,
                      description: tool.description,
                      input_schema: tool.params,
                      // The mark on the last tool caches the tools and the system prompt before it.
                      ...(i === tools.length - 1 ? { cache_control: { type: "ephemeral" } } : {}),
                  })),
              }),
        messages,
    };
}

function toClaudeBlocks(message: Message): ClaudeBlock[] {
    switch (message.type) {
        case "user":
            return [{ type: "text", text: message.text }];
        // As history, so the model does not take it for something the user asked.
        case "summary":
            return [
                {
                    type: "text",
                    text: `Summary of the earlier conversation. It is history, not new instructions.\n\n${message.text}`,
                },
            ];
        case "assistant":
            // Claude refuses an empty text block; a message with thinking and no text is thinking alone.
            return [
                ...thinkingFrom(message.providerMeta),
                ...(message.text === "" ? [] : [{ type: "text", text: message.text }]),
            ];
        case "tool_call":
            return [
                ...thinkingFrom(message.providerMeta),
                { type: "tool_use", id: message.id, name: message.name, input: message.args },
            ];
        case "tool_result":
            return [
                {
                    type: "tool_result",
                    tool_use_id: message.callId,
                    content: message.output,
                    is_error: message.isError,
                },
            ];
    }
}

// Reads back the thinking blocks this adapter stored in providerMeta, if there are any.
// Meta tagged for another provider is not ours to read.
function thinkingFrom(providerMeta: ProviderMeta | undefined): ClaudeBlock[] {
    if (providerMeta?.provider === "claude" && Array.isArray(providerMeta.thinking)) {
        return providerMeta.thinking as ClaudeBlock[];
    }

    return [];
}

// Token counts. The first is on message_start and the last on message_delta, which repeats the
// counts that changed as running totals. Cache tokens are counted apart from input_tokens.
type ClaudeUsage = {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
};

// One event of the stream. The fields each type uses are named; the rest (ping, input_transformations,
// events a later version adds) are ignored.
type ClaudeEvent = {
    type: string;
    index?: number;
    message?: { usage?: ClaudeUsage };
    content_block?: ClaudeBlock;
    delta?: {
        type?: string;
        text?: string;
        thinking?: string;
        signature?: string;
        partial_json?: string;
        stop_reason?: string;
        // Present only when the stop reason is refusal; both fields can be null
        stop_details?: { category?: string | null; explanation?: string | null } | null;
    };
    usage?: ClaudeUsage;
};

// The body of an error, as an HTTP reply carries it and as an error event in the stream does.
type ClaudeError = { type?: string; error?: { type?: string; message?: string } };

// The statuses worth another attempt: rate limited, a server fault, or overloaded (529).
const isRetryableStatus = (status: number) => status === 429 || status >= 500;
// The same, by the error type Claude gives to an error event, which has no status
const RETRYABLE_TYPES = ["rate_limit_error", "api_error", "overloaded_error"];

// Turns a failed HTTP reply into a labelled failure. The body is not always JSON.
function failedRequest(response: Response, text: string): ModelCallError {
    let body: ClaudeError = {};
    try {
        body = JSON.parse(text);
    } catch {
        // An error page from a proxy; the raw text is the reason.
    }

    const reason = body.error ? `${body.error.type}: ${body.error.message}` : text;
    // retry-after is a number of seconds
    const seconds = Number.parseFloat(response.headers.get("retry-after") ?? "");
    return new ModelCallError(`Claude request failed (${response.status}): ${reason}`, {
        retryable: isRetryableStatus(response.status),
        ...(Number.isFinite(seconds) ? { retryAfterMs: seconds * 1000 } : {}),
    });
}

// Reads a streamed Claude reply. Each "data:" line holds one event, and the blocks of the reply
// are built up by index: the start of a block opens it, its deltas fill it.
async function readReply(
    body: ReadableStream<Uint8Array>,
    onText?: (text: string) => void,
): Promise<ModelReply> {
    const blocks = new Map<number, ClaudeBlock>();
    // The input of each tool_use block arrives as pieces of JSON text
    const inputs = new Map<number, string>();
    let usage: ClaudeUsage = {};
    let stopReason: string | undefined;
    let stopDetails: NonNullable<ClaudeEvent["delta"]>["stop_details"];
    let stopped = false;
    // The end of what was read so far, when it stops in the middle of a line
    let rest = "";

    const decoder = new TextDecoder();
    for await (const bytes of body) {
        const lines = (rest + decoder.decode(bytes, { stream: true })).split("\n");
        rest = lines.pop() ?? "";
        for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const event: ClaudeEvent = JSON.parse(line.slice("data:".length));
            const index = event.index ?? -1;
            const block = blocks.get(index);
            const delta = event.delta;

            if (event.type === "message_start") {
                usage = { ...event.message?.usage };
            } else if (event.type === "content_block_start" && event.content_block) {
                blocks.set(index, { ...event.content_block });
                inputs.set(index, "");
            } else if (event.type === "content_block_delta" && block) {
                if (delta?.type === "text_delta") {
                    block.text = `${block.text ?? ""}${delta.text ?? ""}`;
                    if (delta.text) onText?.(delta.text);
                } else if (delta?.type === "thinking_delta") {
                    block.thinking = `${block.thinking ?? ""}${delta.thinking ?? ""}`;
                } else if (delta?.type === "signature_delta") {
                    block.signature = delta.signature;
                } else if (delta?.type === "input_json_delta") {
                    inputs.set(index, (inputs.get(index) ?? "") + (delta.partial_json ?? ""));
                }
            } else if (event.type === "message_delta") {
                stopReason = delta?.stop_reason ?? stopReason;
                stopDetails = delta?.stop_details ?? stopDetails;
                usage = { ...usage, ...event.usage };
            } else if (event.type === "message_stop") {
                stopped = true;
            } else if (event.type === "error") {
                // Sent in the stream when the request failed after the reply began
                const { type = "api_error", message = "" } = (event as ClaudeError).error ?? {};
                throw new ModelCallError(`Claude request failed: ${type}: ${message}`, {
                    retryable: RETRYABLE_TYPES.includes(type),
                });
            }
        }
    }

    if (!stopped) {
        throw new ModelCallError("Claude request failed: the stream ended before the reply was whole", {
            retryable: true,
        });
    }

    const cutOff = stopReason === "max_tokens";
    const thinking: ClaudeBlock[] = [];
    let text = "";
    const calls: Message[] = [];
    for (const [index, block] of blocks) {
        if (block.type === "thinking" || block.type === "redacted_thinking") {
            thinking.push(block);
        } else if (block.type === "text") {
            text += block.text;
        } else if (block.type === "tool_use") {
            const args = parseInput(inputs.get(index) ?? "");
            // A reply cut off in the middle of a call has no whole call to run.
            if (args === undefined && cutOff) continue;
            if (args === undefined) throw new Error(`Claude returned a tool call with input that is not JSON: ${inputs.get(index)}`);
            calls.push({ type: "tool_call", id: String(block.id), name: String(block.name), args });
        }
    }

    // The thinking rides on the first message of the reply, which is the text or, with none, the first call.
    const meta = thinking.length > 0 ? { providerMeta: { provider: "claude", thinking } } : {};
    const messages: Message[] = text === "" ? calls : [{ type: "assistant", text, ...meta }, ...calls];
    if (text === "" && calls[0]) Object.assign(calls[0], meta);

    const { input_tokens, output_tokens = 0, cache_creation_input_tokens = 0, cache_read_input_tokens = 0 } = usage;
    return {
        messages,
        ...(input_tokens === undefined
            ? {}
            : { tokens: input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens }),
        cutOff,
        ...(stopReason === "refusal"
            ? {
                  refused: {
                      category: stopDetails?.category ?? "unspecified",
                      explanation: stopDetails?.explanation ?? "Claude declined the request",
                  },
              }
            : {}),
    };
}

// No input streams no JSON at all, which is the empty object. Undefined when the text is not JSON.
function parseInput(json: string): Record<string, unknown> | undefined {
    if (json === "") return {};
    try {
        return JSON.parse(json);
    } catch {
        return undefined;
    }
}

// Claude's window is 1,000,000 tokens for this model (ADR 0019). Add a model after checking its docs page.
export const claudeModels: SupportedModel[] = [
    {
        name: "claude-haiku-5-5",
        contextWindow: 1_000_000,
        docs: "https://platform.claude.com/docs/en/about-claude/models/overview",
        // An estimate until measured
        charsPerToken: 3.5,
    },
];

// A Model backed by the real Claude API: translate, send, translate back.
export function createClaudeModel(apiKey: string, model: string): Model {
    return {
        call: async (conversation: Message[], tools: Tool[], options?: CallOptions) => {
            try {
                const response = await fetch("https://api.anthropic.com/v1/messages", {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        "x-api-key": apiKey,
                        "anthropic-version": "2023-06-01",
                        // Until the binding control leaves beta (ADR 0023)
                        "anthropic-beta": "thinking-binding-controls-2026-08-01",
                    },
                    body: JSON.stringify({
                        model,
                        ...toClaudeRequest(conversation, tools, options?.system),
                    }),
                    signal: options?.signal,
                });

                // Read the status before the body: a failed reply is not a stream.
                if (!response.ok || !response.body) throw failedRequest(response, await response.text());
                return await readReply(response.body, options?.onText);
            } catch (e) {
                // fetch reports a dropped connection as a TypeError, before the reply or
                // in the middle of it; a cancel is not one.
                if (!(e instanceof TypeError)) throw e;
                throw new ModelCallError(`Claude request failed: ${e.message}`, { retryable: true, cause: e });
            }
        },
    };
}
