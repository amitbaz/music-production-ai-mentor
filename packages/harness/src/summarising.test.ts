import { test } from "node:test";
import assert from "node:assert/strict";
import { createAgent, type TurnOptions } from "./agent.ts";
import type { Update } from "./agent-loop.ts";
import { SUMMARY_INSTRUCTIONS, SUMMARY_REQUEST } from "./summary.ts";
import type { CallOptions, Message, Model, ModelReply, Tool } from "./types.ts";

// Text that takes this many tokens at four characters to a token
const tokens = (n: number) => "x".repeat(n * 4);
const user = (n: number): Message => ({ type: "user", text: tokens(n) });
const assistant = (n: number): Message => ({ type: "assistant", text: tokens(n) });
const said = (text: string): Message[] => [{ type: "assistant", text }];

type Call = { conversation: Message[]; tools: Tool[]; options?: CallOptions };
type Step = Message[] | ModelReply | Error | ((call: Call) => Message[] | ModelReply);

// A scripted model: one step per call. A step is the reply's messages, a whole reply, an error to throw,
// or a function that sees the call first (to cancel in the middle of it, say).
function scriptedModel(steps: Step[]) {
    const calls: Call[] = [];
    const model: Model = {
        call: async (conversation, tools, options) => {
            const call = { conversation: [...conversation], tools, options };
            calls.push(call);
            let step = steps.shift();
            if (step instanceof Error) throw step;
            if (typeof step === "function") step = step(call);
            if (!step) return { messages: [], cutOff: false };
            return Array.isArray(step) ? { messages: step, cutOff: false } : step;
        },
    };
    return { model, calls };
}

// A summary request is the call with no tools and the summary instructions
const isSummaryRequest = (call: Call) => call.options?.system === SUMMARY_INSTRUCTIONS;

const readTool: Tool = {
    name: "read",
    description: "Reads",
    params: {},
    // The result limit is 40,000 characters: 10,000 tokens
    run: () => tokens(10_000),
};

// What the app is told: the kind of each update
function recorder() {
    const updates: Update[] = [];
    return { updates, turn: { onUpdate: (u: Update) => updates.push(u) } as TurnOptions };
}
const kinds = (updates: Update[]) =>
    updates.map((u) => (u.type === "message" ? u.message.type : u.type));

// Four messages of 80k, 10k, 15k and 15k tokens: 120k, past the threshold. A turn of one word on top keeps the newest 30k.
const old: Message[] = [user(80_000), assistant(10_000), user(15_000), assistant(15_000)];

test("no summary while the conversation size is at the threshold", async () => {
    const { model, calls } = scriptedModel([said("ok")]);

    // Exactly 100,000 tokens with the new text
    const result = await createAgent({ model, tools: [] }).generate([], tokens(100_000));

    assert.equal(result.stop, "finished");
    assert.equal(calls.length, 1);
});

test("the summary request has no tools, the summary instructions, the older messages and a request, and does not stream", async () => {
    const { model, calls } = scriptedModel([said("the summary"), said("answer")]);
    const signal = new AbortController().signal;

    await createAgent({ model, tools: [readTool], system: "You are the mentor." }).generate(
        old,
        "next",
        { stream: true, signal },
    );

    const request = calls[0];
    assert.ok(request);
    assert.deepEqual(request.tools, []);
    assert.equal(request.options?.system, SUMMARY_INSTRUCTIONS);
    assert.equal(request.options?.onText, undefined);
    assert.equal(request.options?.signal, signal);
    assert.deepEqual(request.conversation, [
        old[0],
        old[1],
        { type: "user", text: SUMMARY_REQUEST },
    ]);
});

test("the instructions give the headings, exact names, no tools, a fresh read of the Live Set, and newer over older", () => {
    for (const part of [
        "Goal",
        "Preferences",
        "Changes made (and why)",
        "Open questions",
        "exact",
        "track",
        "plug-in",
        "tool",
        "Live Set",
        "newer",
    ]) {
        assert.ok(SUMMARY_INSTRUCTIONS.includes(part), `the instructions lack "${part}"`);
    }
});

test("the notice comes first, then the summary as a message, right before the kept part; the next call is sent only the summary and what follows", async () => {
    const { model, calls } = scriptedModel([said("the summary"), said("answer")]);
    const { updates, turn } = recorder();

    const result = await createAgent({ model, tools: [] }).generate(old, "next", turn);

    const summary: Message = { type: "summary", text: "the summary" };
    assert.deepEqual(kinds(updates), ["summarising", "summary", "assistant"]);
    assert.deepEqual(updates[1], { type: "message", message: summary });
    assert.deepEqual(calls[1]?.conversation, [summary, old[2], old[3], { type: "user", text: "next" }]);
    // The app keeps every message
    assert.deepEqual(result.messages, [
        old[0],
        old[1],
        summary,
        old[2],
        old[3],
        { type: "user", text: "next" },
        { type: "assistant", text: "answer" },
    ]);
    assert.equal(result.stop, "finished");
});

