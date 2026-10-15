# Research — how audio leaves Live with no per-track device

Date: 2026-10-15 · Status: research note, not a decision · Resolves [#51](https://github.com/amitbaz/music-production-ai-mentor/issues/51), part of map [#50](https://github.com/amitbaz/music-production-ai-mentor/issues/50)

Starts from [hearing-live-audio-and-where-the-agent-runs.md](./hearing-live-audio-and-where-the-agent-runs.md) (2026-10-13). Its path survey stands and is not repeated; this note goes deeper on the four things the mentor must hear, on the receivers that exist, and on the licence question.

Checked against: Live 12.4.6 (release notes), Link 4.1 (2026-09-23), Max 9.1.5, macOS 27.0.1. This machine now has **Live 12.4.6 and Max 9.1.5** (the earlier note saw 12.3.2), so Link Audio can be tried here without an update. **[local]**

Markers: **[verified]** read in the linked primary source · **[third-party]** stated by a project that is not the vendor · **[local]** observed on this machine · **[inferred]** my reasoning from verified facts · **[unverified]** could not confirm.

## Short answer

- **Prototype first: a Link Audio receiver sidecar.** It is the only path that gives every track and the Main with no device anywhere, and each buffer it receives carries the Link beat time, so cutting a window by bar is a matter of reading a number. A ring buffer in the sidecar gives "the last N bars" for free. The cost is one small C++ program (GPLv2+, separate process, separate licence file) next to the MIT repo; no npm package exists to depend on.
- **Fallback: a Core Audio process tap through the `audiotee` npm package** (MIT, prebuilt Swift binary, macOS 14.2+). Zero Live-side setup, no GPL, but Main only: a single track means soloing it. If per-track hearing ever needs float samples or an exact tap point, the one-device-on-Main Max for Live recorder from the earlier note is the upgrade, not the fallback.
- **Surprise: there is a fifth path with no device and no native code at all.** The Remote Script can create an audio track, set its input to any other track (Pre FX, Post FX, Post Mixer) or to Resampling (the Main), arm it and record; the clip then has a `file_path`. It covers three of the four requirements (not "the last N bars") at Live's own recording quality, but it edits the Set. Worth keeping as the no-install option, not as the first prototype.

## The four requirements against each path

Requirements: (1) the Main in stereo; (2) any single track alone with nothing added to that track; (3) a window placed by bar (`transport` can play, stop, jump and set the loop); (4) the last N bars already played, without replaying them.

| Path | 1. Main stereo | 2. One track, nothing added | 3. Window by bar | 4. Last N bars already played | Live-side setup | Native code / dependency | Licence next to MIT |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Link Audio receiver sidecar** | Yes: "Main output" is a channel **[verified]** | Yes: every track with audio output is a channel, nothing added to the track **[verified]**; tap point unknown **[unverified]** | Yes, precisely: each buffer carries session beat time and tempo **[verified]** | Yes: keep a source subscribed and ring-buffer in the sidecar **[inferred]** | Toggle Link + Link Audio once **[verified]** | One C++ file against the header-only SDK; no npm package exists **[verified]** | GPLv2+ sidecar as a separate program; repo stays MIT **[inferred from GPL FAQ]** |
| **Core Audio process tap (`audiotee`)** | Yes, with `--stereo` **[verified]** | Only by soloing the track (Live Object Model `solo`), then it is the Main **[inferred]** | By wall clock around `transport`, not by beat **[inferred]** | Yes: ring buffer of the PCM stream in our process **[inferred]** | None; one macOS permission prompt **[verified]** | npm `audiotee` 0.0.7, MIT, downloads a < 600 KB prebuilt Swift binary **[verified]** | MIT **[verified]** |
| **One Max for Live device on the Main** | Yes: `plugin~` on the Main **[verified]** | Solo + Main, or extra `plugin~` inputs routed from other tracks by the LOM **[verified]** that this works on a Main-track device **[unverified]** | Yes: `plugsync~` gives bar and beat inside the device **[verified]** | Yes: `sfrecord~ loop` keeps the most recent N seconds **[verified]** | Drop one `.amxd` on the Main; needs Suite or the M4L add-on | A Max patch, hard to test | Our own patch, any licence |
| **Live records it (LOM, no device)** | Yes: Input Type "Resampling" is the Main **[verified]** | Yes: Audio From any track, Pre FX / Post FX / Post Mixer **[verified]** | Yes: arm, play from bar, stop, read the clip's `file_path` **[verified]** | No: only what was recorded **[inferred]** | None; the mentor adds and removes a track **[inferred]** | None | None |
| **BlackHole / aggregate device** | Yes, after routing Live's output to it | Only by soloing, or by manual multi-channel routing | By wall clock | Ring buffer in our process | Install driver, build a Multi-Output device, change Live's output | Driver | "A license is required for all non-GPLv3 projects" (earlier note) |
| **ScreenCaptureKit** | Yes, max 48 kHz | Solo only | By wall clock | Ring buffer | Screen Recording permission | npm `screencapturekit-audio-capture` 1.3.6 (MIT, prebuilt arm64) **[verified]** | MIT |

"Nothing added to that track" is met by Link Audio, by the LOM recording path, and by the solo trick on every Main-only path. Solo changes what the user hears while the mentor listens, which is a product question for the map, not a blocker. **[inferred]**

## 1. Link Audio, deeper

### What Live sends

- Any track with an audio output can be sent: audio tracks, instrument tracks, return tracks and the Main output. A track is only sent over the network when a peer is enabled to receive it. **[verified]** [Link Audio FAQ](https://help.ableton.com/hc/en-us/articles/25425913328924-Link-Audio-FAQ) (updated 2026-10-15; read through the Help Centre API because the HTML page refuses scripts)
- Link Audio works over localhost, between Live and other Link Audio apps on the same computer, "without additional routing software". **[verified]** same FAQ
- The 12.4.x release notes fixed "recorded audio would not be properly aligned when being sent from tracks with effects which introduce latency while latency compensation was enabled". So the signal a track sends is at least post-effects and is latency-compensated. **[verified]** [Live 12 release notes](https://www.ableton.com/en/release-notes/live-12/). Whether it is also post-fader and post-mute (Post Mixer in Live's own terms) is not stated anywhere I found. **[unverified]** The prototype answers this by comparing a received track against the same bars exported Post Mixer.
- Third parties confirm the channel list in practice: "Live 12.4+ publishes its tracks/Main natively — no BlackHole or virtual audio driver needed". **[third-party]** [daitomanabe/link-osc-app](https://github.com/daitomanabe/link-osc-app). An OBS plugin lists entries as `Peer / Channel` and warns that "names are the identity": two peers with the same peer and channel name appear as one. **[third-party]** [cubicecho/obs-link-audio-plugin](https://github.com/cubicecho/obs-link-audio-plugin). Two tracks with the same name in one Set would be ambiguous by name but not by id: the SDK says channel ids "are persistent for the lifetime of a channel", names are for display. **[verified]** [LinkAudio.hpp](https://github.com/Ableton/link/blob/master/include/ableton/LinkAudio.hpp)

### What the receiver gets

From `LinkAudio.hpp` (Link 4.1): **[verified]**

- A `LinkAudio` peer lists `channels()` (name, peer name, id) and gets a callback when the set changes. A `LinkAudioSource(link, channelId, callback)` subscribes; the callback runs on a Link-managed thread with a `BufferHandle`.
- The handle carries `int16_t* samples`, interleaved, and an `Info` with `numFrames`, `numChannels` (1 or 2), `sampleRate`, `sessionBeatTime` and `tempo`, plus `beginBeats(sessionState, quantum)` / `endBeats(...)` that map the buffer to the local Link beat time. "Sinks only send audio if at least one corresponding source is present in the session."
- Same API in C through `extensions/abl_link` (`abl_link_audio_get_channels`, `abl_link_audio_source_*`, `abl_link_audio_source_buffer_info_begin_beats`), added in 4.0.0b3. **[verified]** [abl_link.h](https://github.com/Ableton/link/blob/master/extensions/abl_link/include/abl_link.h), [releases](https://github.com/Ableton/link/releases)

What this means for the four requirements: **[inferred]**

- (3) Window by bar. Every buffer says which Link beat it starts at. Link beats are the session's beat timeline, not Live's arrangement bar number, so the sidecar does not know "bar 9" by itself. The app does: it jumps `transport` to bar 9, plays, and asks the sidecar for everything from the Link beat at which playback started, for `8 × signature` beats. Live's beat grid and the Link grid are phase-locked while Live plays, so the cut is sample-accurate rather than wall-clock. The earlier note's "there is no give me bars 9–17 without playing them" still holds; the window is exact once played.
- (4) Last N bars. Keep one source open per channel the mentor may ask about (the Main always; a track when the user is working on it) and hold a ring buffer sized from the tempo. A stereo channel at 48 kHz costs 192 kB/s on localhost and in memory; eight bars at 120 BPM is 16 s, about 3 MB per channel. Subscribing to all 60 tracks of a large Set is 11 MB/s on loopback, which is cheap for the network but makes Live encode 60 streams; the prototype measures that CPU cost.
- A subscribe is not instant. The OBS plugin reports that audio starts "about a second after a channel is picked", because the first request can reach a sender that has not noticed the new peer yet, and that it re-asks after half a second of silence. **[third-party]** So a window by bar should subscribe before the jump, not at it.
- 16-bit samples, as before. Fine for every measurement on the map (loudness, balance, width, clipping at the Main is already in the stream); not bit-exact with an export.

### Turning Link on

- Live joins a Link session when the toggle is on. Any peer can change the tempo, and "tempo changes made by a Link session participant will override tempo automation in your Live Set". **[verified]** [Live manual 37.1](https://www.ableton.com/en/live-manual/12/synchronizing-with-link-tempo-follower-and-midi/). The sidecar must never commit a tempo, and the README must say that another Link app on the LAN can move Live's tempo while the mentor listens. **[inferred]**
- "Sync to Incoming Audio" delays Live's playback by the latency slider and must be on for at most one peer; the Latency slider only applies to audio Live receives. **[verified]** FAQ and manual. A receive-only sidecar touches neither. **[inferred]**
- Link discovery uses multicast; on macOS 15+ a *sandboxed* app needs the multicast entitlement. **[third-party]** [macdigi/pylinkaudio README](https://github.com/macdigi/pylinkaudio). A plain command-line sidecar is not sandboxed. **[inferred]**

## 2. Receivers that exist, and what each costs

Searched: GitHub repositories for `LinkAudio`, `"link audio" ableton`, `abl_link`; the npm registry for `ableton link`, `link audio ableton`, `abletonlinkaudio`. Read on 2026-10-15.

| Receiver | What it is | Platform | Licence | Use to us |
| --- | --- | --- | --- | --- |
| [LinkAudioHut](https://github.com/Ableton/link/tree/master/examples/linkaudiohut) (Ableton) | Terminal example: lists `peerName | name` channels, lets you pick one and plays it to the audio device through `examples/linkaudio/AudioPlatform_*`. 316 lines. No file output. **[verified]** | macOS, Windows, Linux; CMake | GPLv2+ | The reference for session setup and channel listing |
| [LinkAudioRenderer.hpp](https://github.com/Ableton/link/blob/master/examples/linkaudio/LinkAudioRenderer.hpp) (Ableton) | 419-line example receiver: queues buffers, drops old ones by beat, re-pitches by `totalFrames / numFrames` to follow tempo and sample-rate differences, converts with `floatToInt16`. **[verified]** | header | GPLv2+ | The pattern for aligning received buffers by beat; a file writer needs the queue, not the re-pitching |
| [abl_link](https://github.com/Ableton/link/tree/master/extensions/abl_link) (Ableton) | C API over the C++ SDK, with Link Audio since 4.0.0b3 **[verified]** | same | GPLv2+ | Lets the sidecar be Swift or C instead of C++; still compiles the GPL code in |
| [daitomanabe/link-osc-app](https://github.com/daitomanabe/link-osc-app) | SwiftUI macOS app: subscribes to one Link Audio channel, runs FFT/HPSS/onset analysis, sends OSC at 60 fps. Built on `abl_link`. macOS 13+, Apple Silicon. **[third-party]** | macOS | GPL-2.0-or-later | The closest existing thing to "listen and measure"; a GUI app, not a recorder; proves the Swift + `abl_link` route works on macOS |
| [cubicecho/obs-link-audio-plugin](https://github.com/cubicecho/obs-link-audio-plugin) | OBS source per channel; ships a `link-audio-probe receive` CLI and documents the practical issues (1 s start, clock drift realigned every ~30 min, names are identity). Linux tested; Windows built, not run. **[third-party]** | Linux | Source MIT; binaries GPL because of Link and libobs | The licence model to copy; the probe as a second reference |
| [gluon/Void-LinkAudio](https://github.com/gluon/Void-LinkAudio) + [ofxAbletonLinkAudio](https://github.com/gluon/ofxAbletonLinkAudio) | Max external `void.linkaudio.receive~`, TouchDesigner, VCV Rack, Pure Data, openFrameworks; shared `LinkAudioManager` + `AudioRingBuffer` in C++. macOS universal builds. 67 stars. **[third-party]** | macOS, Windows, Linux | GPL-2.0 | A ring-buffer receiver core to read; receiving inside Max is not what we need |
| [macdigi/pylinkaudio](https://github.com/macdigi/pylinkaudio) | Python bindings; `AudioSource(link, id).read()` returns int16 numpy frames; wheels for macOS arm64. Pre-alpha. **[third-party]** | macOS arm64, Linux | GPLv3 | A 30-line Python sidecar would work, at the price of a Python runtime; its README states the GPL reasoning plainly |
| [jgusta/node-ableton-link-audio](https://github.com/jgusta/node-ableton-link-audio) | Node native addon fork of `@ktamas77/abletonlink` with `LinkAudio`; built on 4.0.0b1; 0 stars; no licence file; `@jgusta/abletonlinkaudio` is **not on npm** (404). **[verified]** | Node | none stated | Not usable: unlicensed, pre-release API, and an addon links Link into the Node process (see licence) |
| npm `abletonlink` 0.2.0-beta.0 (2023), `@ktamas77/abletonlink` 1.2.3 (2025), `aalink`, `abletonlink-addon` | Link tempo bindings only; none has Link Audio. **[verified]** npm registry | Node | MIT / GPL-3.0 (`aalink`) | None for audio |

Cost to build our own: one C++17 file of roughly 150–250 lines (join, enable audio, list channels, subscribe by `peer|name`, ring buffer, write WAV on a stdin command), compiled with `clang++ -std=c++17 -DLINK_PLATFORM_MACOSX=1 -I link/include -I link/modules/asio-standalone/asio/include`. Link is header-only; the README lists those three steps for a non-CMake project. **[verified]** [Link README](https://github.com/Ableton/link/blob/master/README.md). This machine has `clang++` and `swift` from the command-line tools but no `cmake`. **[local]** The SDK and its asio submodule would be vendored or fetched by `pnpm pair ableton`. **[inferred]**

## 3. Licence: GPLv2+ next to MIT

Link is "dual licensed under GPLv2+ and a proprietary license"; for proprietary use "please contact link-devs@ableton.com". **[verified]** [README](https://github.com/Ableton/link/blob/master/README.md), [LICENSE.md](https://github.com/Ableton/link/blob/master/LICENSE.md), header of `LinkAudio.hpp`.

What the GPL FAQ says, read on 2026-10-15 at [gnu.org/licenses/gpl-faq.html](https://www.gnu.org/licenses/gpl-faq.html): **[verified]**

- Linking, static or dynamic, "is making a combined work based on the GPL covered work. Thus, the terms and conditions of the GNU General Public License cover the whole combination." (#GPLStaticVsDynamic) A library under the GPL means "the work as a whole must be licensed under the GPL" (#IfLibraryIsGPL).
- "Pipes, sockets and command-line arguments are communication mechanisms normally used between two separate programs. So when they are used for communication, the modules normally are separate programs. But if the semantics of the communication are intimate enough, exchanging complex internal data structures, that too could be a basis to consider the two parts as combined" (#MereAggregation). Fork-and-exec without intimate communication "results in the plug-ins being a separate program" (#GPLPlugins). "Using shared memory to communicate with complex data structures is pretty much equivalent to dynamic linking."
- MIT is GPL-compatible: code under a compatible licence can be combined with GPL code, and the combination is then distributed under the GPL (#WhatDoesCompatMean, #LinkingWithGPL).

Applied to this repo: **[inferred]**

1. **A Node native addon that compiles Link is out.** It is dynamic linking into the `node` process, so the mentor as a whole would have to ship under the GPL. That is what `pylinkaudio` says of itself ("anything that imports pylinkaudio becomes a combined GPLv3 work") and why `jgusta/node-ableton-link-audio` cannot be used even if it were on npm.
2. **A sidecar process is fine.** The sidecar is a GPLv2+ program: its source directory carries its own `LICENSE` (GPLv2+), the repo root stays MIT, and the README says which is which. Our app starts it and talks over stdin/stdout or a local socket with simple messages: "subscribe Main", "write the last 8 bars to this path", and WAV files back. That is the arm's-length form the FAQ describes (#GPLInProprietarySystem), and the OBS plugin uses the same split (MIT source, GPL binaries). Keep the protocol simple on purpose: no shared memory, no shared structs.
3. **Vendoring the SDK** into the repo is distribution of GPL code, which the GPL allows as long as the licence and source travel with it; a git submodule pinned to the 4.1 tag is the cleanest form.
4. The proprietary licence is the exit if the project ever cannot carry a GPL part. Whether Ableton grants it to a small open project: **[unverified]**, as before.

## 4. The Core Audio tap path, deeper

- `AudioHardwareCreateProcessTap` is macOS 14.2+; a tap "can specify which outputs it captures from a process or group of processes" with mono or stereo mixdown, can be private, and can mute the process's own output; the tap is read through an aggregate device; the app needs `NSAudioCaptureUsageDescription` and the user is prompted for system audio recording permission once. **[verified]** [Capturing system audio with Core Audio taps](https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps), [AudioHardwareCreateProcessTap](https://developer.apple.com/documentation/coreaudio/audiohardwarecreateprocesstap(_:_:))
- [`audiotee`](https://www.npmjs.com/package/audiotee) 0.0.7 (2025-10-17, MIT): a Node wrapper that downloads a prebuilt universal Swift binary (< 600 KB) built on Core Audio taps, emits PCM chunks, defaults to mono with a `--stereo` flag, can `--include-processes <pid>` to tap only Live, keeps the device sample rate at 32-bit float unless a sample rate is given (then 16-bit). The author says it was built for streaming to an ASR service. Upstream [makeusabrew/audiotee](https://github.com/makeusabrew/audiotee) has 92 stars, last push 2026-03-31, no licence file in the repo although the npm package says MIT. **[verified]** npm registry and README
- What it hears: Live's process output as sent to the audio device, that is the Main after its fader, plus the cue/preview output if it goes to the same device. **[inferred]** from the tap description. Never a track.
- Compared with Link Audio it costs nothing to build and needs nothing from Live, which makes it the right fallback and a good second ear for "what the user actually heard". It cannot place a window by beat; a wall-clock cut around `transport` is within one audio buffer of the bar, which is enough for measurements and not for bar-aligned exports. **[inferred]**
- ScreenCaptureKit per-app capture via npm `screencapturekit-audio-capture` 1.3.6 (MIT, prebuilt arm64, macOS 13+, Screen Recording permission) is the same result with a heavier permission. **[verified]** npm registry

## 5. The Max for Live path, deeper

Everything in the earlier note stands (`plugin~` → `sfrecord~`, hand-off by file path). What this note adds:

- `sfrecord~ loop` records the most recent N seconds; with `sortloop` on, the file is re-ordered so it starts at the beginning of the most recent recording, otherwise the start "will likely be somewhere in the middle of the resulting audio file". **[verified]** [sfrecord~](https://docs.cycling74.com/reference/sfrecord~). So "the last N bars" is one message plus one attribute.
- `plugsync~` outputs whether the transport runs, the current bar (from 1), beat, beat fraction, tempo and sample count. **[verified]** [plugsync~](https://docs.cycling74.com/reference/plugsync~). So a window by bar can be cut inside the device, bar-accurate.
- Per-track without touching the track: `plugin~` takes up to 64 input channels; a `MaxDevice` has `audio_inputs` (`DeviceIO`) whose `routing_type` and `routing_channel` are settable from the LOM, with the usual Pre FX / Post FX / Post Mixer channels. **[verified]** [plugin~](https://docs.cycling74.com/reference/plugin~), [MaxDevice](https://docs.cycling74.com/apiref/lom/maxdevice/), [DeviceIO](https://docs.cycling74.com/apiref/lom/deviceio/). Whether a device on the **Main** track may select other tracks as extra inputs, and how many at once, is not stated. **[unverified]**
- It needs Suite or the Max for Live add-on, which the Link Audio and tap paths do not. That is why it drops from fallback to upgrade in this note.

## 6. Live records it: the no-install path

- Any audio track's Input Type can be "Resampling", which routes the Main output into it; or another track, tapped Pre FX, Post FX or Post Mixer. **[verified]** [Live manual 17.4–17.5](https://www.ableton.com/en/live-manual/12/routing-and-i-o/)
- The LOM can `create_audio_track`, set `input_routing_type` and `input_routing_channel`, `arm`, set `record_mode`, `start_playing` / `stop_playing`, and read a clip's `file_path`; `delete_track` cleans up. **[verified]** [Song](https://docs.cycling74.com/apiref/lom/song/), [Track](https://docs.cycling74.com/apiref/lom/track/), [Clip](https://docs.cycling74.com/apiref/lom/clip/)
- Live writes the file at its own recording settings, with latency compensation, in float. Three of the four requirements, with the user's Set edited while it happens, and nothing for "the last N bars". It is the right answer for a user who has neither Live 12.4 nor the permission prompt, and for a bit-exact per-track export when a measurement needs one. **[inferred]** Not tried.

## Recommendation

1. **Prototype first: the Link Audio sidecar.** One C++17 file against the vendored Link 4.1 headers, GPLv2+ in its own directory, started by the app, spoken to over stdin/stdout. It subscribes to the Main on start, to a track on request, ring-buffers, and writes WAV on command with the Link beat of the first sample in the reply. Questions the prototype must answer, in order: do the Main and every track appear as channels on localhost; what is the tap point (compare eight bars received Post Mixer-style against an export); how long from subscribe to first buffer; CPU cost in Live with 1, 10 and 60 channels subscribed; does a muted or soloed track still send; does enabling Link disturb a Set with tempo automation.
2. **Fallback: `audiotee` (Core Audio process tap) with `--stereo --include-processes <Live pid>`.** Main only, solo for a track, wall-clock windows, ring buffer in Node. If the Link Audio tap point or CPU cost disappoints, this ships the Main requirement in an afternoon with no GPL and no Live setup.
3. Keep the **Max for Live recorder** as the upgrade for float per-track audio with routed inputs, and the **LOM recording track** as the no-install path for editions without Link Audio. Neither is prototyped now.
4. Decisions this raises for the map, not settled here: solo as the way to hear one track on a Main-only path; what the README says about Link changing the tempo; the ADR for a GPL sidecar next to MIT.

## Open questions

- Link Audio tap point (post-fader? post-mute? post-solo?). The one fact found is that it is post-effects and latency-compensated.
- CPU cost in Live of many subscribed channels.
- Whether Live Intro and Lite have Link Audio ("built into all Ableton products" says the manual; not tested).
- Whether a Main-track Max device can take other tracks as extra inputs.
- Whether Ableton grants the proprietary Link licence to a small open project.

## Sources

Ableton
- [Link Audio FAQ](https://help.ableton.com/hc/en-us/articles/25425913328924-Link-Audio-FAQ) (updated 2026-10-15, read through the Help Centre API)
- [Live 12 release notes](https://www.ableton.com/en/release-notes/live-12/) (12.4 Link Audio, 12.4.x fixes)
- [Live manual 37.1 Synchronizing with Link](https://www.ableton.com/en/live-manual/12/synchronizing-with-link-tempo-follower-and-midi/), [17 Routing and I/O](https://www.ableton.com/en/live-manual/12/routing-and-i-o/)
- [Ableton/link](https://github.com/Ableton/link): [README](https://github.com/Ableton/link/blob/master/README.md), [LICENSE.md](https://github.com/Ableton/link/blob/master/LICENSE.md), [LinkAudio.hpp](https://github.com/Ableton/link/blob/master/include/ableton/LinkAudio.hpp), [abl_link.h](https://github.com/Ableton/link/blob/master/extensions/abl_link/include/abl_link.h), [examples/linkaudiohut](https://github.com/Ableton/link/tree/master/examples/linkaudiohut), [examples/linkaudio/LinkAudioRenderer.hpp](https://github.com/Ableton/link/blob/master/examples/linkaudio/LinkAudioRenderer.hpp), [releases](https://github.com/Ableton/link/releases)

Cycling '74
- [sfrecord~](https://docs.cycling74.com/reference/sfrecord~), [plugin~](https://docs.cycling74.com/reference/plugin~), [plugsync~](https://docs.cycling74.com/reference/plugsync~)
- LOM: [MaxDevice](https://docs.cycling74.com/apiref/lom/maxdevice/), [DeviceIO](https://docs.cycling74.com/apiref/lom/deviceio/), [Track](https://docs.cycling74.com/apiref/lom/track/), [Song](https://docs.cycling74.com/apiref/lom/song/), [Clip](https://docs.cycling74.com/apiref/lom/clip/)

Apple
- [Capturing system audio with Core Audio taps](https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps), [AudioHardwareCreateProcessTap](https://developer.apple.com/documentation/coreaudio/audiohardwarecreateprocesstap(_:_:)), [CATapDescription](https://developer.apple.com/documentation/coreaudio/catapdescription)

Licence
- [GNU GPL FAQ](https://www.gnu.org/licenses/gpl-faq.html): #GPLPlugins, #MereAggregation, #GPLInProprietarySystem, #GPLStaticVsDynamic, #IfLibraryIsGPL, #LinkingWithGPL, #WhatDoesCompatMean

Third-party receivers and packages (read 2026-10-15)
- [daitomanabe/link-osc-app](https://github.com/daitomanabe/link-osc-app), [cubicecho/obs-link-audio-plugin](https://github.com/cubicecho/obs-link-audio-plugin), [gluon/Void-LinkAudio](https://github.com/gluon/Void-LinkAudio), [gluon/ofxAbletonLinkAudio](https://github.com/gluon/ofxAbletonLinkAudio), [macdigi/pylinkaudio](https://github.com/macdigi/pylinkaudio), [jgusta/node-ableton-link-audio](https://github.com/jgusta/node-ableton-link-audio), [DatanoiseTV/jack-linkaudio](https://github.com/DatanoiseTV/jack-linkaudio)
- npm: [audiotee](https://www.npmjs.com/package/audiotee), [makeusabrew/audiotee](https://github.com/makeusabrew/audiotee), [screencapturekit-audio-capture](https://www.npmjs.com/package/screencapturekit-audio-capture), [abletonlink](https://www.npmjs.com/package/abletonlink), [@ktamas77/abletonlink](https://www.npmjs.com/package/@ktamas77/abletonlink)
