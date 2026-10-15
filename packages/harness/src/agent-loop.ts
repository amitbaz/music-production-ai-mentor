import { estimateTokens, fixedChars, messagesChars } from "./conversation-size.ts";
import type { Message, Model, ModelReply, Tool, ToolCall } from "./types.ts";

// Defaults, each replaceable through LoopOptions
const MAX_ROUNDS = 10; // Prevent infinite loops if the model keeps calling tools.
const RESULT_LIMIT = 40_000; // Most characters one tool result may hold (ADR 0018).

// `conversationSize` is how many tokens the next model call would send, as best the harness knows (ADR 0018).
export type LoopResult =
    | {
          messages: Message[];
          stop: "finished" | "empty" | "cut_off" | "round_limit" | "cancelled";
          conversationSize: number;
      }
    | { messages: Message[]; stop: "error"; error: Error; conversationSize: number };

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
    // Most model calls in one turn
    maxRounds?: number;
    // Most characters one tool result may hold; past it the result is cut
    resultLimit?: number;
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

    // The last count a provider reported, and how many messages it covers
    let counted: { tokens: number; covered: number } | undefined;

    // The conversation size: the last count plus an estimate for what came after it.
    // With no count, everything sent is estimated, system prompt and tools included.
    const conversationSize = () =>
        counted
            ? counted.tokens + estimateTokens(messagesChars(messages.slice(counted.covered)), model.charsPerToken)
            : estimateTokens(fixedChars(tools, options.system) + messagesChars(messages), model.charsPerToken);

    // Ends the turn
    const stopWith = (stop: Exclude<LoopResult["stop"], "error">): LoopResult => ({
        messages,
        stop,
        conversationSize: conversationSize(),
    });

    // Records a new message and reports it to the caller
    const add = (message: Message) => {
        messages.push(message);
        options.onUpdate?.({ type: "message", message });
    };

    for (let round = 0; round < (options.maxRounds ?? MAX_ROUNDS); round++) {
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
            if (options.signal?.aborted) return stopWith("cancelled");
            const error = e instanceof Error ? e : new Error(String(e));
            return { messages, stop: "error", error, conversationSize: conversationSize() };
        }

        // Cut off by the output limit (ADR 0018): the text is kept, and no tool call runs
        // because its arguments may be incomplete. Every call still gets a result.
        if (reply.cutOff) {
            const kept = reply.messages.filter(
                (message) => message.type !== "assistant" || message.text.trim() !== "",
            );
            for (const message of kept) add(message);
            // The count holds the reply; the results added below come after it.
            if (reply.tokens !== undefined) counted = { tokens: reply.tokens, covered: messages.length };
            for (const message of kept) {
                if (message.type !== "tool_call") continue;
                add({
                    type: "tool_result",
                    callId: message.id,
                    name: message.name,
                    output: "Not run: the reply was cut off",
                    isError: true,
                });
            }
            return stopWith("cut_off");
        }

        // No tool call and no text: the model chose to say nothing. Nothing is kept.
        const isEmpty = reply.messages.every(
            (message) =>
                message.type === "assistant" && message.text.trim() === "",
        );
        if (!isEmpty) for (const message of reply.messages) add(message);
        // The count holds the whole request and the reply, so only what comes later is estimated.
        if (reply.tokens !== undefined) counted = { tokens: reply.tokens, covered: messages.length };
        if (isEmpty) return stopWith("empty");

        // Run each tool the model asked for and record its result
        let calledTool = false;
        for (const message of reply.messages) {
            if (message.type !== "tool_call") continue;
            calledTool = true;
            add(await runToolCall(message, tools, options));
        }

        // No tool calls means the model is done; otherwise go around again.
        if (!calledTool) return stopWith("finished");
        if (options.signal?.aborted) return stopWith("cancelled");
    }

    return stopWith("round_limit");
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
        return { ...result, output: limit(await tool.run(call.args), options, false), isError: false };
    } catch (e) {
        const output = e instanceof Error ? e.message : String(e);
        return { ...result, output: limit(output, options, true), isError: true };
    }
}

// Keeps the start of an output past the result limit and says how much was cut.
// An error gets no advice to ask for less: the tool cannot make its error shorter.
function limit(output: string, options: LoopOptions, isError: boolean): string {
    const max = options.resultLimit ?? RESULT_LIMIT;
    if (output.length <= max) return output;
    // A character past U+FFFF takes two; a cut between them would leave half of one.
    const code = output.charCodeAt(max - 1);
    const end = code >= 0xd800 && code <= 0xdbff ? max - 1 : max;
    return `${output.slice(0, end)}\n\n[Cut: showing the first ${end} of ${output.length} characters.${isError ? "" : " Ask the tool for less."}]`;
}