test("the size after a summary is the size of what the next call was sent, not the count from before", async () => {
    const { model } = scriptedModel([said("s".repeat(40)), said("a".repeat(40))]);

    const result = await createAgent({ model, tools: [] }).generate(old, "n".repeat(40));

    // summary 40 + 15k + 15k tokens + new text 40 + reply 40 characters
    assert.equal(result.conversationSize, 30_000 + (40 + 40 + 40) / 4);
});

test("the kept part is about 20,000 tokens: the newest messages until 20,000 are passed", async () => {
    // Twenty messages of 6,000 tokens: 120,000
    const long = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? user(6_000) : assistant(6_000)));
    const { model, calls } = scriptedModel([said("the summary"), said("answer")]);

    await createAgent({ model, tools: [] }).generate(long, "next");

    // next (1 token) + 6,000 × 3 = 18,001; the fourth message back brings it to 24,001, and it is a user message
    assert.equal(calls[1]?.conversation.length, 1 + 4 + 1);
    assert.deepEqual(calls[1]?.conversation.slice(1, -1), long.slice(-4));
    assert.equal(calls[0]?.conversation.length, 16 + 1);
});

test("the kept part never starts at a tool result: it starts at the model's reply", async () => {
    // The tool result of 25,000 tokens alone passes 20,000, so the cut moves back to its tool call
    const conversation: Message[] = [
        user(60_000),
        assistant(30_000),
        { type: "user", text: "read it" },
        { type: "tool_call", id: "1", name: "read", args: {} },
        { type: "tool_result", callId: "1", name: "read", output: tokens(25_000), isError: false },
        { type: "assistant", text: "done" },
        { type: "user", text: "and now" },
    ];
    const { model, calls } = scriptedModel([said("the summary"), said("answer")]);

    await createAgent({ model, tools: [] }).generate(conversation, "next");

    assert.deepEqual(calls[0]?.conversation.slice(0, -1), conversation.slice(0, 3));
    assert.deepEqual(calls[1]?.conversation.slice(1, -1), conversation.slice(3));
});

test("a reply's text and its tool calls stay together, and so do parallel tool calls", async () => {
    const conversation: Message[] = [
        user(60_000),
        assistant(20_000),
        { type: "user", text: "read both" },
        { type: "assistant", text: "Reading." },
        { type: "tool_call", id: "1", name: "read", args: {} },
        { type: "tool_call", id: "2", name: "read", args: {} },
        { type: "tool_result", callId: "1", name: "read", output: tokens(12_000), isError: false },
        { type: "tool_result", callId: "2", name: "read", output: tokens(12_000), isError: false },
    ];
    const { model, calls } = scriptedModel([said("the summary"), said("answer")]);

    await createAgent({ model, tools: [] }).generate(conversation, "next");

    // The second result brings it to 12,000, the first to 24,000: that is a tool result, so back to the second call (inside a reply), then the first call, then the text
    assert.deepEqual(calls[1]?.conversation.slice(1, -1), conversation.slice(3));
});

test("a summary is made in the middle of a turn, when the last count plus the results is past the threshold", async () => {
    // 82,000 tokens at the start of the turn: no summary yet
    const conversation: Message[] = [user(60_000), assistant(10_000), user(12_000)];
    const { model, calls } = scriptedModel([
        { messages: [{ type: "tool_call", id: "1", name: "read", args: {} }], tokens: 95_000, cutOff: false },
        said("the summary"),
        said("answer"),
    ]);
    const { updates, turn } = recorder();

    const result = await createAgent({ model, tools: [readTool] }).generate(conversation, "go", turn);

    // 95,000 + the 10,000-token result is past the threshold, before the second round's call
    assert.equal(calls.length, 3);
    assert.ok(isSummaryRequest(calls[1] as Call));
    assert.deepEqual(calls[1]?.conversation.slice(0, -1), conversation.slice(0, 2));
    assert.deepEqual(calls[2]?.conversation[0], { type: "summary", text: "the summary" });
    assert.deepEqual(
        calls[2]?.conversation.slice(1).map((m) => m.type),
        ["user", "user", "tool_call", "tool_result"],
    );
    assert.deepEqual(kinds(updates), ["tool_call", "tool_result", "summarising", "summary", "assistant"]);
    assert.equal(result.stop, "finished");
});

