# 0028 — Plug-in parameters are read and set by their text

Date: 2026-10-18 · Status: accepted · Amends [0015](0015-the-first-real-ableton-tool-set-has-a-narrow-scope.md) (third-party plug-in settings are no longer left for later, as far as Live gives them)

## Context

ADR 0015 left third-party plug-in settings for later. The prototype for #70 showed that Live gives a script every parameter in a plug-in's Configure list: Pro-C 2's whole list, read and set exactly (#120). A plug-in's parameter is a 0-to-1 value, and `str_for_value` gives the plug-in's own text for it. That text is not always in units: Threshold `-18.00` is dB, but Ratio `0.60` is the position of a control the plug-in shows as 4.00:1. A native device is written through `display_value`, in Live's units; on a plug-in that value is the 0-to-1 position too.

## Decision

- `read_tracks` gives a plug-in's parameters as it gives a native device's: the text, and the range or the choices. Its description says a plug-in's text may have no units, and that the list may be only part of the plug-in's settings.
- A plug-in whose list holds only Device On is marked as showing none of its settings, with how the user adds them through Configure.
- `set_parameters` takes a plug-in's value as its text shows it: a number such as -30 for `-30.00`, or a name such as `Clean`. It looks through the 0-to-1 positions with `str_for_value`, which does not change the setting, writes the position whose text matches best, and reports before → after. Numbers and lists go through this one path, whether or not Live gives the list's choices.

Rejected:

- Plug-in values as Live's 0-to-1 position: the model would guess a position for -30 dB and correct it, and the rule would differ from native devices.
- Marking a 0.00-to-1.00 range as a position: a guess in code, wrong for a real 0-to-1 control such as a mix knob.
- Counting all of a plug-in's parameters to say "12 of 576": the Remote Script would need a new call, for a note the description already covers.
- Leaving plug-ins name-only until asked: two reads to see one, and plug-ins unlike every other device.

## Consequences

- When a plug-in's text has no units, the mentor sees the same numbers the API gives, not the plug-in window's. The eyes are the way to its own readout.
- A write lands on the nearest position the plug-in's text shows, so -30 may come back as -29.98.
- A setting outside the Configure list is still changed by the user, or by the hands.
