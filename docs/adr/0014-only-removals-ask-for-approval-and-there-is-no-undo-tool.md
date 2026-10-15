# 0014 — Only removals ask for approval, and there is no undo tool

Date: 2026-10-13 · Status: accepted

## Context

A tool is either marked as needing approval or not (ADR 0007). With the real Live, every change lands in Live's undo history. That history is shared by the user and the mentor, and a script can only undo the latest step; it cannot see what the step was or who made it.

## Decision

- Changes that remove the user's work ask first. All removals go through one tool, `delete`, which takes tracks, devices, clips or notes and is marked as needing approval. No other named tool can remove anything.
- The general tools split the same way: `live_get` never asks, `live_change` always asks.
- Every other change runs at once, and its result states the value before and after.
- There is no undo tool. The mentor takes a change back by writing the old value again. The user keeps Live's own undo.

Rejected:

- Every change asks: a request such as "clean up the low end" becomes ten questions in a row.
- Nothing asks: a deleted track may go unnoticed until undoing it would also take back the user's later work.
- Approval decided from a call's arguments: a change to the harness, and a rule per tool that can be wrong where a plain mark cannot. ADR 0007 stays as it is.
- A delete tool per kind of object: four tools where one does.
- An undo tool, asking or not: it is blind, and can take back the user's own latest change.
- A setting to choose the mode: more to build before anyone has asked for another mode.

## Consequences

- The mentor can make a change the user did not want, such as a wrong EQ move; the result shows it and the old value can be written back.
- Something the mentor created is taken back with `delete`, which asks. Something it deleted comes back only through the user's own undo.
- Moving an arrangement clip is done as duplicate then delete, because a script cannot move one directly. That is a move, not a removal, and does not ask.
- Removing a locator is done by `edit_arrangement` and does not ask (#12, as the issue asked): a locator is a marker, not the user's work, and comes back with `add_locator` at its bar. A clip is never put on bars that hold another clip, because Live makes room by cutting the clip under it, which would remove the user's work without asking.
