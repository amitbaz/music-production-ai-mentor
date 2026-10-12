import { test } from "node:test";
import assert from "node:assert/strict";
import { toGeminiRequest } from "./gemini.ts";
import type { Message, Tool } from "../types.ts";

const setTempo: Tool = {
    name: "set_tempo",
    description: "Sets the tempo of the session",
    params: {
        type: "object",
        properties: { bpm: { type: "number" } },
        required: ["bpm"],
    },
    run: () => "",
};

test("translates a conversation and its tools into a Gemini request", () => {
    const conversation: Message[] = [
        { type: "user", text: "Set the tempo to 128" },
        {
            type: "tool_call",
            id: "call_1",
            name: "set_tempo",
            args: { bpm: 128 },
            providerMeta: { thoughtSignature: "sig_1" },
        },
        {
            type: "tool_result",
            callId: "call_1",
            name: "set_tempo",
            output: '{"tempo":128}',
            isError: false,
        },
        { type: "assistant", text: "Done." },
    ];

    assert.deepEqual(toGeminiRequest(conversation, [setTempo]), {
        contents: [
            { role: "user", parts: [{ text: "Set the tempo to 128" }] },
            {
                role: "model",
                parts: [
                    {
                        functionCall: { id: "call_1", name: "set_tempo", args: { bpm: 128 } },
                        // The signature Gemini gave us goes back exactly as it came.
                        thoughtSignature: "sig_1",
                    },
                ],
            },
            {
                role: "user",
                parts: [
                    {
                        functionResponse: {
                            id: "call_1",
                            name: "set_tempo",
                            response: { result: '{"tempo":128}' },
                        },
                    },
                ],
            },
            { role: "model", parts: [{ text: "Done." }] },
        ],
        tools: [
            {
                functionDeclarations: [
                    {
                        name: "set_tempo",
                        description: "Sets the tempo of the session",
                        parameters: setTempo.params,
                    },
                ],
            },
        ],
    });
});

test("groups consecutive messages from the same side into one Gemini turn", () => {
    const conversation: Message[] = [
        { type: "user", text: "Set the tempo and add a track" },
        { type: "assistant", text: "On it." },
        { type: "tool_call", id: "call_1", name: "set_tempo", args: { bpm: 128 } },
        { type: "tool_call", id: "call_2", name: "create_track", args: { name: "Lead" } },
        { type: "tool_result", callId: "call_1", name: "set_tempo", output: "ok", isError: false },
        { type: "tool_result", callId: "call_2", name: "create_track", output: "ok", isError: false },
    ];

    const { contents } = toGeminiRequest(conversation, [setTempo]);

    assert.deepEqual(
        contents.map((content) => [content.role, content.parts.length]),
        [
            ["user", 1],
            ["model", 3],
            ["user", 2],
        ],
    );
});

test("sends a failed tool result as an error", () => {
    const conversation: Message[] = [
        {
            type: "tool_result",
            callId: "call_1",
            name: "set_tempo",
            output: "bpm must be a number between 20 and 999",
            isError: true,
        },
    ];

    const { contents } = toGeminiRequest(conversation, [setTempo]);

    assert.deepEqual(contents[0]?.parts[0], {
        functionResponse: {
            id: "call_1",
            name: "set_tempo",
            response: { error: "bpm must be a number between 20 and 999" },
        },
    });
});
