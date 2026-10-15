import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import type { LoopResult, Message, ToolCall, TurnOptions } from "@mentor/mentor";
import { runCli } from "./run.ts";

type Generate = (conversation: Message[], text: string, turn: TurnOptions) => Promise<LoopResult>;

const finished = (messages: Message[]): LoopResult => ({ messages, stop: "finished" });

// A CLI wired to fake streams and a scripted mentor. `type` is what the user types;
// `terminal` makes the input behave as a real keyboard, which Ctrl+C needs.
function start(generate: Generate, { terminal = false } = {}) {
    const input = new PassThrough();
    const output = new PassThrough();
    const errors = new PassThrough();
    let out = "";
    let err = "";
    output.on("data", (chunk) => (out += chunk));
    errors.on("data", (chunk) => (err += chunk));

    const done = runCli({ mentor: { generate }, input, output, errors, terminal });

    return {
        done,
        type: (text: string) => input.write(text),
        out: () => out,
        err: () => err,
    };
}

// Waits until what the user sees contains the text, for steps that happen in the middle of a turn
async function until(seen: () => string, text: string) {
    const giveUp = Date.now() + 2000;
    while (!seen().includes(text) && Date.now() < giveUp) {
        await new Promise((resolve) => setImmediate(resolve));
    }
    assert.ok(seen().includes(text), `never saw ${JSON.stringify(text)} in ${JSON.stringify(seen())}`);
}

test("it greets the user and ends when they type exit", async () => {
    const cli = start(async () => assert.fail("no turn should run"));

    cli.type("exit\n");
    await cli.done;

    assert.match(cli.out(), /Music production AI mentor\. Type "exit" to quit\./);
});

test("a line is sent to the mentor, and blank lines are not", async () => {
    const texts: string[] = [];
    const cli = start(async (_conversation, text) => {
        texts.push(text);
        return finished([]);
    });

    cli.type("  hello  \n\n   \nexit\n");
    await cli.done;

    assert.deepEqual(texts, ["hello"]);
});

test("the next line is sent with everything that happened so far, and the mentor is asked to stream", async () => {
    const calls: { conversation: Message[]; stream?: boolean }[] = [];
    const cli = start(async (conversation, text, turn) => {
        calls.push({ conversation, stream: turn.stream });
        return finished([...conversation, { type: "user", text }, { type: "assistant", text: `Re: ${text}` }]);
    });

    cli.type("one\ntwo\nexit\n");
    await cli.done;

    assert.deepEqual(calls[1]?.conversation, [
        { type: "user", text: "one" },
        { type: "assistant", text: "Re: one" },
    ]);
    assert.equal(calls[0]?.stream, true);
});

test("a conversation that holds a summary is kept whole and shown as the summary line", async () => {
    const summary: Message = { type: "summary", text: "Goal: a lo-fi beat" };
    const calls: Message[][] = [];
    const cli = start(async (conversation, text, turn) => {
        calls.push(conversation);
        turn.onUpdate?.({ type: "message", message: summary });
        return finished([...conversation, { type: "user", text }, summary]);
    });

    cli.type("one\ntwo\nexit\n");
    await cli.done;

    assert.deepEqual(calls[1]?.at(-1), summary);
    assert.match(cli.out(), /\(earlier conversation summarised\)/);
});

test("a turn that did not finish is kept, and says why", async () => {
    const kept: Message = { type: "user", text: "kept" };
    const cases: [LoopResult, "out" | "err", string][] = [
        [{ messages: [kept], stop: "error", error: new Error("boom") }, "err", "error: boom"],
        [{ messages: [kept], stop: "empty" }, "err", "(no reply)"],
        [{ messages: [kept], stop: "cut_off" }, "err", "(reply cut off)"],
        [{ messages: [kept], stop: "round_limit" }, "err", "stopped: too many rounds without finishing"],
        [{ messages: [kept], stop: "cancelled" }, "out", "cancelled"],
    ];

    for (const [result, where, line] of cases) {
        const seen: Message[][] = [];
        const cli = start(async (conversation) => {
            seen.push(conversation);
            return result;
        });

        cli.type("go\nagain\nexit\n");
        await cli.done;

        assert.ok(cli[where]().includes(line), `${result.stop}: expected ${line} in ${cli[where]()}`);
        assert.deepEqual(seen[1], [kept], `${result.stop}: the conversation was not kept`);
    }
});

const call: ToolCall = { type: "tool_call", id: "1", name: "delete_track", args: {} };

test("a tool that needs approval asks the user, and y says yes", async () => {
    let approved: boolean | undefined;
    const cli = start(async (_conversation, _text, turn) => {
        approved = await turn.approve?.(call);
        return finished([]);
    });

    cli.type("go\n");
    await until(cli.out, "Run delete_track? (y/n)");
    cli.type("y\n");
    cli.type("exit\n");
    await cli.done;

    assert.equal(approved, true);
});

test("anything but y is a no", async () => {
    let approved: boolean | undefined;
    const cli = start(async (_conversation, _text, turn) => {
        approved = await turn.approve?.(call);
        return finished([]);
    });

    cli.type("go\n");
    await until(cli.out, "Run delete_track? (y/n)");
    cli.type("maybe\n");
    cli.type("exit\n");
    await cli.done;

    assert.equal(approved, false);
});

test("Ctrl+C during a turn cancels it and the CLI carries on", async () => {
    let signal: AbortSignal | undefined;
    const texts: string[] = [];
    const cli = start(
        async (_conversation, text, turn) => {
            texts.push(text);
            signal = turn.signal;
            if (text === "slow") {
                await new Promise((resolve) => turn.signal?.addEventListener("abort", resolve, { once: true }));
                return { messages: [], stop: "cancelled" };
            }
            return finished([]);
        },
        { terminal: true },
    );

    cli.type("slow\r");
    await until(() => String(texts), "slow");
    cli.type("\x03");
    await until(cli.out, "cancelled");
    cli.type("next\r");
    await until(() => String(texts), "next");
    cli.type("exit\r");
    await cli.done;

    assert.deepEqual(texts, ["slow", "next"]);
    assert.equal(signal?.aborted, false, "the next turn starts with a fresh signal");
});

test("Ctrl+C while a tool asks for approval answers no and cancels", async () => {
    let approved: boolean | undefined;
    const cli = start(
        async (_conversation, _text, turn) => {
            approved = await turn.approve?.(call);
            return { messages: [], stop: "cancelled" };
        },
        { terminal: true },
    );

    cli.type("go\r");
    await until(cli.out, "Run delete_track? (y/n)");
    cli.type("\x03");
    await until(cli.out, "cancelled");
    cli.type("exit\r");
    await cli.done;

    assert.equal(approved, false);
});

test("Ctrl+C when no turn is running ends the CLI", async () => {
    const cli = start(async () => assert.fail("no turn should run"), { terminal: true });

    await until(cli.out, "you>");
    cli.type("\x03");
    await cli.done;
});
