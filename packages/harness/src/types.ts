// Provider-specific extras on a message (e.g. Gemini's thoughtSignature). `provider` names the adapter
// that wrote it. An adapter reads only meta tagged with its own name and ignores the rest; the loop never reads it.
export type ProviderMeta = { provider: string; [key: string]: unknown };

// One entry in the conversation. `type` says which of the five kinds it is.
export type Message =
    | { type: "user"; text: string }
    // Stands in for everything before it; the model is sent only the latest one (ADR 0018). It has no providerMeta.
    | { type: "summary"; text: string }
    | { type: "assistant"; text: string; providerMeta?: ProviderMeta }
    | {
          type: "tool_call";
          // Letters, digits, "_" and "-". A user may switch provider between turns, so every provider
          // must accept an id another one made. Each adapter's tests prove the ids it makes fit; nothing checks at run time.
          id: string;
          name: string;
          args: Record<string, unknown>;
          providerMeta?: ProviderMeta;
      }
    | {
          type: "tool_result";
          callId: string;
          name: string;
          output: string;
          isError: boolean;
      };

// Something the model can ask the harness to run.
export type Tool = {
    name: string;
    // Sent to the model; it decides when to use the tool from this text.
    description: string;
    // JSON Schema describing the arguments, also sent to the model.
    params: Record<string, unknown>;
    // Ask the user before running
    needsApproval?: boolean;
    // Runs in our program. The model only ever sees the returned string.
    run: (args: Record<string, unknown>) => string | Promise<string>;
};

export type ToolCall = Extract<Message, { type: "tool_call" }>;

// What a model call returns
export type ModelReply = {
    // The model's new messages
    messages: Message[];
    // Tokens the provider reported for the call: the whole request plus the reply, cached tokens included. Absent when the provider gave none.
    tokens?: number;
    // The reply was cut off by the output limit
    cutOff: boolean;
};

// A model API. Takes the whole conversation and returns the model's reply.
export type Model = {
    // How many characters one token takes, for the estimate of text no provider has counted. 4 when absent.
    charsPerToken?: number;
    call: (
        conversation: Message[],
        tools: Tool[],
        options?: CallOptions,
    ) => Promise<ModelReply>;
};

// A failed attempt, labelled by the provider adapter. Only a retryable one is tried again.
export class ModelCallError extends Error {
    retryable: boolean;
    // How long the provider asked us to wait before the next attempt
    retryAfterMs?: number;

    constructor(
        message: string,
        options: { retryable: boolean; retryAfterMs?: number; cause?: unknown },
    ) {
        super(message, { cause: options.cause });
        this.name = "ModelCallError";
        this.retryable = options.retryable;
        if (options.retryAfterMs !== undefined) {
            this.retryAfterMs = options.retryAfterMs;
        }
    }
}

// Optional extras for one model call
export type CallOptions = {
    system?: string;
    signal?: AbortSignal;
    // Called with each piece of assistant text as it arrives
    onText?: (text: string) => void;
};

// A model a provider adapter supports: its name at the provider, its context window
// in tokens, the provider's documentation page that states the window, and its
// characters per token. That number is an estimate until it is measured.
export type SupportedModel = {
    name: string;
    contextWindow: number;
    docs: string;
    charsPerToken: number;
};
