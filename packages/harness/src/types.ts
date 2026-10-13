// One entry in the conversation. `type` says which of the four kinds it is.
// providerMeta holds provider-specific extras (e.g. Gemini's thoughtSignature); the loop never reads it.
export type Message =
    | { type: "user"; text: string }
    | { type: "assistant"; text: string; providerMeta?: unknown }
    | {
          type: "tool_call";
          id: string;
          name: string;
          args: Record<string, unknown>;
          providerMeta?: unknown;
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

// A model API. Takes the whole conversation and returns the model's new messages.
export type Model = {
    call: (
        conversation: Message[],
        tools: Tool[],
        options?: CallOptions,
    ) => Promise<Message[]>;
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
