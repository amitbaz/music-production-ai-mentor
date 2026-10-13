// One entry in the conversation. `type` says which of the four kinds it is.
// providerMeta holds provider-specific extras (e.g. Gemini's thoughtSignature); the loop never reads it.
export type Message =
| {type: "user"; text: string}
| {type: "assistant"; text:string; providerMeta?: unknown}
| {type: "tool_call" ; id: string; name: string; args: Record<string, unknown>; providerMeta?: unknown}
| {type: "tool_result"; callId: string; name: string; output: string; isError: boolean}

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
    run: (args: Record<string, unknown>) =>string | Promise<string>;
}

export type ToolCall = Extract<Message, {type: "tool_call"}>

// A model API. Takes the whole conversation and returns the model's new messages.
export type Provider = {
    generate: (conversation: Message[], tools: Tool[], signal?: AbortSignal) => Promise<Message[]>;
}