import {
    type AgentOptions,
    createAgent,
    type Model,
} from "@mentor/harness";
import { createAbleton } from "@mentor/tools/daws/ableton";
import { systemPrompt } from "./system-prompt.ts";

// The mentor's model, the same in every app.
const MODEL_ID = "gemini:gemini-3.5-flash-lite";

// An app passes its API keys, and the address and password of the Remote Script in Live.
// A ready model takes the keys' place in tests.
export type MentorOptions = (
    | Pick<AgentOptions, "keys" | "onRetry">
    | { model: Model }
) & { abletonAddress?: string; abletonPassword?: string };

// The mentor: an agent with its model, system prompt and tools chosen, the same in every app.
export function createMentor({ abletonAddress, abletonPassword, ...options }: MentorOptions) {
    return createAgent({
        model: MODEL_ID,
        ...options,
        tools: createAbleton({ address: abletonAddress, password: abletonPassword }),
        system: systemPrompt,
    });
}
