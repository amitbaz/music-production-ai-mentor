# Music production AI mentor

An AI mentor for music producers. You talk to it in plain language: it explains when you ask how or why, and it acts in your DAW when you ask it to do something, then says what it did and why. It runs on its own provider-agnostic agent harness, written in TypeScript.

## Status

Early. The mentor runs in the terminal on Gemini and reads the Live Set open in Ableton Live: an overview, the detail of the tracks it chooses, the arrangement and the inside of a clip. `pnpm pair ableton` installs the Remote Script it reaches Live through. It changes device parameters and the mixer, tracks, effect chains, arrangement clips and locators, the notes of MIDI clips, the transport and what is selected in Live, finds devices, presets and samples by name, deletes tracks, devices, clips and notes after asking, and reaches anything else Live offers to scripts through two general tools. Its system prompt tells the model how to work in Live: read first, give each change before → after, and say it cannot hear the audio.

## What it does today

- Talk to the mentor in the terminal, with its reply shown as it is written.
- It tells explaining from acting by how you ask, and looks at the current state before changing anything.
- Its system prompt tells it how to work in Live: read before acting and name tracks, devices and clips by the object ids of the latest read; after a change, give each one as track / device / parameter: before → after, such as `Kick / Volume: 0.0 dB → -3.0 dB`; for what the tools cannot do, such as a plug-in's settings, automation or freezing, give the exact steps; and say it cannot hear the audio rather than claim to.
- `pnpm pair ableton` pairs the mentor with Ableton Live on macOS: it installs the Remote Script with a new random password that only the mentor knows, and says which Control Surface to choose in Live. Running it again replaces both. `pnpm unpair ableton` removes them again. The mentor can be talked to whether Live is paired or not, and when it cannot reach Live it says whether Live is not paired or not answering.
- `read_set` gives the mentor an overview of the Live Set open in Ableton Live, saved or not: tempo, time signature, and each track with its kind, group, volume, pan, sends, mute and solo, and its devices. It connects to Live the first time it is used.
- When Live cannot be used, the mentor is told what is wrong and what to do, and can pass it on: Live not answering or MusicMentor not chosen, the wrong password, an installed script of another version (pair again and restart Live), a Live older than 12.4 (update it), or a command Live did not answer within 10 seconds. After Live is restarted, the next tool call connects again without restarting the mentor; object ids from before are refused with a message to read again, and never given out again.
- `read_tracks` gives the mentor the detail of the tracks it chooses by object id: every parameter of each native device with its value in the units Live shows and its range (a list parameter gives its current choice and its choices), the chains of a rack with their devices, and the track's Session and Arrangement clips, each with an object id. A third-party plug-in is named and marked, without parameters. A result past 40,000 characters is cut at a whole device, and says which devices it left out; the mentor reads those with the `devices` argument.
- `read_arrangement` shows the mentor the Live Set along time: the locators with their object ids, and per track its Arrangement View clips with their object ids, names, and start and end as bar numbers like Live's ruler (Session View clips are not listed). On a Live Set too big to list every clip it gives the clip count and span per track, and the mentor asks again for some tracks or some bars. `read_clip` gives the notes of a MIDI clip, each with an object id (pitch, start, length, velocity, probability), or the warp, gain, pitch and sample file of an audio clip, saying when the sample is missing.
- `set_parameters` changes device parameters and the mixer, several in one call and in order, without asking: any parameter of a native device, and a track's volume, pan and sends (`send t2`, by the object id of the return track). The value is in the units Live shows, or the name of the choice for a list parameter. Each change is reported as track / device / parameter: before → after. A change that fails (an unknown parameter, with the names that exist; a value outside the range, with the range; a third-party plug-in) is reported and does not stop the others. It takes a change back by writing the old value again.
- `edit_tracks` creates audio, MIDI and return tracks, duplicates tracks, and renames them and sets mute, solo, arm and routing, with a list of changes made in order. Each result gives the object id of the track and, for an edit, before and after for what changed. A change that fails is reported with the reason (a routing that does not exist is refused with the names that do) and the others still happen. It cannot delete a track.
- `transport` plays and stops, jumps to a bar, sets the loop region and the tempo (20 to 999 BPM), and switches the metronome on and off, with before and after for each. Bars are numbered as Live's ruler shows them.
- `show` selects a track, device or clip in Live by its object id, and opens the device view or clip view for the last two, so the user is looking at what the mentor is talking about.
- So the user sees what changes, `edit_tracks` and `set_parameters` first bring the track into view: the folded groups it is in are opened, the track is expanded if the Arrangement View shows it as a thin strip, the track is selected, and Live is made to scroll to it by focusing the view and moving the selection one track away and back (selecting from a script does not scroll). When the view could not be moved, the result says so in `view_problems` and the change is still made. For a device, the device is then selected, the device view opens and the device chain is scrolled to it the same way. `show` does the same.
- `edit_devices` lets the mentor build and reorder effect chains: it adds a native device by name to a track or rack chain at a position (and gives its object id), moves a device within its chain or to another, and switches one on or off, each reported with the new order or the state before and after. A list of edits is applied in order and a failed one does not stop the rest. It cannot delete a device. `find_in_browser` finds devices, presets and samples by part of their name in Live's browser, telling which kind each is and where it is; it walks the browser, because Live offers no search, and says when it stopped early.
- `edit_arrangement` reshapes the Arrangement View, with bars as Live's ruler numbers them: it creates an empty MIDI clip at a bar with a length in bars (and gives its object id), duplicates a clip to a bar on its own track or another of the same kind, and moves one, done as a copy and the original removed without asking, since Live cannot move a clip. It refuses to put a clip on bars that hold another, since Live would cut that one to make room. It changes a clip's name, mute and loop, and an audio clip's warp mode, gain in dB (or "-inf" for silence) and pitch, each reported before and after as Live shows it. It adds a locator at the start of a bar, renames and removes one (one inside a bar is left to the user, with the steps, and adding or removing waits for Live to stop playing); Live does that only at the playback position, so the position is moved there and put back, as it is after Live moves it to a new clip. Splitting a clip, inserting or cutting time and arrangement automation are refused with the steps for the user, and it cannot delete a clip.
- `write_notes` adds notes to a MIDI clip with pitch, start, length, velocity and probability, and changes notes by the object ids `read_clip` gives, also a note before the clip's start, reporting each changed field before and after, and saying when Live did not take a change. A note that cannot be written is reported and the others still are. It cannot remove notes.
- The Remote Script also holds one Python file of ours, `Mentor.py`, with the functions the ableton-js script cannot reach: moving a device, deleting a track, device or clip where it is, adding notes with probability, changing notes wherever they start, a Compressor's sidechain source and a Simpler's sample. Moving a device, deleting, and adding and changing notes have tools so far. The client checks its version when it connects. What to try in Live before a release is in [`packages/tools/remote-scripts/checklist.md`](packages/tools/remote-scripts/checklist.md).
- `delete` removes tracks, return tracks, devices (also inside a rack chain), Session and Arrangement clips, and chosen notes of a MIDI clip, by object id, several in one call. The user is asked first, and a refusal leaves the Live Set as it was. Each is reported by name (a note by its clip and its row), or with Live's error, and a failed one does not stop the rest; what is inside is deleted before what holds it. A deleted object's id is refused afterwards with a message to read again. Main cannot be deleted.
- `live_get` reads any property Live offers to scripts, of the song or of an object by object id, by Live's own name, without asking; the Live objects in its answer are given as object ids. `live_change` sets any property, with before and after, or calls any function, and always asks first. An error from Live comes back as the tool result with Live's message.
- Only `delete` and `live_change` ask for approval; every other tool runs at once.
- Ctrl+C cancels a turn. What already happened stays in the conversation.
- A failed model call is retried after a growing wait, and an attempt that hangs is timed out.
- A reply cut off by the model's output limit is kept as far as it got, and none of its tool calls run. The terminal shows "(reply cut off)". See [ADR 0018](docs/adr/0018-a-long-conversation-is-summarised.md).
- A long conversation is summarised: past 100,000 tokens, before a model call (also in the middle of a turn), the mentor's model writes a summary of everything except the newest ~20,000 tokens, and is sent only that summary and what follows from then on. The terminal shows "(summarising the earlier conversation…)" and then "(earlier conversation summarised)". A summary that fails adds nothing: the terminal shows "(could not summarise, carrying on with the full conversation)" and the turn carries on. See [ADR 0018](docs/adr/0018-a-long-conversation-is-summarised.md).
- Only supported models run: a model with a context window of at least 1,000,000 tokens, from a fixed list per provider (today `gemini-3.5-flash-lite`). Any other model name is refused with a plain error. See [ADR 0019](docs/adr/0019-only-supported-models-with-a-1m-window.md).

