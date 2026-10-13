# Reference: harnesses to learn from

This project's harness is written by hand, on purpose. The projects below solve the same problems and are worth reading when designing a feature. They are sources of ideas, not dependencies.

| Project | Where | Worth reading for |
|---|---|---|
| Vercel AI SDK | https://github.com/vercel/ai | One interface over many providers, streaming, tool schemas, stop reasons. |
| pi | https://github.com/badlogic/pi-mono | A small harness close to this one in size and spirit: the loop, provider adapters, a terminal UI. |
| Mastra | https://github.com/mastra-ai/mastra | Memory, workflows and evals built around an agent. |
| LangGraph | https://github.com/langchain-ai/langgraphjs | An agent as a graph of steps; saving and resuming a run. |
| OpenAI Agents SDK | https://github.com/openai/openai-agents-js | Handing work between agents, guardrails, tracing. |
| Claude Agent SDK | https://github.com/anthropics/claude-agent-sdk-typescript | Permissions and approval, hooks, keeping a long conversation short. |
| Model Context Protocol | https://modelcontextprotocol.io | The open standard for offering tool sets to an agent. |