test("nothing is summarised when nothing older is left than the kept part", async () => {
    const { model, calls } = scriptedModel([said("answer")]);
    const { updates, turn } = recorder();

    await createAgent({ model, tools: [] }).generate([user(120_000)], "next", turn);

    // 120,000 tokens, but the kept part reaches back to the first message
    assert.equal(calls.length, 1);
    assert.ok(!kinds(updates).includes("summarising"));
});

test("a summary on its own is not summarised again", async () => {
    const { model, calls } = scriptedModel([said("answer")]);

    await createAgent({ model, tools: [] }).generate(
        [{ type: "summary", text: tokens(60_000) }, user(60_000)],
        "next",
    );

    assert.equal(calls.length, 1);
});

test("a second summary is sent the previous one and what followed it, and the model is then sent only the new one", async () => {
    const previous: Message = { type: "summary", text: "first summary" };
    const conversation: Message[] = [
        user(5_000),
        assistant(5_000),
        previous,
        user(60_000),
        assistant(40_000),
        user(15_000),
        assistant(15_000),
    ];
    const { model, calls } = scriptedModel([said("second summary"), said("answer")]);

    const result = await createAgent({ model, tools: [] }).generate(conversation, "next");

    assert.deepEqual(calls[0]?.conversation, [
        previous,
        conversation[3],
        conversation[4],
        { type: "user", text: SUMMARY_REQUEST },
    ]);
    assert.deepEqual(calls[1]?.conversation, [
        { type: "summary", text: "second summary" },
        conversation[5],
        conversation[6],
        { type: "user", text: "next" },
    ]);
    assert.equal(result.messages.filter((m) => m.type === "summary").length, 2);
});

const failures: [string, Step][] = [
    ["a failed request", new Error("down")],
    ["an empty summary", said("  ")],
    ["a cut-off summary", { messages: said("half a summ"), cutOff: true }],
    [
        "a reply with a tool call",
        [{ type: "tool_call", id: "1", name: "read", args: {} }],
    ],
];

for (const [name, step] of failures) {
    test(`${name} adds nothing, and the turn carries on with the whole conversation`, async () => {
        const { model, calls } = scriptedModel([step, said("answer")]);
        const { updates, turn } = recorder();

        const result = await createAgent({ model, tools: [] }).generate(old, "next", turn);

        assert.equal(result.stop, "finished");
        assert.deepEqual(result.messages, [
            ...old,
            { type: "user", text: "next" },
            { type: "assistant", text: "answer" },
        ]);
        assert.deepEqual(calls[1]?.conversation, [...old, { type: "user", text: "next" }]);
        // The app is told the attempt ended without a summary
        assert.deepEqual(kinds(updates), ["summarising", "summary_failed", "assistant"]);
    });
}

test("a failed summary is not tried again in the same turn, even though the conversation is still past the threshold", async () => {
    const { model, calls } = scriptedModel([
        new Error("down"),
        [{ type: "tool_call", id: "1", name: "read", args: {} }],
        said("answer"),
    ]);

    const result = await createAgent({ model, tools: [readTool] }).generate(old, "next");

    assert.equal(result.stop, "finished");
    assert.equal(calls.length, 3);
    assert.equal(calls.filter(isSummaryRequest).length, 1);
});

test("a cancel while summarising adds nothing and ends the turn as cancelled", async () => {
    const turn = new AbortController();
    const { model, calls } = scriptedModel([
        () => {
            turn.abort();
            throw new Error("aborted");
        },
        said("answer"),
    ]);
    const { updates, turn: options } = recorder();

    const result = await createAgent({ model, tools: [] }).generate(old, "next", {
        ...options,
        signal: turn.signal,
    });

    assert.equal(result.stop, "cancelled");
    assert.deepEqual(result.messages, [...old, { type: "user", text: "next" }]);
    assert.equal(calls.length, 1);
    assert.deepEqual(kinds(updates), ["summarising"]);
});

test("a cancel while summarising adds nothing even if the summary arrives", async () => {
    const turn = new AbortController();
    const { model, calls } = scriptedModel([
        () => {
            turn.abort();
            return said("the summary");
        },
        said("answer"),
    ]);

    const result = await createAgent({ model, tools: [] }).generate(old, "next", {
        signal: turn.signal,
    });

    assert.equal(result.stop, "cancelled");
    assert.deepEqual(result.messages, [...old, { type: "user", text: "next" }]);
    assert.equal(calls.length, 1);
});
