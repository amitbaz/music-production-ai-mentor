<p align="center">
  <img src="docs/logo.svg" alt="Music Production AI Mentor logo: headphones around a speech bubble" width="160">
</p>

<h1 align="center">Music Production AI Mentor</h1>

<p align="center"><em>Ask about your track. Learn why. Make it better.</em></p>

<p align="center">
  <a href="https://github.com/amitbaz/music-production-ai-mentor/actions/workflows/check.yml"><img src="https://img.shields.io/github/actions/workflow/status/amitbaz/music-production-ai-mentor/check.yml?branch=main&label=tests" alt="Tests"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/amitbaz/music-production-ai-mentor" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522.18-339933?logo=nodedotjs&logoColor=white" alt="Node 22.18 or newer">
  <img src="https://img.shields.io/badge/Ableton%20Live-12.4%2B%20%C2%B7%20macOS-000000?logo=apple&logoColor=white" alt="Ableton Live 12.4 or newer, macOS">
</p>

Your AI music production mentor. Ask it about your track: it looks inside your Ableton Live Set, explains what's going on, and helps you make it better, so you learn as you go.

> **Status: early and in active development.** Works with Ableton Live 12.4+ on macOS, in the terminal. Expect rough edges; the full list of what works today is in [docs/features.md](docs/features.md).

```text
you> My kick and bass feel muddy together. What's going on?

⏺ read_set({})
⏺ read_tracks({"tracks":["t1","t2"]})

mentor> Your bass sits 3 dB above the kick and both reach down to the same low
notes, so they fight for the same space. I can't hear the track, so this comes
from the settings, not the sound. Want me to bring the bass down a little?

you> Yes, do it.

⏺ set_parameters({"changes":[{"target":"t2","parameter":"Volume","value":-7}]})

mentor> Done:
  Bass / Volume: -4.0 dB → -7.0 dB
The kick now leads the low end. Listen to the drop: if the bass feels too thin,
ask me to take it back.
```

<sub>A shortened example of a session in the terminal.</sub>

## Why use it

- **It works on your own Live Set.** A chatbot gives general advice from a screenshot. The mentor reads your tracks, devices, clips and arrangement, so its answer is about your song.
- **It teaches, not just does.** Ask *how* or *why* and it explains. Ask it to do something and it does it, then shows every change as `before → after` and says why, so you can learn from it and undo it.
- **It's careful with your work.** It reads before it changes anything, asks before it deletes, and says plainly when an answer depends on the sound.
- **It's built as a mentor, not a remote control.** Ableton MCP servers let a general assistant drive Live. Here the instructions, the tools and the tests are all made for teaching production, and changes to how it behaves are tested on real Live Sets before they're kept ([evals](evals/README.md)).
- **You choose the model.** Bring your own API key for Gemini (free tier available) or Claude.

## What it can do

- Read the whole Live Set: tracks, devices and their settings, clips, notes and the arrangement.
- Change device parameters and the mixer: volume, pan, sends, any native device setting, and the plug-in settings Live gives.
- Build tracks and effect chains, and load devices, presets and samples from Live's browser.
- Edit the arrangement: place, copy and move clips, add locators, write MIDI notes.
- Control the transport: play, stop, loop, tempo, metronome.
- Show you what it's talking about by selecting the track, device or clip in Live.

The full list, with every tool and its limits, is in [docs/features.md](docs/features.md).

## What it can't do yet

- **Hear your music.** It sees the settings, the notes and the arrangement, not the audio. It will say so instead of guessing.
- **Every setting of a third-party plug-in.** It reads and changes the settings Live gives it, up to 128; for the rest it gives you the steps.
- **Automation, freezing, splitting clips.** For these it gives you the steps to do by hand.
- **Run outside the terminal, or on Windows.** A desktop app is planned.

## Quick start

You need:

- [Node.js](https://nodejs.org) 22.18 or newer, and [pnpm](https://pnpm.io)
- A [Gemini API key](https://aistudio.google.com/apikey) (free), or an [Anthropic API key](https://console.anthropic.com/settings/keys) for Claude
- [Ableton Live](https://www.ableton.com/live/) 12.4 or newer, on macOS

**1. Install and add your key**

```sh
git clone https://github.com/amitbaz/music-production-ai-mentor.git
cd music-production-ai-mentor
pnpm install
cp apps/cli/.env.example apps/cli/.env   # then set GEMINI_API_KEY (or ANTHROPIC_API_KEY) in it
```

**2. Connect it to Live (once)**

```sh
pnpm pair ableton
```

Then restart Live, open **Settings → Link, Tempo & MIDI**, and choose `MusicMentor` as a Control Surface.

**3. Start talking**

```sh
pnpm start                                    # Gemini
pnpm start --model claude:claude-haiku-5-5    # or Claude
```

Open a Live Set and ask it anything. Type `exit` to quit; Ctrl+C stops the current answer.

<details>
<summary>What <code>pnpm pair ableton</code> does</summary>

It copies the [ableton-js](https://github.com/leolabs/ableton-js) 5.0.4 Remote Script, with one Python file of ours and a few lines changed to load it, to `~/Music/Ableton/User Library/Remote Scripts/MusicMentor`, and writes a new random password into the script and into `apps/cli/.env`. Running it again replaces both.

If you installed `AbletonJS` by hand before, choose `MusicMentor` in its slot instead: both listen on the same port, and `AbletonJS` has no password. `ABLETON_ADDRESS` in `apps/cli/.env` sets where the script listens (default `ws://127.0.0.1:39031`).

</details>

## Uninstall

1. Run `pnpm unpair ableton`. It removes the `MusicMentor` Remote Script and its password, and leaves the rest of Live's Remote Scripts folder alone.
2. In Live, **Settings → Link, Tempo & MIDI**: set that Control Surface to None, then restart Live.
3. Delete the repo's folder.

## Roadmap

- **Listening** ([#50](https://github.com/amitbaz/music-production-ai-mentor/issues/50)): let the mentor hear your mix, so its advice is based on the sound.
- **Memory across conversations** ([#20](https://github.com/amitbaz/music-production-ai-mentor/issues/20)): it remembers your preferences.
- **A `mentor` command** ([#37](https://github.com/amitbaz/music-production-ai-mentor/issues/37)): run it from any folder.
- **Every setting of a third-party plug-in**: past what Live gives a script.
- **A desktop app**, next to the terminal one.

More, with links to each issue, in [docs/features.md](docs/features.md#planned).

## Contributing

The mentor runs on its own hand-written, provider-agnostic agent harness in TypeScript. [CONTRIBUTING.md](CONTRIBUTING.md) explains how the code is laid out, how features are designed and built, and where to start reading.

## License

[MIT](LICENSE)
