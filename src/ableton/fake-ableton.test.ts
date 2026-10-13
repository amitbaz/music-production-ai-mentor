import {test} from "node:test";
import assert from "node:assert/strict";
import {createFakeAbleton} from "./fake-ableton.ts";
import type { Tool } from "../agent/types.ts";

function findTool(tools: Tool[], name: string): Tool{
    const tool = tools.find((tool) => tool.name === name);
    if(!tool) throw new Error(`Tool ${name} not found`);
    return tool;
}

test("get_session returns the starting sessions", async () => {
    const tools = createFakeAbleton();

    const output = await findTool(tools, "get_session").run({});

    assert.deepEqual(JSON.parse(output), {
        "tracks": ["Drums", "Bass"],
        "tempo": 120,
    });
});

test("set_tempo changes the tempo of the session", async () => {
    const tools = createFakeAbleton();

    const result = await findTool(tools, "set_tempo").run({ bpm: 128 });
    assert.equal(JSON.parse(result).tempo, 128);

    const output = await findTool(tools, "get_session").run({});
    assert.equal(JSON.parse(output).tempo, 128);
})

test("set_tempo rejects a tempo outside the range of 20-999", async () => {
    const tools = createFakeAbleton();

    await assert.rejects(
        async () => findTool(tools, "set_tempo").run({ bpm: 10 }),
        /bpm must be a number between 20 and 999/
    )
})

test("create_track adds a track at the end", async () => {
    const tools = createFakeAbleton();

    const result = await findTool(tools, "create_track").run({ name: "Lead" });
    const tracks = JSON.parse(result).tracks;
    assert.equal(tracks[tracks.length - 1], "Lead");

    const output = await findTool(tools, "get_session").run({});
    assert.deepEqual(JSON.parse(output).tracks, ["Drums", "Bass", "Lead"]);
})

test("create_track rejects a track with an empty name", async () => {
    const tools = createFakeAbleton();
    
    await assert.rejects(
        async () => findTool(tools, "create_track").run({ name: "" }),
        /name must be a non-empty string/
    )
})

test("create_track rejects a track without a name", async () => {
    const tools = createFakeAbleton();
    
    await assert.rejects(
        async () => findTool(tools, "create_track").run({}),
        /name must be a non-empty string/
    )
})
