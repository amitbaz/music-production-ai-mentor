# Research — what the mentor's tools can read for a diagnosis, and the gaps

Date: 2026-10-17 · Status: research note, not a decision · Ticket: #129, for the map #127

The question: before the mentor picks a fix, what can its tools read today, and what is missing? A **diagnosis** (GLOSSARY.md, on the `glossary-diagnosis` branch) needs three things here:

1. The device chain on a track, racks included, and every transpose along it, so the sounding pitch can be worked out.
2. An instrument's structure: how many oscillators are on, what follows the key, and what moves at random or drifts.
3. What a clip actually plays: its notes and their range.

For each gap: does Live's API expose it, what would it cost in result size (the 40,000-character result limit, ADR 0018), and could a read return it on demand?

Sources: the tool code in `packages/tools/src/daws/ableton/`, the Remote Script in `packages/tools/remote-scripts/ableton-js/`, the replies recorded from a real Live in `recorded-reads.json`, [what-live-lets-a-script-do.md](what-live-lets-a-script-do.md), and the [Live Object Model](https://docs.cycling74.com/apiref/lom/) (LOM, version 12.4.5). Live was not connected for this note.

Tags: **[code]** read in our code. **[LOM]** stated in the LOM reference. **[measured]** computed from `recorded-reads.json`. **[inferred]** follows from the code or docs, not checked in Live. **[unverified]** open.

## Short answer

- **The device chain is read well.** `read_tracks` gives every device in order, the chains of every rack at any depth, and every parameter of every native device, with its value, range or choices, as Live shows them. Every transpose that is a device parameter is in there: Pitch, Arpeggiator, Simpler's Transpose and Detune, an instrument's coarse and fine. So is every key-tracking amount, LFO and random amount that is a parameter, such as Simpler's `Filt < Key`, `L R < Key` and `Pan < Rnd`. **[code]** **[measured]**
- **Nothing works out the sounding pitch.** The mentor must find each pitch-moving parameter by name, across devices with different names for the same idea, and add them up itself. A read cannot do that for it without a list of parameter names per device, which nobody has dumped yet. **[inferred]**
- **Five small gaps hide facts a diagnosis needs, and Live exposes all of them:**
  1. `read_clip` drops each note's `mute` flag. The Remote Script already sends it. A deactivated note looks like one that plays. **[code]**
  2. `read_clip` gives no loop or start and end markers. Notes outside them do not play. `live_get` can read them, one property per call. **[code]** **[LOM]**
  3. `read_tracks` drops a Drum Rack chain's `in_note`. The script already sends it. Without it, a note cannot be matched to the drum it plays. **[code]**
  4. No tool reads a parameter's `automation_state` or `state`. So the mentor cannot tell that a value is automated, or that a setting has no effect (for example, on an oscillator that is off). **[code]** **[LOM]**
  5. No tool reads a rack chain's volume and pan. `read_tracks` gives a chain's mute and solo only. **[code]** **[LOM]**
- **Some instrument structure is outside the parameters.** Wavetable's and Drift's modulation matrices (what the LFOs and the key drive) are device properties and functions. Drift's can be read with `live_get` today. Wavetable's needs a function call, which only `live_change` makes, and that asks the user. **[LOM]** **[code]**
- **Some things cannot be read at all**: a rack chain's key and velocity zones, the target of a Max for Live modulator (such as the LFO device), Sampler's zones, arrangement automation, and third-party plug-in parameters. **[LOM]** **[inferred]**
- **Size is not the blocker.** One Simpler with all 83 parameters is 5,441 characters, about 66 per parameter. A 40,000 result holds about seven such instruments. `read_tracks` already cuts by whole devices and lets the mentor ask for the rest by id. Every fix above costs tens to a few thousand characters. **[measured]** **[code]**

## What the tools read today

| Tool | What it gives | Size control |
|---|---|---|
| `read_set` | Tempo, time signature, every track with volume, pan, sends, mute, solo, group, and its top-level devices by name and id. No parameters, no clips. | Fixed per track. |
| `read_tracks` | For chosen tracks: devices in order; every native device's parameters as `{name, value, range}` or `{name, value, choices}`; racks with chains (`id`, `name`, `mute`, `solo`) and their devices, at any depth; plug-ins by name only; session and arrangement clips with id, kind, muted, scene or start and end. | Past 40,000 it keeps whole devices in order, lists the rest by name in `left_out`, and takes a `devices` argument to read only those. |
| `read_arrangement` | Locators, and each track's arrangement clips as `[id, name, start bar, end bar]`. | Past the limit, a count and first and last bar per track. |
| `read_clip` | MIDI: notes as `[id, pitch, start, length, velocity, probability]`. Audio: warp mode, gain, pitch in semitones and cents, file. | Past the limit, only `note_count`; ask again with `from_beat` and `to_beat`. |
| `live_get` | Any property of the song, a track, a device, a clip or a rack chain, by Live's own name. | Past the limit, a count and a note. |

Sources: `tools/reads/read-set.ts`, `read-tracks.ts`, `read-arrangement.ts`, `read-clip.ts`, `tools/general/live-get.ts`. **[code]**

`live_get` reaches only objects with an id kind: `t`, `d`, `c` and `ch` (`NAMESPACES` in `live-get.ts`). A device parameter, a chain's mixer and a drum pad have no id kind, so `live_get` cannot reach them. **[code]**

## The table

"Cost" is the extra size of the result, in characters, at the rates measured below.

| What a diagnosis needs | Read today? (tool, field) | Gap | Does Live's API expose it | Cost in result size |
|---|---|---|---|---|
| **1. Device chain and pitch** | | | | |
| Devices on a track, in order | Yes: `read_tracks` `devices` | — | Yes | — |
| Racks: chains and their devices, nested | Yes: `read_tracks` `chains[].devices` | — | Yes | — |
| Device on or off | Yes: the `Device On` parameter; chain `mute` | `Device.is_active` (off because a parent rack or chain is off) not given, but it can be worked out | Yes: `Device.is_active`; also via `live_get` today | — |
| A chain's volume and pan | No: only `mute`, `solo` | A chain turned down or panned cannot be seen | Yes: `Chain.mixer_device` (ChainMixerDevice) | About 35 per chain; two more messages per rack level |
| A rack's return chains | No | Not read | Yes: `RackDevice.return_chains` | Like a chain |
| Drum Rack: which note plays which chain | No: `read_tracks` drops `in_note` | A clip's notes cannot be matched to drums | Yes: `DrumChain.in_note`, `out_note`, `choke_group`; the script already sends them (`Chain.py`) | About 13 per chain, so 1,700 for 128 |
| Rack chain key and velocity zones | No | A key-split or velocity layer cannot be seen | **No**: the LOM `Chain` page lists no zone property | — |
| Rack macros and what they are mapped to | Values yes (macros are the rack's parameters); targets no | Which parameter a macro moves is unknown | Only `has_macro_mappings` and `macros_mapped` (which macros, not where to) | About 30 per rack |
| Transposes in MIDI effects (Pitch, Arpeggiator, Chord, Scale, Note Echo, Random) | Yes: as parameters in `read_tracks` | Names differ per device; no sum | Yes, as parameters | Already in the result |
| An instrument's Transpose, coarse, fine, detune | Yes: as parameters, such as Simpler `Transpose`, `Detune` | Same: found by name only | Yes, as parameters | Already in the result |
| An audio clip's transpose | Yes: `read_clip` `pitch_semitones`, `pitch_cents` | — | Yes | — |
| The sounding pitch of a note | No | Nothing adds the transposes up | Not as one value: it is our sum of parameters | About 300 per track as a summary; needs a list of pitch parameters per device first |
| A tuning system | No | Rare | Yes: a `TuningSystem` namespace exists in the script | Small |
| Third-party plug-ins | Named only, marked `plugin` | Their settings are invisible | See [reaching-third-party-plug-ins.md](reaching-third-party-plug-ins.md) | — |
| **2. Instrument structure** | | | | |
| How many oscillators are on | Yes, when the switch is a parameter (such as an oscillator's on switch or level) | Which settings are parameters is not dumped for Operator, Sampler or others | Parameters yes; settings outside them no (`what-live-lets-a-script-do.md`, section 5) | Already in the result |
| Whether a setting has an effect | No | A value on an oscillator that is off looks like one that counts | Yes: `DeviceParameter.state` (0 active, 1 "changes won't have an audible effect", 2 cannot change) | About 15 per inactive parameter, if only those are marked |
| What follows the key (filter key tracking, envelope key scaling, LFO rate by key) | Yes, when it is a parameter, such as Simpler `Filt < Key`, `L R < Key` | Wavetable routes the key through its matrix | Wavetable: `get_modulation_value(target, source)`, a function. Drift: `mod_matrix_*_index` properties | Matrix: about 1,000–2,000 per device |
| LFOs and envelopes inside an instrument | Yes, as parameters (Simpler `L Wave`, `L Rate`, `Pitch < LFO`, `Pe < Env`) | Matrix routings as above | As above | Already in the result |
| Random and drift sources | Yes, when they are parameters, such as Simpler `Pan < Rnd`; Random's chance; note probability | — | As parameters | Already in the result |
| Wavetable's wavetable, unison, voices; Drift's voices | No (not parameters) | Not in `read_tracks` | Yes: `WavetableDevice` and `DriftDevice` properties; `live_get` reads them today | About 200 per device |
| Simpler's sample and play mode | No | Sample file, slicing, play mode not given | Yes: `SimplerDevice.playback_mode`; `sample` comes back as text only | About 100 |
| Max for Live modulator targets (LFO, Shaper, Envelope Follower) | Its own parameters only | What it moves is unknown | **No**: the LOM `MaxDevice` page has inputs, outputs and banks, no mapping target | — |
| Sampler zones | No | — | **No**: no `SamplerDevice` class | — |
| **3. What a clip plays** | | | | |
| Notes: pitch, start, length, velocity, probability | Yes: `read_clip` rows | — | Yes | About 22 per note row; 40,000 holds about 1,800 notes |
| A note switched off | No: `read_clip` drops `mute` | A deactivated note looks like it plays | Yes: `get_notes_extended` returns `mute`, and the script already sends it (`Clip.py`) | 0 when only muted notes get a mark; else 2 per row |
| Velocity deviation, release velocity | No | Minor for a diagnosis | Yes, already sent by the script | 2–4 per row |
| Loop, start and end markers | No in `read_clip`; yes one by one with `live_get` | Notes outside them do not play; arrangement clips repeat the loop | Yes: `looping`, `loop_start`, `loop_end`, `start_marker`, `end_marker` | About 90 per clip |
| Pitch range (lowest, highest) | No: the mentor scans the rows; a big clip gives only `note_count` | Register needs a full note read | Ours to compute from the notes | About 30 per clip |
| A clip switched off | Yes: `read_tracks` `muted`; not in `read_arrangement` rows | — | Yes | — |
| Clip automation (Session clip envelopes) | No | An automated parameter reads only its value now | Yes: `Clip.has_envelopes`; `automation_envelope(parameter)` needs a parameter object | `has_envelopes`: about 20 per clip |
| A parameter is automated (arrangement) | No | Same | Only `DeviceParameter.automation_state` (0 none, 1 active, 2 overridden); the envelope itself cannot be read | About 20 per automated parameter |
| Groove on a clip | No | Timing, not pitch | Not through the script as shipped (`Clip.groove` needs a wrapper) | — |

Sources for the LOM column: [Chain](https://docs.cycling74.com/apiref/lom/chain/), [DrumChain](https://docs.cycling74.com/apiref/lom/drumchain/), [RackDevice](https://docs.cycling74.com/apiref/lom/rackdevice/), [Device](https://docs.cycling74.com/apiref/lom/device/), [DeviceParameter](https://docs.cycling74.com/apiref/lom/deviceparameter/), [MaxDevice](https://docs.cycling74.com/apiref/lom/maxdevice/), [WavetableDevice](https://docs.cycling74.com/apiref/lom/wavetabledevice/), [Clip](https://docs.cycling74.com/apiref/lom/clip/), and [what-live-lets-a-script-do.md](what-live-lets-a-script-do.md) sections 4, 5, 6 and 7.

## How the sizes were measured

`recorded-reads.json` holds a real `read_tracks` of a Simpler (`OriginalSimpler`). Rebuilding its parameter list the way `describeParameters` does gives **83 parameters in 5,441 characters**, about 66 per parameter. 19 of them are lists with choices, at 1,337 characters together. **[measured]**

So one 40,000 result holds about 590 parameters, or about seven Simpler-size instruments. A full read of one track with one instrument and a few effects fits. A rack of several instruments may not, and then `read_tracks` cuts by whole devices and names the rest in `left_out`. **[measured]** **[code]**

A note row such as `["n12",60,0,1,100,1]` is about 22 characters, so `read_clip` lists about 1,800 notes before it gives only a count. **[inferred]** from `noteRow` in `reading.ts`

Operator's parameter count is **not known**. The Patience base Set has an Operator, but no read of its parameters is recorded. A dump from a running Live would settle Operator's size and which of its settings are parameters (also open in `what-live-lets-a-script-do.md`, "What was not verified"). **[unverified]**

## Could a read return each gap on demand?

Yes, for every gap Live exposes. Ordered by how much they help a diagnosis for what they cost:

1. **Note `mute` in `read_clip`.** The data already arrives; `noteRow` drops it. Mark only muted notes, so a clean clip costs nothing. Small change in `reading.ts` and `live.ts`. **[code]**
2. **Loop and markers in `read_clip`.** Five more properties in the same message, about 90 characters. **[code]** **[LOM]**
3. **Drum chain `in_note` in `read_tracks`.** The data already arrives in each chain; `describeChains` drops it. About 13 characters per chain. **[code]**
4. **Pitch range in `read_clip`**, also in the too-many-notes answer, so the register is known without listing notes. About 30 characters. **[inferred]**
5. **Parameter `automation_state` and `state` in `read_tracks`**, marked only when not the default. It costs one more round of messages per read (one property per parameter, in the batched way `describeParameters` already reads `min`, `max` and `value_items`). Characters stay small because most parameters are neither automated nor inactive. **[inferred]**
6. **Chain volume and pan in `read_tracks`.** Two more messages per rack level, about 35 characters per chain. **[inferred]**
7. **Wavetable's modulation matrix.** `get_modulation_value` takes two numbers, so the script can call it with JSON arguments today, but only through `live_change`, which asks the user first. A read needs either a tool argument on `read_tracks` for a device, or a read-only path for functions. About 1,000–2,000 characters per Wavetable. **[code]** **[inferred]**
8. **A sounding-pitch summary.** Possible only after a dump of parameter names per native device, to know which ones move pitch. Until then, the mentor can do the sum from `read_tracks`, which already holds every such parameter. **[inferred]**

Not readable, whatever we build on the script: rack chain zones, Max for Live modulator targets, Sampler zones, arrangement automation envelopes, and plug-in settings beyond what a plug-in exposes. For these, the mentor must ask the user or listen (the listening map, #50). **[LOM]** **[inferred]**

## What was not verified

- Operator's parameter list and size, and which Operator and Sampler settings are parameters. Needs a dump from Live.
- That reading `automation_state` and `state` for every parameter stays fast enough in a real Live Set.
- That `live_get` returns the Wavetable and Drift properties as plain values, not text. The dispatch code suggests it does (`what-live-lets-a-script-do.md`, transport section).
- The LOM `Chain` page has no zone property. Whether the Python API has one under another name was not checked.

## Sources

- Code: `packages/tools/src/daws/ableton/tools/reads/read-tracks.ts`, `read-clip.ts`, `read-set.ts`, `read-arrangement.ts`, `tools/general/live-get.ts`, `live-change.ts`, `reading.ts`, `live.ts`, `recorded-reads.json`.
- Remote Script: `packages/tools/remote-scripts/ableton-js/Namespaces/Clip.py` (`_serialize_midi_notes` sends `mute`, `velocity_deviation`, `release_velocity`), `Chain.py` (`serialize_chain` sends `in_note`, `out_note`, `choke_group` for drum chains), `Interface.py` (generic `get_prop`), `DeviceParameter.py` (`get_automation_state`, `get_state`).
- Cycling '74, [Live Object Model](https://docs.cycling74.com/apiref/lom/) 12.4.5: the pages linked under the table.
- [what-live-lets-a-script-do.md](what-live-lets-a-script-do.md), [reaching-third-party-plug-ins.md](reaching-third-party-plug-ins.md).
- ADR 0018, `docs/adr/0018-a-long-conversation-is-summarised.md`: the 40,000-character result limit.
- `evals/sets/patience/plants.ts`: the Operator `Transpose` plant that started the map.
