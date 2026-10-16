# Scores

One line per case, per model, per series. `change` names what was different from the line before on the same case, or `—` for a baseline. Details of each series are in the linked issue or pull request.

| date | case | model | passed | change | where |
|---|---|---|---|---|---|
| 2026-10-16 | low-end-hot-told | gemini:gemini-3.5-flash-lite | 0/10 | — | [#77](https://github.com/amitbaz/music-production-ai-mentor/issues/77): right control, right direction, 5 dB past the base every time. Out of the loop: a judgment plant with no range yet ([#79](https://github.com/amitbaz/music-production-ai-mentor/issues/79), ADR 0024) |
| 2026-10-16 | low-end-hot-told | claude:claude-haiku-5-5 | 0/30 | — | [PR](https://github.com/amitbaz/music-production-ai-mentor/pulls): right control, right direction, 2 to 5 dB past the base every time (-3 dB 13 times, -4 dB twice, -6 dB 15 times, base is -1 dB). Out of the loop with Gemini's line: a judgment plant with no range yet ([#79](https://github.com/amitbaz/music-production-ai-mentor/issues/79), ADR 0024) |
