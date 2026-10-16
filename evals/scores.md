# Scores

One line per case, per model, per series. `change` names what was different from the line before on the same case, or `—` for a baseline. Details of each series are in the linked issue or pull request.

| date | case | model | passed | change | where |
|---|---|---|---|---|---|
| 2026-10-16 | low-end-hot-told | gemini:gemini-3.5-flash-lite | 0/10 | — | [#77](https://github.com/amitbaz/music-production-ai-mentor/issues/77): right control, right direction, 5 dB past the base every time. Out of the loop: a judgment plant with no range yet ([#79](https://github.com/amitbaz/music-production-ai-mentor/issues/79), ADR 0024) |
| 2026-10-16 | low-end-hot-told | claude:claude-haiku-5-5 | 0/30 | — | [#97](https://github.com/amitbaz/music-production-ai-mentor/pull/97): right control, right direction, 2 to 5 dB past the base every time (-3 dB 13 times, -4 dB twice, -6 dB 15 times, base is -1 dB). Out of the loop with Gemini's line: a judgment plant with no range yet ([#79](https://github.com/amitbaz/music-production-ai-mentor/issues/79), ADR 0024) |
| 2026-10-16 | kick-bass-fight-told | gemini:gemini-3.5-flash-lite | 0/30 | — | [mentor-kb #19](https://github.com/amitbaz/mentor-kb/issues/19): baseline without the knowledge base. Every run read the Operator inside Sub Sub Bass › Bassline; none changed Transpose. Instead: a high-pass on the sub's EQ (24), a sidechain compressor (6), an EQ on the kick (1). A knowledge failure, not a tool one |
| 2026-10-16 | kick-bass-fight-told | claude:claude-haiku-5-5 | 0/10 | — | [mentor-kb #19](https://github.com/amitbaz/mentor-kb/issues/19): same baseline, 10 runs as the ticket asked. Every run read the Operator; none changed Transpose. Instead: EQ bands on the sub (5), Coarse instead of Transpose (3), the kick's pitch decay (1), Bass Mono (1) |
| 2026-10-16 | kick-bass-fight-named | gemini:gemini-3.5-flash-lite | 1/1 | — | control for the line above, the fix named by the user: read the Operator, wrote Transpose -12 → -24 on the second try (the first gave "-24 st" as a string). The tools are not the problem |
| 2026-10-16 | kick-bass-fight-named | claude:claude-haiku-5-5 | 1/1 | — | control, same as Gemini's: one string attempt, then the number. Most told runs stopped the series on restore ([#113](https://github.com/amitbaz/music-production-ai-mentor/issues/113)); Live was relaunched between series |

