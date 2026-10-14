import {
    type AgentOptions,
    createAgent,
    type Model,
} from "@mentor/harness";
import { createAbleton } from "@mentor/tools/daws/ableton";
import { systemPrompt } from "./system-prompt.ts";

// The mentor's model, the same in every app.
const MODEL_ID = "gemini:gemini-3.5-flash-lite";

// An app passes its API keys. A ready model takes their place in tests.
export type MentorOptions =
    | Pick<AgentOptions, "keys" | "onRetry">
    | { model: Model };

// The mentor: an agent with its model, system prompt and tools chosen, the same in every app.
export function createMentor(options: MentorOptions) {
    return createAgent({
        model: MODEL_ID,
        ...options,
        tools: createAbleton(),
        system: systemPrompt,
    });
}
