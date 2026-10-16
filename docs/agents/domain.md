# Domain Docs

How the engineering skills should consume this repo's domain documentation. This repo has one context: `GLOSSARY.md` and `docs/adr/` at the root.

## Before exploring

Read `GLOSSARY.md`, and the ADRs in `docs/adr/` that touch the area you're about to work in.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. If the concept isn't in the glossary yet, either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, say so explicitly rather than silently overriding it:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