## Planned

- **The real Ableton Live** ([#2](https://github.com/amitbaz/music-production-ai-mentor/issues/2)): `read_set` staying under the result limit on a big Live Set ([#19](https://github.com/amitbaz/music-production-ai-mentor/issues/19)); reading and changing the Live Set, `delete`, the general tools and the system prompt's rules for Live are in.
- **A `mentor` command** ([#37](https://github.com/amitbaz/music-production-ai-mentor/issues/37)): type `mentor`, `mentor auth gemini` or `mentor pair ableton` from any folder.
- **Load a tool set only when the mentor needs it** ([#1](https://github.com/amitbaz/music-production-ai-mentor/issues/1)).
- **Evals** for what the model decides: which tool it picks, whether it follows the system prompt, which format tool results should use ([#16](https://github.com/amitbaz/music-production-ai-mentor/issues/16)), and what a summary of a long conversation keeps ([#18](https://github.com/amitbaz/music-production-ai-mentor/issues/18)). How a run is graded is decided ([ADR 0020](docs/adr/0020-evals-grade-the-set-against-its-base.md)): the Live Set is read back and compared to its base. The runner is in: `pnpm eval <case>` plants, runs the mentor, grades and restores, and prints the rate ([#77](https://github.com/amitbaz/music-production-ai-mentor/issues/77)). Scores are kept in [`evals/scores.md`](evals/scores.md), and [`evals/README.md`](evals/README.md) has the loop that turns a score into the next change.
- **Long conversations** ([#21](https://github.com/amitbaz/music-production-ai-mentor/issues/21)): the mentor summarises the older part of a long conversation so each question stays cheap and its answers stay sharp, and shows how big the conversation is. Measuring the size, sending the model only the latest summary and what follows it, and writing the summary are in. See [ADR 0018](docs/adr/0018-a-long-conversation-is-summarised.md).
- **Memory across conversations** ([#20](https://github.com/amitbaz/music-production-ai-mentor/issues/20)): the mentor remembers your preferences from one conversation to the next.
- **Run tools in parallel**: when the model asks for several tools in one reply, run them at the same time instead of one after another.
- **Third-party plug-ins in Ableton**: read and change the settings of plug-ins that are not native devices. Left out of the first tool set by [ADR 0015](docs/adr/0015-the-first-real-ableton-tool-set-has-a-narrow-scope.md); see [reaching third-party plug-ins](docs/research/reaching-third-party-plug-ins.md).
- **A desktop app**, next to the terminal one.
- **Listening** ([#50](https://github.com/amitbaz/music-production-ai-mentor/issues/50)): let the mentor hear your mix, so its advice is based on the sound and not only on the settings. See [how the agent can hear Live](docs/research/hearing-live-audio-and-where-the-agent-runs.md). The ground truth is in: Ableton's own demo song, Chuck Sutton's *Patience*, which ships with Live 12, is the first base Set (`evals/sets/patience/`) for faults to be planted on and found ([#54](https://github.com/amitbaz/music-production-ai-mentor/issues/54), [#65](https://github.com/amitbaz/music-production-ai-mentor/issues/65)), and its seven plants are in, applied and reverted with `pnpm plant` ([#75](https://github.com/amitbaz/music-production-ai-mentor/issues/75)).
- **Stems and sound analysis**: tools that split a track into stems and measure the sound, such as loudness, frequency balance and dynamics.

## Quick start

You need Node 22.18 or newer, pnpm, and a Gemini API key (free from [Google AI Studio](https://aistudio.google.com/apikey)).

```sh
git clone https://github.com/amitbaz/music-production-ai-mentor.git
cd music-production-ai-mentor
pnpm install
cp apps/cli/.env.example apps/cli/.env   # then set GEMINI_API_KEY in it
pnpm start
```

For the Ableton tools you also need Ableton Live 12.4 or newer on macOS. Pair it once:

```sh
pnpm pair ableton
```

This copies the [ableton-js](https://github.com/leolabs/ableton-js) 5.0.4 Remote Script, kept in `packages/tools/remote-scripts/ableton-js/` with its files unchanged but for one Python file of ours and the one line that registers it, to `~/Music/Ableton/User Library/Remote Scripts/MusicMentor`. It also writes a new password into the script and into `apps/cli/.env`. Then restart Live and choose `MusicMentor` as a Control Surface in Settings → Link, Tempo & MIDI. If you installed `AbletonJS` by hand before, choose `MusicMentor` in its slot instead, so `AbletonJS` is chosen nowhere: both listen on the same port, and `AbletonJS` has no password. `ABLETON_ADDRESS` in `apps/cli/.env` says where the script listens; `.env.example` has its default, `ws://127.0.0.1:39031`.

## Uninstall

1. `pnpm unpair ableton` removes the `MusicMentor` Remote Script and its password. It leaves anything else in Live's Remote Scripts folder alone.
2. In Live, Settings → Link, Tempo & MIDI: set that Control Surface to None, then restart Live.
3. Delete the repo's folder.

`pnpm check` runs the type check, the linter and the tests in every package. The tests need no network and no key.

## How it's put together

A pnpm workspace. Packages export their TypeScript source; there is no build step.

| Path | What it holds |
|---|---|
| `packages/harness/` | The agent loop, the message format, tools, and the provider adapters. Knows nothing about music. |
| `packages/tools/` | Tool sets, one per outside source, such as `src/daws/ableton/`. |
| `packages/mentor/` | The product: the system prompt, the model and the tool sets, joined by `createMentor`. The only place the harness and the tool sets meet. |
| `apps/cli/` | The terminal app. Owns what the user sees and keeps the conversation. |

The harness is written by hand on purpose, to keep every request, reply and stop reason in view, and it is the only thing the mentor runs on: the user brings an API key for the model they pick ([ADR 0022](docs/adr/0022-one-harness-and-the-user-brings-a-key.md)). A dependency is taken when it saves real code that would teach nothing ([ADR 0021](docs/adr/0021-a-dependency-is-allowed-when-it-saves-real-code.md)); today there are none. [`docs/reference.md`](docs/reference.md) lists the harnesses read for ideas along the way.

## How it's made

The code is written by coding agents. Each feature goes through the same steps:

1. Open questions are researched against primary sources, and the findings are kept in [`docs/research/`](docs/research/).
2. Each design question is settled with the maintainer and recorded in [`docs/adr/`](docs/adr/), with new terms added to [`GLOSSARY.md`](GLOSSARY.md).
3. The work is written up as a spec issue and split into issues marked `ready-for-agent`.
4. An agent builds each issue test-first, under the rules in [`AGENTS.md`](AGENTS.md).

## Reading the project

1. [`GLOSSARY.md`](GLOSSARY.md): the words used in the code, the tests and the docs.
2. [`docs/adr/`](docs/adr/): one record per decision, in order. Each says what was chosen, what else was considered and why. Records that were replaced stay, marked as superseded.
3. [`docs/research/`](docs/research/): the notes written before a decision, with their sources, the versions checked, and which facts are verified and which are not.
4. The code, from the inside out: `packages/harness` → `packages/tools` → `packages/mentor` → `apps/cli`.
5. [`AGENTS.md`](AGENTS.md): the working rules: package boundaries, test-first, and the three kinds of test.

Some trails from question to decision to work:

- **How a turn ends:** [ADR 0005](docs/adr/0005-the-loop-returns-a-result-and-never-throws.md) (the loop never throws) → [ADR 0006](docs/adr/0006-cancelling-a-turn.md) (cancelling) → [`agent-loop.ts`](packages/harness/src/agent-loop.ts).
- **How the mentor reaches Live:** [connecting to Ableton Live](docs/research/connecting-to-ableton-live.md) → [ADR 0012](docs/adr/0012-live-is-reached-through-the-ableton-js-remote-script.md) → [#2](https://github.com/amitbaz/music-production-ai-mentor/issues/2).
- **What the first real tool set covers:** [what Live lets a script do](docs/research/what-live-lets-a-script-do.md) and [reaching third-party plug-ins](docs/research/reaching-third-party-plug-ins.md) → [ADR 0013](docs/adr/0013-ableton-tools-are-a-short-named-list-plus-two-general-tools.md) and [ADR 0015](docs/adr/0015-the-first-real-ableton-tool-set-has-a-narrow-scope.md) → the issues split from [#2](https://github.com/amitbaz/music-production-ai-mentor/issues/2).
- **Hearing the audio:** [how the agent can hear Live](docs/research/hearing-live-audio-and-where-the-agent-runs.md), researched and left for later by [ADR 0015](docs/adr/0015-the-first-real-ableton-tool-set-has-a-narrow-scope.md).

## License

[MIT](LICENSE)
