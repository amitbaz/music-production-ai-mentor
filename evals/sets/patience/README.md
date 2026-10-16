# Patience, the first base Set

The listening evals plant faults on a Live Set with none, and the answer key is the difference between the base and the planted copy (#54). The base has to sound right, and a model cannot hear: two Sets built through the mentor's own tools (set-1 in #54, its rebuild in #65) did not. So the first base is a finished track that ships with Live 12: Chuck Sutton's *Patience*, Ableton's demo song, made by a producer and mixed to be listened to.

## Where it is

```
/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Core Library/Lessons/Demo Songs/Chuck Sutton - Patience (Live 12 Suite Demo).als
```

It is on every Live 12 Suite install, and it is Ableton's, so it is not copied into the repo. The evals open it from there. Open it in Live and never save over it; a planted copy is what is in Live after a plant was applied, and it is not saved either.

## What is in it

- 167 BPM, 108 bars, 15 tracks and two returns (reverb, delay).
- Instruments and drums on MIDI tracks, four vocal audio tracks.
- Stock devices only: Drift, instrument and effect racks, Drum Rack, Simpler, Reverb, Delay, Compressor, Auto Filter, Utility. No third-party plug-in.
- Samples from the Core Library.
- One audio effect rack on Main. It is part of the base, not a fault.

## Plants

A plant is a parameter change made through the tools, applied and reverted by name, and never saved. Its answer key is the difference between the base and the planted copy (#54, ADR 0020): the before values below. The seven plants of #54 are rewritten here for this Set (#75); they live in `plants.ts`.

```
pnpm plant                      # lists the plants
pnpm plant <name>               # applies one to the Set open in Live
pnpm plant <name> --revert      # puts its before values back
```

A plant is only written when Live holds its before values, so a Set that was already changed, or a plant left applied, is refused rather than planted on.

| plant | changes (track / device / parameter: before → after) | bars where it sounds | what a good mentor says |
|---|---|---|---|
| `low-end-hot` Low end too hot | Sub Sub Bass / Volume: -1.0 → 5.0 dB | 25–33, 65–73, 81–89 | "The sub bass is several dB too loud for the kick." |
| `main-clips` Clipping on Main | Main / Volume: 0.0 → 6.0 dB | 17–25, 33–41, 81–89 (the choruses sum highest) | "The master clips; bring it down." |
| `mono` Mono image | Coffee Leaf / Utility / Mono: Off → On; Drums / Utility / Mono: Off → On | 1–41 | "The pad and the drums are mono; the mix has no width until the breakdown." |
| `kick-bass-fight` Kick and bass fight | Sub Sub Bass › Bassline › Operator / Transpose: -24 → -12 st | 25–33, 65–73, 81–89 | "The sub sits an octave up, on the kick's body; they mask each other in the low end." |
| `tail-smears` Vocal tail smears | Vocal Main / Reverb / Dry/Wet: 0 → 60 % (its decay is 6.8 s) | 11–42, 82–90 | "The lead vocal's reverb washes over everything; the words blur." |
| `clicks` Clicks | Coffee Leaf / Coffee Leaf / Env 1 Attack: 114 → 0 ms; Env 1 Release: 544 → 10 ms | 1–9, 17–25, 33–41, each chord change | "Something clicks on the pad's chord changes." |
| `chorus-flat` The chorus does not lift | Coffee Leaf / Volume: -4.0 → -20.0 dB | 17–25 against 9–17 | "The chorus is no bigger than the verse; the pad that should carry it is buried." |

Sections, by locator: Intro 1, Verse 1 9, Chorus 17, Verse 2 25, Chorus 33, Breakdown 41, Instrumental 57, Chorus 81, Outro 89.

## Cases

A case is a plant and what the user says about it (ADR 0020); they live in `cases.ts`. A run passes when the Set read back equals the base. With Patience open in Live, unsaved:

```
pnpm eval                                   # lists the cases
pnpm eval <case> [--runs 30] [--model provider:model]
```

Each run is saved under `~/.mentor/evals/runs/`, outside the repo. Between runs the runner puts the Set back; if it cannot, it stops and Patience is reopened without saving.
