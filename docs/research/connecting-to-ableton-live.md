# Research — how a Node process can connect to a running Ableton Live

Date: 2026-10-13 · Status: research note, not a decision

The question: how can an external Node/TypeScript process read and change the Live Set of a running Ableton Live? The answer replaces the fake Ableton in `packages/tools/src/daws/ableton/`, which today holds a tempo and a list of track names in memory and offers `get_session`, `set_tempo`, `create_track` and `delete_track`.

Versions this note was checked against: Live 12.4.6 (current release, 2026-09-15, [release notes](https://www.ableton.com/en/release-notes/live-12/)); a Live 12 beta line that carries the Extensions SDK (latest beta entry 2026-10-08, [beta release notes](https://www.ableton.com/en/release-notes/live-12-beta/)); the Live Object Model reference, which "refers to Ableton Live version 12.4.5" ([LOM](https://docs.cycling74.com/apiref/lom/)). The machine this was written on has Live 12 Suite **12.3.2**, Node **22.23.3**, and AbletonOSC already installed in the User Library (see [Local observations](#local-observations)).

Third-party code was read at these commits: AbletonOSC `0ca6821` (2025-11-19), ableton-js `c668d80` (v5.0.4, 2026-10-12), ableton-mcp `9dddc7b` (v1.4.5, 2026-09-22), Producer Pal `52a4c21` (2026-10-01). File and line references below are to those commits.

Markers: **[verified]** read in the linked primary source during this research · **[code]** read in the project's source at the commit above · **[local]** observed on this machine · **[third-party]** stated by a project about something it does not own · **[inferred]** my reasoning from verified facts · **[unverified]** could not confirm.

## Short answer

There are two ways to reach the Live Object Model (LOM) from outside Live, and one new official one that is not usable yet.

1. **A MIDI Remote Script** (Python, runs inside Live) that opens a local socket. This is what AbletonOSC, ableton-js and ableton-mcp all do. It needs no Max for Live. The Python API is not documented by Ableton.
2. **A Max for Live device** that reaches the LOM through `LiveAPI` and talks to the outside over UDP or through a Node process inside the device. It needs Suite, or Standard with the Max for Live add-on.
3. **The Ableton Extensions SDK** (official, JavaScript, first shipped in a public beta on 2026-06-02) is the first-party API the question asked about. Today it is beta-only, Suite-only, and built for tools that run once from a context menu, so it does not fit a mentor that reads and acts during a conversation.

Link, plain MIDI and `.als` files are each too narrow to be the connection.

Every option below can be driven from Node with built-ins only. None forces an npm package or a native addon, except plain MIDI.

| Option | User installs | Live edition | Node side | LOM coverage | Maintenance | Licence |
| --- | --- | --- | --- | --- | --- | --- |
| **Own Remote Script** + own protocol | Copy one folder into the User Library, pick it as a Control Surface | Live 11+; no Max for Live | `node:net` or `node:dgram`, nothing else | Whatever we write; the whole Python LOM is reachable | Ours, against an undocumented API | Ours |
| **AbletonOSC** | Same, the AbletonOSC folder | Live 11+; no Max for Live | `node:dgram` plus a hand-written OSC codec (small) | 253 documented addresses: song, tracks, clips, notes, scenes, devices and parameters, view; listeners. No browser, so no loading of devices; arrangement clips are read-only | Last commit 2025-11-19; 73 open issues; README badge says beta | MIT |
| **ableton-js** Remote Script | Same, the `AbletonJS` folder | Live 11+; no Max for Live | Global `WebSocket` and JSON (Node 22 has both), **or** the `ableton-js` package, which brings 4 runtime dependencies | Widest of the three: song, tracks, clips, notes, devices, parameters, racks, browser (load devices), arrangement clips (create), cue points, listeners | Active: v5.0.4 on 2026-10-12; 5 open issues. Wire protocol changed in v5.0.0 (2026-09-11) | MIT |
| **ableton-mcp** Remote Script | Same, the `AbletonMCP` folder | Live 10+ per its README | `node:net` and JSON | About 40 fixed commands; no listeners | Active: last commit 2026-09-22 | MIT |
| **Max for Live device** (own) | Drop an `.amxd` on a track in every Set, or save it in the default Set | Suite, or Standard + Max for Live | `node:dgram`, or `fetch` if the device runs an HTTP server | Whole documented LOM | Ours; patches are hard to test | Ours |
| **Producer Pal** (existing M4L device) | Same, its `.amxd` | Live 12.3+ with Max for Live | `fetch` to `http://localhost:3350` | Its own tool set, not raw LOM | Active: pushed 2026-10-13 | GPL-3.0-or-later |
| **Extensions SDK** | Install an extension in Settings → Extensions | Live 12 **Suite beta** only | Not applicable: the extension is the Node code | Tracks, clips, MIDI, devices, tempo; run-once | Ableton; beta | SDK licence, not redistributable **[third-party]** |
| Ableton Link | Turn Link on | All editions | Native addon (C++ SDK) | Tempo, beat, phase, start/stop only | Ableton | GPLv2+ or proprietary |
| Plain / virtual MIDI | Create a virtual port, MIDI-map each control by hand | All editions | Native addon; Node has no MIDI | Only what the user mapped; write-only | — | — |
| `.als` file | Nothing | All editions | `node:zlib` | The saved Set, not the running one | Format undocumented | — |

## What all Remote Script options share

A Remote Script is a Python package that Live loads as a "Control Surface". Three facts hold for every project in this family.

**Install and activation.** The user creates `Remote Scripts` inside the User Library (`~/Music/Ableton/User Library` on macOS, `\Users\[username]\Documents\Ableton\User Library` on Windows), copies the script folder in, starts Live, and selects the script in the Control Surface chooser of the MIDI settings. This works "as of Live 10.1.13", and scripts in that folder keep loading after a Live update. **[verified]** [Installing third-party remote scripts](https://help.ableton.com/hc/en-us/articles/209072009-Installing-third-party-remote-scripts) (updated 2026-08-28). Live offers a limited number of slots: "Up to six supported control surfaces can be used simultaneously". **[verified]** [Live manual 34.1.1](https://www.ableton.com/en/live-manual/12/midi-and-key-remote-control/)

**No support and no official reference.** "We cannot provide technical support for remote scripts not included with Live." **[verified]** same article. Ableton publishes no reference for the Python API; its own article on writing a control surface covers only `UserConfiguration.txt` mappings. **[verified]** [Creating your own Control Surface script](https://help.ableton.com/hc/en-us/articles/206240184-Creating-your-own-Control-Surface-script). The best evidence for the Python API is:

- the Cycling '74 [LOM reference](https://docs.cycling74.com/apiref/lom/), which is official for Max for Live and describes the same object model (36 classes, among them Song, Track, Clip, ClipSlot, Scene, Device, DeviceParameter, MixerDevice, RackDevice, TakeLane, CuePoint via `Song.cue_points`). Release notes speak of "the Python API or the Max for Live API" as two views of one thing. **[verified]** [Live 11 release notes](https://www.ableton.com/en/release-notes/live-11/). That the Python API matches the LOM reference member for member: **[unverified]**;
- unofficial decompiled sources of Live's bundled scripts: [gluon/AbletonLive12_MIDIRemoteScripts](https://github.com/gluon/AbletonLive12_MIDIRemoteScripts) ("Unofficial repository for Ableton Live 12.4 MIDI Remote Scripts Python sources") and its unofficial docs site [midiremotescripts.structure-void.com](https://midiremotescripts.structure-void.com); not read in depth;
- the bundled scripts themselves, shipped as `.pyc` in `Ableton Live 12 Suite.app/Contents/App-Resources/MIDI Remote Scripts/` (144 entries, including `_Framework`). **[local]**

**Python version.** Live 10 and earlier used Python 2; "This has been upgraded to Python 3, as of Live 11." **[verified]** [Installing third-party remote scripts](https://help.ableton.com/hc/en-us/articles/209072009-Installing-third-party-remote-scripts). In Live 12.1 "The embedded Python interpreter has been updated to version 3.11.6", and compiled `.pyc` scripts must be recompiled for it. **[verified]** [Live 12 release notes](https://www.ableton.com/en/release-notes/live-12/). The exact version in Live 11 and in 12.4: **[unverified]**. A script shipped as `.py` source avoids the recompile problem. **[inferred]**

**Threading and timing.** Ableton documents nothing here. The Max for Live docs say "The Live API runs in the main thread in Live". **[verified]** [live.object](https://docs.cycling74.com/reference/live.object/). The projects handle that in two ways, and disagree on whether Python threads work:

- AbletonOSC uses no threads. It polls a non-blocking UDP socket from a function that reschedules itself with `schedule_message(1, self.tick)`, described as "Called once per 100ms", with the comment "Live's embedded Python implementation does not appear to support threading, and beachballs when a thread is started." **[code]** [`manager.py` L110–119](https://github.com/ideoforms/AbletonOSC/blob/0ca6821/manager.py#L110-L119)
- ableton-js and ableton-mcp do start Python threads for socket I/O and hand each command to the main thread: ableton-js through a queue drained in a `schedule_message(1, …)` tick ([`AbletonJS.py` L107–125](https://github.com/leolabs/ableton-js/blob/c668d80/midi-script/AbletonJS.py#L107-L125), [`Socket.py` L306](https://github.com/leolabs/ableton-js/blob/c668d80/midi-script/Socket.py#L306)), ableton-mcp through `schedule_message(0, main_thread_task)` for anything that changes the Set ([`__init__.py` L290–413](https://github.com/ahujasid/ableton-mcp/blob/9dddc7b/AbletonMCP_Remote_Script/__init__.py#L290-L413)). ableton-js notes that its send thread "only gets scheduled every ~20ms inside Live" ([`Socket.py` L149](https://github.com/leolabs/ableton-js/blob/c668d80/midi-script/Socket.py#L149)). **[code]**

So a round trip costs up to one tick (about 100 ms) plus the work. For a mentor that waits seconds for a model, that is fine. **[inferred]** The real length of one `schedule_message` tick was not measured. **[unverified]**

**Shared failure modes.**

- Live not running: nothing listens. Over TCP or WebSocket the connect is refused at once; over UDP nothing comes back and the caller must time out. **[inferred]**
- Script not selected as a Control Surface, or copied to the wrong folder: same symptom as Live not running. **[inferred]**
- Port already in use: each script reports it differently, see below.
- A script error is written to Live's `Log.txt` (`~/Library/Preferences/Ableton/Live x.x.x/Log.txt` on macOS). **[local]** the log on this machine has `Python:` lines from AbletonOSC.
- A Live update can change or remove a Python API member without notice, because the API is unsupported. **[inferred]**

**Edition.** The help centre marks control surfaces as "Live Versions: All". **[verified]** [Using Control Surfaces](https://help.ableton.com/hc/en-us/articles/209774285-Using-Control-Surfaces). None of the three READMEs names an edition. That a third-party Remote Script loads in Intro and Lite: **[unverified]**.

## 1. Own Remote Script with a socket

Write the Python script ourselves and choose the wire format.

- **Connection.** The script binds a socket on `127.0.0.1`; Node connects with `node:net` (TCP) or `node:dgram` (UDP). No npm package. **[inferred]** from the three projects, which all do exactly this.
- **Format.** Free choice. A line of JSON per message with a request id is enough, and is what ableton-js and ableton-mcp converge on (minus the framing). **[inferred]**
- **Reach.** Everything the Python LOM has, including listeners (`add_<property>_listener`, as used in [AbletonOSC `handler.py` L77–79](https://github.com/ideoforms/AbletonOSC/blob/0ca6821/abletonosc/handler.py#L77-L79)). **[code]**
- **Cost.** A second language in a TypeScript repo, no way to run the script in `pnpm check` without Live, and we carry the risk of the undocumented API ourselves. The script can stay small: AbletonOSC's whole API layer is about 1,500 lines of Python. **[code]** (`abletonosc/*.py`)
- **User cost.** One folder to copy, one chooser to set. Same as every other Remote Script.

## 2. AbletonOSC

- **What it is.** "a MIDI remote script that provides an Open Sound Control (OSC) interface to control Ableton Live"; "requires Ableton Live 11 or above". **[verified]** [README](https://github.com/ideoforms/AbletonOSC/blob/0ca6821/README.md)
- **Transport.** UDP. It listens on port 11000 and replies on port 11001 ([`constants.py` L5–6](https://github.com/ideoforms/AbletonOSC/blob/0ca6821/abletonosc/constants.py#L5-L6)). The socket is non-blocking and bound to `0.0.0.0`, every IPv4 interface, not only loopback ([`osc_server.py` L15, L36–38](https://github.com/ideoforms/AbletonOSC/blob/0ca6821/abletonosc/osc_server.py#L15-L38)). A reply goes to the sender's IP address on the fixed port 11001, not to the sender's source port ([`osc_server.py` L93–99](https://github.com/ideoforms/AbletonOSC/blob/0ca6821/abletonosc/osc_server.py#L87-L126)). Datagrams are read up to 65,536 bytes ([L158](https://github.com/ideoforms/AbletonOSC/blob/0ca6821/abletonosc/osc_server.py#L158)). **[code]**
- **Format.** OSC 1.0 messages and bundles, parsed by a vendored copy of python-osc. OSC is a small binary format: null-padded strings, 32-bit big-endian ints and floats, every item a multiple of 4 bytes. **[verified]** [OSC 1.0 spec](https://opensoundcontrol.stanford.edu/spec-1_0.html). A codec for the types AbletonOSC uses fits in one small file on top of `Buffer`, so no npm package is needed. **[inferred]**
- **Address space.** `/live/<object>/<verb>/<property>` with numeric indexes as arguments, for example `/live/song/set/tempo 125` or `/live/clip/get/notes <track> <clip>`. The README documents 253 addresses: song 75, track 58, clip 58, scene 21, device 13, view 12, clip_slot 7, api 4, application 1, midimap 1. `*` wildcards are accepted in queries. **[verified]** README, counted from its tables.
- **Covered.** Tempo, transport, undo/redo, cue points; create, delete and duplicate tracks and scenes; track volume, pan, sends, mute, solo, arm, meters; clip slots (create, delete, duplicate clips); clip properties and MIDI notes (get, add, remove); device names and parameter values; selected track, scene, clip and device. **[verified]** README
- **Not covered.** No browser, so no loading of an instrument or effect. Arrangement clips can be listed per track (name, length, start time) but not created or edited. **[verified]** README: no such addresses exist in its tables.
- **Listeners.** `/live/<object>/start_listen/<property>` attaches a LOM listener and pushes each change to the client; `/live/song/start_listen/beat` sends a message every beat. **[verified]** README; **[code]** [`handler.py` L47–95](https://github.com/ideoforms/AbletonOSC/blob/0ca6821/abletonosc/handler.py#L47-L95)
- **Limits that matter for an agent.**
  - No request id. A reply is matched to its request only by address and leading arguments. Two identical queries in flight cannot be told apart. **[code]** `osc_server.py` L87–126
  - Errors come back on a separate address, `/live/error`, as text, with nothing tying them to the request that failed ([`manager.py` L58](https://github.com/ideoforms/AbletonOSC/blob/0ca6821/manager.py#L58)). An unknown address is only logged. **[code]**
  - UDP gives no delivery guarantee and a big reply must fit in one datagram. **[inferred]**
  - The reply port is fixed, so only one client per machine can receive replies, and our process must be able to bind 11001. **[inferred]** from the code above
  - Binding `0.0.0.0` exposes control of Live to the local network. **[inferred]**
- **Failure modes.** If port 11000 is taken, Live's status bar shows "AbletonOSC: Couldn't bind to port 11000" and the API is not registered ([`manager.py` L24–35](https://github.com/ideoforms/AbletonOSC/blob/0ca6821/manager.py#L24-L35)). On success it shows "AbletonOSC: Listening for OSC on port 11000". **[code]**
- **Maintenance and licence.** MIT. Last commit 2025-11-19, no tagged releases, 73 open issues, README badge "stability-beta". **[verified]** GitHub API, 2026-10-13. It loads in Live 12.3.2 on this machine. **[local]**

## 3. ableton-js

- **What it is.** A TypeScript client plus a Remote Script: "lets you control Ableton 11 or later using Node.js, Deno, or a browser"; "requires Ableton Live 11 or later". **[verified]** [README](https://github.com/leolabs/ableton-js/blob/c668d80/README.md)
- **What it installs.** The `midi-script` folder of the package, copied to the User Library as `Remote Scripts/AbletonJS`. **[verified]** README. The script is about 1,100 lines plus one file per LOM class under `Namespaces/`. **[code]**
- **Transport.** The script is a WebSocket server on `127.0.0.1:39031`, loopback only by default, with an optional password checked by HMAC-SHA256 ([`Config.py`](https://github.com/leolabs/ableton-js/blob/c668d80/midi-script/Config.py), [`Socket.py` L343–355](https://github.com/leolabs/ableton-js/blob/c668d80/midi-script/Socket.py#L343-L355)). Several clients can connect at once. **[code]**, README "Protocol". Before v5.0.0 (2026-09-11, "the WebSocket Release") the transport was UDP. **[verified]** [CHANGELOG](https://github.com/leolabs/ableton-js/blob/c668d80/CHANGELOG.md)
- **Format.** JSON text frames. The client sends `{ uuid, commands: [{ ns, nsid?, name, args?, etag?, cache? }] }` ([`src/index.ts` L18–31](https://github.com/leolabs/ableton-js/blob/c668d80/src/index.ts#L18-L31)). The script answers `{ event, data, uuid, ts }` where `event` is `result`, `error`, `connect` or a listener event, and `data` for a result is one `{ ok, data }` or `{ ok: false, error, errorType }` per command ([`Socket.py` L231–258](https://github.com/leolabs/ableton-js/blob/c668d80/midi-script/Socket.py#L231-L258), [`AbletonJS.py` L151–193](https://github.com/leolabs/ableton-js/blob/c668d80/midi-script/AbletonJS.py#L151-L193)). `errorType` is the Python exception class name. **[code]**
- **Node side.** Two ways:
  - Use the `ableton-js` package: MIT, `engines.node >= 21`, 4 runtime dependencies (`@noble/hashes`, `lodash`, `lru-cache`, `p-limit`). **[code]** [`package.json`](https://github.com/leolabs/ableton-js/blob/c668d80/package.json)
  - Speak the protocol ourselves. The client opens the socket with the global `new WebSocket(url)` and no import ([`src/index.ts` L493](https://github.com/leolabs/ableton-js/blob/c668d80/src/index.ts#L493)), and Node 22 has a global `WebSocket` class ([Node 22 globals](https://nodejs.org/docs/latest-v22.x/api/globals.html)). **[code]**, **[verified]**. So a client with no dependency is possible, at the price of following the script's protocol by hand. **[inferred]**
- **Covered.** Namespaces exist for Song, SongView, Track, TrackView, Clip, ClipSlot, Scene, CuePoint, Device, DeviceParameter, MixerDevice, RackDevice, Chain, DrumPad, PluginDevice, Browser, BrowserItem, Application, Groove, TakeLane and more (`src/ns/`). That includes creating and deleting tracks ([`song.ts` L270–310](https://github.com/leolabs/ableton-js/blob/c668d80/src/ns/song.ts#L270-L310)), reading and writing MIDI notes (`clip.ts`), creating MIDI and audio clips in the Arrangement through take lanes (`take-lane.ts` L51–60), inserting and deleting devices in chains, and loading a browser item (`browser.ts` L129). **[code]**
- **Listeners.** `add_listener` / `remove_listener` commands; updates go only to the client that subscribed ([`Interface.py` L96–170](https://github.com/leolabs/ableton-js/blob/c668d80/midi-script/Namespaces/Interface.py#L96-L170), README). The README lists two listeners that do not fire reliably in Live (`output_meter_level`, clip slot `playing_status`). **[verified]** README "Caveats"
- **Failure modes.** The client pings every 2 s and emits `connect` / `disconnect`; it reconnects by itself and advises re-attaching listeners on every `connect`. Commands have a timeout and reject with `TimeoutError`; a Python exception rejects with `CommandError`. **[code]** `src/index.ts` L100–135, L401–448; README. If the port cannot be bound the script logs "Cannot bind to …, trying again" and retries ([`Socket.py` L322–341](https://github.com/leolabs/ableton-js/blob/c668d80/midi-script/Socket.py#L322-L341)). The script logs when "Ableton Live's main thread is lagging" by more than 200 ms ([`AbletonJS.py` L110–112](https://github.com/leolabs/ableton-js/blob/c668d80/midi-script/AbletonJS.py#L110-L112)). **[code]**
- **Maintenance and licence.** MIT. v5.0.4 on 2026-10-12, v5.0.3 on 2026-09-21, 5 open issues. **[verified]** GitHub API, 2026-10-13. The v5 protocol is one month old; client and script versions must match. **[inferred]** from the changelog.

## 4. ableton-mcp (ahujasid) and similar

- **What it is.** Two parts: a Remote Script that "creates a socket server to receive and execute commands", and a Python MCP server that connects to it. **[verified]** [README](https://github.com/ahujasid/ableton-mcp/blob/9dddc7b/README.md). Prerequisites: "Ableton Live 10 or newer", Python 3.8+, and `uv`. **[verified]** README
- **Transport.** TCP on `127.0.0.1:9877` ([`__init__.py` L19, L29, L142–145](https://github.com/ahujasid/ableton-mcp/blob/9dddc7b/AbletonMCP_Remote_Script/__init__.py#L19-L29)). **[code]**
- **Format.** One JSON object per request, `{ "type": …, "params": {…} }`, answered by `{ "status": "success", "result": … }` or `{ "status": "error", "message": … }`. There is no framing: the script keeps reading until the buffer parses as JSON ([L213–243](https://github.com/ahujasid/ableton-mcp/blob/9dddc7b/AbletonMCP_Remote_Script/__init__.py#L213-L243)). One request at a time per connection. **[code]**
- **Covered.** A fixed list of about 40 command types: session and track info, create MIDI/audio tracks, rename, create and delete clips, add and clear notes, fire and stop clips, transport, tempo, browser tree and loading an instrument or effect, device parameters (get and set), arrangement clips (list, rename, duplicate a session clip to the arrangement), locators. The MCP server exposes 37 tools on top. **[code]** `__init__.py` dispatch at L272–510; `MCP_Server/server.py`
- **Not covered.** No delete track, no listeners (a polled `drain_passive_events` queue instead), no general property access. **[code]**
- **Node side.** `node:net` and `JSON` are enough to speak to the script and skip the Python MCP server. **[inferred]**
- **Other.** The Python server sends "Anonymous telemetry — on by default" and has an opt-in dataset recorder that uploads prompts and Set contents. **[verified]** README "Telemetry". This lives in the MCP server, not in the Remote Script. **[code]** (`MCP_Server/telemetry.py`, `MCP_Server/dataset/`)
- **Maintenance and licence.** MIT, v1.4.5, last commit 2026-09-22, 45 open issues. **[verified]** GitHub API, 2026-10-13
- **Similar projects**, not read in depth: [bschoepke/ableton-live-mcp](https://github.com/bschoepke/ableton-live-mcp) (a Remote Script that lets the agent "eval arbitrary python that runs inside Ableton"), [uisato/ableton-mcp-extended](https://github.com/uisato/ableton-mcp-extended), [Simon-Kansara/ableton-live-mcp-server](https://github.com/Simon-Kansara/ableton-live-mcp-server) (an MCP server over AbletonOSC), [xiaolaa2/ableton-copilot-mcp](https://github.com/xiaolaa2/ableton-copilot-mcp) (over ableton-js). All are a Remote Script plus a socket; none adds a new connection mechanism. **[verified]** repository descriptions only.

## 5. Max for Live

- **Reach.** A device reaches the LOM with `live.path`, `live.object`, `live.observer`, or the `LiveAPI` object in JavaScript (`js`, or `v8` in Max 9). Paths start at `live_set`, `live_app`, `control_surfaces N` or `this_device`. **[verified]** [Live API overview](https://docs.cycling74.com/userguide/m4l/live_api_overview/), [LiveAPI](https://docs.cycling74.com/apiref/js/liveapi/). This is the documented, supported way to the LOM, and the [LOM reference](https://docs.cycling74.com/apiref/lom/) is written for it. It documents, for example, `Song.create_midi_track`, `Song.delete_track`, `Song.tempo`, `Track.create_midi_clip`, `Track.insert_device`, `Track.arrangement_clips` ("Available since Live 11.0"), `Clip.add_new_notes`, `Clip.get_notes_extended`, `DeviceParameter.value`. **[verified]** [Song](https://docs.cycling74.com/apiref/lom/song/), [Track](https://docs.cycling74.com/apiref/lom/track/), [Clip](https://docs.cycling74.com/apiref/lom/clip/), [DeviceParameter](https://docs.cycling74.com/apiref/lom/deviceparameter/)
- **Getting out of the device.** Two documented routes:
  - `udpsend` / `udpreceive`: "Objects like udpreceive and udpsend will still work, but integrated OSC support will not be functional" with only a Max for Live licence. **[verified]** [Max for Live limitations](https://docs.cycling74.com/userguide/m4l/live_limitations/). Node talks to it with `node:dgram`.
  - `node.script`, which will "Control a local Node.js process from Max". **[verified]** [node.script](https://docs.cycling74.com/reference/node.script/). That process can open any server, but it cannot call the LOM itself; it must pass messages to a `js`/`v8` object in the patch. Producer Pal describes exactly this split: `node.script` has "the network … but … no access to the Live API", `v8` has "direct access to the Live API, but no Node.js, no npm, and no network", joined by "JSON over Max patch cables". **[third-party]** [Producer Pal, the bridge](https://github.com/adamjmurray/producer-pal/blob/52a4c21/docs/how-it-works/the-bridge.md). The Node version bundled with Max for Live: **[unverified]**.
- **Threading limits.** "The Live API runs in the main thread in Live, and all messages to and from the API are automatically deferred." **[verified]** [live.object](https://docs.cycling74.com/reference/live.object/). `LiveAPI` "cannot be created or used in the high-priority thread" and cannot be used in JavaScript global code, only after the device has loaded. **[verified]** [LiveAPI](https://docs.cycling74.com/apiref/js/liveapi/). "changes to a Live Set and its contents are not possible from a notification"; a `deferlow` is the usual fix. **[verified]** [Live API overview](https://docs.cycling74.com/userguide/m4l/live_api_overview/)
- **Edition.** "Max for Live is included by default in Live Suite and can be purchased as an additional add-on for Live Standard"; "not supported within Live Lite or Intro". **[verified]** [Buying Max for Live](https://help.ableton.com/hc/en-us/articles/206407124-Buying-Max-for-Live)
- **User cost.** The device lives in a Set, on a track. A user must add it to each Set, or save it into their default Set. A Remote Script, once selected, is there for every Set. **[inferred]**
- **Failure modes.** Device not in the Set, Live not running, or port in use: nothing answers. **[inferred]**
- **Existing device: Producer Pal.** A Max for Live device that serves MCP and a REST API over HTTP: "default port 3350 … available whenever the Producer Pal Max for Live device is running", with `GET /api/tools` and `POST /api/tools/{toolName}`. **[verified]** [REST API guide](https://producer-pal.org/guide/rest-api). "Requires: Ableton Live 12.3+ with Max for Live." **[verified]** [installation](https://producer-pal.org/installation). Node could call it with `fetch` and no dependency. **[inferred]** Licence: GPL-3.0-or-later. **[code]** [`LICENSE`](https://github.com/adamjmurray/producer-pal/blob/52a4c21/LICENSE). It exposes its own tools, not the raw LOM, so our tool set would be shaped by someone else's. Whether calling a user-installed GPL program over HTTP puts any duty on this repo is a legal question this note does not answer.

## 6. Ableton Extensions SDK (official, beta)

This is what Ableton has shipped recently, and it did not exist when the three Remote Script projects were written.

- **What it is.** "The Extensions SDK lets you customize and expand Live's functionality. You can build your own tools with JavaScript and TypeScript and use them directly in Live. Extensions can interact with the elements of a Live Set, host custom UI elements, and integrate with external services." **[verified]** [Live 12 beta release notes](https://www.ableton.com/en/release-notes/live-12-beta/). Extensions "can interact with tracks, clips, MIDI, devices, tempo, and other parts of a Live Set". **[verified]** [Ableton Extensions FAQ](https://help.ableton.com/hc/en-us/articles/27303428331420-Ableton-Extensions-FAQ) (updated 2026-10-01, read through the Help Centre API)
- **Where it runs.** "Extensions are built on the NodeJS platform". Developing one needs the SDK and "NodeJS … v24.16.0 (LTS) or higher". **[verified]** FAQ. Live runs them in an "Extension Host" process (named in beta notes such as "The Extension Host now connects to Live more reliably"). **[verified]** beta release notes
- **Availability.** "Extensions are available in Live 12 Suite Beta, version 12.4.5 or later. Extensions are not available in Live Standard, Intro, or Lite." **[verified]** FAQ, and [ableton.com/live/extensions](https://www.ableton.com/en/live/extensions/). The SDK "is available exclusively in the Live 12.4.5 public beta" and is downloaded from Centercode after joining the beta programme. **[verified]** [ableton.github.io/extensions-sdk](https://ableton.github.io/extensions-sdk/). The stable 12.4.6 release notes do not mention Extensions. **[verified]** [Live 12 release notes](https://www.ableton.com/en/release-notes/live-12/). Live 12.3.2 on this machine has no Extension Host in its app bundle. **[local]**
- **Run model.** An extension is started by the user from a right-click context menu: "Triggering an extension causes it to run once, performing its task which returns a result or applies changes, then stop." Extensions "are intended for discrete tasks that are completed and closed after a single use" and cannot do "Background processing during playback or recording" or "Real-time interaction with transport". **[verified]** FAQ
- **What that means here.** The mentor needs a connection it can use at any moment in a turn, started by the model and not by a right-click. By Ableton's own description, that is not what Extensions are for. **[inferred]**
- **A project that tries anyway.** [OthmanAdi/loophole](https://github.com/OthmanAdi/loophole) is an MCP server designed to run inside the Extension Host and bind an HTTP server on loopback. Its README says the host is a "persistent Node process", and also lists the SDK's limits: "there is no automation, CC, clip-gain, or routing API; extensions are user-invoked, never auto-triggered", device insertion is built-in devices only, and the SDK package is non-redistributable. It also says there is "no published package, `.ablx`, CLI, or release yet", and that loading in Live and client connectivity are "NOT_RUN". **[third-party]** [README](https://github.com/OthmanAdi/loophole/blob/main/README.md), [CONTRIBUTING](https://github.com/OthmanAdi/loophole/blob/main/CONTRIBUTING.md). So whether an extension can keep a server open between invocations is a claim nobody has shown working. **[unverified]**
- **API reference and licence.** Both are inside the Centercode download, which needs a beta account. Not read. **[unverified]**

## 7. Ableton Link, plain MIDI, and `.als` files

All three are too narrow to be the connection.

**Link.** "a technology that synchronizes musical beat, tempo, and phase across multiple applications". **[verified]** [Link README](https://github.com/Ableton/link/blob/master/README.md), [Live manual 37](https://www.ableton.com/en/live-manual/12/synchronizing-with-link-tempo-follower-and-midi/). A Link peer can read and set the shared tempo and start/stop, and nothing else: no tracks, clips or devices. It is a C++ SDK, so Node needs a native addon, and it is "dual licensed under GPLv2+ and a proprietary license". **[verified]** Link README. Link is in every edition. **[verified]** [Compare editions](https://www.ableton.com/en/live/compare-editions/). Link Audio (audio out of Live) is covered in [the other research note](hearing-live-audio-and-where-the-agent-runs.md).

**Plain or virtual MIDI.** Live maps incoming MIDI notes and CCs to controls the user has assigned by hand in MIDI Map Mode. **[verified]** [Live manual 34.2](https://www.ableton.com/en/live-manual/12/midi-and-key-remote-control/). So it can move a mapped knob or press a mapped button. It cannot read anything, create a track, name a clip or write notes into a clip, and every control needs a manual mapping per Set. **[inferred]** from the manual: MIDI mapping is one-way and per parameter. A virtual port exists on macOS as the IAC Driver. **[verified]** [Apple, Audio MIDI Setup](https://support.apple.com/guide/audio-midi-setup/transfer-midi-information-between-apps-ams1013/mac). Windows equivalent: **[unverified]**. Node has no MIDI module, so this route needs a native addon. **[verified]** by absence in the [Node 22 API index](https://nodejs.org/docs/latest-v22.x/api/). It is the only option here that cannot be done with built-ins.

**`.als` files.** A saved Set is gzip-compressed XML: a template on this machine is "gzip compressed data" and starts with `<Ableton MajorVersion="5" MinorVersion="12.0_12300" … Creator="Ableton Live 12.3.2">` followed by `<LiveSet>` and `<Tracks>`. **[local]** Node can read it with `node:zlib`. Ableton does not publish this format. **[unverified]** (no specification found in the help centre; the only published Ableton file spec found was for `.ascl` tuning files). The file is the Set as last saved, not as it is now, and Live does not reload a file changed on disk, so writing it cannot change the running Set. **[inferred]** It could serve a read-only "look at this project" feature, with a format that can change in any release.

## Recommendation

**Use a Remote Script with a local socket. Prototype against the ableton-js Remote Script, spoken to from Node with the built-in `WebSocket` and JSON. Keep AbletonOSC as the fallback, and an own Remote Script as the place this probably ends.**

Reasoning:

1. **A Remote Script is the only mechanism that works without Max for Live and outside the beta.** Max for Live shuts out Standard users without the add-on and all Intro users, and a device must be added to every Set. The Extensions SDK is the right long-term answer in principle (official, JavaScript, documented) but is beta-only, Suite-only and run-once today.
2. **It keeps the repo at zero runtime dependencies.** All three Remote Script protocols can be spoken with `node:net`, `node:dgram` or the global `WebSocket`.
3. **Of the existing scripts, ableton-js fits an agent best.** Every request carries an id and gets a typed result or error back on the same connection, so a failed tool call can become a tool result that says why. It binds to loopback by default. It covers the four tools the fake has today and the likely next ones (notes, devices, parameters, loading devices, arrangement clips). It is the most actively maintained.
4. **AbletonOSC is simpler but weaker for this use.** No request id, errors on a side channel, UDP, a fixed reply port, bound to every interface, no device loading, and no commits for 11 months. Its advantages are a stable, documented address space and that it is already installed on the maintainer's machine.
5. **Depending on someone else's script has a cost either way.** The user installs a third-party folder, and its wire protocol is not ours (ableton-js changed it a month ago). An own script removes that, costs a Python file tree in a TypeScript repo, and is cheap to start once a prototype has shown which LOM calls the tools really need. The connection should sit behind one interface in the tool set, so the fake Ableton stays as the offline test double and the script behind it can be swapped.

This rests on reading code, not on running it. See [What was not verified](#what-was-not-verified).

## Open questions for the maintainer

1. Which Remote Script: ableton-js's, AbletonOSC, or our own from the start?
2. If ableton-js: add the `ableton-js` npm package (4 runtime dependencies, a typed client, reconnect and heartbeat for free), or write a small client on the built-in `WebSocket` and stay at zero dependencies?
3. If a third-party script: does the user install it themselves from its upstream, or does this repo ship a pinned copy (MIT allows it) and install it with a command?
4. Is Python source in this repo acceptable, and where does it live (`packages/tools/src/daws/ableton/` or a folder outside the TypeScript packages)? How is it checked, given `pnpm check` cannot run it?
5. Who starts the connection and when: on the first tool call, or when the mentor is created? What does a tool return when Live is not running or the script is not selected?
6. Which Live versions to support: 12 only, or 11 as well (all three scripts claim 11+)?
7. Is Max for Live ever acceptable as a requirement? This note and the audio note both keep a thin Max for Live device as a possible second component; one device could do both jobs.
8. How do tools name things? The fake addresses a track by name; every real mechanism addresses it by index or by an object id that changes when tracks move.
9. Does the mentor need to observe changes (listeners), or is reading state at the start of each tool call enough for now?
10. Which changes need approval? `delete_track` does today. Live has one undo history, and a tool call may or may not be one undo step.
11. Should the tool set revisit the Extensions SDK when it leaves beta, and what would trigger that?
12. Windows: nothing here was run on Windows. Is Windows in scope for the first version?

## Prototype results

A throwaway prototype was run on 2026-10-13 against a real Live Set on this machine: Live 12 Suite 12.3.2 (macOS), the ableton-js Remote Script v5.0.4 copied unchanged into the User Library, and a client written on Node's built-in `WebSocket` with no npm package. The scripts lived outside the repo. Everything in this section is **[local]** unless marked otherwise. One Set and one machine: read the numbers as an example, not as a rule.

### The connection

- The script loaded in Live 12.3.2 and listened on `127.0.0.1:39031`. The client connected with no dependency.
- A request is `{"uuid", "commands": [{"ns", "nsid", "name", "args"}]}`. The reply is `{"event": "result", "uuid", "data": [{"ok", "data"} | {"ok": false, "error", "errorType"}]}`. One message can carry several commands; the prototype sent one per message.
- Reading the whole Set (58 tracks, 4 returns, Main, every device with its parameters, the first clips of each track) took about 16 seconds at one command per message. Live's log held one `main thread is lagging, delta: 686ms` warning from the script, written before the client connected.
- Writes worked: create an audio track, select it, load a plug-in from the browser onto it, delete the track.

### What can be read

- **Native devices: all of it.** EQ Eight gave 84 parameters, Compressor 23, Simpler 33 to 83, Limiter 13, and devices inside racks and chains were reachable.
- **MIDI notes: all of it.** `get_notes_extended` returned notes for every MIDI clip tried.
- **Audio clips: partly.** `file_path` was a real path for 33 of 147 arrangement audio clips and an empty string for the other 114. None of those tracks was frozen. `sample_length`, `sample_rate`, `warping`, `gain` and `pitch_coarse` were readable on the clips with an empty path. The maintainer's explanation is that the samples were moved from one cloud folder to another, so Live cannot find the files. **[inferred]** An empty `file_path` then means a missing sample; this was not confirmed against Live's missing-files list.
- **Plug-in presets: none.** `presets` returned one entry for every plug-in.

### Third-party plug-ins

- Of 127 plug-in instances in the Set, 70 exposed only `Device On`. That included every FabFilter Pro-Q 4 (39 instances) and Pro-Q 3 (10), Pro-MB, Smooth Operator Pro, and most LFOTool and Serum 2 instances.
- Other plug-ins exposed some or all parameters: Nexus 46, Pro-C 2 43, EchoBoy 25, ValhallaRoom 23, OTT 20, Simplon 18 to 19, Pro-L 2 17, Decapitator 12.
- Instances of the same plug-in differed (Serum 2: 1, 2, 3, 6 or 7 parameters). **[inferred]** Live exposes only the parameters in the device's Configure list, which the user fills by hand or by automating a parameter.
- `PluginDevice.get_parameter_names` lists a plug-in's full parameter names without that list: 713 for a fresh Pro-Q 4 (VST3), 2,623 for Serum 2. It returns names only, no values. On the Pro-Q instances already in the Set it returned nothing, while fresh instances of the same plug-in returned the full list; the cause is **[unverified]**.

### The `PluginAutoPopulateThreshold` option

Ableton documents `-_PluginAutoPopulateThreshold=X` in `Options.txt`: Live fills the Configure list on its own when a plug-in has at most X parameters, default 64, maximum 128. **[verified]** [Options.txt file](https://help.ableton.com/hc/en-us/articles/6003224107292). A 2019 forum post says the option was removed. **[third-party]** [Ableton forum](https://forum.ableton.com/viewtopic.php?p=1761660). The Live 12.3.2 binary still contains a function named `SAutoPopulateParameterCountThreshold`, and the tests below show the option changes behaviour.

Each test loaded fresh instances on a temporary track after a restart of Live. The count is exposed parameters without `Device On`; the number in brackets is what the plug-in reports through `get_parameter_names`.

| Plug-in | Format | Value `-1` | Value `1000` |
| --- | --- | --- | --- |
| Pro-Q 4 | AU (576) | 0 | 128 |
| Pro-Q 4 | VST2 (576) | 0 | 0 |
| Pro-Q 4 | VST3 (713) | 0 | 0 |
| Pro-Q 3 | AU (358) | 0 | 128 |
| Pro-Q 3 | VST2 (382), VST3 (519) | 0 | 0 |
| Smooth Operator Pro | AU (212) | 1 | 128 |
| Smooth Operator Pro | VST2, VST3 (212) | 0 | 0 |
| H-Delay Stereo | VST3 (148) | 0 | 0 |
| Pro-C 2 | AU (46) | 0 | 41 |
| Pro-C 2 | VST2 (46) | 0 | 46 |
| Pro-C 2 | VST3 (183) | 0 | 42 |
| EchoBoy | AU, VST2 (25) | 0 | 25 |
| EchoBoy | VST3 (25) | 0 | 24 |
| Kickstart 2 | VST2 (12) | 0 | 12 |
| Kickstart 2 | AU (12), VST3 (2,093) | 0 | 5 |

What this shows:

- `-1` does not mean "no limit", as forum posts claim. With `-1` nothing was filled, not even a 25-parameter plug-in.
- No format exposed more than 128 parameters with the value at 1000. **[inferred]** Values above 128 are clamped.
- VST2 and VST3 are all or nothing: over the limit, the list stays empty. An Audio Unit over the limit gets its first 128 parameters in the plug-in's own order. For Pro-Q 3 (12 parameters per band) that is bands 1 to 10 in full; for Pro-Q 4 (20 per band) bands 1 to 6 and part of band 7.
- For VST3 the count Live compares is not the count `get_parameter_names` reports: Pro-C 2 reports 183 and was filled, Kickstart 2 reports 2,093 and got 5. **[inferred]** Live counts only some parameters, probably the automatable ones.
- The option did not change the 127 instances already saved in the Set. It applies when an instance is created.
- Not tested: no option at all (the default of 64), and the value 128 itself.

### What follows

- The Remote Script route is enough to read and change the Live Set, native devices and MIDI.
- It is not enough for third-party plug-ins. What the mentor can read there depends on the plug-in's size and format, and on what the user configured. A plug-in that reports only `Device On` is one the mentor cannot read, and it can tell.
- How to reach third-party plug-in settings another way is an open research question. Hearing the audio is covered in [the other research note](hearing-live-audio-and-where-the-agent-runs.md).

## Checked in Live 12.4.6

On 2026-10-14 a throwaway script, kept outside the repo, tried the connection facts that [#3](https://github.com/amitbaz/music-production-ai-mentor/issues/3) listed. Machine: Live 12 Suite **12.4.6** (2026-09-10 build) on macOS, the ableton-js Remote Script **5.0.4**, Node 22.23.3 with the built-in `WebSocket`. Everything here is **[local]**, seen once on one machine. What the checks showed about parameters, clips and automation is in [what Live lets a script do](what-live-lets-a-script-do.md#checked-in-live-1246).

- **The script loads and answers.** It listened on `127.0.0.1:39031`. `internal.get_prop version` answered `5.0.4`; `application.get_prop` gave `major_version` 12, `minor_version` 4, `bugfix_version` 6. Both checks the client needs on connect work.
- **Python.** Live 12.4.6 embeds Python **3.11.6** (`sys.version`, read through our own file below).
- **Our own file registers with one added line.** A file `Mentor.py` at the top of the script folder, with a class built on the script's `Interface`, was registered by one line added to the `handlers` table in `AbletonJS.py`:

  ```python
  "mentor": __import__("Mentor", globals(), None, ["Mentor"], 1).Mentor(c_instance, self.socket),
  ```

  The inline `__import__` keeps it to one line, with no import at the top of the file. A command with `ns: "mentor"` reached the file's function, and its result came back like any other. No other upstream file was changed.
- **The password works as the source reads.** With `PASSWORD` set in `Config.py`, the `connect` event carries `requiresAuth: true` and a `salt`. The client answers with the first command `internal.authenticate`, `{ hash: HMAC-SHA256(key = password, message = salt) }` in hex.
  - Right password: `{ ok: true, data: true }`, and later commands run.
  - Wrong password: an `error` event `"Invalid password"`, then the script closes the socket (the client saw close code 1006).
  - No authentication: every command gets an `error` event `"Unauthorized"`, and the socket stays open.
- **A web page and the port.** The script does not check the `Origin` header. An upgrade request sent with `Origin: https://evil.example` got `101 Switching Protocols` and the `connect` event, with the password off and with it on. It also serves an HTML page at `GET /` without asking for anything.
  - Password off: such a page can send any command.
  - Password on: the page sees the salt, but its command, a tempo change, was answered `"Unauthorized"` and the tempo did not change. A page without the password cannot act, and each wrong guess costs it a new connection.
  - Browser-side limits on public pages reaching `127.0.0.1` were not tried.
- **Another Live Set loaded.** The script sends a `disconnect` event, closes the socket (code 1005) and starts again. A new connection about one second later worked and authenticated. An id from before was answered `Unknown object id`, because the script empties its id table when it starts again. The client sees a lost connection, so its own table is emptied by the rule it already has.
- **An object deleted while connected.** The script keeps the old Python wrapper in its table, so its id is still known. Reading or writing through it fails with `errorType: "ArgumentError"` and a message that names a C++ signature, for example `Python argument types in None.None(Track) did not match C++ signature: None(TTrackPyHandle)`. That was the same for a track, a device, a parameter and an arrangement clip. A wrong argument type on a live object gives the same `ArgumentError` (a parameter set to `"Bell"` instead of a number), so the client can only read it as "deleted" after it has checked the argument types itself. An id the script never gave out is answered `Unknown object id: …`.

## What was not verified

- **Timing and undo.** The prototype in [Prototype results](#prototype-results) sent real commands, but latency per call, tick length, behaviour under load, and whether each call is one undo step were not measured.
- The Python Remote Script API has no official reference. Every claim about what it can do comes from third-party code or from the Max for Live LOM reference.
- Whether third-party Remote Scripts load in Live Intro and Lite.
- The Python version embedded in Live 11. Live 12.4.6 embeds 3.11.6 (see [Checked in Live 12.4.6](#checked-in-live-1246)).
- Whether Python threads are safe inside Live. AbletonOSC's author says they hang Live; ableton-js and ableton-mcp use them.
- Whether ableton-mcp works on Live 12.4.6. ableton-js v5.0.4 was seen working on 12.4.6, and AbletonOSC loading on 12.3.2.
- The Extensions SDK API reference and licence text (behind a beta login), and whether an extension can keep a server open between invocations.
- The Node version inside Max for Live's `node.script`.
- A virtual MIDI port on Windows, and the Windows firewall's reaction to AbletonOSC binding `0.0.0.0`.
- The `.als` format beyond the first bytes of one local file.
- The similar MCP projects in section 4 beyond their descriptions.
- Context7 lists ableton-js (`/leolabs/ableton-js`); it was not queried, because the source at the current commit was read directly.

## Local observations

- `/Applications/Ableton Live 12 Suite.app` reports version 12.3.2 (2025-12-15 build). Its `App-Resources/MIDI Remote Scripts` holds 144 entries as `.pyc`.
- `~/Music/Ableton/User Library/Remote Scripts/` contains `AbletonOSC`. `~/Library/Preferences/Ableton/Live 12.3.2/Log.txt` has `Python: INFO:abletonosc` lines, so it has been loaded by Live 12.3.2.
- A template `.als` in the User Library is gzip data whose content starts with the XML shown in section 7.
- `node --version` is v22.23.3; the packages test with `node --test`.

## Sources

Ableton
- [Live 12 release notes](https://www.ableton.com/en/release-notes/live-12/), [Live 12 beta release notes](https://www.ableton.com/en/release-notes/live-12-beta/), [Live 11 release notes](https://www.ableton.com/en/release-notes/live-11/)
- [Extensions page](https://www.ableton.com/en/live/extensions/), [Extensions SDK landing page](https://ableton.github.io/extensions-sdk/), [Ableton Extensions FAQ](https://help.ableton.com/hc/en-us/articles/27303428331420-Ableton-Extensions-FAQ)
- [Installing third-party remote scripts](https://help.ableton.com/hc/en-us/articles/209072009-Installing-third-party-remote-scripts), [Using Control Surfaces](https://help.ableton.com/hc/en-us/articles/209774285-Using-Control-Surfaces), [Creating your own Control Surface script](https://help.ableton.com/hc/en-us/articles/206240184-Creating-your-own-Control-Surface-script), [Buying Max for Live](https://help.ableton.com/hc/en-us/articles/206407124-Buying-Max-for-Live) (help centre articles were read through the Help Centre API)
- [Live manual: MIDI and Key Remote Control](https://www.ableton.com/en/live-manual/12/midi-and-key-remote-control/), [Synchronizing with Link…](https://www.ableton.com/en/live-manual/12/synchronizing-with-link-tempo-follower-and-midi/), [Compare editions](https://www.ableton.com/en/live/compare-editions/)
- [Ableton/link README](https://github.com/Ableton/link/blob/master/README.md)

Cycling '74
- [Live Object Model](https://docs.cycling74.com/apiref/lom/): [Song](https://docs.cycling74.com/apiref/lom/song/), [Track](https://docs.cycling74.com/apiref/lom/track/), [Clip](https://docs.cycling74.com/apiref/lom/clip/), [DeviceParameter](https://docs.cycling74.com/apiref/lom/deviceparameter/)
- [Live API overview](https://docs.cycling74.com/userguide/m4l/live_api_overview/), [LiveAPI (JavaScript)](https://docs.cycling74.com/apiref/js/liveapi/), [live.object](https://docs.cycling74.com/reference/live.object/), [live.observer](https://docs.cycling74.com/reference/live.observer/), [node.script](https://docs.cycling74.com/reference/node.script/), [udpreceive](https://docs.cycling74.com/reference/udpreceive/), [Max for Live limitations](https://docs.cycling74.com/userguide/m4l/live_limitations/)

Projects (source read at the commits named at the top)
- [ideoforms/AbletonOSC](https://github.com/ideoforms/AbletonOSC)
- [leolabs/ableton-js](https://github.com/leolabs/ableton-js)
- [ahujasid/ableton-mcp](https://github.com/ahujasid/ableton-mcp)
- [adamjmurray/producer-pal](https://github.com/adamjmurray/producer-pal), [producer-pal.org](https://producer-pal.org)
- [OthmanAdi/loophole](https://github.com/OthmanAdi/loophole) (README and CONTRIBUTING only)
- [gluon/AbletonLive12_MIDIRemoteScripts](https://github.com/gluon/AbletonLive12_MIDIRemoteScripts) (unofficial, README only)

Specs and platforms
- [OSC 1.0 specification](https://opensoundcontrol.stanford.edu/spec-1_0.html)
- [Node.js 22 globals](https://nodejs.org/docs/latest-v22.x/api/globals.html)
- [Apple: transfer MIDI information between apps (IAC Driver)](https://support.apple.com/guide/audio-midi-setup/transfer-midi-information-between-apps-ams1013/mac)
