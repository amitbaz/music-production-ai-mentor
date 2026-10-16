import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgentLoop } from "./agent-loop.ts";
import type { Update } from "./agent-loop.ts";
import type { Message, Model, ModelReply, Tool } from "./types.ts";

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

// A scripted model that hands out prepared replies, one per call,
// and records what it was sent each time. A reply given as bare messages was not cut off.
function scriptedModel(replies: (Message[] | ModelReply)[]) {
    const calls: Message[][] = [];
    const model: Model = {
        call: async (conversation) => {
            calls.push([...conversation]);
            const reply = replies.shift();
            if (!reply) throw new Error("The script ran out of replies");
            return Array.isArray(reply) ? { messages: reply, cutOff: false } : reply;
        },
    };
    return { model, calls };
}

test("returns the model's text when it calls no tools", async () => {
    const { model, calls } = scriptedModel([
        [{ type: "assistant", text: "Hi there" }],
    ]);

    const result = await runAgentLoop(model, tools, [
        { type: "user", text: "Hello" },
    ]);

    assert.deepEqual(result, {
        messages: [
            { type: "user", text: "Hello" },
            { type: "assistant", text: "Hi there" },
        ],
        stop: "finished",
        // The tool, as the model is told of it, and both messages: 131 characters
        conversationSize: 33,
    });
    assert.equal(calls.length, 1);
});

