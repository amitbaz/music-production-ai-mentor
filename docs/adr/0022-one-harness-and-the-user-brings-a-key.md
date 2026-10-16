# 0022 — One harness, and the user brings a key

Date: 2026-10-16 · Status: accepted

## Context

The mentor's users are music producers. Most have a chat subscription (Claude Pro, ChatGPT Plus, Google AI Pro) and no API key, no terminal, no coding agent. The model is interchangeable: the user picks it, Mentor brings the producer's abilities.

Two ways to serve a subscription user were looked at. One is to be an MCP server inside the chat app they already pay for; the chat app then owns the conversation, the model choice and the system prompt, and the mentor's rules of work have no slot. The other, as pen.dev does, is to keep our own chat window and run the vendor's coding agent behind it (Claude Code through the Agent SDK, Codex through its SDK, Google's `agy`), the subscription paying for it. That is three more harnesses to keep, a vendor binary on every user's machine, and Anthropic's stated policy is that subscription login is for Claude Code and its own apps; it has cut third-party tools off before. Mentor would break on a day of the vendor's choosing.

## Decision

- Mentor runs on its own harness, and only on it. The harness is the one host of the agent loop, for the apps, for the evals, and for any paid tier later.
- The user brings an API key per provider (bring your own key). The app helps them get one: a link per provider and a place to paste it.
- Users who will not get a key are served later by a paid tier in which Mentor pays the API. That tier is not designed here; it goes with the knowledge base.
- A vendor's subscription is not used to run the mentor.
- Serving the tool sets as an MCP server to a chat app stays possible as a side door, built only when asked for. It is not the product.
- The evals run through the harness, on more than one supported model, so that a low score can be told apart from a weak model.

Rejected:

- Vendor coding agents behind our window on the user's subscription: three hosts to keep, a binary to install, and a policy the vendor enforces.
- The chat apps as the product: no system prompt, no model choice, no control over how a tool result is shown.
- Replacing the harness with one vendor's agent SDK: one provider only, and the harness is where the project learns.

## Consequences

- The first run asks for a key. That friction is accepted; the wizard reduces it.
- The panel of models the evals need means a second provider adapter now; its design is its own ADR, since ADR 0011 names two things to settle before a second adapter exists.
- The harness grows only for what the apps and the evals need: images and audio in tool results, an MCP client for the knowledge base.
