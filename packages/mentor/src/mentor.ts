import {
    type LoopOptions,
    type LoopResult,
    type Message,
    type Provider,
    type RetryOptions,
    runAgentLoop,
    withRetry,
} from "@mentor/harness";
import { createGeminiProvider } from "@mentor/harness/providers/gemini";
import { createFakeAbleton } from "@mentor/tools/daws/ableton";
import { systemPrompt } from "./system-prompt.ts";

// An app passes its API key. A ready provider takes its place in tests.
export type MentorOptions =
    | { apiKey: string; onRetry?: RetryOptions["onRetry"] }
    | { provider: Provider };

// What an app can hook into during a turn. The system prompt is the mentor's own.
export type TurnOptions = Omit<LoopOptions, "system">;

// The mentor: one model, one system prompt and one set of tools, the same in every app.
export function createMentor(options: MentorOptions) {
    const provider =
        "provider" in options
            ? options.provider
            : withRetry(
                  createGeminiProvider(options.apiKey, "gemini-3.5-flash-lite"),
                  { onRetry: options.onRetry },
              );
    const tools = createFakeAbleton();

    return {
        // The app keeps the conversation: it passes it in and takes the new one from the result.
        runTurn: (
            conversation: Message[],
            text: string,
            turn: TurnOptions = {},
        ): Promise<LoopResult> =>
            runAgentLoop(
                provider,
                tools,
                [...conversation, { type: "user", text }],
                { ...turn, system: systemPrompt },
            ),
    };
}
