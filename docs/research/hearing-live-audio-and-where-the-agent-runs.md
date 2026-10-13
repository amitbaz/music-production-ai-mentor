# Research — how the agent can hear Live, and whether it should live inside or outside Live

Date: 2026-10-13 · Status: research note, not a decision

Versions this note was checked against: Live 12.4.6 (current release, 2026-09-15, [release notes](https://www.ableton.com/en/release-notes/live-12/)), Max 9.1.4 (bundled since Live 12.4, same page), Link 4.1 ([releases](https://github.com/Ableton/link/releases)), macOS 27. The machine this was written on has Live 12 Suite **12.3.2** with bundled Max **9.0.9**, and BlackHole 2ch installed (checked locally, see [Local observations](#local-observations)).

Markers used below: **[verified]** read in the linked primary source during this research · **[forum]** vendor forum, behaviour the vendor does not document · **[local]** observed on this machine · **[inferred]** my reasoning from verified facts, not stated by any source · **[unverified]** could not confirm.

## Short answer

1. **Hearing audio.** No control API gives samples. The Live Object Model exposes meters only. Real audio can leave Live four ways: **Link Audio** (first-party, Live 12.4+, every track plus the Main output, to any process on the same machine or LAN), a **Max for Live audio device** (sees the track it sits on plus routed inputs, can write audio files), **OS loopback capture** (Main output only), and **manual export** (cannot be triggered from the API).
2. **Architecture.** Keep the harness and the chat UI in an app outside Live. Do not build the chat inside a Max for Live device. Add audio as a small separate "ear" that feeds files to a tool:
   - first choice to prototype: a native **Link Audio receiver** sidecar, because it is the only option that gives per-track audio with no per-track setup, no Max for Live licence and no audio driver;
   - second choice, and the fallback if Link Audio disappoints: a **thin Max for Live audio device** on the Main track that records to disk on request.
3. This fits the repo as it is: ADR 0001 already defers "desktop app" and "real Ableton bridge", and ADR 0004 keeps `src/agent/` free of Ableton. Audio becomes one more tool in `src/ableton/` (for example `listen`, returning a file path and measured features), and the agent loop does not change.

The recommendation rests on three prototypes that have not been run yet. See [Prototypes to run](#prototypes-to-run).

## Options table

| Option | What you get | Per-track | Realtime | User setup | Needs | Main limits |
| --- | --- | --- | --- | --- | --- | --- |
| **Link Audio** receiver in an external process | PCM stream of any track, return or Main | Yes | Yes, with a set latency | Turn on Link + Link Audio in Live | Live 12.4+; native code using the Link SDK | 16-bit; GPLv2+ or a proprietary licence from Ableton; tap point undocumented |
| **M4L audio device** → file on disk | Float audio at the exact point in the device chain | Only where a device sits, plus routed extra inputs | Capture is realtime, hand-off is by file | Drop a device on a track | Suite, or Standard + Max for Live add-on | Signals cannot enter Node for Max or jweb directly; licence; hard to test |
| **LOM / Remote Script / control surface** | Peak meters only | Meters per track | Yes | Install a Remote Script | Any edition | No samples at all |
| **macOS Core Audio process tap** | Whatever Live's process plays to its output device | No | Yes | One permission prompt | macOS 14.2+; native helper | Main (and cue) mix only |
| **ScreenCaptureKit audio** | App or system audio | No | Yes | Screen recording permission | macOS 13+; native helper | Max 48 kHz; Main only; heavier permission |
| **BlackHole / aggregate device** | Loopback device any app can record | Only by manual multi-channel routing | Yes | Install driver, build a Multi-Output device, change Live's output | macOS | Most setup of all; fragile |
| **Windows WASAPI loopback** | System mix of a render endpoint, or one process tree | No | Yes | None | Windows 10 (process mode: build 20348+) | Shared mode only |
| **Export / resample** | Rendered files, Main or all tracks | Yes (export) | No | Manual menu command | Any edition | Export cannot be triggered from the LOM |
| **VST3 / AU plug-in** | Audio on its track (+ sidechain) | One instance per track | Yes | Install plug-in | Any edition; C++ toolchain | No LOM access; biggest build cost |

## Detail

### 1. Link Audio (new in Live 12.4)

This is the recent first-party feature the question asked about, and it changes the picture.

- Live 12.4 (2026-05-05) added Link Audio: "you can stream audio in real-time between Link peers in a shared session… Once enabled, all tracks with audio output can be received by Link peers." **[verified]** [Live 12 release notes, 12.4](https://www.ableton.com/en/release-notes/live-12/)
- From Live, "any track with an audio output can be sent, including audio tracks, instrument tracks, return tracks, and the Main output", and "a track is only sent over the network when a peer device is enabled to receive it." **[verified]** [Link Audio FAQ](https://help.ableton.com/hc/en-us/articles/25425913328924-Link-Audio-FAQ) (updated 2026-10-12)
- It works on one machine: "Link Audio works over localhost, allowing you to stream audio between multiple instances of Live or between Live and other Link Audio-enabled apps on the same computer… without additional routing software." **[verified]** same FAQ
- User setup is a toggle: Link on, then Link Audio on, in the Control Bar menu or Settings → Link. **[verified]** same FAQ; [Live manual 37.1](https://www.ableton.com/en/live-manual/12/synchronizing-with-link-tempo-follower-and-midi/)
- The manual says "Link and Link Audio are built into all Ableton products". **[verified]** [Live manual 37.1](https://www.ableton.com/en/live-manual/12/synchronizing-with-link-tempo-follower-and-midi/). Whether that includes Live Intro and Lite specifically: **[unverified]**.
- Third parties can receive. The open Link SDK added it in Link 4.0 (2026-05-04) and stabilised it in 4.1 (2026-09-23). **[verified]** [Link releases](https://github.com/Ableton/link/releases). The SDK is header-only C++: include `LinkAudio.hpp` instead of `Link.hpp`. A C API exists in `extensions/abl_link`. **[verified]** [Link README](https://github.com/Ableton/link/blob/master/README.md), [abl_link](https://github.com/Ableton/link/tree/master/extensions/abl_link)
- API shape: a peer lists the session's channels, constructs a `LinkAudioSource` for a channel id, and gets buffers in a callback on a Link-managed thread. "Audio buffers are interleaved and samples are represented as 16-bit signed integers"; a channel is mono or stereo and each buffer carries its sample rate and beat-time mapping. A sink sends only while a matching source exists. **[verified]** [LinkAudio.hpp](https://github.com/Ableton/link/blob/master/include/ableton/LinkAudio.hpp), [Link docs](https://ableton.github.io/link/)
- Licence: "dual licensed under GPLv2+ and a proprietary license"; proprietary use means contacting Ableton. **[verified]** [Link README](https://github.com/Ableton/link/blob/master/README.md)
- Latency is audio buffer size plus transit, managed by a Latency slider in Live. **[verified]** [Link Audio FAQ](https://help.ableton.com/hc/en-us/articles/25425913328924-Link-Audio-FAQ). For an agent that listens to a few bars and then thinks for seconds, this does not matter. **[inferred]**

What it cannot do, or what is not known:

- 16-bit integer samples, where Live's own engine and a Max for Live device work in float. Enough for analysis; not a bit-exact copy. **[inferred]** from the header.
- Where in the track the signal is tapped (pre or post fader, pre or post mixer) is not stated in the FAQ, manual or SDK. **[unverified]**
- It is a stream: the agent only hears while Live is producing audio. There is no "give me bars 9–17" without playing them. **[inferred]**
- Turning on Link joins a Link session, so another Link app on the network could change Live's tempo. **[inferred]** from how Link is described in the [manual](https://www.ableton.com/en/live-manual/12/synchronizing-with-link-tempo-follower-and-midi/).
- This repo has no dependencies and runs on Node (ADR 0001). The SDK is C++, so the receiver would be a small native sidecar that writes WAV files or a pipe, or a Node native addon. A third-party Node binding exists ([jgusta/node-ableton-link-audio](https://github.com/jgusta/node-ableton-link-audio), built on the 4.0.0b1 pre-release); not evaluated. **[unverified]**
- This machine has Live 12.3.2, so Link Audio needs an update to 12.4 or later first. **[local]**

### 2. Max for Live audio device

What gives you the signal:

- `plugin~` "receives its input from the Live application as part of a Max for Live audio device"; `plugout~` sends audio back. Up to 64 input channels can be declared; the default is 2. **[verified]** [plugin~](https://docs.cycling74.com/reference/plugin~), [plugout~](https://docs.cycling74.com/reference/plugout~)
- So a device on the Main track hears the Main track's signal at its position in the device chain, before the Main fader. **[inferred]** from the above plus Live's signal flow.

Seeing other tracks:

- A Max device has extra input buses. The LOM `MaxDevice` has `audio_inputs` and `audio_outputs`, lists of `DeviceIO`, and each `DeviceIO` has `available_routing_types`, and settable `routing_type` and `routing_channel`. So one device can pull audio from other tracks into its extra `plugin~` channels, and the routing can be set from code. **[verified]** [MaxDevice](https://docs.cycling74.com/apiref/lom/maxdevice/), [DeviceIO](https://docs.cycling74.com/apiref/lom/deviceio/). How many tracks this handles well in practice, and how it behaves with latency compensation: **[unverified]**.
- `send~` / `receive~` between Max for Live devices is "not supported". **[verified]** [Max for Live limitations](https://docs.cycling74.com/userguide/m4l/live_limitations/)
- The Live API gives no audio for other tracks, only meters (next section).

Getting audio out of Max to another process:

| Route | Works? | Notes |
| --- | --- | --- |
| `sfrecord~` to disk | Yes | Writes AIFF (default), WAVE, FLAC, OGG or raw, 1–64 channels. Its `loop` message "begins a recording that captures the most recent audio in the specified amount of time", which is a ready-made "last N seconds" recorder. **[verified]** [sfrecord~](https://docs.cycling74.com/reference/sfrecord~) |
| `record~` → `buffer~` → write | Yes | `record~` records a signal into a `buffer~`, which stores samples "to be saved, edited, or referenced". **[verified]** [record~](https://docs.cycling74.com/reference/record~), [buffer~](https://docs.cycling74.com/reference/buffer~) |
| Node for Max (`node.script`) | Not for signals | `node.script` "control[s] a local Node.js process from Max" and accepts messages and dictionaries. Its reference lists no signal input. **[verified]** [node.script](https://docs.cycling74.com/reference/node.script), [Node for Max API](https://docs.cycling74.com/apiref/nodeformax/). Audio would have to arrive as a file path, or as lists of numbers. |
| Samples as Max messages (`snapshot~`, JS `Buffer.peek()`, lists) | Poorly | Max handles events on a high-priority scheduler or a low-priority (main thread) queue, and throttles the queue. **[verified]** [Scheduler](https://docs.cycling74.com/userguide/scheduler/). JS can read a `buffer~` via the `Buffer` class. **[verified]** [JS Buffer](https://docs.cycling74.com/apiref/js/buffer/). Pushing 44,100 values per second per channel through that path is the wrong tool; fine for a few analysis numbers per second. **[inferred]** |
| `udpsend` | For control and small data | "Objects like udpreceive and udpsend will still work, but integrated OSC support will not be functional" with only a Max for Live licence. **[verified]** [limitations](https://docs.cycling74.com/userguide/m4l/live_limitations/) |
| jweb | Not for signals | CEF "runs in a separate process from the rest of Max", messages are asynchronous and arrive on the low-priority queue. It can exchange messages, dictionaries and Jitter matrices. **[verified]** [Web Browser guide](https://docs.cycling74.com/userguide/web_browser/) |
| Shared memory, mc.*, Jitter matrix packing | Possible in principle | No vendor doc found that describes this as a supported way to hand audio to another process. **[unverified]** |

Practical conclusion: the Max-side job is "record a window of audio to a WAV and tell the outside world the path". Everything else is fighting the environment. **[inferred]**

Cost: Ableton's own guidelines ask developers to measure a device's CPU load in a musical context and to set its latency so Live can compensate. **[verified]** [Max for Live Production Guidelines](https://github.com/Ableton/maxdevtools/blob/main/m4l-production-guidelines/m4l-production-guidelines.md). That a device's MSP processing shares Live's audio processing, and whether `sfrecord~` disk writes can cause dropouts in a busy Set: **[unverified]**.

### 3. Live Object Model, Python Remote Scripts, control surfaces

- The LOM `Track` has `output_meter_left` / `output_meter_right` ("smoothed momentary peak value… 0.0 to 1.0"), `output_meter_level` ("hold peak value… the hold time is 1 second"), and the matching `input_meter_*`. The docs warn that the left/right meters "add a significant load to Live GUI resource usage". There is no property or function that returns samples. **[verified]** [LOM Track](https://docs.cycling74.com/apiref/lom/track/)
- Ableton does not publish a reference for the Python Remote Script API and gives no support for third-party scripts. **[verified]** [Installing third-party remote scripts](https://help.ableton.com/hc/en-us/articles/209072009-Installing-third-party-remote-scripts). That it has no audio access is therefore **[inferred]**: the projects that wrap it expose the same meters and nothing more ([AbletonOSC](https://github.com/ideoforms/AbletonOSC/blob/master/README.md) lists `/live/track/get/output_meter_left|right|level`).
- Meters are still useful as cheap context for the agent ("which tracks are loud right now"), just not as hearing. **[inferred]**

How existing projects reach Live's state and control, for reference. All three are a Python Remote Script plus a local socket, and none carries audio:

- AbletonOSC: OSC on port 11000, Live 11+. **[verified]** [README](https://github.com/ideoforms/AbletonOSC/blob/master/README.md)
- ableton-js: WebSocket on `127.0.0.1:39031`, Live 11+, TypeScript client. **[verified]** [README](https://github.com/leolabs/ableton-js/blob/master/README.md)
- ableton-mcp: socket server in the Remote Script, Python MCP server outside. **[verified]** [README](https://github.com/ahujasid/ableton-mcp/blob/main/README.md)

### 4. OS-level capture from outside Live

All of these capture what Live sends to its audio device, so they give the Main mix (plus cue if it shares the device) and never individual tracks. **[inferred]**

macOS:

- **Core Audio taps.** `AudioHardwareCreateProcessTap` is available from macOS 14.2. A tap "can specify which outputs it captures from a process or group of processes" with mono or stereo mixdown, can be private to the creating process, and can mute the process's normal output. You read it by adding the tap to a HAL aggregate device. The app needs `NSAudioCaptureUsageDescription` in its Info.plist and "the system prompts you to grant the app system audio recording permission" on first use. **[verified]** [Capturing system audio with Core Audio taps](https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps), [AudioHardwareCreateProcessTap](https://developer.apple.com/documentation/coreaudio/audiohardwarecreateprocesstap(_:_:)), [CATapDescription](https://developer.apple.com/documentation/coreaudio/catapdescription)
  This needs a small native helper with a bundle and Info.plist; a plain `node` process cannot do it alone. **[inferred]**
- **ScreenCaptureKit.** `capturesAudio` exists from macOS 13; supported sample rates are 8, 16, 24 and 48 kHz; the app must request screen recording permission. **[verified]** [capturesAudio](https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration/capturesaudio), [sampleRate](https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration/samplerate), [ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit). A heavier permission than the tap for the same Main-only result. **[inferred]**
- **BlackHole.** A virtual loopback driver with "zero additional driver latency", 32-bit float, 2/16/64/128/256-channel builds, no kernel extension. To hear and capture at once the user builds a Multi-Output Device in Audio MIDI Setup; aggregates need drift correction or they glitch. "A license is required for all non-GPLv3 projects". **[verified]** [BlackHole README](https://github.com/ExistentialAudio/BlackHole/blob/master/README.md). Per-track capture would mean a multi-channel build and routing each track to its own external output by hand. **[inferred]** BlackHole 2ch is already installed here. **[local]**
- Loopback (Rogue Amoeba) was not researched. **[unverified]**

Windows:

- WASAPI loopback captures "the audio stream that is being played by a rendering endpoint device", in shared mode only. **[verified]** [Loopback Recording](https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording)
- Per-process capture ("a specific process and any of its child processes") needs Windows 10 build 20348 or later. **[verified]** [Application loopback sample](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/)
- If Live uses an ASIO driver, its audio may not pass through the shared-mode engine that loopback reads. **[inferred]**, to be tested on Windows.
- Core Audio taps, ScreenCaptureKit and BlackHole are macOS only; Link Audio and Max for Live are the same on both platforms. **[inferred]** from the vendors' platform lists.

### 5. Rendering and export (offline)

- Export Audio/Video (File menu, Cmd/Ctrl-Shift-R) renders Main, "All Individual Tracks" (a file per track, including groups, returns and Main, all the same length), or selected tracks. **[verified]** [Live manual 5.1.3](https://www.ableton.com/en/live-manual/12/managing-files-and-sets/)
- The LOM has no export, render, bounce or freeze function. `Song`, `Track` and `Application` function lists were read in full; `Track` only has read-only `can_be_frozen` / `is_frozen`. **[verified]** [Song](https://docs.cycling74.com/apiref/lom/song/), [Track](https://docs.cycling74.com/apiref/lom/track/), [Application](https://docs.cycling74.com/apiref/lom/application/)
- So export can only be driven by the user, or by scripting the UI (keystrokes and dialogs), which is brittle. **[inferred]**
- A programmable middle path: Live can route its Main output into an audio track ("Resampling"), and a track can tap another track Pre FX, Post FX or Post Mixer. **[verified]** [Live manual 17.4–17.5](https://www.ableton.com/en/live-manual/12/routing-and-i-o/). The LOM can set `input_routing_type` and `arm` on a track, and `Clip` has a `file_path` property. **[verified]** [Track](https://docs.cycling74.com/apiref/lom/track/), [Clip](https://docs.cycling74.com/apiref/lom/clip/). So the agent could create a track, record into it and read the resulting file. It works in real time, changes the user's Set, and has not been tried. **[inferred]**

### 6. VST3 / AU plug-in, briefly

A plug-in receives the audio of the track it is on and can have a sidechain input (the Live manual has a "Sidechain Parameters" section for plug-ins, [chapter 24](https://www.ableton.com/en/live-manual/12/working-with-instruments-and-effects/); section text not read, **[unverified]**). It can open any window and embed a real web view, needs no Max for Live licence, and works in other DAWs. It has no access to the LOM, so it cannot control Live, and it means a C++ toolchain, code signing and notarisation. For this project it only beats a Max for Live device if the product must work on Standard/Intro without Link Audio, or in other hosts. **[inferred]**

### 7. Chat UI inside a Max for Live device

- Size: "The height of all Live devices is fixed at 169 pixels"; width is free. **[verified]** [User Interfaces in Max for Live](https://docs.cycling74.com/userguide/m4l/live_userinterfaces/)
- Pop-out windows are possible with a subpatcher opened by `pcontrol`, but Ableton's guidelines say "this is ideally avoided", and that such windows should be floating or they pull Live out of full-screen. **[verified]** [Max for Live Production Guidelines, Pop-out Windows](https://github.com/Ableton/maxdevtools/blob/main/m4l-production-guidelines/m4l-production-guidelines.md)
- `jweb` embeds Chromium (CEF) in a Max UI object, talks to the patch through `window.max` (`bindInlet`, `outlet`, dictionaries), and can be debugged from Chrome's remote inspector. **[verified]** [jweb](https://docs.cycling74.com/reference/jweb), [Web Browser guide](https://docs.cycling74.com/userguide/web_browser/). So a web chat UI can technically be shown in a device or a pop-out.
- Keyboard focus is the real problem. A developer reports that on macOS, typing in a jweb text area inside a Max for Live device also triggers Live's shortcuts (space starts playback, "a" toggles automation mode), that Cmd shortcuts such as copy do nothing in the page, that `preventDefault` does not help, and that a floating pop-out does not fix it because Live keeps focus. Cycling '74 support replied "This is a known issue that we have ticketed… I can't say if or when this will be fixed". `textedit` objects "work as expected", and Windows is reported fine. **[forum]** [Cycling '74 forum thread](https://cycling74.com/forums/any-way-to-prevent-max-jweb-object-from-passing-all-keyboard-input-through-to-live) (post date and versions not shown)
- Max 9.0.8 lists "jweb: appropriately intercepts keys when it has focus". **[verified]** [Max 9.0.8 release notes](https://cycling74.com/releases/max/9.0.8). Whether that fixes the in-Live case is **[unverified]**; Live 12.3.2 here bundles 9.0.9 so it can be tested directly.
- Without jweb, the UI is `textedit` for input and Max UI objects for output, inside 169 px. A scrolling, streaming, Markdown chat transcript in that is not realistic. **[inferred]**
- Networking: `node.script` (full Node process), `maxurl` ("Make HTTP requests"), or the page inside jweb. **[verified]** [node.script](https://docs.cycling74.com/reference/node.script), [maxurl](https://docs.cycling74.com/reference/maxurl)
- Node runtime: Node for Max ships its own Node and npm; `node_bin_path` can override "the one included". **[verified]** [node.script](https://docs.cycling74.com/reference/node.script). The bundled binary in Max 9.0.9 reports **v20.6.1**. **[local]** The version in Max 9.1.4: **[unverified]**.
- That matters for this repo: ADR 0001 runs `.ts` files directly on Node 22, and type stripping is on by default only from Node 22.18. **[verified]** [Node 22 TypeScript docs](https://nodejs.org/docs/latest-v22.x/api/typescript.html). The current harness would not run unchanged inside `node.script`; it would need a build step or a pinned external Node. **[inferred]**
- Distribution: a device is shared frozen (`.amxd` with its dependencies). "You should include node_modules in any Standalone, Collective or frozen Max for Live Device". **[verified]** [Sharing Max for Live Devices](https://docs.cycling74.com/userguide/m4l/live_sharing/), [Node for Max, using npm (Max 8 docs)](https://docs.cycling74.com/legacy/max8/vignettes/02_n4m_usingnpm)
- Licence: "Max for Live is included by default in Live Suite and can be purchased as an additional add-on for Live Standard… not supported within Live Lite or Intro." **[verified]** [Buying Max for Live](https://help.ableton.com/hc/en-us/articles/206407124-Buying-Max-for-Live), [Compare editions](https://www.ableton.com/en/live/compare-editions/), [Live manual 32.1](https://www.ableton.com/en/live-manual/12/max-for-live/)
- Secrets: a frozen device carries its files with it, so an API key must not be saved in the device. It would have to be read at runtime from a file or environment outside the Set, which is the same `.env` approach the repo uses today, with more moving parts. **[inferred]**

### 8. Architecture comparison

| | External app (today's direction) | Chat inside an M4L device | Hybrid: external app + thin ear inside or beside Live |
| --- | --- | --- | --- |
| Audio access | Link Audio: all tracks + Main. OS tap: Main only. | Track it sits on, plus routed inputs, float | Same as the best of both |
| Live state and control | Needs a bridge (Remote Script, as AbletonOSC / ableton-js do) | LOM directly from the device | Bridge of choice; the ear does not have to be the bridge |
| UI quality | Anything: terminal now, Tauri/Electron later (ADR 0001) | 169 px strip or a pop-out; jweb keyboard problem on macOS | Same as external |
| Dev and debugging | Node 22, plain `.ts`, terminal | Max patcher + bundled Node 20.6.1 + CEF | Agent stays simple; the ear is small |
| Testability | `node --test` with the scripted provider and fake Ableton | Patches are not unit-testable in that way | Agent fully testable; ear tested by hand and by file output |
| Install friction | Run an app; toggle Link Audio or grant one permission | Drag one `.amxd` | App plus a toggle, or app plus one `.amxd` |
| Licence needed | None beyond Live (Link Audio: 12.4+) | Suite or Standard + add-on | None with Link Audio; Suite/add-on with the M4L ear |
| Robustness | A crash cannot take Live down | Runs inside Live; release notes list Live crashes caused by Max devices ([12.4.x notes](https://www.ableton.com/en/release-notes/live-12/)) | Only the thin part is inside Live |
| Fit with this repo | Direct: tools replace the fake Ableton (ADR 0001), harness untouched (ADR 0004) | Poor: runtime mismatch, UI rewrite, no terminal | Direct |

### What the model can actually use

The first provider adapter is Gemini (ADR 0002). Gemini accepts WAV, MP3, FLAC and others, inline or by upload, at "32 tokens per second of audio", but audio is "downsampled to 16 Kbps" and "multi-channel audio combined to single channel". **[verified]** [Gemini API audio docs](https://ai.google.dev/gemini-api/docs/audio)

So sending raw audio to the model gives it a rough, mono impression. Anything about stereo width, low-end balance, loudness or clipping has to be measured locally and passed as numbers in the tool result. That favours a file-based hand-off (record a window, analyse it, optionally attach it) over a live stream, and it means low latency is not a requirement. **[inferred]**

## Recommendation

1. **Keep the agent and the UI outside Live.** The chat-in-a-device option loses on UI, testing, runtime fit and licence, and its only real gain (the device is "in" the Set) can be had with a thin device that has no UI.
2. **Treat hearing as a tool that returns a file and measurements**, not as a stream into the model.
3. **Prototype Link Audio first** as the source of that file: one native receiver that subscribes to a named channel (Main or a track), records N seconds to WAV and exits. It needs Live 12.4+, and it puts a GPLv2+ component next to the harness, which is fine for an open portfolio project and needs a decision if the project is ever closed-source.
4. **Keep the thin Max for Live device as the planned fallback**, and as the upgrade if float quality or a precise tap point turns out to matter: `plugin~` → `sfrecord~`, triggered over `udpreceive` or `node.script`.
5. **Do not start with OS loopback.** It needs native code too and only ever yields the Main mix.
6. Live's state and control is a separate question from audio. The existing pattern is a Remote Script with a local socket; this note does not choose between that and a Max for Live LOM bridge.

This does not contradict any ADR. It adds a native component, which ADR 0001's "no dependencies" did not anticipate; that is worth its own ADR once a prototype has been chosen.

## Prototypes to run

1. **Link Audio receiver.** Update Live to 12.4+. Build `LinkAudioHut` from the Link repo ([examples](https://github.com/Ableton/link/tree/master/examples)), confirm the Main output and individual tracks appear as channels on localhost, record 10 s to WAV. Answers: is Main really there, what is the tap point (compare against an export), sample rate, CPU cost, does enabling Link disturb tempo in a normal Set, does it work on Live Standard/Intro.
2. **Node hand-off.** Decide sidecar binary vs native addon by trying the smallest version of each; check the third-party Node binding only as a reference.
3. **M4L ear.** An audio device with `plugin~` → `sfrecord~` (`loop` mode for "the last 8 bars") on the Main track, triggered by a UDP message, writing WAV to a known folder. Answers: does disk writing cause dropouts, where a frozen device may write, does routing a second track into `audio_inputs` work from code.
4. **jweb typing test**, only if an in-Live UI is still wanted: a text area in a jweb in a device and in a floating pop-out, on this machine's Max 9.0.9 and on 9.1.4. Type a space and an "a".
5. **Model usefulness.** Send the same 10 s clip to Gemini as audio, and as locally measured numbers, and compare what the agent can say about a mix.
6. **Core Audio tap spike**, only if both 1 and 3 fail: Apple's sample project pointed at Live's process.

## Open questions

- Link Audio tap point, and whether muted or soloed tracks still send.
- Whether the Link proprietary licence is obtainable for a small project, if GPL becomes a problem.
- Node version bundled with Max 9.1.4.
- Whether the Remote Script API has anything the LOM docs do not show (not expected; undocumented by Ableton).
- Windows behaviour of every option; nothing here was tested on Windows.

## Local observations

Checked on this machine on 2026-10-13:

- `/Applications/Ableton Live 12 Suite.app` reports version 12.3.2 (2025-12-15 build).
- Its bundled `Max.app` reports 9.0.9; `…/packages/Node for Max/source/bin/osx/node/node --version` prints `v20.6.1`.
- `/Library/Audio/Plug-Ins/HAL/BlackHole2ch.driver` is present.
- macOS 27.0.1.

## Sources

Ableton
- [Live 12 release notes](https://www.ableton.com/en/release-notes/live-12/) (12.4 Link Audio; bundled Max versions)
- [Link Audio FAQ](https://help.ableton.com/hc/en-us/articles/25425913328924-Link-Audio-FAQ) (read through the Help Centre API; the HTML page refuses automated fetches)
- [Live manual: Synchronizing with Link…](https://www.ableton.com/en/live-manual/12/synchronizing-with-link-tempo-follower-and-midi/), [Routing and I/O](https://www.ableton.com/en/live-manual/12/routing-and-i-o/), [Managing Files and Sets](https://www.ableton.com/en/live-manual/12/managing-files-and-sets/), [Max for Live](https://www.ableton.com/en/live-manual/12/max-for-live/)
- [Buying Max for Live](https://help.ableton.com/hc/en-us/articles/206407124-Buying-Max-for-Live), [Max for Live bundled in Live](https://help.ableton.com/hc/en-us/articles/360000036850-Max-for-Live-bundled-in-Live), [Compare editions](https://www.ableton.com/en/live/compare-editions/)
- [Installing third-party remote scripts](https://help.ableton.com/hc/en-us/articles/209072009-Installing-third-party-remote-scripts)
- [Ableton/link](https://github.com/Ableton/link): [README](https://github.com/Ableton/link/blob/master/README.md), [LinkAudio.hpp](https://github.com/Ableton/link/blob/master/include/ableton/LinkAudio.hpp), [releases](https://github.com/Ableton/link/releases), [docs](https://ableton.github.io/link/)
- [Ableton/maxdevtools: Max for Live Production Guidelines](https://github.com/Ableton/maxdevtools/blob/main/m4l-production-guidelines/m4l-production-guidelines.md)

Cycling '74
- Reference: [plugin~](https://docs.cycling74.com/reference/plugin~), [plugout~](https://docs.cycling74.com/reference/plugout~), [sfrecord~](https://docs.cycling74.com/reference/sfrecord~), [record~](https://docs.cycling74.com/reference/record~), [buffer~](https://docs.cycling74.com/reference/buffer~), [node.script](https://docs.cycling74.com/reference/node.script), [jweb](https://docs.cycling74.com/reference/jweb), [maxurl](https://docs.cycling74.com/reference/maxurl)
- Guides: [Max for Live limitations](https://docs.cycling74.com/userguide/m4l/live_limitations/), [User Interfaces in Max for Live](https://docs.cycling74.com/userguide/m4l/live_userinterfaces/), [Sharing Max for Live Devices](https://docs.cycling74.com/userguide/m4l/live_sharing/), [Web Browser](https://docs.cycling74.com/userguide/web_browser/), [Scheduler](https://docs.cycling74.com/userguide/scheduler/), [Node for Max: using npm (Max 8)](https://docs.cycling74.com/legacy/max8/vignettes/02_n4m_usingnpm)
- API: [LOM Track](https://docs.cycling74.com/apiref/lom/track/), [Song](https://docs.cycling74.com/apiref/lom/song/), [Application](https://docs.cycling74.com/apiref/lom/application/), [Clip](https://docs.cycling74.com/apiref/lom/clip/), [MaxDevice](https://docs.cycling74.com/apiref/lom/maxdevice/), [DeviceIO](https://docs.cycling74.com/apiref/lom/deviceio/), [Node for Max API](https://docs.cycling74.com/apiref/nodeformax/), [JS Buffer](https://docs.cycling74.com/apiref/js/buffer/)
- [Max 9.0.8 release notes](https://cycling74.com/releases/max/9.0.8)
- Forum (undocumented behaviour): [jweb passing keyboard input through to Live](https://cycling74.com/forums/any-way-to-prevent-max-jweb-object-from-passing-all-keyboard-input-through-to-live)

Apple, Microsoft, others
- [Capturing system audio with Core Audio taps](https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps), [AudioHardwareCreateProcessTap](https://developer.apple.com/documentation/coreaudio/audiohardwarecreateprocesstap(_:_:)), [CATapDescription](https://developer.apple.com/documentation/coreaudio/catapdescription)
- [ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit), [capturesAudio](https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration/capturesaudio), [sampleRate](https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration/samplerate)
- [WASAPI Loopback Recording](https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording), [Application loopback audio capture sample](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/)
- [BlackHole README](https://github.com/ExistentialAudio/BlackHole/blob/master/README.md)
- [AbletonOSC README](https://github.com/ideoforms/AbletonOSC/blob/master/README.md), [ableton-js README](https://github.com/leolabs/ableton-js/blob/master/README.md), [ableton-mcp README](https://github.com/ahujasid/ableton-mcp/blob/main/README.md)
- [Gemini API: audio understanding](https://ai.google.dev/gemini-api/docs/audio)
- [Node.js 22: TypeScript](https://nodejs.org/docs/latest-v22.x/api/typescript.html)
