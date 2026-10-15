import { type LoopOptions, type LoopResult, runAgentLoop } from "./agent-loop.ts";
import { type Keys, modelFor } from "./providers/index.ts";
import type { RetryOptions } from "./retry.ts";
import type { Message, Model, Tool } from "./types.ts";

export type AgentOptions = {
    // A model id, written provider:model. A ready model takes its place in tests.
    model: string | Model;
    // One API key per provider name; needed for a model id
    keys?: Keys;
    tools: Tool[];
    // The system prompt. A function is called at the start of each turn.
    system?: string | (() => string);
    // Called before each wait of a retry
    onRetry?: RetryOptions["onRetry"];
    // Most model calls in one turn; the loop's default when absent
    maxRounds?: number;
    // Most characters one tool result may hold; the loop's default when absent
    resultLimit?: number;
};

// What a caller can hook into during a turn. The system prompt is the agent's own.
export type TurnOptions = Omit<LoopOptions, "system" | "maxRounds" | "resultLimit">;

// An agent: one model, one system prompt and one set of tools. Never throws.
export function createAgent(options: AgentOptions) {
    const { tools, system, maxRounds, resultLimit } = options;
    const model =
        typeof options.model === "string"
            ? modelFor(options.model, options.keys ?? {}, {
                  onRetry: options.onRetry,
              })
            : options.model;

    return {
        // Runs one turn. The caller keeps the conversation: it passes it in and takes the new one from the result.
        generate: (
            conversation: Message[],
            text: string,
            turn: TurnOptions = {},
        ): Promise<LoopResult> =>
            runAgentLoop(model, tools, [...conversation, { type: "user", text }], {
                ...turn,
                maxRounds,
                resultLimit,
                system: typeof system === "function" ? system() : system,
            }),
    };
}
