import { test } from "node:test";
import assert from "node:assert/strict";
import type { Message, Update } from "@mentor/mentor";
import { createScreen } from "./render.ts";

// A screen that writes into a string, so a test can read what the user would see.
function screen(options: { width?: number; color?: boolean } = {}) {
    let text = "";
    const { show, endTurn } = createScreen(
        { write: (piece: string) => (text += piece) },
        { width: () => options.width, color: options.color },
    );
    const showAll = (...updates: Update[]) => updates.forEach(show);
    return { show, showAll, endTurn, text: () => text };
}

const message = (message: Message): Update => ({ type: "message", message });
const piece = (text: string): Update => ({ type: "text", text });

test("a summary is shown as a short line saying the earlier conversation was summarised", () => {
    const s = screen();

    s.show(message({ type: "summary", text: "Goal: a lo-fi beat" }));

    assert.equal(s.text(), "\n(earlier conversation summarised)\n");
});

test("the summary line is dimmed when the terminal shows colour", () => {
    const s = screen({ color: true });

    s.show(message({ type: "summary", text: "Goal: a lo-fi beat" }));

    assert.equal(s.text(), "\n\x1b[2m(earlier conversation summarised)\x1b[22m\n");
});

test("the notice that summarising has started is shown as a short line", () => {
    const s = screen();

    s.show({ type: "summarising" });

    assert.equal(s.text(), "\n(summarising the earlier conversation…)\n");
});

test("the summarising notice is dimmed when the terminal shows colour", () => {
    const s = screen({ color: true });

    s.show({ type: "summarising" });

    assert.equal(s.text(), "\n\x1b[2m(summarising the earlier conversation…)\x1b[22m\n");
});

test("an assistant message that was not streamed is written whole", () => {
    const s = screen();

    s.show(message({ type: "assistant", text: "Hello" }));

    assert.equal(s.text(), "\nmentor> Hello\n");
});

test("streamed text opens one line, and the whole message closes it without writing the text again", () => {
    const s = screen();

    s.showAll(piece("Hel"), piece("lo"), message({ type: "assistant", text: "Hello" }));

    assert.equal(s.text(), "\nmentor> Hello\n");
});

test("the next streamed message opens a new line", () => {
    const s = screen();

    s.showAll(
        piece("One"),
        message({ type: "assistant", text: "One" }),
        piece("Two"),
        message({ type: "assistant", text: "Two" }),
    );

    assert.equal(s.text(), "\nmentor> One\n\nmentor> Two\n");
});

test("a tool call is shown with its name and arguments", () => {
    const s = screen();

    s.show(message({ type: "tool_call", id: "1", name: "set_tempo", args: { bpm: 128 } }));

    assert.equal(s.text(), '\n⏺ set_tempo({"bpm":128})\n');
});

const result = (output: string, isError = false): Update =>
    message({ type: "tool_result", callId: "1", name: "read_set", output, isError });

test("a tool result shows its first line and how many lines were left out", () => {
    const s = screen();

    s.show(result("tempo 128\ntrack 1\ntrack 2"));

    assert.equal(s.text(), "  ⎿  tempo 128 (+2 lines)\n");
});

test("a tool result line too wide for the screen is cut with an ellipsis", () => {
    const s = screen({ width: 16 });

    s.show(result("0123456789abcdefghij"));

    // The line gets the width less the six characters of the indent, the ellipsis included.
    assert.equal(s.text(), "  ⎿  012345678…\n");
});

test("a failed tool result is red when the terminal shows colour, and plain when it does not", () => {
    const coloured = screen({ color: true });
    const plain = screen();

    coloured.show(result("no such track", true));
    plain.show(result("no such track", true));

    assert.equal(coloured.text(), "\x1b[31m  ⎿  no such track\x1b[39m\n");
    assert.equal(plain.text(), "  ⎿  no such track\n");
});

test("the user's own message is not echoed", () => {
    const s = screen();

    s.show(message({ type: "user", text: "hello" }));

    assert.equal(s.text(), "");
});

test("the end of a turn closes a line left open by text whose message was dropped", () => {
    const s = screen();

    // A reply of only whitespace is dropped by the loop, so no message follows its text.
    s.showAll(piece("\n"));
    s.endTurn();
    s.showAll(piece("Hi"), message({ type: "assistant", text: "Hi" }));

    assert.equal(s.text(), "\nmentor> \n\n\nmentor> Hi\n");
});

test("the end of a turn writes nothing when no line is open", () => {
    const s = screen();

    s.showAll(piece("Hi"), message({ type: "assistant", text: "Hi" }));
    s.endTurn();

    assert.equal(s.text(), "\nmentor> Hi\n");
});
