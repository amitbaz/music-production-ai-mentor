import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgentLoop } from "./agent-loop.ts";
import type { Message, Provider, Tool } from "./types.ts";

// One generic tool, so these tests depend on nothing outside the agent folder.
const tools: Tool[] = [
    {
        name: "shout",
        description: "Returns the given text in upper case",
        params: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
        },
        run: ({ text }) => {
            if (typeof text !== "string") throw new Error("text must be a string");
            return text.toUpperCase();
        },
    },
];

// A fake provider that hands out prepared replies, one per call,
// and records what it was sent each time.
function scriptedProvider(replies: Message[][]) {
    const calls: Message[][] = [];
    const provider: Provider = {
        generate: async (conversation) => {
            calls.push([...conversation]);
            const reply = replies.shift();
            if (!reply) throw new Error("The script ran out of replies");
            return reply;
        },
    };
    return { provider, calls };
}

test("returns the model's text when it calls no tools", async () => {
    const { provider, calls } = scriptedProvider([
        [{ type: "assistant", text: "Hi there" }],
    ]);

    const result = await runAgentLoop(provider, tools, [
        { type: "user", text: "Hello" },
    ]);

    assert.deepEqual(result, {
        messages: [
            { type: "user", text: "Hello" },
            { type: "assistant", text: "Hi there" },
        ],
        stop: "finished",
    });
    assert.equal(calls.length, 1);
});

test("runs a tool call and sends the result back to the model", async () => {
    const { provider, calls } = scriptedProvider([
        [{ type: "tool_call", id: "call_1", name: "shout", args: { text: "hello" } }],
        [{ type: "assistant", text: "It says HELLO." }],
    ]);

    const result = await runAgentLoop(provider, tools, [
        { type: "user", text: "Shout hello" },
    ]);

    assert.deepEqual(result.messages, [
        { type: "user", text: "Shout hello" },
        { type: "tool_call", id: "call_1", name: "shout", args: { text: "hello" } },
        {
            type: "tool_result",
            callId: "call_1",
            name: "shout",
            output: "HELLO",
            isError: false,
        },
        { type: "assistant", text: "It says HELLO." },
    ]);
    assert.equal(result.stop, "finished");
    // On its second call the model must have seen the tool result.
    assert.equal(calls.length, 2);
    assert.equal(calls[1]?.at(-1)?.type, "tool_result");
});

test("a failing tool becomes an error result the model can read", async () => {
    const { provider } = scriptedProvider([
        [{ type: "tool_call", id: "call_1", name: "shout", args: { text: 5 } }],
        [{ type: "assistant", text: "I need text to shout." }],
    ]);

    const result = await runAgentLoop(provider, tools, [
        { type: "user", text: "Shout 5" },
    ]);

    assert.deepEqual(result.messages[2], {
        type: "tool_result",
        callId: "call_1",
        name: "shout",
        output: "text must be a string",
        isError: true,
    });
    // A tool failure is not a stop reason: the model answered, so the turn finished.
    assert.equal(result.stop, "finished");
});

test("a tool the model invented becomes an error result", async () => {
    const { provider } = scriptedProvider([
        [{ type: "tool_call", id: "call_1", name: "delete_everything", args: {} }],
        [{ type: "assistant", text: "I can't do that." }],
    ]);

    const result = await runAgentLoop(provider, tools, [
        { type: "user", text: "Delete everything" },
    ]);

    assert.deepEqual(result.messages[2], {
        type: "tool_result",
        callId: "call_1",
        name: "delete_everything",
        output: "Tool delete_everything not found",
        isError: true,
    });
});

test("stops after 10 rounds without adding a message of its own", async () => {
    const endlessToolCalls: Message[][] = Array.from({ length: 20 }, (_, i) => [
        { type: "tool_call", id: `call_${i}`, name: "shout", args: { text: "again" } },
    ]);
    const { provider, calls } = scriptedProvider(endlessToolCalls);

    const result = await runAgentLoop(provider, tools, [
        { type: "user", text: "Loop forever" },
    ]);

    assert.equal(calls.length, 10);
    assert.equal(result.stop, "round_limit");
    // 1 user message, then a tool call and its result for each of the 10 rounds.
    assert.equal(result.messages.length, 21);
    assert.equal(result.messages.at(-1)?.type, "tool_result");
});

