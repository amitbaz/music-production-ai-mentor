# 0026 — The knowledge base is an optional MCP server

Date: 2026-10-17 · Status: accepted

## Context

What a good producer knows, such as how to mix, arrange or design a sound, lives in a private repo, `mentor-kb`, as notes behind a small MCP server with three tools: `kb_search`, `kb_read` and `kb_browse` (#81). This repo is public and must stay whole without it. How the mentor works in Live stays in the system prompt; what a good producer knows goes in the knowledge base.

The server runs over stdio. Its first start in a fresh clone takes about 30 s, because it downloads an embedding model and embeds every note; later starts take about 0.5 s. When it is hosted, it will be reached by a URL and a token instead.

## Decision

- The harness has a general MCP client, `connectMcp`, on the official SDK (`@modelcontextprotocol/client`). It starts a server as a process, lists its tools and passes each one to the model as the server describes it: name, description and input schema. A result the server marks as an error becomes a failed tool result. The harness still knows nothing about music or about mentor-kb.
- `KB_PATH`, the path to a mentor-kb clone, switches the knowledge base on. The mentor runs `node <KB_PATH>/src/server.ts`. Without it, the mentor is exactly what it was: no process, no kb tools, no knowledge base section in the system prompt.
- The server starts in the background while the mentor is being created, and creating the mentor doesn't wait. The first turn waits for it, and tells the app it is loading when it has to wait.
- A server that can't start, or doesn't answer within 60 s, is reported once, with its reason, and the mentor carries on without it. A server that dies later fails the next kb tool call, like any failed tool.
- The system prompt gets a short knowledge base section only while the kb tools are there. Its wording is tuned by the evals (#117).
- An eval series uses the knowledge base when `KB_PATH` is set, and `--no-kb` turns it off. The runner connects once per series, waits for the tools before the sandbox starts, and records the mentor-kb commit with every run.
- The SDK is the harness's first runtime dependency (ADR 0021). It buys the MCP protocol and its transports: stdio now, HTTP when the server is hosted. Its server half, `@modelcontextprotocol/server`, and `zod` are dev dependencies, for a small test server the offline tests start as a real process.

Rejected:

- Writing the three kb tools by hand in `@mentor/tools`. Startup would stay lazy, but the descriptions would live in two repos and drift.
- Adding the tools when the server is ready, as Claude Code does, and running earlier turns without them. The quickest start, but an eval run could miss the knowledge base on its first turn.
- Waiting for the server inside `createMentor`. Every app would wait before its prompt appears, about 30 s the first time.
- A hand-written stdio client. About 150 lines and no dependency, but HTTP and auth would be ours to write once the server is hosted.
- Failing the turn when the server can't be reached. A broken clone would block every use of the mentor, even for things that don't need it.
- A config file listing MCP servers, like Claude Code's `.mcp.json`. It is ready for many servers, but there is one.

## Consequences

- An app has to hand the connection to the mentor and close it when it is done. The CLI relies on the server exiting when its input closes, which it does when the CLI exits.
- A turn cancelled while the first turn is still waiting ends once the knowledge base has started or failed, so it can take up to 60 s.
- When the server is hosted, `KB_PATH` gives way to `KB_URL` and `KB_TOKEN`, and `connectMcp` learns the SDK's HTTP transport.
- The paid tier, in which Mentor also pays the API for users without a key (ADR 0022), goes with the knowledge base. It is not designed here.
