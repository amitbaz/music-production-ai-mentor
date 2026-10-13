import type { Message, Provider, Tool, ToolCall } from "./types.ts";

const MAX_ROUNDS = 10; // Prevent infinite loops if the model keeps calling tools.

export type LoopResult =
    | { messages: Message[]; stop: "finished" | "round_limit" | "cancelled" }
    | { messages: Message[]; stop: "error"; error: Error };

export type LoopOptions = {
    // Called with each new message as soon as it exists
    onMessage?: (message: Message) => void;
    // Lets the caller cancel the turn
    signal?: AbortSignal;
};

// Never throws: a failed model call is returned as stop "error"
export async function runAgentLoop(
    provider: Provider,
    tools: Tool[],
    conversation: Message[],
    options: LoopOptions = {},
): Promise<LoopResult> {
    // Work on a copy so the caller's list is not modified.
    const messages = [...conversation];

    // Records a new message and reports it to the caller
    const add = (message: Message) => {
        messages.push(message);
        options.onMessage?.(message);
    };

    for (let round = 0; round < MAX_ROUNDS; round++) {
        // Send the whole conversation; get back the model's next messages.
        let reply: Message[];
        try {
            reply = await provider.generate(messages, tools, options.signal);
        } catch (e) {
            // A cancel makes the pending call fail; that is not an error.
            if (options.signal?.aborted) return { messages, stop: "cancelled" };
            const error = e instanceof Error ? e : new Error(String(e));
            return { messages, stop: "error", error };
        }

        for (const message of reply) add(message);

        // Run each tool the model asked for and record its result
        let calledTool = false;
        for (const message of reply) {
            if (message.type !== "tool_call") continue;
            calledTool = true;
            add(await runToolCall(message, tools, options.signal));
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
    signal?: AbortSignal,
): Promise<Message> {
    const result = {
        type: "tool_result" as const,
        callId: call.id,
        name: call.name,
    };

    if (signal?.aborted) {
        return { ...result, output: "Cancelled before it ran", isError: true };
    }

    const tool = tools.find((t) => t.name === call.name);
    if (!tool) {
        return {
            ...result,
            output: `Tool ${call.name} not found`,
            isError: true,
        };
    }

    try {
        return { ...result, output: await tool.run(call.args), isError: false };
    } catch (e) {
        const output = e instanceof Error ? e.message : String(e);
        return { ...result, output, isError: true };
    }
}