test("runs a tool call and sends the result back to the model", async () => {
    const { model, calls } = scriptedModel([
        [{ type: "tool_call", id: "call_1", name: "shout", args: { text: "hello" } }],
        [{ type: "assistant", text: "It says HELLO." }],
    ]);

    const result = await runAgentLoop(model, tools, [
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
    const { model } = scriptedModel([
        [{ type: "tool_call", id: "call_1", name: "shout", args: { text: 5 } }],
        [{ type: "assistant", text: "I need text to shout." }],
    ]);

    const result = await runAgentLoop(model, tools, [
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
    const { model } = scriptedModel([
        [{ type: "tool_call", id: "call_1", name: "delete_everything", args: {} }],
        [{ type: "assistant", text: "I can't do that." }],
    ]);

    const result = await runAgentLoop(model, tools, [
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
    const { model, calls } = scriptedModel(endlessToolCalls);

    const result = await runAgentLoop(model, tools, [
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
    const { model } = scriptedModel([]);

    const result = await runAgentLoop(model, tools, [
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
    const { model } = scriptedModel([
        [{ type: "tool_call", id: "call_1", name: "shout", args: { text: "hello" } }],
    ]);

    const result = await runAgentLoop(model, tools, [
        { type: "user", text: "Shout hello" },
    ]);

    assert.equal(result.stop, "error");
    assert.deepEqual(
        result.messages.map((message) => message.type),
        ["user", "tool_call", "tool_result"],
    );
});

test("reports each new message as it happens", async () => {
    const { model } = scriptedModel([
        [{ type: "tool_call", id: "call_1", name: "shout", args: { text: "hello" } }],
        [{ type: "assistant", text: "It says HELLO." }],
    ]);
    const reported: Update[] = [];

    const result = await runAgentLoop(
        model,
        tools,
        [{ type: "user", text: "Shout hello" }],
        { onUpdate: (update) => reported.push(update) },
    );

    // Everything except the user's own message, in order.
    assert.deepEqual(
        reported,
        result.messages.slice(1).map((message) => ({ type: "message", message })),
    );
});

test("gives the model the caller's cancel signal", async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const model: Model = {
        call: async (_conversation, _tools, options) => {
            received = options?.signal;
            return { messages: [{ type: "assistant", text: "Hi" }], cutOff: false };
        },
    };

    await runAgentLoop(model, tools, [{ type: "user", text: "Hello" }], {
        signal: controller.signal,
    });

    assert.equal(received, controller.signal);
});

test("cancelling while waiting for the model stops the turn as cancelled", async () => {
    const controller = new AbortController();
    // Behaves like a real model: the cancel makes the pending call fail.
    const model: Model = {
        call: async () => {
            controller.abort();
            throw new Error("This operation was aborted");
        },
    };

    const result = await runAgentLoop(
        model,
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
    const { model, calls } = scriptedModel([
        [
            { type: "tool_call", id: "call_1", name: "slow", args: { label: "first" } },
            { type: "tool_call", id: "call_2", name: "slow", args: { label: "second" } },
        ],
        [{ type: "assistant", text: "This reply must never be asked for." }],
    ]);

    const result = await runAgentLoop(
        model,
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
    return scriptedModel([
        [{ type: "tool_call", id: "call_1", name: "wipe", args: {} }],
        [{ type: "assistant", text: "Done." }],
    ]);
}

test("a tool that needs approval runs when the caller approves", async () => {
    const { guarded, ran } = guardedTool();
    const { model } = wipeScript();
    const asked: string[] = [];

    const result = await runAgentLoop(
        model,
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
    const { model, calls } = wipeScript();

    const result = await runAgentLoop(
        model,
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
    const { model } = wipeScript();

    const result = await runAgentLoop(model, guarded, [
        { type: "user", text: "Wipe it" },
    ]);

    assert.deepEqual(ran, []);
    assert.equal(
        result.messages[2]?.type === "tool_result" && result.messages[2].output,
        "The user refused this action",
    );
});

test("a tool that does not need approval runs without asking", async () => {
    const { model } = scriptedModel([
        [{ type: "tool_call", id: "call_1", name: "shout", args: { text: "hello" } }],
        [{ type: "assistant", text: "Done." }],
    ]);
    let asked = false;

    await runAgentLoop(model, tools, [{ type: "user", text: "Shout hello" }], {
        approve: () => {
            asked = true;
            return true;
        },
    });

    assert.equal(asked, false);
});

test("cancelling while being asked counts as cancelled, not refused", async () => {
    const { guarded, ran } = guardedTool();
    const { model } = wipeScript();
    const controller = new AbortController();

    const result = await runAgentLoop(
        model,
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
    const { model, calls } = scriptedModel([[]]);

    const result = await runAgentLoop(model, tools, [
        { type: "user", text: "Hello" },
    ]);

    assert.equal(result.stop, "empty");
    assert.deepEqual(result.messages, [{ type: "user", text: "Hello" }]);
    assert.equal(calls.length, 1);
});

test("a reply with only blank text is empty and is not kept", async () => {
    const { model } = scriptedModel([
        [{ type: "tool_call", id: "call_1", name: "shout", args: { text: "hello" } }],
        [{ type: "assistant", text: "  \n" }],
    ]);
    const reported: Update[] = [];

    const result = await runAgentLoop(
        model,
        tools,
        [{ type: "user", text: "Shout hello" }],
        { onUpdate: (update) => reported.push(update) },
    );

    assert.equal(result.stop, "empty");
    assert.deepEqual(
        result.messages.map((message) => message.type),
        ["user", "tool_call", "tool_result"],
    );
    assert.equal(reported.length, 2);
});

test("gives the model the system prompt on every model call", async () => {
    const received: (string | undefined)[] = [];
    const replies: Message[][] = [
        [{ type: "tool_call", id: "call_1", name: "shout", args: { text: "hello" } }],
        [{ type: "assistant", text: "It says HELLO." }],
    ];
    const model: Model = {
        call: async (_conversation, _tools, options) => {
            received.push(options?.system);
            return { messages: replies.shift() ?? [], cutOff: false };
        },
    };

    const result = await runAgentLoop(
        model,
        tools,
        [{ type: "user", text: "Shout hello" }],
        { system: "You are a test." },
    );

    // Two rounds, so the prompt is sent twice, and it never enters the conversation.
    assert.deepEqual(received, ["You are a test.", "You are a test."]);
    assert.equal(result.messages.length, 4);
});

// A model whose reply arrives as pieces of text, and then ends as the test says.
function streamingModel(pieces: string[], end: () => Message[]): Model {
    return {
        call: async (_conversation, _tools, options) => {
            for (const piece of pieces) options?.onText?.(piece);
            return { messages: end(), cutOff: false };
        },
    };
}

test("with stream on, reports each piece of text and then the whole message", async () => {
    const model = streamingModel(["Hi", " there"], () => [
        { type: "assistant", text: "Hi there" },
    ]);
    const reported: Update[] = [];

    await runAgentLoop(model, tools, [{ type: "user", text: "Hello" }], {
        stream: true,
        onUpdate: (update) => reported.push(update),
    });

    assert.deepEqual(reported, [
        { type: "text", text: "Hi" },
        { type: "text", text: " there" },
        { type: "message", message: { type: "assistant", text: "Hi there" } },
    ]);
});

test("with stream off, reports whole messages only", async () => {
    const model = streamingModel(["Hi", " there"], () => [
        { type: "assistant", text: "Hi there" },
    ]);
    const reported: Update[] = [];

    await runAgentLoop(model, tools, [{ type: "user", text: "Hello" }], {
        onUpdate: (update) => reported.push(update),
    });

    assert.deepEqual(reported, [
        { type: "message", message: { type: "assistant", text: "Hi there" } },
    ]);
});

test("a cancel while a reply is arriving keeps the text that arrived", async () => {
    const controller = new AbortController();
    const model = streamingModel(["A compressor lowers", " the loud pa"], () => {
        controller.abort();
        throw new Error("This operation was aborted");
    });
    const reported: Update[] = [];

    const result = await runAgentLoop(
        model,
        tools,
        [{ type: "user", text: "What is a compressor?" }],
        { signal: controller.signal, onUpdate: (update) => reported.push(update) },
    );

    const kept = { type: "assistant", text: "A compressor lowers the loud pa" };
    assert.deepEqual(result, {
        messages: [{ type: "user", text: "What is a compressor?" }, kept],
        stop: "cancelled",
        // The tool and both messages: 170 characters
        conversationSize: 43,
    });
    // Stream is off here: the rule does not depend on it.
    assert.deepEqual(reported, [{ type: "message", message: kept }]);
});

test("a model call that fails while a reply is arriving keeps the text that arrived", async () => {
    const lost = new Error("connection lost");
    const model = streamingModel(["A compressor lowers"], () => {
        throw lost;
    });

    const result = await runAgentLoop(model, tools, [
        { type: "user", text: "What is a compressor?" },
    ]);

    assert.deepEqual(result, {
        messages: [
            { type: "user", text: "What is a compressor?" },
            { type: "assistant", text: "A compressor lowers" },
        ],
        stop: "error",
        error: lost,
        // The tool and both messages: 158 characters
        conversationSize: 40,
    });
});

test("a cut-off reply keeps its text and stops the turn as cut_off", async () => {
    const { model, calls } = scriptedModel([
        { messages: [{ type: "assistant", text: "The kick is too" }], cutOff: true },
    ]);

    const result = await runAgentLoop(model, tools, [
        { type: "user", text: "Mix my kick" },
    ]);

    assert.deepEqual(result, {
        messages: [
            { type: "user", text: "Mix my kick" },
            { type: "assistant", text: "The kick is too" },
        ],
        stop: "cut_off",
        // The tool and both messages: 144 characters
        conversationSize: 36,
    });
    assert.equal(calls.length, 1);
});

test("a cut-off reply keeps its tool calls but does not run them", async () => {
    let ran = 0;
    const counting: Tool[] = [
        {
            name: "shout",
            description: "Counts how often it runs",
            params: { type: "object" },
            run: () => {
                ran++;
                return "HELLO";
            },
        },
    ];
    const { model } = scriptedModel([
        {
            messages: [
                { type: "assistant", text: "Let me shout" },
                { type: "tool_call", id: "call_1", name: "shout", args: { text: "a" } },
                { type: "tool_call", id: "call_2", name: "shout", args: { text: "b" } },
            ],
            cutOff: true,
        },
    ]);
    const reported: Update[] = [];

    const result = await runAgentLoop(
        model,
        counting,
        [{ type: "user", text: "Shout twice" }],
        { onUpdate: (update) => reported.push(update) },
    );

    const notRun = (callId: string) => ({
        type: "tool_result",
        callId,
        name: "shout",
        output: "Not run: the reply was cut off",
        isError: true,
    });
    assert.equal(ran, 0);
    assert.equal(result.stop, "cut_off");
    assert.deepEqual(result.messages, [
        { type: "user", text: "Shout twice" },
        { type: "assistant", text: "Let me shout" },
        { type: "tool_call", id: "call_1", name: "shout", args: { text: "a" } },
        { type: "tool_call", id: "call_2", name: "shout", args: { text: "b" } },
        notRun("call_1"),
        notRun("call_2"),
    ]);
    // Every message added to the conversation is also reported.
    assert.deepEqual(
        reported,
        result.messages.slice(1).map((message) => ({ type: "message", message })),
    );
});

test("a tool that needs approval is not asked about in a cut-off reply", async () => {
    let asked = 0;
    const risky: Tool[] = tools.map((tool) => ({ ...tool, needsApproval: true }));
    const { model } = scriptedModel([
        {
            messages: [{ type: "tool_call", id: "call_1", name: "shout", args: { text: "a" } }],
            cutOff: true,
        },
    ]);

    const result = await runAgentLoop(model, risky, [{ type: "user", text: "Shout" }], {
        approve: () => {
            asked++;
            return true;
        },
    });

    assert.equal(asked, 0);
    assert.equal(result.stop, "cut_off");
});

test("a reply cut off before any text arrived is not kept", async () => {
    const { model } = scriptedModel([
        { messages: [{ type: "assistant", text: " \n" }], cutOff: true },
    ]);

    const result = await runAgentLoop(model, tools, [{ type: "user", text: "Hello" }]);

    assert.deepEqual(result, {
        messages: [{ type: "user", text: "Hello" }],
        stop: "cut_off",
        // The tool and the user text, not the blank reply: 123 characters
        conversationSize: 31,
    });
});

const refusal = { category: "cyber", explanation: "I can't help with that." };

test("a refused reply keeps its text, gives its tool calls an error result and stops the turn as refused", async () => {
    let ran = 0;
    const counting: Tool[] = tools.map((tool) => ({ ...tool, run: () => {
            ran++;
            return "HELLO";
        },
    }));
    const { model, calls } = scriptedModel([
        {
            messages: [
                { type: "assistant", text: "Let me start" },
                { type: "tool_call", id: "call_1", name: "shout", args: { text: "a" } },
            ],
            cutOff: false,
            refused: refusal,
        },
    ]);

    const result = await runAgentLoop(model, counting, [{ type: "user", text: "Shout" }]);

    assert.equal(ran, 0);
    assert.equal(calls.length, 1);
    assert.deepEqual(result, {
        messages: [
            { type: "user", text: "Shout" },
            { type: "assistant", text: "Let me start" },
            { type: "tool_call", id: "call_1", name: "shout", args: { text: "a" } },
            {
                type: "tool_result",
                callId: "call_1",
                name: "shout",
                output: "Not run: the model refused",
                isError: true,
            },
        ],
        stop: "refused",
        ...refusal,
        // The tool and all four messages, as in the cut-off tests
        conversationSize: 45,
    });
});

test("a refused reply with no text keeps nothing of it, and the size is the provider's count", async () => {
    const { model } = scriptedModel([
        { messages: [{ type: "assistant", text: "" }], tokens: 500, cutOff: false, refused: refusal },
    ]);

    const result = await runAgentLoop(model, tools, [{ type: "user", text: "Hello" }]);

    assert.deepEqual(result.messages, [{ type: "user", text: "Hello" }]);
    assert.equal(result.stop, "refused");
    assert.equal(result.conversationSize, 500);
});
