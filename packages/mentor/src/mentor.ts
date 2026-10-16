import {
    type AgentOptions,
    createAgent,
    type Model,
} from "@mentor/harness";
import { createAbleton } from "@mentor/tools/daws/ableton";
import { systemPrompt } from "./system-prompt.ts";

// The mentor's model unless another is asked for, the same in every app.
export const MODEL_ID = "gemini:gemini-3.5-flash-lite";

// An app passes its API keys, and the address and password of the Remote Script in Live.
// A model id, written provider:model, runs the mentor on another model, as the evals do (ADR 0020).
// A ready model takes the keys' place in tests.
export type MentorOptions = (
    | (Pick<AgentOptions, "keys" | "onRetry"> & { model?: string })
    | { model: Model }
) & { abletonAddress?: string; abletonPassword?: string };

// The mentor: an agent with its model, system prompt and tools chosen, the same in every app.
export function createMentor({ abletonAddress, abletonPassword, ...options }: MentorOptions) {
    return createAgent({
        ...options,
        model: options.model ?? MODEL_ID,
        tools: createAbleton({ address: abletonAddress, password: abletonPassword }),
        system: systemPrompt,
    });
}
