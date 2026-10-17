import { type TestContext, test } from "node:test";
import assert from "node:assert/strict";
import type { CallOptions, McpConnection, Message, Model, Tool } from "@mentor/harness";
import { MENTOR_VERSION, PINNED_VERSION } from "@mentor/tools/daws/ableton/stand-in-live";
import { createMentor, keysFromEnv, type Update } from "./mentor.ts";
import { knowledgeBaseSection, systemPrompt } from "./system-prompt.ts";

type Call = {
    conversation: Message[];
    tools: Tool[];
    options?: CallOptions;
};

// A scripted model that hands out prepared replies, one per call,
// and records what it was sent each time.
function scriptedModel(replies: Message[][]) {
    const calls: Call[] = [];
    const model: Model = {
        call: async (conversation, tools, options) => {
            calls.push({ conversation: [...conversation], tools, options });
            return { messages: replies.shift() ?? [], cutOff: false };
        },
    };
    return { model, calls };
}

// A stand-in for the global WebSocket, answering like the ableton-js Remote Script
// for a Live Set with only the Main track. It records the address of each connection opened.
class StandInSocket extends EventTarget {
    static opened: string[] = [];
    static props: Record<string, unknown> = {
        tempo: 120,
        signature_numerator: 4,
        signature_denominator: 4,
        tracks: [],
        return_tracks: [],
        master_track: { id: "live_1", name: "Main", type: "main", mute: false, solo: false },
        devices: [],
        mixer_device: { id: "live_2" },
        group_track: null,
        volume: { id: "live_3", value: 0.85 },
        panning: { id: "live_4", value: 0 },
        sends: [],
    };

    constructor(url: string) {
        super();
        StandInSocket.opened.push(url);
        setTimeout(() => this.reply({ event: "connect", uuid: null }));
    }

    send(text: string) {
        const { uuid, commands } = JSON.parse(text) as {
            uuid: string;
            commands: { ns: string; name: string; args?: { prop: string } }[];
        };
        // A property comes from the table, the versions are the pinned script's and our file's, read
        // from the script as the tools' stand-in Live does, and a shown value is always 0.0 dB.
        const versions: Record<string, unknown> = { get_version: PINNED_VERSION, get_major_version: 12, get_minor_version: 4 };
        const data = commands.map((command) => ({
            ok: true,
            data:
                command.name === "get_prop"
                    ? StandInSocket.props[command.args?.prop ?? ""]
                    : command.ns === "mentor" && command.name === "get_version"
                      ? MENTOR_VERSION
                      : (versions[command.name] ?? "0.0 dB"),
        }));
        setTimeout(() => this.reply({ event: "result", uuid, data }));
    }

    reply(message: unknown) {
        this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) }));
    }
}

// Puts the stand-in in place of the global WebSocket for one test.
function useStandIn(t: TestContext) {
    const real = globalThis.WebSocket;
    StandInSocket.opened = [];
    globalThis.WebSocket = StandInSocket as unknown as typeof WebSocket;
    t.after(() => {
        globalThis.WebSocket = real;
    });
}

// The url and options of the first request a test sent.
function sentRequest(fetchMock: { mock: { calls: { arguments: unknown[] }[] } }) {
    const call = fetchMock.mock.calls[0];
    assert.ok(call, "fetch was not called");
    return call.arguments as [string, RequestInit];
}

test("a turn sends the user text after the conversation, with the system prompt and the Ableton tools", async () => {
    const { model, calls } = scriptedModel([
        [{ type: "assistant", text: "Hi" }],
    ]);
    const before: Message[] = [
        { type: "user", text: "hello" },
        { type: "assistant", text: "Hello" },
    ];

    const result = await createMentor({ model }).generate(before, "hi again");

    assert.deepEqual(calls[0]?.conversation, [
        ...before,
        { type: "user", text: "hi again" },
    ]);
    assert.equal(calls[0]?.options?.system, systemPrompt);
    assert.deepEqual(
        calls[0]?.tools.map((tool) => tool.name),
        [
            "read_set",
            "read_tracks",
            "read_arrangement",
            "read_clip",
            "set_parameters",
            "edit_tracks",
            "transport",
            "show",
            "edit_devices",
            "find_in_browser",
            "delete",
            "live_get",
            "live_change",
            "edit_arrangement",
            "write_notes",
        ],
    );
    assert.equal(result.stop, "finished");
    assert.deepEqual(result.messages, [
        ...before,
        { type: "user", text: "hi again" },
        { type: "assistant", text: "Hi" },
    ]);
});

test("the system prompt sent with a turn states the rules for Ableton Live", async () => {
    const { model, calls } = scriptedModel([[{ type: "assistant", text: "Hi" }]]);

    await createMentor({ model }).generate([], "hi");

    const system = calls[0]?.options?.system ?? "";
    // Read before acting, with the object ids of the latest read.
    assert.match(system, /read_set/);
    assert.match(system, /object ids? .*latest read/i);
    // Say what was changed, before and after.
    assert.match(system, /before → after/);
    // Exact steps for what the tools cannot do.
    assert.match(system, /exact steps/i);
    // Never claim to have heard the audio.
    assert.match(system, /cannot hear/i);
});

test("a turn's tool calls reach Live at the app's address, over the connection opened in the turn before", async (t: TestContext) => {
    useStandIn(t);
    const { model } = scriptedModel([
        [{ type: "tool_call", id: "1", name: "read_set", args: {} }],
        [{ type: "assistant", text: "120 BPM" }],
        [{ type: "tool_call", id: "2", name: "read_set", args: {} }],
        [{ type: "assistant", text: "Still 120" }],
    ]);
    const mentor = createMentor({ model, abletonAddress: "ws://127.0.0.1:40123" });

    const first = await mentor.generate([], "what is the tempo?");
    const second = await mentor.generate(first.messages, "and now?");

    const read = second.messages.findLast((message) => message.type === "tool_result");
    assert.equal(read?.isError, false);
    assert.equal(JSON.parse(read?.output ?? "").tempo, 120);
    assert.deepEqual(StandInSocket.opened, ["ws://127.0.0.1:40123"]);
});

