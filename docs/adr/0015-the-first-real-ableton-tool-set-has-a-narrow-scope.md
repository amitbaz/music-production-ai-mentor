# 0015 — The first real Ableton tool set has a narrow scope

Date: 2026-10-13 · Status: accepted · Amended by [0028](0028-plug-in-parameters-are-read-and-set-by-their-text.md) (plug-in settings in the Configure list are read and set)

## Context

The aim is full control of a Live Set. A prototype and three research notes (`docs/research/`) showed where that is cheap and where it is not. Third-party plug-ins expose at most 128 parameters to a script and many expose none. No control route gives audio. Several functions the tools need exist only in recent Live versions, and fixes for crashes in the arrangement clip functions came in 12.3 and 12.4.

## Decision

The first real Ableton tool set covers:

- Control of the Live Set, saved or not. The mentor never asks the user to save.
- Reading and writing native devices.
- Arrangement View.
- Live 12.4 or newer.
- macOS.

Left for later:

- Reading and writing third-party plug-in settings. The planned first step is knowledge that lets the mentor tell the user exactly what to change.
- Hearing the audio.
- Session View.
- Live 11 and Live 12 before 12.4.
- Windows.

For anything the tool set cannot do, the mentor gives the user the exact steps and selects the place in Live. What a script cannot do is listed at the top of `docs/research/what-live-lets-a-script-do.md`; that list is the record of what is not supported yet.

Rejected:

- Live 12.3 or newer: two version lines to try by hand, a version check per action, and arrangement editing without some crash fixes.
- Workarounds for what Live does not offer, such as faking an insert of time by copying every later clip: special code that is hard to test and can leave the Live Set half changed. Each may be taken up later from the list.
- Driving Live's interface with the mouse and keyboard: a large, brittle, separate build.
- Windows from the start: nobody here can try it.

## Consequences

- A user on an older Live is told to update before the tools work.
- The mentor sees the structure of an arrangement, not how it sounds.
- Automation on the arrangement timeline is unsettled: a script cannot write it directly. The route through a Session View clip was tried in Live 12.4.6 (#3): copying the clip to the arrangement drops its envelope. The route by recording is untried.
- Nothing in the client is written for macOS only; Windows later is the Remote Scripts folder path and a round of testing.
