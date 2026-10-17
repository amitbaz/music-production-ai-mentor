# PROTOTYPE: read and turn one third-party plug-in by eye and hand (#70)

Throwaway, never for main. Answers [#70](https://github.com/amitbaz/music-production-ai-mentor/issues/70) on the map [#67](https://github.com/amitbaz/music-production-ai-mentor/issues/67).

Run on 2026-10-17: macOS 27.0.1, Live 12 Suite 12.4.6, FabFilter Pro-C 2 (AU v2) on the Main track of the maintainer's template Set, run from Superset (the host app holding Screen Recording and Accessibility).

## Files

- `live.ts`: runs the mentor's Ableton tools from a script. `params.ts`: a plug-in's parameters with Live's display text; sets them by API. `plugins.ts`: finds a plug-in's browser path.
- `eyes.js` (JXA): Live's windows, legacy capture. `hands.swift`: AX dump, per-process and real-mouse double-click plus typing, hover plus capture.
- `read-by-eye.ts`: sets eight states by API, captures, asks models to read five controls, scores against Live's display text.
- On this branch, `find-in-browser.ts` also searches Live's `plugins` folder, so `edit_devices` can load a plug-in.

## What was found

**Opening and finding the window**
- `is_editor_open` works. Live also opens a plug-in's window on load.
- The plug-in window is **layer 3** (floating), titled `<device>/<track>`, such as `Pro-C 2/Main`. A layer-0 filter misses it.
- **Live hides plug-in windows while another app is in front.** The window then gives no image.

**Capture**
- `CGWindowListCreateImage` returned NULL for the plug-in window, even with Live in front. It still captured the main window.
- `screencapture -l <id>` captured the plug-in window every time Live was in front: 16 of 16, plus the hover captures. It never worked while the window was hidden.
- So **a look at a plug-in takes Live to the front** for about a second. Size: 1000 × 623 points, 2000 × 1246 pixels, about 460 KB PNG. That is about 3,240 tokens on Claude (no shrinking) and 1,120 on Gemini.

**Accessibility**
- Pro-C 2's window exposes nothing to Accessibility: only the window's close, minimise and zoom buttons and its title. Route (c), acting on elements by Accessibility, is out for it.
- Live's AX window list holds the plug-in window only while Live is in front.

**Reading through the API**
- Live gives every Pro-C 2 parameter (it has fewer than 64): its 0–1 value and its display text through `str_for_value`. The tools skip plug-in parameters today (`read_tracks`: "cannot be read").
- The display text is the plug-in's own, and only partly in units. Threshold reads `-18.00`, Knee `18.00`, Range `60.00` (all dB), Style `Clean`, Auto Gain `On`. But Ratio reads `0.60`, Attack `0.10` and Release `0.41`, bare 0–1 numbers.

**Reading by eye** (8 states, one capture each; right out of 8; threshold ±3 dB, knee ±6 dB, range ±5 dB)

| | Threshold (knob) | Knee (slider) | Range (slider) | Style (button text) | Auto Gain (lit label) |
| --- | --- | --- | --- | --- | --- |
| gemini-3.5-flash-lite, run 1 | 1 | 1 | 1 | 8 | 8 |
| gemini-3.5-flash-lite, run 2 | 7* | 1 | 1 | 8 | 7 |
| claude-haiku-5-5, run 2 | 8* | 3 | 1 | 8 | 8 |
| claude-sonnet-5-5, run 2 | 7* | 3 | 2 | 8 | 8 |

\* In run 2 the cursor rested over the Threshold knob, so Pro-C 2 showed its **hover readout** ("Threshold −22.80 dB") and the models read the printed number. Run 1 had no readout. Claude's run 1 answers were lost to a token cap (thinking used it up).

- Printed text (button labels, lit labels, hover readouts) was read right almost every time. Positions of knobs and sliders with no number were mostly wrong, as the model research predicted.
- **The hover readout is the eyes' best source.** A real-mouse move over Ratio showed `Ratio 4.00:1` (API: `0.60`). Over Attack it showed `Attack 0.255 ms` (API: `0.10`). One hover and one capture each.

**Input** (target: the Threshold knob, double-click, type a value, Return; checked through the API)

| Route | Result | Cursor | Focus |
| --- | --- | --- | --- |
| `CGEventPostToPid` (Live's process only), Live in front | 0 of 1: no entry box opened | untouched | untouched |
| `CGEventPostToPid` scroll wheel | 0 of 1 | untouched | untouched |
| `CGEventPost` at the HID tap (a real mouse) | **11 of 11** right, about 2 s each | moves, restored after | Live comes forward, previous app restored after |
| Accessibility actions | not possible: no elements | — | — |

- `NSRunningApplication.activate()` from the helper did **not** bring Live forward on macOS 27, and one real-mouse write landed in the app in front (Superset). `tell application "Ableton Live 12 Suite" to activate` through AppleScript did work. **A guard that stops unless Live is really in front is required** before any real-mouse event.

## What this means

- A plug-in's settings come from the API first. Its values are exact, readable and writable without touching the screen. The eyes add what the API's text lacks (units for Ratio, Attack, Release) through a hover readout, and the layout (where a control is).
- The hands, for a FabFilter-style plug-in, are a real mouse: double-click, type, Return. That takes Live to the front and moves the cursor for about 2 s. Per-process events and Accessibility do not reach it.
- A model should never be asked to read a value off a knob's angle.
