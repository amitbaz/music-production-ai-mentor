import { createInterface } from "node:readline";
import { styleText } from "node:util";
import {
    createMentor,
    type Message,
    type ToolCall,
    type Update,
} from "@mentor/mentor";

// Show the mentor's text as it is written. Fixed until the app has settings.
const STREAMING = true;

const mentor = createMentor({
    keys: { gemini: process.env.GEMINI_API_KEY },
    abletonAddress: process.env.ABLETON_ADDRESS,
    onRetry: ({ error, retry, maxRetries, waitMs }) =>
        console.error(
            `  (${error.message}, trying again in ${waitMs / 1000}s, retry ${retry} of ${maxRetries})`,
        ),
});

let conversation: Message[] = [];

const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
});
terminal.setPrompt("\nyou> ");
console.log(
    'Music production AI mentor. Type "exit" to quit.',
);

// Whether a streamed assistant message is on screen with its line still open
let writing = false;

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
        const result = await mentor.generate(conversation, text, {
            onUpdate: show,
            stream: STREAMING,
            signal: turn.signal,
            approve,
        });

        turn = undefined;

        // Keep everything that happened, even when the turn did not finish
        conversation = result.messages;

        if (result.stop === "error") {
            console.error(`error: ${result.error.message}`);
        } else if (result.stop === "empty") {
            console.error("(no reply)");
        } else if (result.stop === "cut_off") {
            console.error("(reply cut off)");
        } else if (result.stop === "cancelled") {
            console.log("cancelled");
        } else if (result.stop === "round_limit") {
            console.error("stopped: too many rounds without finishing");
        }
    }
    terminal.prompt();
}

terminal.close();
// The connection to Live, once opened, would keep the process running.
process.exit();

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

function show(update: Update) {
    if (update.type === "text") {
        // The first piece of a message opens its line.
        if (!writing) process.stdout.write("\nmentor> ");
        writing = true;
        process.stdout.write(update.text);
    } else if (writing && update.message.type === "assistant") {
        // Its text is already on screen; only the line is closed.
        writing = false;
        console.log();
    } else {
        print(update.message);
    }
}

function print(message: Message) {
    if (message.type === "assistant") {
        console.log(`\nmentor> ${message.text}`);
    } else if (message.type === "tool_call") {
        console.log(`\n⏺ ${message.name}(${JSON.stringify(message.args)})`);
    } else if (message.type === "tool_result") {
        const line = `  ⎿  ${summary(message.output)}`;
        console.log(message.isError ? styleText("red", line) : line);
    }
}

// The first line of a tool's output, cut to fit the screen. The model still sees all of it.
function summary(output: string): string {
    const [first = "", ...rest] = output.split("\n");
    const width = (process.stdout.columns ?? 80) - 6;
    const line = first.length > width ? `${first.slice(0, width - 1)}…` : first;
    return rest.length > 0 ? `${line} (+${rest.length} lines)` : line;
}
