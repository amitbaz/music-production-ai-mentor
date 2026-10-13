# 0010 — A pnpm workspace of source packages, with the mentor between the apps and the harness

Date: 2026-10-13 · Status: accepted · Supersedes [0004](0004-agent-code-is-separate-from-ableton-code.md)

## Context

ADR 0004 kept the harness as a folder and said to make it a package when a second product needs it. Its reason was cost: a workspace, a build step and versioning, paid while the interface still changes. A desktop app is now planned next to the CLI, and the rule that the harness imports nothing from outside itself was only written down.

## Decision

- The repo is a pnpm workspace: `packages/harness`, `packages/tools`, `packages/mentor` and `apps/cli`, named `@mentor/<folder>`.
- A package exports its `.ts` source through `exports` in its `package.json`. There is no build step and no version number; packages depend on each other with `workspace:*`.
- `@mentor/mentor` holds what makes the harness a mentor: the system prompt, the model and the tool sets, behind `createMentor`. The app passes the conversation in and takes the new one from the result.
- An app depends only on `@mentor/mentor`, which re-exports the few types an app needs.
- Each package has its own `tsconfig.json` and its own `typecheck`, `lint`, `test` and `check` scripts. The root runs them all with `pnpm -r`.
- Each app has its own `.env`.

## Why split before the second app exists

Node runs `.ts` files directly, and it follows pnpm's link to a workspace package's real path, so a package needs no build. That removes most of the cost ADR 0004 named. What is left is a `package.json` and a `tsconfig.json` per package. In return the boundaries are checked: a package that is not a dependency cannot be imported, and `rootDir` in each `tsconfig.json` turns a relative path into another package into a type error.

## Why the mentor is a package

Two apps that each join the harness, the tool sets and the system prompt can drift, and then the mentor behaves differently in the terminal and on the desktop. With one package between them, an app cannot build its own agent loop or reach a tool set.

`createMentor` was shaped from one app. Expect it to change when the desktop app starts.

## Alternatives rejected

- **Wait for the desktop app.** Nothing to pay now, but the boundary stays a written rule.
- **One package and a lint rule.** Enforces the harness boundary, but gives the apps no shared mentor.
- **One check at the root.** One `tsconfig.json` cannot give each package its own `rootDir`, and a package could not be checked alone.
- **Apps import the harness for its types.** No re-exports, but an app could then call the agent loop directly.

## Consequences

- `createMentor` accepts a ready provider in place of an API key. Only tests use it today.
- The Gemini entry `@mentor/harness/providers/gemini` also exposes the request and response translators that its tests use. Only the mentor can import the harness, so this is left as it is.
- A package that later needs a build step, for example to be published, gets one then.
