# 0007 — Tools declare that they need approval; without an answer the loop refuses

Date: 2026-10-13 · Status: accepted

## Context

Some tool calls are destructive (deleting a track) and must not run on the model's word alone. The loop needs a checkpoint before a tool runs, and something has to decide which calls stop there.

## Decision

- A tool may be marked `needsApproval: true`. Before running such a tool, the loop asks the caller's `approve(call)` function, which answers yes or no. Other tools run without asking.
- A refusal becomes an error tool result ("The user refused this action") and the turn continues, so the model can respond to it. There is no stop reason for a refusal.
- If a tool needs approval and the caller gave no `approve` function, the loop refuses the call.

Rejected:

- The caller deciding for every call: the list of risky tools would live in each caller, away from the tools.
- A per-call decision (`needsApproval` as a function of the arguments): more than the tools need today; the boolean can grow into it.
- Stopping the turn on a refusal: the user would have to type again just to move on.
- Running a marked tool when no `approve` function is given: one forgotten line of setup would silently remove the guard.

## Consequences

- The agent code decides when to ask; the caller decides how (a terminal prompt today, a dialog later).
- Tests and scripts that use a marked tool must pass an `approve` function.
- A cancel while the user is being asked counts as the call not having started (ADR 0006).
