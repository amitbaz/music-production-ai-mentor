import { createFakeAbleton } from "./ableton/fake-ableton.ts";
import { createGeminiProvider } from "./agent/providers/gemini.ts";
import { createInterface } from "node:readline";
import type { Message } from "./agent/types.ts";
import { runAgentLoop } from "./agent/agent-loop.ts";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

const provider = createGeminiProvider(apiKey, "gemini-3.5-flash-lite");
const tools = createFakeAbleton();

let conversation: Message[] = [];

const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
});
terminal.setPrompt("\nyou> ");
console.log('Ableton co-pilot (fake session). Type "exit" to quit.');
terminal.prompt();

for await (const line of terminal) {
    const text = line.trim();
    if (text === "exit") break;

    if (text !== "") {
        const firstNew = conversation.length + 1;

        try {
            conversation = await runAgentLoop(provider, tools, [
                ...conversation,
                { type: "user", text },
            ]);
            for (const message of conversation.slice(firstNew)) {
                print(message);
            }
        } catch (error) {
            // A failed request leaves the conversation as it was before this message.
            console.error(
                `error: ${error instanceof Error ? error.message : error}`,
            );
        }
    }
    terminal.prompt();
}

terminal.close();

function print(message: Message) {
    if (message.type === "assistant") {
        console.log(`\ncopilot> ${message.text}`);
    } else if (message.type === "tool_call") {
        console.log(
            `  [tool] ${message.name}(${JSON.stringify(message.args)})`,
        );
    } else if (message.type === "tool_result") {
        console.log(
            `  [${message.isError ? "error" : "result"}] ${message.output}`,
        );
    }
}
