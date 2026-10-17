// A small MCP server for the tests, over stdio: `node echo-server.ts [hang]`.
// With "hang" it starts but never answers.
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

if (process.argv[2] === "hang") {
    process.stdin.resume();
} else {
    serveStdio(() => {
        const server = new McpServer({ name: "echo", version: "0.0.0" });
        server.registerTool(
            "echo",
            { description: "Says the text back.", inputSchema: z.object({ text: z.string().describe("What to say") }) },
            async ({ text }) => ({ content: [{ type: "text", text }] }),
        );
        server.registerTool(
            "fail",
            { description: "Always fails.", inputSchema: z.object({}) },
            async () => ({ content: [{ type: "text", text: "It went wrong." }], isError: true }),
        );
        server.registerTool(
            "exit",
            { description: "Ends the server.", inputSchema: z.object({}) },
            async () => process.exit(1),
        );
        return server;
    });
}
