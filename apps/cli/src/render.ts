import { styleText } from "node:util";
import type { Message, Update } from "@mentor/mentor";

export type Output = { write: (text: string) => unknown };

type ScreenOptions = {
    // The width of the screen, asked each time a line is cut, as the user can resize it
    width?: () => number | undefined;
    // Whether the terminal shows colour
    color?: boolean;
};

// What the user sees of the conversation: turns each update into text on the output.
export function createScreen(output: Output, options: ScreenOptions = {}) {
    // Whether a streamed assistant message is on screen with its line still open
    let writing = false;

    const line = (text: string) => output.write(`${text}\n`);
    const style = (format: "red" | "dim", text: string) =>
        options.color ? styleText(format, text, { validateStream: false }) : text;

    function print(message: Message) {
        if (message.type === "assistant") {
            line(`\nmentor> ${message.text}`);
        } else if (message.type === "summary") {
            line(`\n${style("dim", "(earlier conversation summarised)")}`);
        } else if (message.type === "tool_call") {
            line(`\n⏺ ${message.name}(${JSON.stringify(message.args)})`);
        } else if (message.type === "tool_result") {
            const text = `  ⎿  ${firstLine(message.output)}`;
            line(message.isError ? style("red", text) : text);
        }
    }

    // The first line of a tool's output, cut to fit the screen. The model still sees all of it.
    function firstLine(text: string): string {
        const [first = "", ...rest] = text.split("\n");
        const width = Math.max(1, (options.width?.() ?? 80) - 6);
        const cut = first.length > width ? `${first.slice(0, width - 1)}…` : first;
        return rest.length > 0 ? `${cut} (+${rest.length} lines)` : cut;
    }

    return {
        show(update: Update) {
            if (update.type === "text") {
                // The first piece of a message opens its line.
                if (!writing) output.write("\nmentor> ");
                writing = true;
                output.write(update.text);
            } else if (writing && update.message.type === "assistant") {
                // Its text is already on screen; only the line is closed.
                writing = false;
                output.write("\n");
            } else {
                print(update.message);
            }
        },

        // Closes a line left open by text whose message the loop dropped, such as a reply of only whitespace
        endTurn() {
            if (writing) output.write("\n");
            writing = false;
        },
    };
}
