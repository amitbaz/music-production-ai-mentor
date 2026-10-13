import { createFakeAbleton } from "./tools/daws/ableton/fake-ableton.ts";
import { createGeminiProvider } from "./agent/providers/gemini.ts";
import { createInterface } from "node:readline";
import type { Message, ToolCall } from "./agent/types.ts";
import { runAgentLoop } from "./agent/agent-loop.ts";
import { systemPrompt } from "./system-prompt.ts";

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
console.log(
    'Music production AI mentor (fake Ableton session). Type "exit" to quit.',
);

let turn: AbortController | undefined;
terminal.on("SIGINT", () => {
    if (turn) turn.abort();
    else terminal.close();
});
terminal.prompt();

for await (const line of terminal) {
    const text = line.trim();
    if (text === "exit") break;

    if (text !== "") {
        turn = new AbortController();
        const result = await runAgentLoop(
            provider,
            tools,
            [...conversation, { type: "user", text }],
            {
                onMessage: print,
                signal: turn.signal,
                system: systemPrompt,
                approve,
            },
        );

        turn = undefined;

        // Keep everything that happened, even when the turn did not finish
        conversation = result.messages;

        if (result.stop === "error") {
            console.error(`error: ${result.error.message}`);
        } else if (result.stop === "empty") {
            console.error("(no reply)");
        } else if (result.stop === "cancelled") {
            console.log("cancelled");
        } else if (result.stop === "round_limit") {
            console.error("stopped: too many rounds without finishing");
        }
    }
    terminal.prompt();
}

terminal.close();

function approve(call: ToolCall): Promise<boolean> {
    return new Promise((resolve) => {
        // Ctrl+C while the question is open cancels it.
        turn?.signal.addEventListener("abort", () => resolve(false), {
            once: true,
        });
        terminal.question(
            ` Run ${call.name}? (y/n) `,
            { signal: turn?.signal },
            (answer) => resolve(answer.trim().toLowerCase() === "y"),
        );
    });
}

function print(message: Message) {
    if (message.type === "assistant") {
        console.log(`\nmentor> ${message.text}`);
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
