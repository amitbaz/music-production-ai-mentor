import type { Message, Model, ModelReply, Tool, ToolCall } from "./types.ts";

const MAX_ROUNDS = 10; // Prevent infinite loops if the model keeps calling tools.
const RESULT_LIMIT = 40_000; // Most characters one tool result may hold (ADR 0018).

export type LoopResult =
    | {
          messages: Message[];
          stop: "finished" | "empty" | "round_limit" | "cancelled";
      }
    | { messages: Message[]; stop: "error"; error: Error };

// Something reported to the caller while a turn runs
export type Update =
    // A piece of assistant text that has just arrived
    | { type: "text"; text: string }
    // A whole message, as it was added to the conversation
    | { type: "message"; message: Message };

export type LoopOptions = {
    // Called with each update as soon as it exists
    onUpdate?: (update: Update) => void;
    // Report assistant text in pieces as it arrives, before the whole message
    stream?: boolean;
    // Lets the caller cancel the turn
    signal?: AbortSignal;
    // The system prompt, sent with every model call
    system?: string;
    // Asked before running a tool marked needsApproval; true means go ahead
    approve?: (call: ToolCall) => boolean | Promise<boolean>;
};

// Never throws: a failed model call is returned as stop "error"
export async function runAgentLoop(
    model: Model,
    tools: Tool[],
    conversation: Message[],
    options: LoopOptions = {},
): Promise<LoopResult> {
    // Work on a copy so the caller's list is not modified.
    const messages = [...conversation];

    // Records a new message and reports it to the caller
    const add = (message: Message) => {
        messages.push(message);
        options.onUpdate?.({ type: "message", message });
    };

    for (let round = 0; round < MAX_ROUNDS; round++) {
        // Send the whole conversation; get back the model's next messages.
        let reply: ModelReply;
        // The text of the reply so far, in case the call stops before it is whole
        let arrived = "";
        try {
            reply = await model.call(messages, tools, {
                system: options.system,
                signal: options.signal,
                onText: (text) => {
                    arrived += text;
                    if (options.stream) options.onUpdate?.({ type: "text", text });
                },
            });
        } catch (e) {
            // Text that arrived is kept, cut off where it stopped.
            if (arrived.trim() !== "") add({ type: "assistant", text: arrived });
            // A cancel makes the pending call fail; that is not an error.
            if (options.signal?.aborted) return { messages, stop: "cancelled" };
            const error = e instanceof Error ? e : new Error(String(e));
            return { messages, stop: "error", error };
        }

        // No tool call and no text: the model chose to say nothing. Nothing is kept.
        const isEmpty = reply.messages.every(
            (message) =>
                message.type === "assistant" && message.text.trim() === "",
        );
        if (isEmpty) return { messages, stop: "empty" };

        for (const message of reply.messages) add(message);

        // Run each tool the model asked for and record its result
        let calledTool = false;
        for (const message of reply.messages) {
            if (message.type !== "tool_call") continue;
            calledTool = true;
            add(await runToolCall(message, tools, options));
        }

        // No tool calls means the model is done; otherwise go around again.
        if (!calledTool) return { messages, stop: "finished" };
        if (options.signal?.aborted) return { messages, stop: "cancelled" };
    }

    return { messages, stop: "round_limit" };
}

// Runs one tool call. Never throws: any failure becomes an error result for the model.
async function runToolCall(
    call: ToolCall,
    tools: Tool[],
    options: LoopOptions,
): Promise<Message> {
    const result = {
        type: "tool_result" as const,
        callId: call.id,
        name: call.name,
    };

    const cancelled = {
        ...result,
        output: "Cancelled before it ran",
        isError: true,
    };

    if (options.signal?.aborted) {
        return cancelled;
    }

    const tool = tools.find((t) => t.name === call.name);
    if (!tool) {
        return {
            ...result,
            output: `Tool ${call.name} not found`,
            isError: true,
        };
    }

    if (tool.needsApproval) {
        // No approve function means nobody can say yes, so the answer is no
        const approved = (await options.approve?.(call)) ?? false;
        // A cancel while the user was being asked is a cancel, not a refusal
        if (options.signal?.aborted) return cancelled;
        if (!approved) {
            return {
                ...result,
                output: "The user refused this action",
                isError: true,
            };
        }
    }

    try {
        return { ...result, output: limit(await tool.run(call.args)), isError: false };
    } catch (e) {
        const output = e instanceof Error ? e.message : String(e);
        return { ...result, output: limit(output), isError: true };
    }
}

// Keeps the start of an output past the result limit and says how much was cut
function limit(output: string): string {
    if (output.length <= RESULT_LIMIT) return output;
    return `${output.slice(0, RESULT_LIMIT)}\n\n[Cut: showing the first ${RESULT_LIMIT} of ${output.length} characters. Ask the tool for less.]`;
}