test("a failed model call returns the error and keeps the user's message", async () => {
    // An empty script: the first model call fails.
    const { provider } = scriptedProvider([]);

    const result = await runAgentLoop(provider, tools, [
        { type: "user", text: "Hello" },
    ]);

    assert.equal(result.stop, "error");
    assert.equal(
        result.stop === "error" ? result.error.message : "",
        "The script ran out of replies",
    );
    assert.deepEqual(result.messages, [{ type: "user", text: "Hello" }]);
});

test("a model call that fails after a tool ran keeps the tool's record", async () => {
    // One reply only: the second model call fails.
    const { provider } = scriptedProvider([
        [{ type: "tool_call", id: "call_1", name: "shout", args: { text: "hello" } }],
    ]);

    const result = await runAgentLoop(provider, tools, [
        { type: "user", text: "Shout hello" },
    ]);

    assert.equal(result.stop, "error");
    assert.deepEqual(
        result.messages.map((message) => message.type),
        ["user", "tool_call", "tool_result"],
    );
});

test("reports each new message as it happens", async () => {
    const { provider } = scriptedProvider([
        [{ type: "tool_call", id: "call_1", name: "shout", args: { text: "hello" } }],
        [{ type: "assistant", text: "It says HELLO." }],
    ]);
    const reported: Message[] = [];

    const result = await runAgentLoop(
        provider,
        tools,
        [{ type: "user", text: "Shout hello" }],
        { onMessage: (message) => reported.push(message) },
    );

    // Everything except the user's own message, in order.
    assert.deepEqual(reported, result.messages.slice(1));
});

test("gives the provider the caller's cancel signal", async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const provider: Provider = {
        generate: async (_conversation, _tools, signal) => {
            received = signal;
            return [{ type: "assistant", text: "Hi" }];
        },
    };

    await runAgentLoop(provider, tools, [{ type: "user", text: "Hello" }], {
        signal: controller.signal,
    });

    assert.equal(received, controller.signal);
});

test("cancelling while waiting for the model stops the turn as cancelled", async () => {
    const controller = new AbortController();
    // Behaves like a real provider: the cancel makes the pending call fail.
    const provider: Provider = {
        generate: async () => {
            controller.abort();
            throw new Error("This operation was aborted");
        },
    };

    const result = await runAgentLoop(
        provider,
        tools,
        [{ type: "user", text: "Hello" }],
        { signal: controller.signal },
    );

    assert.equal(result.stop, "cancelled");
    assert.deepEqual(result.messages, [{ type: "user", text: "Hello" }]);
});

test("cancelling while a tool runs lets it finish and skips the rest", async () => {
    const controller = new AbortController();
    const ran: string[] = [];
    // A tool that is cancelled in the middle of its own run.
    const slowTools: Tool[] = [
        {
            name: "slow",
            description: "Takes a while",
            params: { type: "object", properties: {} },
            run: ({ label }) => {
                ran.push(String(label));
                controller.abort();
                return `finished ${label}`;
            },
        },
    ];
    const { provider, calls } = scriptedProvider([
        [
            { type: "tool_call", id: "call_1", name: "slow", args: { label: "first" } },
            { type: "tool_call", id: "call_2", name: "slow", args: { label: "second" } },
        ],
        [{ type: "assistant", text: "This reply must never be asked for." }],
    ]);

    const result = await runAgentLoop(
        provider,
        slowTools,
        [{ type: "user", text: "Do two slow things" }],
        { signal: controller.signal },
    );

    assert.equal(result.stop, "cancelled");
    assert.deepEqual(ran, ["first"]);
    assert.deepEqual(result.messages.slice(3), [
        {
            type: "tool_result",
            callId: "call_1",
            name: "slow",
            output: "finished first",
            isError: false,
        },
        {
            type: "tool_result",
            callId: "call_2",
            name: "slow",
            output: "Cancelled before it ran",
            isError: true,
        },
    ]);
    // The model is not called again after a cancel.
    assert.equal(calls.length, 1);
});

// A tool that must be approved before it runs, and a record of whether it ran.
function guardedTool() {
    const ran: string[] = [];
    const guarded: Tool[] = [
        {
            name: "wipe",
            description: "Wipes something for good",
            params: { type: "object", properties: {} },
            needsApproval: true,
            run: () => {
                ran.push("wipe");
                return "wiped";
            },
        },
    ];
    return { guarded, ran };
}

