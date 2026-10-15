import { type TestContext, test } from "node:test";
import assert from "node:assert/strict";
import type { CallOptions, Message, Model, Tool } from "@mentor/harness";
import { createMentor } from "./mentor.ts";
import { systemPrompt } from "./system-prompt.ts";

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
        // A property comes from the table, the versions are ones the client accepts (our own file
        // has its own), and a shown value is always 0.0 dB.
        const versions: Record<string, unknown> = { get_version: "5.0.4", get_major_version: 12, get_minor_version: 4 };
        const data = commands.map((command) => ({
            ok: true,
            data:
                command.name === "get_prop"
                    ? StandInSocket.props[command.args?.prop ?? ""]
                    : command.ns === "mentor" && command.name === "get_version"
                      ? "2"
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
