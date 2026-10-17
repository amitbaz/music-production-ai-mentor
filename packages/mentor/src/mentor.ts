import { join } from "node:path";
import {
    type AgentOptions,
    connectMcp,
    createAgent,
    type McpConnection,
    type Model,
    type Tool,
    type TurnOptions as AgentTurnOptions,
    type Update as AgentUpdate,
    type Message,
} from "@mentor/harness";
import { createAbleton } from "@mentor/tools/daws/ableton";
import { knowledgeBaseSection, systemPrompt } from "./system-prompt.ts";

// The mentor's model unless another is asked for, the same in every app.
export const MODEL_ID = "gemini:gemini-3.5-flash-lite";

// The API key of each provider, read from its environment variable, the same in every app.
export function keysFromEnv(env: Record<string, string | undefined>) {
    return { gemini: env.GEMINI_API_KEY, claude: env.ANTHROPIC_API_KEY };
}

// Starts the knowledge base server in a clone of mentor-kb (ADR 0026). Close it when done.
export function connectKnowledgeBase(clone: string): McpConnection {
    return connectMcp({ command: process.execPath, args: [join(clone, "src", "server.ts")] });
}

// What the mentor reports while a turn runs: the agent's updates, and the knowledge base's.
export type Update =
    | AgentUpdate
    // The first turn is waiting for the knowledge base to start
    | { type: "knowledge_base_loading" }
    // The knowledge base could not be reached; the mentor carries on without it
    | { type: "knowledge_base_unavailable"; reason: string };

export type TurnOptions = Omit<AgentTurnOptions, "onUpdate"> & { onUpdate?: (update: Update) => void };

// An app passes its API keys, and the address and password of the Remote Script in Live.
// A model id, written provider:model, runs the mentor on another model, as the evals do (ADR 0020).
// A ready model takes the keys' place in tests.
// A knowledge base is optional (ADR 0026): an app passes its connection, which may still be starting.
export type MentorOptions = (
    | (Pick<AgentOptions, "keys" | "onRetry"> & { model?: string })
    | { model: Model }
) & { abletonAddress?: string; abletonPassword?: string; knowledgeBase?: McpConnection };

// The mentor: an agent with its model, system prompt and tools chosen, the same in every app.
export function createMentor({ abletonAddress, abletonPassword, knowledgeBase, ...options }: MentorOptions) {
    const ableton = createAbleton({ address: abletonAddress, password: abletonPassword });
    const agentWith = (kbTools: Tool[]) =>
        createAgent({
            ...options,
            model: options.model ?? MODEL_ID,
            tools: [...ableton, ...kbTools],
            system: kbTools.length ? `${systemPrompt}\n\n${knowledgeBaseSection}` : systemPrompt,
        });
    // The knowledge base's tools, or why it could not be reached
    const knowledge = (knowledgeBase?.tools ?? Promise.resolve([])).then(
        (tools) => tools,
        (error: Error) => error,
    );
    let agent: ReturnType<typeof createAgent> | undefined;

    return {
        // The first turn waits for the knowledge base; one that fails is reported once and left out.
        generate: async (conversation: Message[], text: string, turn: TurnOptions = {}) => {
            if (!agent) {
                // Still starting once everything already settled has run: say why the turn waits.
                const pending = Symbol();
                const now = await Promise.race([knowledge, new Promise((resolve) => setImmediate(resolve, pending))]);
                if (now === pending) turn.onUpdate?.({ type: "knowledge_base_loading" });
                const tools = await knowledge;
                if (tools instanceof Error) turn.onUpdate?.({ type: "knowledge_base_unavailable", reason: tools.message });
                agent = agentWith(tools instanceof Error ? [] : tools);
            }
            return agent.generate(conversation, text, turn);
        },
    };
}
