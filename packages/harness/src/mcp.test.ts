import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { type TestContext, test } from "node:test";
import { connectMcp } from "./mcp.ts";

const ECHO_SERVER = fileURLToPath(new URL("fixtures/echo-server.ts", import.meta.url));

// Connects to the echo server, closed when the test ends.
function connectEcho(t: TestContext, ...args: string[]) {
    const connection = connectMcp({ command: process.execPath, args: [ECHO_SERVER, ...args] });
    t.after(() => connection.close());
    return connection;
}

test("the server's tools are listed as it describes them", async (t) => {
    const tools = await connectEcho(t).tools;
    const echo = tools.find((tool) => tool.name === "echo");
    assert.deepEqual(tools.map((tool) => tool.name), ["echo", "fail", "exit"]);
    assert.equal(echo?.description, "Says the text back.");
    assert.deepEqual((echo?.params as { properties?: unknown } | undefined)?.properties, {
        text: { type: "string", description: "What to say" },
    });
});

test("a tool call reaches the server and returns its text", async (t) => {
    const tools = await connectEcho(t).tools;
    const echo = tools.find((tool) => tool.name === "echo");
    assert.equal(await echo?.run({ text: "hello" }), "hello");
});

test("a result the server marks as an error fails the call", async (t) => {
    const tools = await connectEcho(t).tools;
    const fail = tools.find((tool) => tool.name === "fail");
    await assert.rejects(async () => fail?.run({}), { message: "It went wrong." });
});

test("a server that can't start gives the reason", async (t) => {
    const connection = connectMcp({ command: process.execPath, args: ["/no/such/server.ts"] });
    t.after(() => connection.close());
    await assert.rejects(connection.tools, /Cannot find module '\/no\/such\/server\.ts'/);
});

test("a server that doesn't answer in time is given up on", async (t) => {
    const connection = connectMcp({ command: process.execPath, args: [ECHO_SERVER, "hang"], timeoutMs: 300 });
    t.after(() => connection.close());
    await assert.rejects(connection.tools, { message: "No answer within 0.3 s" });
});

test("after the server dies, the next call fails", async (t) => {
    const tools = await connectEcho(t).tools;
    const [echo, , exit] = tools;
    await assert.rejects(async () => exit?.run({}));
    await assert.rejects(async () => echo?.run({ text: "still there?" }));
});
