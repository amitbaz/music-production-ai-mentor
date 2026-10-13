# Research — reaching the settings of third-party plug-ins in a running Live Set

Date: 2026-10-13 · Status: research note, not a decision

The question: how can an external agent read and change the settings of third-party plug-ins (VST2, VST3, Audio Unit) that sit in a running Live Set, beyond what Live's own API exposes? This follows the [Prototype results](connecting-to-ableton-live.md#prototype-results) of the connection note, where 70 of 127 plug-in instances in a real Set exposed only `Device On`. Hearing the audio is covered in [the audio note](hearing-live-audio-and-where-the-agent-runs.md) and is not repeated here.

Versions this note was checked against: Live 12.4.6 (current release, [release notes](https://www.ableton.com/en/release-notes/live-12/)); the Live Object Model reference ([LOM](https://docs.cycling74.com/apiref/lom/)); the Max `vst~` reference ([vst~](https://docs.cycling74.com/reference/vst~/)); VST 3 SDK at `3cdf9ca` (2026-08-11); JUCE 9.0.4 (2026-10-12). The machine has Live 12 Suite **12.3.2**, macOS 27, Node 22.23.3.

Third-party code was read at these commits: pedalboard `05e8f0b` (v0.9.26, 2026-10-07), DawDreamer `e0daff3` (v0.9.0 line, 2026-10-02), Producer Pal `52a4c21` (2026-10-02), Ubermap (tomduncalf, last push 2023-02-05), node-serum2-preset-packager `37489da`, serum-preset-packager `ccf7bb6`, preset-toolkit `7b3e8ee`, WhyCremisi `8981fb3`.

Markers: **[verified]** read in the linked primary source during this research · **[code]** read in the project's source at the commit above · **[local]** observed on this machine, by reading files only; nothing was sent to Live · **[third-party]** stated by a project or a forum about something it does not own · **[inferred]** my reasoning from verified facts · **[unverified]** could not confirm.

## Short answer

"The agent can only listen" is not the only answer. Three things came out of this research that change the picture:

1. **The Set file holds every plug-in's full state, and for several popular plug-ins that state is readable without loading the plug-in.** In the local Sets, a FabFilter Pro-Q 4 (VST2) state is a 12-byte header and one 32-bit float per parameter, in real units (a band frequency is stored as log2 of Hz). Valhalla and other JUCE-built plug-ins store XML with one attribute per parameter. Serum 2 stores a JSON header and a zstd-compressed body. **[local]** This is a READ of the Set as last saved, with `node:zlib` and nothing else.
2. **Where the state is opaque, a second copy of the plug-in loaded in our own process (a "shadow host") can decode it.** The libraries exist and take a state blob. All of them are native code, and the Python ones are GPLv3.
3. **Live's own list is capped at 128 parameters per instance, and no API call adds to it.** The Set file stores the list as a fixed array of 128 slots in every one of 101 plug-in devices inspected. **[local]** So the Configure list can never show all of Pro-Q 4 (576 to 713 parameters), whatever fills it.

No route gives a live, general WRITE to a plug-in that is not in the Configure list. The realistic write paths are the Configure list (filled by the user, by the `Options.txt` threshold, or by a default configuration file), and replacing the whole state through a preset file.

| Route | Read / write | Existing instances | User cost | Our build cost | Dependency or native code | Licence risk | Confidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **1a. Configure list, by API** | — | — | — | — | — | — | High that no such call exists in 12.3.2 |
| **1b. Configure list, filled by the user on request** | Both, live | Yes | A few clicks per parameter, per instance; max 128 | None | None | None | High |
| **1c. Default configuration files (`.appc`) + threshold option** | Both, live | No, new instances only | Accept files in the User Library; maybe one `Options.txt` line | Small: generate JSON files | None | None | Medium: file format seen, effect on Live not tested |
| **2a. Read plug-in state from the `.als`, decode known formats** | Read, as last saved | Yes | Save the Set | Small per format; grows per plug-in | None (`node:zlib`) | Low: formats are undocumented vendor formats | High for FabFilter and JUCE XML locally; per plug-in otherwise |
| **2b. Edit the `.als` to fill the list** | Makes 1b automatic | Yes, after close and reopen | Close and reopen the Set | Medium | None | None | Low: untested, can damage a Set |
| **3. Shadow host fed from the `.als`** | Read, as last saved | Yes (VST3, AU; VST2 is harder) | Install a helper | Medium to large | Native: Python + pedalboard / DawDreamer, or our own C++ helper | GPLv3 (pedalboard, DawDreamer), AGPLv3 or paid (JUCE), MIT (VST 3 SDK) | Medium: API confirmed, not run |
| **4. Wrapper plug-in** | Both, live, all parameters | No: each plug-in must be re-inserted inside the wrapper | Install our plug-in, rebuild chains | Large: a signed C++ plug-in on two platforms | Native C++ | Same as a C++ shadow host | Medium |
| **5. Max for Live device around `vst~`** | Both, live, all parameters | No: same as the wrapper | Suite or Max for Live; re-insert plug-ins | Medium: a Max patch | Max for Live | None | Medium: reference read, not run in Live |
| **6. Vendor preset files** | Same decoders as 2a | — | — | — | — | — | — |
| **7. Capture the plug-in window, read it with a vision model** | Read, live, including unsaved changes | Yes | Screen Recording permission; Live 12.4.3+ to open windows by API | Small to medium | A capture helper (`screencapture` on macOS; native on Windows) | None | Low: accuracy not measured |
| **8. Whole-state write through a preset file** | Write, whole state | Yes, if Live loads the preset onto the device | None | Medium, needs 2a or 3 first | Same as 2a or 3 | Same | Low: not tested |

Routes 2a and 7 are the two that reach instances already in a Set with little or no native code. They are the recommendation; see [Recommendation](#recommendation).

## 1. Filling the Configure list

**What the list is.** Live shows a plug-in's parameters in its own panel only when they are in the device's list. "Plug-ins that contain more than 64 parameters will open with an empty panel, which you can then configure." The user adds one by pressing Configure and clicking the control in the plug-in window; "For some plug-ins, it may be necessary to actually change the parameter's value", and "certain plug-ins do not 'publish' all of their parameters to Live. These parameters cannot be added." The list is "unique for each instance of a given plug-in in your Set, and … saved with the Set." **[verified]** [Live manual 24.1.2](https://www.ableton.com/en/live-manual/12/using-plug-ins/)

Three other user actions add a parameter without Configure Mode: editing its automation after touching it in the plug-in window, recording automation while moving it, and moving it while in MIDI, key or Macro mapping mode. **[verified]** same section. All four need a hand on the plug-in's own window.

**No API call adds a parameter.**

- The LOM's `PluginDevice` has three members of its own: `is_editor_open`, `presets`, `selected_preset_index`. `Device` adds nothing that touches the list. `Device.parameters` is "get, observe". **[verified]** [PluginDevice](https://docs.cycling74.com/apiref/lom/plugindevice/), [Device](https://docs.cycling74.com/apiref/lom/device/)
- The Live 12.3.2 binary carries the Python docstrings for `Live.PluginDevice`: `presets`, `selected_preset_index`, and `get_parameter_names` ("Get the range of plugin parameter names, bound by begin and end"). Nothing else. `is_editor_open` is not in this binary. **[local]** (`strings` on the application binary)
- So neither the Max for Live API nor the Python API can add a parameter, read a value outside the list, or read the plug-in's state. **[inferred]** from the two points above. A hidden member that is neither documented nor carries a docstring cannot be ruled out. **[unverified]**

**The list is capped at 128.** In the local Sets every `PluginDevice` has a `ParameterList` of exactly 128 `PluginFloatParameter` elements; an empty slot has `ParameterId` −1. That held for all 101 plug-in devices in the three Sets that have any, and the largest number of used slots was 42. **[local]** Producer Pal's documentation says the same from the user's side: "You map them yourself, up to 128 parameters". **[third-party]** [limitations.md](https://github.com/adamjmurray/producer-pal/blob/52a4c21/docs/features/limitations.md). A hand-configured list is therefore not unlimited. **[inferred]**

**The threshold option, one gap in the earlier test.** Ableton's article says of `-_PluginAutoPopulateThreshold`: "Default = 64, Min = 1, Max = 128", and "128 will always populate the list with max. 128 parameters, regardless of how many parameters the plug-in has." **[verified]** [Options.txt file](https://help.ableton.com/hc/en-us/articles/6003224107292) (read through the Help Centre API). The earlier prototype tested `-1` and `1000` and found VST2 and VST3 all-or-nothing; it did not test `128` itself. By the article's wording, exactly `128` should give VST2 and VST3 their first 128 parameters too. Whether it does: **[unverified]**, and cheap to test.

**Default configuration files.** "You can save the parameter configuration for a VST or Audio Units plug-in as a default. Add the parameters you want to include in Configure Mode, then select the Save as Default Configuration option". The file goes to "its respective folder, either Audio Units or VSTs, in the Plug-In Configurations folder", and "plug-in defaults do not retain any parameter values: only the parameters that have been added to the device panel". **[verified]** [Live manual 23.2.6.2](https://www.ableton.com/en/live-manual/12/working-with-instruments-and-effects/)

On this machine they are at `~/Music/Ableton/User Library/Defaults/Plug-in Configurations/VSTs/<plug-in name>/Default.appc`. The file is plain JSON, not gzip: **[local]**

```json
{
  "id": "application/vnd.ableton.plugin-configuration",
  "version": "1.0",
  "device-id": "device:vst:instr:1315073900?n=Bolt",
  "mpe-enabled": false,
  "groups": [
    { "name": "Default", "parameters": [
      { "name": "O1 Detune", "id": 4, "x-slot": 0, "y-slot": 0 }
    ] }
  ]
}
```

- `device-id` carries the format, the kind and the plug-in's numeric id; a parameter is a name, an id and a position. For this VST2 plug-in the ids are small integers, which look like parameter indexes. **[local]**, **[inferred]**. The folder name and the id form for VST3 and Audio Units were not seen: only VST2 files exist here. **[unverified]**
- Such files could be generated and shipped for popular plug-ins: the 128 most useful parameters of Pro-Q 4, for example. The names and order are available from `get_parameter_names`. **[inferred]** What the ids must be for VST3 (the Set file stores large numbers such as `1262808749` as `ParameterId` for VST3 parameters, **[local]**) needs a fresh instance or a shadow host to find out. **[inferred]**
- They are defaults, so they should apply only when an instance is created, like the threshold option. Whether Live applies one to an instance already in a Set: **[unverified]**, expected no.
- Writing into the user's Library is a change to the user's Live setup and needs their consent. **[inferred]**

**What this route gives.** For instances the user creates from now on, up to 128 chosen parameters per plug-in, readable and writable live through the Remote Script that already works. For the instances already in a Set, nothing, unless the user configures them by hand. The mentor can ask for exactly that ("press Configure on the Pro-Q on the vocal bus and click the band 3 gain"), then read and set the parameter. That costs no code, and it is the workaround Producer Pal documents. **[inferred]**

## 2. The `.als` file

**Where the file is.** `Song.file_path`: "The path to the current Live Set, in OS-native format. If the Live Set hasn't been saved, the path is empty." Access: get. **[verified]** [Song](https://docs.cycling74.com/apiref/lom/song/). That the Python API in 12.3.2 has the same member: **[unverified]**, one call to check.

**How a plug-in device is stored.** Read from three local Sets written by Live 12.0.1, 12.1.1 and 12.3.2 (element names only; no Set content is reproduced here). **[local]**

- A `PluginDevice` has a `PluginDesc` holding one of `VstPluginInfo`, `Vst3PluginInfo` or, by the names in Producer Pal's reader, `AuPluginInfo`. No Audio Unit instance exists in the local Sets or the User Library, so the Audio Unit layout was not seen. **[local]**, **[code]** [`read-als.mjs` L178–181](https://github.com/adamjmurray/producer-pal/blob/52a4c21/examples/skills/ableton-read-als/read-als.mjs#L178-L181)
- **VST2:** `PlugName`, `UniqueId`, `NumberOfParameters`, and `Preset/VstPreset` with `Type` (`FBCh` or `FxBk`, the VST2 bank kinds), `ProgramNumber` and `Buffer`, the plug-in's chunk as hex text.
- **VST3:** `Name`, `Uid` (four 32-bit fields, the class id), and `Preset/Vst3Preset` with `ProcessorState` and `ControllerState` as hex text. These are the two states the VST 3 preset format also stores. **[verified]** [VST 3 preset format](https://steinbergmedia.github.io/vst3_dev_portal/pages/Technical+Documentation/Locations+Format/Preset+Format.html)
- **The list:** `ParameterList` with 128 `PluginFloatParameter` slots, each with `ParameterName`, `ParameterId`, `VisualIndex` and a `ParameterValue` that holds `Manual` (the value), `AutomationTarget` and `ModulationTarget`.
- Also `WinPosX` / `WinPosY`, the last position of the plug-in window.

So the full state of every plug-in is in the file, whether or not the list is empty. **[local]**

**What the state looks like, by plug-in.** First bytes of the stored state in the local Sets: **[local]**

| Plug-in (format) | State starts with | Readable without the plug-in? |
| --- | --- | --- |
| FabFilter Pro-Q 4, Pro-Q 3 (VST2); Pro-R 2 (VST3) | `FFBS`, version, parameter count, then 32-bit floats | Yes. Pro-Q 4: count 576, equal to `NumberOfParameters`; a default band reads `1.0, 9.966, 0.0, 0.5 …`, and 2^9.966 = 1000 Hz |
| FabFilter Pro-C 2, Pro-L 2, Pro-DS (VST3) | `FabF`, a preset name, then floats | Likely, same family; layout not decoded |
| ValhallaRoom, VintageVerb, Supermassive (VST3) | `VstW` … `CcnK` … `FBCh` … `VC2!` then XML | Yes: one XML attribute per parameter, values 0 to 1 |
| Soundtoys EchoBoy, Decapitator; SSL; IK TR5; MetricAB (VST3) | `VstW` … `CcnK`, 84–92% printable text | Probably; content not decoded |
| The Glue, SoundID Reference (VST2) | `VC2!` then XML | Yes |
| Serum 2 (VST3) | `XferJson`, a JSON header, then a zstd frame (`28 b5 2f fd`) | Body needs zstd and a format reader |
| Smooth Operator Pro (VST3) | `smopro_state`, 63% text | Not decoded |
| Kickstart 2 (VST3) | `#zip#` | Not decoded |
| LFOTool (VST2), Transient Master, SPAN (VST3) | Binary | No |

- `VstW` is the header the VST 3 SDK writes when a VST3 plug-in keeps VST2-compatible state, wrapping a `CcnK` bank. **[code]** [`vst2persistence.cpp` L277–282](https://github.com/steinbergmedia/vst3_public_sdk/blob/master/source/vst/utility/vst2persistence.cpp#L277-L282). `VC2!` followed by XML is the form JUCE-built plug-ins commonly store. **[inferred]** from the bytes; the JUCE source for it was not read.
- Node 22 can do all of this with built-ins: `zlib.gunzipSync` for the Set and `zlib.zstdDecompressSync` for a zstd frame. **[verified]** [Node 22 zlib](https://nodejs.org/docs/latest-v22.x/api/zlib.html)
- Mapping float number N of a FabFilter state to a name needs the plug-in's parameter list in order. `get_parameter_names` on a fresh instance gives 576 names for Pro-Q 4 VST2, the same count as the state. That the order matches: **[inferred]**, to be proven.
- Values come in two kinds: real units (FabFilter) and normalised 0 to 1 (Valhalla XML, and the list's `Manual`). A normalised value needs the plug-in's own scaling to become "2.4 kHz". **[inferred]**

**How fresh it is.** The file is written when the user saves. Nothing in the LOM exposes a "modified" flag or a save call that was checked here, so the reader cannot know how stale the file is, and cannot make it fresh. **[inferred]**, **[unverified]** Live also keeps crash-recovery folders (`BaseFiles`, `Undo`, `CrashRecoveryInfo.cfg`) under its preferences folder; their format was not looked at. **[local]**

**Editing the file to fill the list.** The structure makes it look possible: fill empty slots with a name, an id and a position. **[inferred]** The risks:

- each slot carries automation and modulation target ids that must be unique in the Set, so the edit is more than three fields; **[inferred]** from the slot layout
- VST3 ids are not indexes and must come from the plug-in;
- Live does not reload a Set changed on disk, so the user must close and reopen it, and an edit made while the Set is open is overwritten by the next save; **[inferred]**
- the format is undocumented and a mistake can make a Set unreadable. Only a copy should ever be written. **[inferred]**

It would still be capped at 128. Not tested. **[unverified]**

**Prior art.** Producer Pal ships a dependency-free `.als` reader as a skill. It reads the configured `ParameterList` of plug-ins, not the state buffers. **[code]** [`read-als.mjs` L504–569](https://github.com/adamjmurray/producer-pal/blob/52a4c21/examples/skills/ableton-read-als/read-als.mjs#L504-L569)

## 3. A shadow host

Load the same plug-in in our own process, hand it the state from the `.als`, and ask it for every parameter with its display text.

**What the plug-in formats allow.** A host can restore state and enumerate parameters in all three formats:

- **VST3:** the SDK ships hosting classes (`module`, `plugprovider`, `hostclasses`, `parameterchanges` in `source/vst/hosting`). **[code]** [vst3_public_sdk](https://github.com/steinbergmedia/vst3_public_sdk/tree/master/source/vst/hosting). The preset file format is published: a `VST3` header, a version, the class id as 32 ASCII characters, and a chunk list. **[verified]** [Preset format](https://steinbergmedia.github.io/vst3_dev_portal/pages/Technical+Documentation/Locations+Format/Preset+Format.html). The `.als` holds the class id and both states, so a `.vstpreset` can be written from it. **[inferred]**
- **Audio Unit:** `AUAudioUnit.fullState` is "A persistable snapshot of the audio unit's properties and parameters", "bridged to the version 2 `kAudioUnitProperty_ClassInfo` API", and `parameterTree` lets hosts "discover a unit's parameters". **[verified]** [fullState](https://developer.apple.com/documentation/audiotoolbox/auaudiounit/fullstate), [parameterTree](https://developer.apple.com/documentation/audiotoolbox/auaudiounit/parametertree). macOS only.
- **VST2:** Steinberg "no longer makes the VST2 SDK available and no longer enters into VST2 license agreements" since October 2018, and a Steinberg employee states that new hosts may not add VST2. **[third-party]** [Steinberg forum, 2020](https://forums.steinberg.net/t/can-i-create-vst-2-support-for-host-application-vst-3-license/202012) (vendor forum, not a licence text). 51 of the 101 local plug-in devices are VST2, among them every Pro-Q. **[local]** Whether a plug-in's VST3 build accepts its VST2 chunk depends on the vendor. **[unverified]**

**Candidates.**

| Candidate | Formats | Takes a state blob? | Runs from | Licence | Status |
| --- | --- | --- | --- | --- | --- |
| **pedalboard** (Spotify) | VST3; AU on macOS. No VST2 | Yes: `raw_state` (get/set bytes), `preset_data` ("bytes in .vstpreset format"), `load_preset(path)` for VST3; `raw_state` for AU | Python | GPL-3.0; it bundles JUCE 6 and the VST3 SDK | v0.9.26, 2026-10-07 |
| **DawDreamer** | "VST 2/3 and Audio Unit"; `.dll`, `.vst3`, `.vst`, `.component` | By file: `load_preset` (FXP), `load_vst3_preset` (`.vstpreset`), `load_state` (its own format) | Python | GPL-3.0 | v0.9.0, 2026-08-12 |
| **JUCE** (own C++ helper) | VST3, AU, others | Yes, by API | C++ | AGPLv3, or the JUCE licence: Starter free up to $20,000 revenue, Indie $40/month, Pro $175/month | 9.0.4, 2026-10-12 |
| **VST 3 SDK** (own C++ helper) | VST3 only | Yes, by API | C++ | MIT; "Licensing under GPLv3 and the Steinberg proprietary license is no longer available" | `3cdf9ca`, 2026-08-11 |
| **AudioToolbox** (own Swift or C helper) | AU only, macOS only | Yes, `fullState` | Swift / C | Apple SDK | — |

Sources: **[code]** pedalboard [`ExternalPlugin.h` L1672–1730, L1936–1950](https://github.com/spotify/pedalboard/blob/05e8f0b/pedalboard/ExternalPlugin.h), **[verified]** [pedalboard README](https://github.com/spotify/pedalboard/blob/05e8f0b/README.md), [DawDreamer plugin processor guide](https://dbraun.github.io/DawDreamer/user_guide/plugin_processor.html), [JUCE LICENSE.md](https://github.com/juce-framework/JUCE/blob/master/LICENSE.md), [Get JUCE](https://juce.com/get-juce/), [VST 3 SDK README](https://github.com/steinbergmedia/vst3sdk/blob/master/README.md) and [LICENSE](https://github.com/steinbergmedia/vst3sdk/blob/master/LICENSE.txt).

- **Nothing callable from Node was found.** An npm search for a VST3 host returned no relevant package. **[verified]** npm registry search, 2026-10-13. So this route is a second process the mentor starts and talks to. **[inferred]**
- pedalboard warns that "providing invalid data may cause the plugin to crash, taking the entire Python process down with it". **[code]** same file. A separate process contains that. **[inferred]**
- The format of pedalboard's `raw_state` for VST3 is JUCE's own wrapping, not the raw processor state, so Live's blobs go in through `preset_data` or a `.vstpreset` file. **[inferred]** from the two property docs; not run.
- **GPL.** Starting a user-installed GPL program and reading its output is the same open legal question the connection note left for Producer Pal. Shipping pedalboard or DawDreamer inside our product is a different matter and would bring GPLv3 duties. This note does not answer either.
- **Copy protection.** A second host loads the same licensed plug-in on the same machine, which is what a second DAW does. Plug-ins that check a licence at load may show a dialog or need their licence service running, and a host with no window may hang on that. **[inferred]** No vendor statement was found. **[unverified]**
- **It reads the saved state, not the live one.** Same limit as route 2. A shadow instance is a different instance: changing it does not change the one in Live. **[inferred]**

## 4. A wrapper plug-in

Our own VST3 or Audio Unit that hosts the third-party plug-in inside it, sees every parameter at all times, and talks to the mentor over a local socket.

- **Products that host plug-ins inside a plug-in.**
  - Blue Cat's PatchWork "can host up to 64 VST, VST3, Audio Unit or built-in plug-ins … in a single instance", and maps inner parameters to the DAW through a learn mode: "up to 40 controls are available". **[verified]** [PatchWork manual](https://www.bluecataudio.com/Doc/Product_PatchWork/)
  - DDMF Metaplugin: "Automate up to 100 parameters by mapping them on any parameter of a loaded plugin". **[verified]** [product page](https://ddmf.eu/metaplugin-chainer-vst-au-rtas-aax-wrapper/)
  - Kushview Element: "a modular AU/LV2/VST/VST3/CLAP audio plugin host" that "Runs standalone or as a plugin in your DAW". **[verified]** [README](https://github.com/kushview/element/blob/main/README.md). Its licence and what it exposes to the DAW were not read. **[unverified]**
  - PluginGuru Unify and NI Komplete Kontrol: not confirmed from a primary source. **[unverified]**
- **The pattern.** Each of the two read here gives the DAW a small fixed set of its own parameters and maps inner ones onto them. None publishes the inner plug-in's full parameter list to the DAW. **[inferred]** That is the DAW-facing side; our wrapper would not need it, because it would talk to the mentor directly.
- **Build cost.** A C++ plug-in in at least two formats, hosting three formats, on macOS and Windows, code-signed and notarised, with an installer, plus state saving, latency reporting, side-chain and multi-output handling, and the inner plug-in's window. It is the largest item in this note. **[inferred]**
- **Existing Sets.** Nothing changes for plug-ins used directly. Each one must be removed and re-inserted inside the wrapper, with its state carried over by a preset. The 127 instances of the prototype Set would all be manual work. **[inferred]**
- **A project that claims this.** WhyCremisi describes itself as a "VST3/AU plugin that auto-discovers every parameter of every plugin in your DAW". Its README puts it on the master channel and shows OSC and WebSocket bridges; one star, marked beta. How one plug-in would see other plug-ins in the host was not found in the README. **[third-party]** [WhyCremisi](https://github.com/OfficialWhyEd/WhyCremisi); mechanism **[unverified]**. A plug-in has no API to reach its siblings in a host. **[inferred]**

## 5. Max for Live `vst~`

`vst~` will "load a real-time VST, VST3 or Audio Unit plug-in and use its audio processing". **[verified]** [vst~](https://docs.cycling74.com/reference/vst~/). A Max for Live device built around it is a wrapper (route 4) without C++.

- **Read.** `params` sends the list of parameter names; `get N` or `get <name>` reports "the current parameter value (a float between 0 and 1)"; `get -4` gives the parameter count. With the `valuemode` attribute the object sends the value as a number, as the plug-in's display text ("2 -6dB"), or both. **[verified]** same page
- **Write.** A list of parameter number (from 1) and a value from 0 to 1, or a parameter name and a value. **[verified]**
- **Window.** `open` and `wclose` open and close the plug-in's window. **[verified]**
- **State.** `read` loads "a file of effect programs, either in bank or individual program format"; `write`, `writebank`, `writepgm` save one. There is no message that takes a state blob, so state can only arrive as a file. **[verified]** by the message list. Whether `read` accepts a `.vstpreset`: **[unverified]**
- **Limits.**
  - It is a second instance inside our device, not the plug-in already on the track. Same cost for existing Sets as route 4. **[inferred]**
  - Edition: Suite, or Standard with the Max for Live add-on. **[verified]** [Buying Max for Live](https://help.ableton.com/hc/en-us/articles/206407124-Buying-Max-for-Live)
  - The Max for Live limitations page says nothing about `vst~`. **[verified]** [limitations](https://docs.cycling74.com/userguide/m4l/live_limitations/). Whether the hosted plug-in's state is saved with the Set, whether its latency is compensated, and how side-chain inputs behave inside Live: **[unverified]**
- **Getting out.** `udpsend` or `node.script`, as in the connection note.

## 6. Vendor state and preset formats

This is the decoding half of route 2. No vendor among those checked publishes its format; everything below is from bytes on this machine or from community code.

- **FabFilter.** `.ffp` presets on this machine are binary: a 4-character product tag, a version, a count, then 32-bit floats (59 presets under `~/Documents/FabFilter/Presets`). **[local]** That is the same shape as the `FFBS` state in the Set. A community parser exists for Pro-Q 3 only: MIT, last pushed 2024-09, 7 stars, with "Some parameters … unknown". **[third-party]** [raoulsh/preset-toolkit](https://github.com/raoulsh/preset-toolkit)
- **Serum 2.** "The file format was not open so far and it took a bit of reverse engineering". **[third-party]** [serum-preset-packager](https://github.com/KennethWussmann/serum-preset-packager). A TypeScript reader exists, MIT, last pushed 2025-05, with a zstd dependency. **[third-party]** [node-serum2-preset-packager](https://github.com/CharlesBT/node-serum2-preset-packager). The state in the Set starts with the same `XferJson` tag. **[local]** Whether the Set's state equals a preset file byte for byte: **[unverified]**
- **Valhalla.** State is XML, one attribute per parameter. **[local]**
- **Soundtoys, Waves and others.** Soundtoys states are mostly printable text inside a `VstW` wrapper; not decoded. No Waves instance was in the local Sets. **[local]**, **[unverified]**
- **Cost.** One decoder per vendor family, maintained by us against formats that can change with a plug-in update. The generic decoders (XML in a `VC2!` block, an `FFBS` float array) cover many plug-ins each. **[inferred]**

## 7. Looking at the plug-in window

**Opening the window.**

- `PluginDevice.is_editor_open`: "The opened state of the plug-in's editor window", get, set and observe. **[verified]** [PluginDevice](https://docs.cycling74.com/apiref/lom/plugindevice/)
- It is new in Live 12.4.3: "Max for Live can now open or close plug-in editor windows via the LOM." **[verified]** [Live 12 release notes](https://www.ableton.com/en/release-notes/live-12/). It is absent from the 12.3.2 binary. **[local]**
- The same notes say Move opens plug-in windows, and Move is driven by a bundled control surface script, so the Python API very likely has the member too. **[inferred]**; **[unverified]** until run on 12.4.3+.
- Producer Pal uses it: `device.setProperty("is_editor_open", open ? 1 : 0)`. **[code]** [`selection-updates.ts` L220–247](https://github.com/adamjmurray/producer-pal/blob/52a4c21/src/tools/session/helpers/selection-updates.ts#L220-L247)
- `Device.View.is_collapsed` only folds the device in the device chain; it does not open the plug-in window. **[verified]** [Device.View](https://docs.cycling74.com/apiref/lom/device_view/)
- On Live older than 12.4.3 the user opens the window. **[inferred]**

**Capturing it, macOS.**

- ScreenCaptureKit captures one window: `SCContentFilter(desktopIndependentWindow:)` (macOS 12.3+) and `SCScreenshotManager` for a single frame (macOS 14+). **[verified]** [SCContentFilter](https://developer.apple.com/documentation/screencapturekit/sccontentfilter/init(desktopindependentwindow:)), [SCScreenshotManager](https://developer.apple.com/documentation/screencapturekit/scscreenshotmanager)
- The older `CGWindowListCreateImage` is marked obsolete in the current SDK header (`SCREEN_CAPTURE_OBSOLETE(10.5,14.0,15.0)`). **[local]** (`CGWindow.h` in the installed macOS SDK)
- The system tool `screencapture` has `-l <windowid>` ("Captures the window with windowid") and `-R <rectangle>`. **[local]** (`man screencapture`). Node can run it with `node:child_process`, so a first version needs no native code of ours. Finding the window id or its rectangle does need something: a small helper, or the window position Live stores in the Set (`WinPosX`, `WinPosY`). **[inferred]**
- Screen capture needs the Screen Recording permission; `CGPreflightScreenCaptureAccess` and `CGRequestScreenCaptureAccess` exist since macOS 10.15. **[verified]** [CGRequestScreenCaptureAccess](https://developer.apple.com/documentation/coregraphics/cgrequestscreencaptureaccess()). The permission belongs to the app that captures, which for a terminal app is the terminal. **[inferred]** How often recent macOS versions ask again: **[unverified]**

**Capturing it, Windows.** `IGraphicsCaptureItemInterop::CreateForWindow` "Targets a single window" (Windows 10 version 1903+). The system draws "a yellow notification border … around the actively captured item"; `GraphicsCaptureSession.IsBorderRequired` controls it. **[verified]** [CreateForWindow](https://learn.microsoft.com/en-us/windows/win32/api/windows.graphics.capture.interop/nf-windows-graphics-capture-interop-igraphicscaptureiteminterop-createforwindow), [Screen capture](https://learn.microsoft.com/en-us/windows/uwp/audio-video-camera/screen-capture), [IsBorderRequired](https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.graphicscapturesession.isborderrequired). This needs native code. **[inferred]**

**Reading it.** A vision-capable model reads the image. This is model behaviour, so only an eval can say how well it reads an EQ curve or a knob position; nothing here measured it. **[unverified]** What can be said in advance: **[inferred]**

- it is the only route that sees unsaved changes on an instance outside the Configure list;
- it sees what the user sees, including things that are not parameters (a spectrum, gain reduction);
- it reads one page of the plug-in: hidden tabs and collapsed sections are not on screen;
- it costs image tokens on every look, and a number read off a knob is an estimate;
- it is read-only. Writing through the window means synthetic mouse input, which is a different and more fragile project.

**Accessibility API.** macOS exposes UI elements of "accessible applications" through `AXUIElement`. **[verified]** [AXUIElement.h](https://developer.apple.com/documentation/applicationservices/axuielement_h). Plug-in editors are custom-drawn views, so whether a given plug-in exposes its controls and values there depends on that plug-in. No plug-in was inspected. **[unverified]** It needs the Accessibility permission, separate from Screen Recording. **[inferred]**

## 8. What others did

- **Producer Pal** states the limit plainly: it "cannot read or set the parameters inside a third-party VST/AU plug-in", and its workaround is Configure Mode, "up to 128 parameters", saved in a Rack because "Saving a preset for the plug-in device on its own loses the mappings (still true as of Live 12.4)". It can open the plug-in window and list installed plug-ins. **[third-party]** [limitations.md](https://github.com/adamjmurray/producer-pal/blob/52a4c21/docs/features/limitations.md). Its Remote Script can "load a preset in place of a device already in the Set". **[third-party]** [remote-script README](https://github.com/adamjmurray/producer-pal/blob/52a4c21/remote-script/README.md)
- **ableton-mcp.** Its Remote Script only names plug-ins when browsing and loading; it has no plug-in parameter path beyond the generic device parameters. **[code]** [`__init__.py` L1331](https://github.com/ahujasid/ableton-mcp/blob/9dddc7b/AbletonMCP_Remote_Script/__init__.py#L1331). ableton-mcp-extended lists plug-in support as future work through Configure. **[third-party]** search result summary, repository not read.
- **Ubermap** renames and regroups the parameters Live already exposes, for Push: "custom parameter mappings for VST and AU plugins on the Push display". It is "not currently maintained". **[verified]** [README](https://github.com/tomduncalf/ubermap/blob/master/README.md). It works on the Configure list, not around it. **[inferred]** Push itself shows what the list holds. **[inferred]**
- **NKS (Native Instruments).** NI describes NKS as partner work: "We work with the best developers … pre-mapped". **[verified]** [This is NKS](https://www.native-instruments.com/en/specials/komplete/this-is-nks/). The mapping is done per plug-in, by the vendor or by users, inside NI's own host plug-in. **[third-party]** community posts; the developer documentation was not found. **[unverified]**
- **Softube Console 1.** "works with all major DAWs — no mapping necessary". **[verified]** [product page](https://www.softube.com/us/console-1-channel-mk-iii). Which plug-ins it controls and how third-party plug-ins join: **[unverified]**
- **Novation Automap.** No primary source reached. **[unverified]**
- **The common thread.** Everyone who gets full access does it from inside the audio path, as the host of the plug-in (NKS, the wrappers of route 4), or by per-plug-in agreements with vendors. Everyone outside lives with the Configure list. Nobody found reads the state from the Set. **[inferred]**

## 9. Newer Live

- **12.4.3** added opening and closing plug-in windows through the LOM (route 7). **[verified]** [release notes](https://www.ableton.com/en/release-notes/live-12/)
- Nothing in the 12.4.x release notes or the current beta notes changes which plug-in parameters are exposed, the Configure list, or its size. The plug-in lines are bug fixes. **[verified]** by searching both pages for "plug-in" with "parameter", "configure", "API".
- **Extensions SDK.** No beta note mentions plug-in parameters. The one project that documents the SDK's limits says device insertion is for built-in devices only. **[third-party]**, see the [connection note](connecting-to-ableton-live.md#6-ableton-extensions-sdk-official-beta). The SDK reference is behind a beta login. **[unverified]**

## 10. Routes added during the research

- **Whole-state write through a preset.** If the mentor can produce a full state (route 2a for a format we can also write, or route 3), it can save it as a preset file and have Live load it onto the device through the browser, as Producer Pal's script does for presets. That replaces every setting at once and reaches instances outside the Configure list. `PluginDevice.selected_preset_index` is the small version of this for plug-ins that expose programs; the prototype saw one entry everywhere. Which preset files Live's browser accepts per format, and whether loading keeps the device's list and automation: **[unverified]**
- **Replacing the plug-in file with a look-alike** that carries the same id and hosts the original, so existing Sets load the wrapper without knowing. It would reach existing instances with full live access. It also breaks code signing expectations, is undone by every plug-in update, and very likely breaks vendor licence terms. Not recommended. **[inferred]**
- **Reading Live's memory or injecting into its process.** Not a product route: it fights the operating system's protections and Ableton's terms. **[inferred]**

## Recommendation

**Prototype route 2a first: read plug-in state from the saved Set and decode the formats that are plain. Prototype route 7 second: open the plug-in window and let the model look. Run two five-minute checks on route 1 alongside.**

Reasoning:

1. **Route 2a reaches the instances that are the problem, with no dependency.** The earlier prototype's worst case was 49 Pro-Q instances showing only `Device On`. Their settings are an array of floats in the Set file. `node:zlib` reads it. This fits the repo's constraints exactly, and it works on Windows unchanged, since it is a file.
2. **Its limit is clear and can be told to the user.** It reads the Set as last saved. The mentor can say so, and ask the user to save.
3. **Route 7 covers what 2a cannot:** opaque formats, unsaved changes, and things that are not parameters. It needs a permission and, for opening windows by itself, Live 12.4.3 or later. Its accuracy is unknown, which is why it is second.
4. **A shadow host (route 3) is the general form of 2a.** It should wait until the prototype shows how many of the user's plug-ins the plain decoders miss. It brings native code and a GPL question, both maintainer decisions.
5. **A wrapper (routes 4 and 5) is the only live read and write of everything, and the only one that does nothing for existing Sets.** It changes how the user builds a Set. Not a first step.
6. **Write stays on the Configure list for now.** The `.appc` files and the exact value 128 may make new instances writable for 128 chosen parameters at almost no cost.

What each prototype must prove:

**Prototype A — state from the Set (route 2a).** Throwaway script outside the repo.
- `Song.file_path` is readable through the Remote Script on 12.3.2, and what it returns for an unsaved Set.
- For Pro-Q 4 and Pro-Q 3: every float maps to the right name from `get_parameter_names`, checked against the plug-in window for a band the user sets to known values (frequency, gain, Q, shape, on/off).
- The same for one JUCE XML plug-in (ValhallaRoom) and one `VstW` plug-in (EchoBoy), including turning 0-to-1 values into display values, or showing that this cannot be done without the plug-in.
- Coverage: of the 127 instances in the prototype Set, how many become readable with the FabFilter and XML decoders alone.
- Staleness: change a setting, do not save, confirm the file is unchanged; save, confirm it changed.
- Matching: that the n-th plug-in device in the file is the n-th device the API reports on the same track, including inside racks.

**Prototype B — the window (route 7).** Throwaway script outside the repo, and an eval in the sense of `AGENTS.md`.
- On Live 12.4.3+: `is_editor_open` can be set from the Remote Script. On 12.3.2: confirm it cannot, and that asking the user is the fallback.
- A capture of exactly one plug-in window with `screencapture -l`, when the window is behind others and when it is on a second display, and what the permission prompt looks like from the CLI.
- Reading accuracy over several runs per case: Pro-Q 4 with five bands at known settings, a compressor with known threshold and ratio, a synth page. Report how many runs gave the right values and how far off the wrong ones were.
- Token cost per look.

**Two quick checks (route 1).**
- `-_PluginAutoPopulateThreshold=128`, fresh Pro-Q 4 in VST2, VST3 and AU: does each get its first 128 parameters?
- Hand-write a `Default.appc` for a plug-in with more than 128 parameters, listing chosen ones; create a fresh instance; does the list appear, in VST2, VST3 and AU? What does a VST3 file look like when Live writes it?

## Open decisions for the maintainer

1. Is "the Set as last saved" an acceptable basis for advice about plug-in settings, if the mentor says so?
2. May the mentor read the user's `.als` file from disk at all, and should it ask first?
3. Is a per-vendor decoder acceptable as product code, knowing each one follows an undocumented format we do not own? If yes, which plug-ins first?
4. Is a native helper acceptable (a shadow host, a window capture tool)? In which language, and who builds and signs it for macOS and Windows?
5. Is a GPLv3 program that the user installs and the mentor starts (pedalboard, DawDreamer) acceptable? Is shipping one?
6. If we write C++ ourselves: JUCE under AGPLv3 or a paid tier, or the MIT VST 3 SDK and Apple's AudioToolbox directly, with VST2 left out?
7. Is the Screen Recording permission acceptable for a mentor, and is sending images of the user's screen to the model provider?
8. Should the mentor ever write files into the User Library (`.appc` defaults, presets) or suggest an `Options.txt` line?
9. Is editing a copy of the user's `.als` ever acceptable?
10. Is the minimum Live version 12.4.3, so that plug-in windows can be opened by the API, or must 12.3 and older work?
11. Is a wrapper (our own plug-in, or a Max for Live device around `vst~`) in scope at all, given that it changes how users build Sets and does nothing for existing ones?
12. For write access: is "the user adds the parameter in Configure Mode when the mentor asks" good enough for a first version?
13. VST2: 51 of 101 local plug-in devices are VST2 and no new VST2 host licence exists. Is decoding VST2 state from the file enough, with no VST2 hosting ever?

## What was not verified

- Nothing in this note was run against Live. Every local fact comes from reading files: three Sets, one `.appc`, FabFilter preset files, the Live 12.3.2 binary's strings, the macOS SDK header and a man page.
- Whether the Python API has `Song.file_path` on 12.3.2 and `is_editor_open` on 12.4.3+.
- The exact value `128` for the threshold option, and the default of 64.
- Whether a `Default.appc` written by us is applied, its form for VST3 and Audio Units, and whether it touches existing instances.
- The Audio Unit layout in the `.als` (`AuPluginInfo`): no Audio Unit instance was available locally.
- That FabFilter float order equals `get_parameter_names` order; the layout of the `FabF` states; any decoding of Soundtoys, SSL, IK, Smooth Operator, Kickstart or Serum 2 bodies.
- Whether the `.als` plug-in layout is the same in Live 11 and in 12.4.x, and on Windows.
- Any shadow host actually loading a state taken from a Set; how plug-in copy protection reacts to a second, windowless host; whether a VST3 build accepts its VST2 sibling's chunk.
- `vst~` inside Live: state saving with the Set, latency compensation, side-chain, `.vstpreset` loading.
- How well a vision model reads a plug-in window. No image was captured or sent.
- Whether any plug-in exposes its controls through the macOS Accessibility API or Windows UI Automation.
- How often macOS asks again for Screen Recording, and capture from a terminal app.
- Which preset file types Live's browser loads onto an existing plug-in device, and what that does to its list and automation.
- Editing a `.als` to fill the list.
- NKS developer terms, Softube Console 1 integration, Novation Automap, PluginGuru Unify, NI Komplete Kontrol's DAW-facing parameters, Kushview Element's licence: no primary source read.
- The VST2 licence position rests on a Steinberg employee's forum posts, not on a licence text.
- The Extensions SDK reference (behind a beta login).
- Context7 was not used: every library fact here was read in the project's own source, README or reference page at the commits named at the top.

## Local observations

- Three of five local Sets contain plug-in devices: 101 in total, 51 VST2 and the rest VST3 by `PluginDesc` child, none Audio Unit. Every one has 128 `PluginFloatParameter` slots; 63 have none in use; the most in use is 42.
- `~/Music/Ableton/User Library/Defaults/Plug-in Configurations/VSTs/` holds three `Default.appc` files, plain JSON with the id `application/vnd.ableton.plugin-configuration`. The Live binary contains the strings `Default.appc` and that id.
- The Live 12.3.2 binary's `Live.PluginDevice` docstrings list `presets`, `selected_preset_index` and `get_parameter_names` only.
- `~/Library/Preferences/Ableton/Live 12.3.2/Crash/` holds dated `BaseFiles`, `Undo` and `CrashRecoveryInfo.cfg` entries.
- Installed plug-in counts: 356 VST3, 494 Audio Unit components, 318 VST2.
- pedalboard is not installed; `auval` and `screencapture` are present.

## Sources

Ableton
- [Live manual: Using Plug-Ins](https://www.ableton.com/en/live-manual/12/using-plug-ins/), [Working with Instruments and Effects](https://www.ableton.com/en/live-manual/12/working-with-instruments-and-effects/)
- [Live 12 release notes](https://www.ableton.com/en/release-notes/live-12/), [Live 12 beta release notes](https://www.ableton.com/en/release-notes/live-12-beta/)
- [Options.txt file](https://help.ableton.com/hc/en-us/articles/6003224107292), [Buying Max for Live](https://help.ableton.com/hc/en-us/articles/206407124-Buying-Max-for-Live) (help centre articles read through the Help Centre API)

Cycling '74
- LOM: [PluginDevice](https://docs.cycling74.com/apiref/lom/plugindevice/), [Device](https://docs.cycling74.com/apiref/lom/device/), [Device.View](https://docs.cycling74.com/apiref/lom/device_view/), [Song](https://docs.cycling74.com/apiref/lom/song/), [Application.View](https://docs.cycling74.com/apiref/lom/application_view/)
- [vst~](https://docs.cycling74.com/reference/vst~/), [Max for Live limitations](https://docs.cycling74.com/userguide/m4l/live_limitations/)

Steinberg
- [VST 3 SDK README](https://github.com/steinbergmedia/vst3sdk/blob/master/README.md), [LICENSE](https://github.com/steinbergmedia/vst3sdk/blob/master/LICENSE.txt), [licence page](https://www.steinberg.net/sdklicenses_vst3)
- [VST 3 preset format](https://steinbergmedia.github.io/vst3_dev_portal/pages/Technical+Documentation/Locations+Format/Preset+Format.html), [hosting classes](https://github.com/steinbergmedia/vst3_public_sdk/tree/master/source/vst/hosting), [`vst2persistence.cpp`](https://github.com/steinbergmedia/vst3_public_sdk/blob/master/source/vst/utility/vst2persistence.cpp)
- [Forum thread on VST2 hosting licences](https://forums.steinberg.net/t/can-i-create-vst-2-support-for-host-application-vst-3-license/202012) (vendor forum)

Apple and Microsoft
- [AUAudioUnit.fullState](https://developer.apple.com/documentation/audiotoolbox/auaudiounit/fullstate), [parameterTree](https://developer.apple.com/documentation/audiotoolbox/auaudiounit/parametertree), [kAudioUnitProperty_ClassInfo](https://developer.apple.com/documentation/audiotoolbox/kaudiounitproperty_classinfo)
- [SCScreenshotManager](https://developer.apple.com/documentation/screencapturekit/scscreenshotmanager), [SCContentFilter init(desktopIndependentWindow:)](https://developer.apple.com/documentation/screencapturekit/sccontentfilter/init(desktopindependentwindow:)), [CGRequestScreenCaptureAccess](https://developer.apple.com/documentation/coregraphics/cgrequestscreencaptureaccess()), [AXUIElement.h](https://developer.apple.com/documentation/applicationservices/axuielement_h) (read through the documentation JSON endpoint)
- [CreateForWindow](https://learn.microsoft.com/en-us/windows/win32/api/windows.graphics.capture.interop/nf-windows-graphics-capture-interop-igraphicscaptureiteminterop-createforwindow), [Screen capture](https://learn.microsoft.com/en-us/windows/uwp/audio-video-camera/screen-capture), [IsBorderRequired](https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.graphicscapturesession.isborderrequired)

Projects and products
- [spotify/pedalboard](https://github.com/spotify/pedalboard), [DBraun/DawDreamer](https://github.com/DBraun/DawDreamer) and its [plugin processor guide](https://dbraun.github.io/DawDreamer/user_guide/plugin_processor.html)
- [juce-framework/JUCE LICENSE.md](https://github.com/juce-framework/JUCE/blob/master/LICENSE.md), [Get JUCE](https://juce.com/get-juce/)
- [adamjmurray/producer-pal](https://github.com/adamjmurray/producer-pal), [ahujasid/ableton-mcp](https://github.com/ahujasid/ableton-mcp), [tomduncalf/ubermap](https://github.com/tomduncalf/ubermap)
- [Blue Cat's PatchWork manual](https://www.bluecataudio.com/Doc/Product_PatchWork/), [DDMF Metaplugin](https://ddmf.eu/metaplugin-chainer-vst-au-rtas-aax-wrapper/), [kushview/element](https://github.com/kushview/element)
- [raoulsh/preset-toolkit](https://github.com/raoulsh/preset-toolkit), [KennethWussmann/serum-preset-packager](https://github.com/KennethWussmann/serum-preset-packager), [CharlesBT/node-serum2-preset-packager](https://github.com/CharlesBT/node-serum2-preset-packager), [OfficialWhyEd/WhyCremisi](https://github.com/OfficialWhyEd/WhyCremisi) (READMEs only)
- [This is NKS](https://www.native-instruments.com/en/specials/komplete/this-is-nks/), [Softube Console 1 Channel Mk III](https://www.softube.com/us/console-1-channel-mk-iii)

Platform
- [Node.js 22 zlib](https://nodejs.org/docs/latest-v22.x/api/zlib.html)
