import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { Tool } from "./types.ts";

// An MCP server the harness starts as a process and talks to over stdio.
export type McpServerOptions = {
    command: string;
    args?: string[];
    // How long the server has to start and list its tools; 60 s when absent
    timeoutMs?: number;
};

// A connection to an MCP server: its tools once it has listed them, and a way to stop it.
export type McpConnection = { tools: Promise<Tool[]>; close: () => Promise<void> };

// Starts the server and lists its tools, each passed to the model as the server describes it.
export function connectMcp({ command, args = [], timeoutMs = 60_000 }: McpServerOptions): McpConnection {
    const client = new Client({ name: "harness", version: "0.0.0" });
    // The server's own logs are kept, not shown: the reason it failed to start is in them.
    const transport = new StdioClientTransport({ command, args, stderr: "pipe" });
    let logs = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
        logs = (logs + chunk).slice(-10_000);
    });
    const start = async () => {
        try {
            await client.connect(transport);
        } catch (error) {
            const lines = logs.split("\n").filter((line) => line.trim());
            const reason = lines.find((line) => /Error\b/.test(line)) ?? lines.at(-1);
            throw new Error(reason ? `${(error as Error).message}: ${reason.trim()}` : (error as Error).message);
        }
        const { tools } = await client.listTools();
        return tools.map(
            (tool): Tool => ({
                name: tool.name,
                description: tool.description ?? "",
                params: tool.inputSchema,
                run: async (args) => {
                    const result = await client.callTool({ name: tool.name, arguments: args });
                    const text = result.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
                    // A thrown error becomes a failed tool result in the agent loop.
                    if (result.isError) throw new Error(text);
                    return text;
                },
            }),
        );
    };
    let timer: NodeJS.Timeout | undefined;
    const tooLate = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`No answer within ${timeoutMs / 1000} s`)), timeoutMs);
    });
    const tools = Promise.race([start(), tooLate]).finally(() => clearTimeout(timer));
    // A server given up on is stopped.
    tools.catch(() => client.close());
    return { tools, close: () => client.close() };
}
