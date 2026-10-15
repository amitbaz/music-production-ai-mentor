import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import type { LoopResult, Message, ToolCall, TurnOptions } from "@mentor/mentor";
import { createScreen, type Output } from "./render.ts";

export type CliOptions = {
    // What the CLI needs of the mentor: run one turn
    mentor: {
        generate: (conversation: Message[], text: string, turn: TurnOptions) => Promise<LoopResult>;
    };
    input: Readable;
    output: Output & NodeJS.WritableStream;
    // Where problems are written
    errors: Output;
    // Whether input is a keyboard, which Ctrl+C needs. Left out, it follows the output.
    terminal?: boolean;
    color?: boolean;
    width?: () => number | undefined;
};

// Show the mentor's text as it is written. Fixed until the app has settings.
const STREAMING = true;

// Reads lines from the user until they type exit, Ctrl+C is pressed with no turn running, or the input ends.
export async function runCli({ mentor, input, output, errors, terminal, color, width }: CliOptions): Promise<void> {
    const screen = createScreen(output, { color, width });
    const lines = createInterface({ input, output, terminal });
    let conversation: Message[] = [];
    let turn: AbortController | undefined;

    lines.setPrompt("\nyou> ");
    output.write('Music production AI mentor. Type "exit" to quit.\n');
    lines.on("SIGINT", () => {
        if (turn) turn.abort();
        else lines.close();
    });
    lines.prompt();

    for await (const line of lines) {
        const text = line.trim();
        if (text === "exit") break;

        if (text !== "") {
            turn = new AbortController();
            const result = await mentor.generate(conversation, text, {
                onUpdate: screen.show,
                stream: STREAMING,
                signal: turn.signal,
                approve,
            });
            turn = undefined;

            // Keep everything that happened, even when the turn did not finish
            conversation = result.messages;

            if (result.stop === "error") {
                errors.write(`error: ${result.error.message}\n`);
            } else if (result.stop === "empty") {
                errors.write("(no reply)\n");
            } else if (result.stop === "cut_off") {
                errors.write("(reply cut off)\n");
            } else if (result.stop === "cancelled") {
                output.write("cancelled\n");
            } else if (result.stop === "round_limit") {
                errors.write("stopped: too many rounds without finishing\n");
            }
        }
        lines.prompt();
    }

    lines.close();

    function approve(call: ToolCall): Promise<boolean> {
        return new Promise((resolve) => {
            // Ctrl+C while the question is open cancels it.
            turn?.signal.addEventListener("abort", () => resolve(false), { once: true });
            lines.question(
                ` Run ${call.name}? (y/n) `,
                { signal: turn?.signal },
                (answer) => resolve(answer.trim().toLowerCase() === "y"),
            );
        });
    }
}
