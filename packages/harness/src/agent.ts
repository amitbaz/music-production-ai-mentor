import { type LoopOptions, type LoopResult, runAgentLoop } from "./agent-loop.ts";
import { type Keys, broken, modelFor } from "./providers/index.ts";
import type { RetryOptions } from "./retry.ts";
import type { Message, Model, Tool } from "./types.ts";

// The retry options (maxRetries, timeoutMs, firstWaitMs, onRetry) apply to a model id, not to a ready model.
export type AgentOptions = RetryOptions & {
    // A model id, written provider:model. A ready model takes its place in tests.
    model: string | Model;
    // One API key per provider name; needed for a model id
    keys?: Keys;
    tools: Tool[];
    // The system prompt. A function is called at the start of each turn.
    system?: string | (() => string);
    // Most model calls in one turn; the loop's default when absent
    maxRounds?: number;
    // Most characters one tool result may hold; the loop's default when absent
    resultLimit?: number;
};

// What a caller can hook into during a turn. The system prompt is the agent's own.
export type TurnOptions = Omit<LoopOptions, "system" | "maxRounds" | "resultLimit">;

// Whole numbers need `Number.isInteger`; NaN and Infinity fail both checks.
const wholeAbove0 = (n: number) => Number.isInteger(n) && n > 0;
const checks: [keyof AgentOptions, string, (n: number) => boolean][] = [
    ["resultLimit", "a whole number above 0", wholeAbove0],
    ["maxRounds", "a whole number above 0", wholeAbove0],
    ["maxRetries", "a whole number, 0 or more", (n) => Number.isInteger(n) && n >= 0],
    ["timeoutMs", "a number above 0", (n) => Number.isFinite(n) && n > 0],
    ["firstWaitMs", "a number, 0 or more", (n) => Number.isFinite(n) && n >= 0],
];

// The message for the first number option that makes no sense, if any
function invalidNumber(options: AgentOptions): string | undefined {
    for (const [name, rule, ok] of checks) {
        const value = options[name];
        if (value !== undefined && !ok(value as number)) {
            return `${name} must be ${rule}, got ${value}`;
        }
    }
}

// An agent: one model, one system prompt and one set of tools. Never throws.
export function createAgent(options: AgentOptions) {
    const { tools, system, maxRounds, resultLimit } = options;
    // A bad number ends the first turn with an error, as a missing key does.
    const invalid = invalidNumber(options);
    const model = invalid
        ? broken(invalid)
        : typeof options.model === "string"
            ? modelFor(options.model, options.keys ?? {}, options)
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