test("a turn reports each new message through the app's callback", async (t: TestContext) => {
    useStandIn(t);
    const { model } = scriptedModel([
        [{ type: "tool_call", id: "1", name: "read_set", args: {} }],
        [{ type: "assistant", text: "120 BPM" }],
    ]);
    const seen: string[] = [];

    await createMentor({ model, abletonAddress: "ws://127.0.0.1:40123" }).generate([], "what is the tempo?", {
        onUpdate: (update) => {
            if (update.type === "message") seen.push(update.message.type);
        },
    });

    assert.deepEqual(seen, ["tool_call", "tool_result", "assistant"]);
});

test("with keys, a turn goes to the mentor's own model with the key for its provider", async (t: TestContext) => {
    const fetchMock = t.mock.method(
        globalThis,
        "fetch",
        async () =>
            new Response(
                `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "Hi" }] } }] })}\n\n`,
            ),
    );

    const result = await createMentor({ keys: { gemini: "test-key" } }).generate([], "hi");

    assert.equal(result.stop, "finished");
    const [url, options] = sentRequest(fetchMock);
    assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\/.*\/models\/gemini-/);
    assert.equal((options.headers as Record<string, string>)["x-goog-api-key"], "test-key");
});

test("with a model id, a turn goes to that model in place of the mentor's own", async () => {
    const result = await createMentor({ keys: { gemini: "test-key" }, model: "gemini:gemini-0-unknown" }).generate([], "hi");

    assert.equal(result.stop, "error");
    assert.match(result.stop === "error" ? result.error.message : "", /gemini-0-unknown/);
});

test("keysFromEnv reads each provider's key from its variable", () => {
    assert.deepEqual(keysFromEnv({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a", OTHER: "x" }), { gemini: "g", claude: "a" });
    assert.deepEqual(keysFromEnv({}), { gemini: undefined, claude: undefined });
});

const kbSearch: Tool = {
    name: "kb_search",
    description: "Search the producer knowledge base.",
    params: { type: "object", properties: { query: { type: "string" } } },
    run: () => "No notes matched.",
};

// A knowledge base whose tools arrive when `settle` is called, as a starting server's do.
function startingKnowledgeBase() {
    let settle!: (tools: Tool[] | Error) => void;
    const tools = new Promise<Tool[]>((resolve, reject) => {
        settle = (result) => (result instanceof Error ? reject(result) : resolve(result));
    });
    const connection: McpConnection = { tools, close: async () => {} };
    return { connection, settle };
}

const hi: Message[] = [{ type: "assistant", text: "Hi" }];

test("with a knowledge base, its tools follow the Ableton tools and the system prompt says when to search", async () => {
    const without = scriptedModel([hi]);
    const { model, calls } = scriptedModel([hi]);
    const { connection, settle } = startingKnowledgeBase();
    settle([kbSearch]);

    await createMentor({ model: without.model }).generate([], "hi");
    await createMentor({ model, knowledgeBase: connection }).generate([], "hi");

    const names = (tools: Tool[] = []) => tools.map((tool) => tool.name);
    assert.deepEqual(names(calls[0]?.tools), [...names(without.calls[0]?.tools), "kb_search"]);
    assert.equal(calls[0]?.options?.system, `${systemPrompt}\n\n${knowledgeBaseSection}`);
    assert.match(knowledgeBaseSection, /^Knowledge base:\n- Before you advise on or change how something is mixed, arranged or sound-designed, search the knowledge base with kb_search/);
    assert.match(knowledgeBaseSection, /Before you change anything, read the most relevant note with kb_read and follow its How-to steps in order\./);
});

test("the first turn waits for a knowledge base still starting, and says it is loading", async () => {
    const { model, calls } = scriptedModel([hi, hi]);
    const { connection, settle } = startingKnowledgeBase();
    const mentor = createMentor({ model, knowledgeBase: connection });
    const updates: Update["type"][] = [];
    const onUpdate = (update: Update) => {
        updates.push(update.type);
    };

    const first = mentor.generate([], "hi", { onUpdate });
    await new Promise(setImmediate);
    assert.equal(calls.length, 0);
    settle([kbSearch]);
    await first;
    await mentor.generate([], "hi again", { onUpdate });

    assert.equal(calls[0]?.tools.at(-1)?.name, "kb_search");
    assert.deepEqual(updates, ["knowledge_base_loading", "message", "message"]);
});

test("a knowledge base that fails is reported once, and the turns carry on without it", async () => {
    const { model, calls } = scriptedModel([hi, hi]);
    const { connection, settle } = startingKnowledgeBase();
    settle(new Error("No answer within 60 s"));
    const mentor = createMentor({ model, knowledgeBase: connection });
    const updates: Update[] = [];
    const onUpdate = (update: Update) => {
        updates.push(update);
    };

    const first = await mentor.generate([], "hi", { onUpdate });
    await mentor.generate(first.messages, "hi again", { onUpdate });

    assert.equal(first.stop, "finished");
    assert.equal(calls[1]?.tools.some((tool) => tool.name === "kb_search"), false);
    assert.equal(calls[1]?.options?.system, systemPrompt);
    assert.deepEqual(
        updates.filter((update) => update.type !== "message"),
        [{ type: "knowledge_base_unavailable", reason: "No answer within 60 s" }],
    );
});