function wipeScript() {
    return scriptedProvider([
        [{ type: "tool_call", id: "call_1", name: "wipe", args: {} }],
        [{ type: "assistant", text: "Done." }],
    ]);
}

test("a tool that needs approval runs when the caller approves", async () => {
    const { guarded, ran } = guardedTool();
    const { provider } = wipeScript();
    const asked: string[] = [];

    const result = await runAgentLoop(
        provider,
        guarded,
        [{ type: "user", text: "Wipe it" }],
        {
            approve: (call) => {
                asked.push(call.name);
                return true;
            },
        },
    );

    assert.deepEqual(asked, ["wipe"]);
    assert.deepEqual(ran, ["wipe"]);
    assert.equal(
        result.messages[2]?.type === "tool_result" && result.messages[2].output,
        "wiped",
    );
});

test("a refused tool does not run, and the model is told", async () => {
    const { guarded, ran } = guardedTool();
    const { provider, calls } = wipeScript();

    const result = await runAgentLoop(
        provider,
        guarded,
        [{ type: "user", text: "Wipe it" }],
        { approve: () => false },
    );

    assert.deepEqual(ran, []);
    assert.deepEqual(result.messages[2], {
        type: "tool_result",
        callId: "call_1",
        name: "wipe",
        output: "The user refused this action",
        isError: true,
    });
    // The turn carries on: the model gets to answer the refusal.
    assert.equal(calls.length, 2);
    assert.equal(result.stop, "finished");
});

test("a tool that needs approval is refused when the caller cannot be asked", async () => {
    const { guarded, ran } = guardedTool();
    const { provider } = wipeScript();

    const result = await runAgentLoop(provider, guarded, [
        { type: "user", text: "Wipe it" },
    ]);

    assert.deepEqual(ran, []);
    assert.equal(
        result.messages[2]?.type === "tool_result" && result.messages[2].output,
        "The user refused this action",
    );
});

test("a tool that does not need approval runs without asking", async () => {
    const { provider } = scriptedProvider([
        [{ type: "tool_call", id: "call_1", name: "shout", args: { text: "hello" } }],
        [{ type: "assistant", text: "Done." }],
    ]);
    let asked = false;

    await runAgentLoop(provider, tools, [{ type: "user", text: "Shout hello" }], {
        approve: () => {
            asked = true;
            return true;
        },
    });

    assert.equal(asked, false);
});

test("cancelling while being asked counts as cancelled, not refused", async () => {
    const { guarded, ran } = guardedTool();
    const { provider } = wipeScript();
    const controller = new AbortController();

    const result = await runAgentLoop(
        provider,
        guarded,
        [{ type: "user", text: "Wipe it" }],
        {
            signal: controller.signal,
            approve: () => {
                controller.abort();
                return false;
            },
        },
    );

    assert.deepEqual(ran, []);
    assert.equal(
        result.messages[2]?.type === "tool_result" && result.messages[2].output,
        "Cancelled before it ran",
    );
    assert.equal(result.stop, "cancelled");
});

test("a reply with nothing in it stops the turn as empty", async () => {
    const { provider, calls } = scriptedProvider([[]]);

    const result = await runAgentLoop(provider, tools, [
        { type: "user", text: "Hello" },
    ]);

    assert.equal(result.stop, "empty");
    assert.deepEqual(result.messages, [{ type: "user", text: "Hello" }]);
    assert.equal(calls.length, 1);
});

test("a reply with only blank text is empty and is not kept", async () => {
    const { provider } = scriptedProvider([
        [{ type: "tool_call", id: "call_1", name: "shout", args: { text: "hello" } }],
        [{ type: "assistant", text: "  \n" }],
    ]);
    const reported: Message[] = [];

    const result = await runAgentLoop(
        provider,
        tools,
        [{ type: "user", text: "Shout hello" }],
        { onMessage: (message) => reported.push(message) },
    );

    assert.equal(result.stop, "empty");
    assert.deepEqual(
        result.messages.map((message) => message.type),
        ["user", "tool_call", "tool_result"],
    );
    assert.equal(reported.length, 2);
});
