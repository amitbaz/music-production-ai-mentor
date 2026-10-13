# Research — what Live lets a Remote Script do

Date: 2026-10-13 · Status: research note, not a decision

The question: which actions can a MIDI Remote Script take in Ableton Live 12, and which can it not? The script reaches Live through the Python API, the same object model that Max for Live documents as the Live Object Model (LOM). Scope is Live's own devices. Third-party plug-ins and audio capture are left out; see [the connection note](connecting-to-ableton-live.md) for plug-ins.

Nothing in this note was run against Live. It is a reading of four sources:

- **The LOM reference** by Cycling '74, which "refers to Ableton Live version 12.4.5". It is written for Max for Live.
- **Ableton's Live 12 release notes**, 12.0 to 12.4.6.
- **Type stubs of the Python API** (`Live/*.pyi`, 43 modules) shipped inside ableton-js v5.0.4. This is the newest generated listing of the Python classes found. The stubs do not state which Live version they were made from. They contain members added in 12.3 (`Track.insert_device`, `Device.can_compare_ab`) and lack members added in 12.4 (`SimplerDevice.replace_sample`) and 12.4.3 (`PluginDevice.is_editor_open`), so they look like a 12.3.x listing. **[inferred]**
- **The ableton-js v5.0.4 Remote Script source** (`midi-script/`), for what the transport passes through.

The older public listing by NSUSpray stops at Live 11.0.0; it was used only to tell whether a member is newer than 11.0. The structure-void listing for Live 12 could not be fetched.

Markers: **[LOM]** read in the LOM reference · **[notes]** read in Ableton's release notes · **[stubs]** present in the type stubs (so the member exists in Python, in a 12.3-era Live) · **[code]** read in the ableton-js script · **[local]** seen in the prototype on Live 12.3.2 · **[inferred]** my reasoning · **[unverified]** could not confirm. "Absent" means the member is in neither the LOM reference nor the stubs. The first four markers count as verified from a primary source.

The machine runs Live **12.3.2**. Anything marked 12.4 or later is not available on it.

## Short answer: what is not possible, or only partly

This list is also the record of what the Ableton tool set does not support yet ([ADR 0015](../adr/0015-the-first-real-ableton-tool-set-has-a-narrow-scope.md)). Until an item is solved, the mentor tells the user the steps. Two additions from the design discussion:

- **Arrangement automation may be reachable indirectly.** Two routes are untried: write the envelope in a Session clip and copy the clip to the arrangement with `Track.duplicate_clip_to_arrangement`, or record parameter changes with arrangement recording on. **[unverified]**
- **Session View is not supported by decision**, although the API offers it.

**Not in the API at all** (absent from both the LOM reference and the stubs):

1. **Group and ungroup tracks.** A script can read `Track.group_track`, `is_grouped`, `is_foldable` and set `fold_state`. It cannot create or dissolve a group.
2. **Move or reorder a track.** There is no move function. `create_*_track(index)` and `duplicate_track(index)` are the only ways to place a track.
3. **Freeze, unfreeze, flatten.** Only `Track.is_frozen` and `can_be_frozen` can be read.
4. **Save, save as, open or create a Set.** `Song.file_path` and `Song.name` are read-only.
5. **Export or render audio, bounce in place, consolidate, resample to a new file.**
6. **Split an arrangement clip, move it, or set its position.** `Clip.start_time` and `end_time` are read-only.
7. **Arrangement automation.** `Clip.automation_envelope` "Returns None for Arrangement clips" **[stubs]**, and no track-level envelope exists. Automation can be read and written only inside Session clips.
8. **Comp takes.** Take lanes can be read, created and filled with clips. Nothing selects a take region.
9. **Search the browser by text.** The browser is a tree of items; there is no search function.
10. **Undo history.** A script can undo, redo and ask `can_undo` / `can_redo`. It cannot list, name or count undo steps.
11. **Set a parameter from its displayed text.** `str_for_value` turns a number into text; nothing goes the other way.
12. **Sidechain routing of Gate, Auto Filter and every device other than Compressor.** Only `CompressorDevice` has routing properties.
13. **Device settings that are not parameters and have no device class**: Operator's algorithm and other non-automatable choices, "Hi-Quality" switches reached from a device's context menu, Sampler's zones and samples, the inside of a Max for Live device.
14. **Delete or reorder a rack chain**, map a macro to a parameter, rename a macro's mapping. `insert_chain` exists; a matching delete does not.
15. **Delete a locator directly, or create one at a given time.** `set_or_delete_cue` toggles a locator at the playback position.
16. **Add or remove a groove in the groove pool, quantise audio by settings dialog, edit a time-signature or tempo change in the arrangement, edit clip fades.**

**Possible, with a limit:**

- **Load a device.** `Track.insert_device(name, index)` places a native device at a chosen position without selecting anything, but only since Live 12.3, only for native devices, and only by device name, not by preset. Presets, samples, Max for Live devices and User Library items load through `Browser.load_item`, which acts on the selected track.
- **Arrangement clips.** Create MIDI (12.1.10) and audio clips, duplicate, delete, rename, mute, set loop and markers. Not move, split or resize as such.
- **Replace Simpler's sample.** `SimplerDevice.replace_sample` exists from Live 12.4, so not on this machine's 12.3.2.
- **Undo grouping.** `Song.begin_undo_step` / `end_undo_step` exist; what they group is undocumented.
- **Meters.** Readable and observable, as peak values from 0 to 1, not dB or loudness.
- **Warp markers.** Read, add, move and remove; nothing else about warping is editable beyond mode and on/off.

**Reachable in Live but not through ableton-js v5.0.4 as shipped** (see [the transport section](#what-the-ableton-js-transport-passes-through)): `Song.move_device`, `Clip.add_new_notes`, `Clip.add_warp_marker`, Simpler's `Sample` object, Compressor sidechain routing, `Clip.groove`, the Wavetable modulation matrix functions that take a parameter, and the `Live.Conversions` functions. Each needs a small wrapper in the script.

## What the ableton-js transport passes through

All **[code]**, from `Namespaces/Interface.py`, `AbletonJS.py` and `Socket.py`.

- **No allow-list.** A command names a namespace, an object id and a method. `dispatch` first looks for the method on the namespace handler, then on the Live object itself, and calls it with the JSON arguments (`Interface.py` L85–113). `get_prop` and `set_prop` fall back to plain `getattr` / `setattr` (L197–216). No namespace restricts property or method names.
- **Object ids are not typed.** An id resolves through one shared table (`Interface.get_obj`). Any saved object can be sent to any namespace.
- **A Live object can only be returned through a wrapper.** A handler method such as `get_mixer_device` saves the object and returns an id. Without one, the result goes through a JSON fallback that turns it into a list or a string (`Socket.py` L232–237), so the client gets text and no id.
- **A Live object can only be passed in through a wrapper.** JSON arguments are numbers, strings, lists and dicts. A native method that wants a `Device`, `DeviceParameter`, `MidiNoteSpecification`, `WarpMarker` or routing object cannot be called raw.
- **Module-level functions cannot be reached.** `Live.Conversions.*` and `Live.Song.get_all_scales_ordered` belong to no object.
- **Enum values.** Handlers convert names to enums for warp mode, launch mode, quantisation, monitoring state, crossfade assign, panning mode, browser filter, device insert mode and groove base. For other enum properties (for example `Eq8Device.global_mode`, `SimplerDevice.playback_mode`) the raw value is passed; whether Live accepts a plain integer there is **[unverified]**.

Namespaces registered in v5.0.4: `application`, `application-view`, `browser`, `browser-item`, `chain`, `chain-mixer-device`, `clip`, `clip_slot`, `cue-point`, `device`, `device-parameter`, `device-view`, `drum-chain`, `drum-pad`, `envelope`, `groove`, `groove-pool`, `internal`, `looper-device`, `midi`, `mixer-device`, `plugin-device`, `rack-device`, `rack-device-view`, `scene`, `session`, `song`, `song-view`, `take-lane`, `track`, `track-view`, `tuning-system`. So rack chains and their mixer, drum pads, the groove pool, take lanes and envelopes do have namespaces.

Live object types with no namespace and no wrapper that returns them:

| Type | Consequence |
| --- | --- |
| `Sample` (Simpler's sample) | `SimplerDevice.sample` comes back as text. File path, slices, warp settings of a Simpler sample cannot be read or set. |
| `RoutingType` / `RoutingChannel` outside `Track` | Track routing is wrapped. `CompressorDevice.input_routing_type` is not: it reads as text and cannot be set. |
| `DeviceIO` (Max for Live device inputs and outputs) | Not addressable. |
| `Groove` as a clip property | `groove-pool` returns grooves, but `Clip.groove` has no setter wrapper, so a groove cannot be assigned to a clip. |
| `Clip.View`, `Eq8Device.View`, `SimplerDevice.View` | No own namespace. `device-view` resolves `.view` of whatever id it is given (`DeviceView.py`), so these may be reachable that way. **[inferred]** |
| Device-specific classes (`CompressorDevice`, `Eq8Device`, `SimplerDevice`, `WavetableDevice`, `HybridReverbDevice`, `DriftDevice`, `MeldDevice`, `RoarDevice`, `ShifterDevice`, `SpectralResonatorDevice`, `DrumCellDevice`, `CcControlDevice`, `MaxDevice`) | No own namespace, but their number, text and list properties are reachable through `device` with the generic get and set. **[inferred]** from the dispatch code |
| `Live.Conversions` functions | Not reachable. |

Native methods that need an object argument and have no wrapper: `Song.move_device`, `Song.find_device_position`, `Clip.add_new_notes`, `Clip.add_warp_marker`, `Clip.View.select_envelope_parameter`, `WavetableDevice.add_parameter_to_modulation_matrix`, `WavetableDevice.is_parameter_modulatable`.

One mismatch: the script's `Envelope.create_event` calls a native `Envelope.create_event`, which is not in the stubs. Either it is newer than the stubs or it fails. **[unverified]**

## 1. Set level

| Action | Possible? | Member | Source |
| --- | --- | --- | --- |
| Read and set tempo | Yes | `Song.tempo` | [LOM] [stubs] |
| Tap tempo, nudge | Yes | `Song.tap_tempo()`, `nudge_up`, `nudge_down` | [LOM] [stubs] |
| Time signature | Yes, the global one | `Song.signature_numerator`, `signature_denominator` | [LOM] [stubs] |
| Time-signature or tempo changes along the arrangement | No | absent | [inferred] from absence |
| Loop region | Yes | `Song.loop`, `loop_start`, `loop_length` | [LOM] [stubs] |
| Playback position | Yes | `Song.current_song_time` (get, set), `jump_by(beats)`, `scrub_by(beats)`, `start_time` | [LOM] [stubs] |
| Play, stop, continue | Yes | `Song.start_playing()`, `stop_playing()`, `continue_playing()`, `play_selection()`, `is_playing` | [LOM] [stubs] |
| Record | Yes | `Song.record_mode` (Arrangement Record), `session_record`, `arrangement_overdub`, `overdub`, `punch_in`, `punch_out`, `trigger_session_record()`, `capture_midi()` | [LOM] [stubs] |
| Metronome | Yes | `Song.metronome` | [LOM] [stubs] |
| Read locators | Yes | `Song.cue_points`; `CuePoint.name`, `CuePoint.time` | [LOM] [stubs] |
| Rename a locator | Yes | `CuePoint.name` is settable | [LOM] [stubs] |
| Jump to a locator | Yes | `CuePoint.jump()`, `Song.jump_to_next_cue()`, `jump_to_prev_cue()` | [LOM] [stubs] |
| Create a locator | With a limit: only at the current playback position | `Song.set_or_delete_cue()`: "Toggle cue point at current Arrangement playback position" | [LOM] |
| Delete a locator | With a limit: move the playhead onto it, then toggle | same function; `CuePoint.time` is read-only | [LOM]; the two-step method is [inferred] |
| Song length | Read only | `Song.song_length`, `last_event_time` | [LOM] [stubs] |
| Scale and key | Yes | `Song.root_note` (0–11), `scale_name`, `scale_mode` (added 12.0.5), `scale_intervals` (read) | [LOM] [notes] |
| Tuning system | Yes | `Song.tuning_system` (12.1) | [notes] [LOM] |
| Undo, redo | Yes | `Song.undo()`, `redo()`, `can_undo`, `can_redo` | [LOM] [stubs] |
| Group several changes into one undo step | Probably; undocumented | `Song.begin_undo_step()`, `end_undo_step()`. In the Python API since 11.0, not in the LOM reference, no description | [stubs]; the effect is [unverified] |
| Name an undo step | No | absent | [inferred] from absence |
| Read the undo history | No | only `can_undo` / `can_redo` | [LOM] [stubs] |
| Store own data in the Set | Yes | `Song.set_data(key, value)`, `get_data`; also on `Track` | [stubs] |

## 2. Tracks

| Action | Possible? | Member | Source |
| --- | --- | --- | --- |
| Create audio, MIDI, return track | Yes | `Song.create_audio_track(index)`, `create_midi_track(index)`, `create_return_track()` (always at the end) | [LOM] [stubs] [local] |
| Delete | Yes | `Song.delete_track(index)`, `delete_return_track(index)` | [LOM] [stubs] [local] |
| Duplicate | Yes | `Song.duplicate_track(index)` | [LOM] [stubs] |
| Rename, colour | Yes | `Track.name`, `color`, `color_index` | [LOM] [stubs] |
| Mute, solo, arm | Yes | `Track.mute`, `solo`, `arm` (not on return or Main); `Song.exclusive_arm`, `exclusive_solo` read-only | [LOM] [stubs] |
| Fold a group | Yes | `Track.fold_state`, only if `is_foldable` | [LOM] [stubs] |
| Collapse a track in the arrangement | Yes | `Track.View.is_collapsed` | [LOM] [stubs] |
| Group or ungroup tracks | **No** | absent. Reading: `group_track`, `is_grouped` | [inferred] from absence |
| Move or reorder a track | **No** | absent | [inferred] from absence |
| Input and output routing | Yes | `Track.input_routing_type`, `input_routing_channel`, `output_routing_type`, `output_routing_channel`, each set from the matching `available_*` list. Output not on Main | [LOM] [stubs] [code] |
| Monitoring | Yes | `Track.current_monitoring_state` (In, Auto, Off) | [stubs] [code]; not on the LOM page as fetched [unverified] |
| Freeze, unfreeze, flatten | **No** | read only: `is_frozen`, `can_be_frozen` | [LOM] [stubs] |
| Read meters while playing | Yes, as peak 0.0–1.0 | `Track.output_meter_level` (hold peak, 1 s), `output_meter_left`, `output_meter_right` (smoothed momentary peak), `input_meter_*` | [LOM] [stubs] |
| Meter in dB, RMS or LUFS | No | absent | [inferred] from absence |
| CPU load of a track | Read | `Track.performance_impact` | [LOM] [stubs] |

The LOM warns that the left and right meters "add a significant load to Live GUI resource usage". **[LOM]**

## 3. Mixer

| Action | Possible? | Member | Source |
| --- | --- | --- | --- |
| Volume, pan | Yes | `Track.mixer_device.volume`, `.panning` | [LOM] [stubs] |
| Split-stereo pan | Yes | `MixerDevice.panning_mode`, `left_split_stereo`, `right_split_stereo` | [LOM] [stubs] |
| Sends | Yes | `MixerDevice.sends`, one per return track | [LOM] [stubs] |
| Crossfader | Yes | `MixerDevice.crossfader` (Main track only), `crossfade_assign` per track | [LOM] [stubs] |
| Track on/off | Yes | `MixerDevice.track_activator` | [LOM] [stubs] |
| Cue volume, Main tempo as a parameter | Yes | `MixerDevice.cue_volume`, `song_tempo` | [LOM] [stubs] |
| Rack chain mixer | Yes | `Chain.mixer_device`: `volume`, `panning`, `sends`, `chain_activator` | [LOM] [stubs] [code] |

Volume, pan, sends, crossfader, activator and cue volume are `DeviceParameter` objects, the same class as device parameters, with `value`, `min`, `max`, `str_for_value` and listeners. **[LOM]** ("It provides access to volume, panning and other DeviceParameter objects")

## 4. Devices

| Action | Possible? | Member | Source |
| --- | --- | --- | --- |
| Insert a native device at a chosen position, on any track or chain | Yes, since **12.3** | `Track.insert_device(device_name, index)`, `Chain.insert_device(...)`. Name "as it appears in the UI". "Only native Live devices can be inserted; Max for Live devices and plug-ins are not supported." Not every index is valid. | [notes] [LOM] [stubs] |
| Load a preset, rack preset, sample, Max for Live device or User Library item | Yes, through the browser | `Browser.load_item(item)` | [stubs] [local] |
| Choose the target of `load_item` | Only by selection | It loads onto the selected track. `Track.View.device_insert_mode` sets where: at the end, or left or right of the selected device. | selected track [local] [inferred]; insert mode [LOM] |
| Replace a device through hot-swap | Probably | `Browser.hotswap_target` is settable; `Application.View.toggle_browse()` | [stubs] [LOM]; behaviour [unverified] |
| Delete a device | Yes | `Track.delete_device(index)`, `Chain.delete_device(index)` | [LOM] [stubs] |
| Move or reorder a device | Yes | `Song.move_device(device, target, target_position)`: target is a track or chain; returns the position used. `Song.find_device_position(...)` asks first. Needs a wrapper in ableton-js. | [LOM] [stubs] |
| Duplicate a device | Yes | `Track.duplicate_device(index)`, `Chain.duplicate_device(index)`. Newer than 11.0; not in the LOM reference | [stubs] [code] |
| Turn on and off | Yes | the device's first parameter, "Device On"; `Device.is_active` reads the result | [LOM]; "Device On" as first parameter [local] |
| Rename | Yes | `Device.name` | [stubs] |
| A/B compare | Yes, since **12.3** | `Device.can_compare_ab`, `is_using_compare_preset_b`, `save_preset_to_compare_ab_slot()` | [LOM] [notes] |
| Read rack chains | Yes | `RackDevice.chains`, `return_chains`; `Chain.devices`, `name`, `mute`, `solo`, `color` | [LOM] [stubs] [local] |
| Add a rack chain | Yes, since **12.3** | `RackDevice.insert_chain(index)` | [LOM] [notes] |
| Delete or reorder a rack chain | **No** | absent. `DrumPad.delete_all_chains()` empties one drum pad. | [inferred] from absence; [LOM] |
| Rack macros: read and set values | Yes | macros are the rack's `parameters`; `visible_macro_count`, `has_macro_mappings`, `macros_mapped` | [LOM] [stubs] |
| Add or remove a macro control, randomise, variations | Yes | `add_macro()`, `remove_macro()`, `randomize_macros()`, `store_variation()`, `recall_selected_variation()`, `delete_selected_variation()`, `selected_variation_index` | [LOM] [stubs] |
| Map a macro to a parameter | **No** | absent | [inferred] from absence |
| Chain selector | Yes | `RackDevice.chain_selector` (a parameter) | [LOM] |
| Drum rack pads: read | Yes | `RackDevice.drum_pads` (128, top-level rack only), `visible_drum_pads`; `DrumPad.note`, `name`, `mute`, `solo`, `chains` | [LOM] [stubs] |
| Drum rack pads: edit | Partly | `RackDevice.copy_pad(source, destination)`; `DrumChain.in_note` (**12.3**), `out_note`, `choke_group`; `insert_chain` plus `in_note` makes a new pad | [LOM] [notes] |
| Convert (drums to MIDI, slice to drum rack, audio to MIDI) | In Python only | `Live.Conversions.audio_to_midi_clip`, `create_drum_rack_from_audio_clip`, `sliced_simpler_to_drum_rack`, `create_midi_track_with_simpler`, `move_devices_on_track_to_new_drum_rack_pad` | [stubs]; not in the LOM reference; not reachable through ableton-js |

## 5. Device settings that are not ordinary parameters

`Device.parameters` holds "Only automatable parameters". **[LOM]** Everything else needs a device-specific class. The classes that exist, and what each adds beyond `parameters`:

| Class | Adds | Source |
| --- | --- | --- |
| `CompressorDevice` | Sidechain source: `input_routing_type`, `input_routing_channel` (get, set, observe) and their `available_*` lists | [LOM] [stubs] |
| `Eq8Device` | `global_mode` (0 Stereo, 1 L/R, 2 M/S), `edit_mode` (which channel is edited), `oversample` (on/off); `View.selected_band` | [LOM] [stubs] |
| `SimplerDevice` | `sample` (a `Sample`), `playback_mode` (Classic, One-Shot, Slicing), `slicing_playback_mode`, `voices`, `retrigger`, `pad_slicing`, `multi_sample_mode` (read); `crop()`, `reverse()`, `warp_as(beats)`, `warp_double()`, `warp_half()`; `replace_sample(file_path)` since **12.4** | [LOM] [stubs] [notes] |
| `Sample` | `file_path` (read), `length`, `sample_rate`, `gain`, `start_marker`, `end_marker`, `warping`, `warp_mode` and per-mode settings, `warp_markers` (read), `slices` (read), `slicing_style`, `slicing_sensitivity`, `slicing_beat_division`, `slicing_region_count`; `insert_slice`, `move_slice`, `remove_slice`, `clear_slices`, `reset_slices` | [LOM] [stubs] |
| `WavetableDevice` | Wavetable choice per oscillator (`oscillator_N_wavetable_category`, `_index`, lists), `oscillator_N_effect_mode`, `filter_routing`, `mono_poly`, `poly_voices`, `unison_mode`, `unison_voice_count`; the modulation matrix: `get_modulation_value`, `set_modulation_value`, `add_parameter_to_modulation_matrix`, `visible_modulation_target_names` | [LOM] [stubs] |
| `DriftDevice` | Modulation matrix sources and targets (`mod_matrix_*_index` with `_list`), `voice_mode_index`, `voice_count_index`, `pitch_bend_range` | [LOM] [stubs] |
| `MeldDevice` | `selected_engine`, `unison_voices`, `mono_poly`, `poly_voices` | [LOM] [stubs] |
| `HybridReverbDevice` | Impulse response: `ir_category_index`, `ir_file_index` with `ir_category_list`, `ir_file_list`; `ir_attack_time`, `ir_decay_time`, `ir_size_factor`, `ir_time_shaping_on` | [LOM] [stubs] |
| `RoarDevice` | `routing_mode_index` with list, `env_listen` | [LOM] [stubs] |
| `ShifterDevice` | `pitch_mode_index`, `pitch_bend_range` | [LOM] [stubs] |
| `SpectralResonatorDevice` | `frequency_dial_mode`, `midi_gate`, `mod_mode`, `mono_poly`, `pitch_mode`, `polyphony`, `pitch_bend_range` | [LOM] [stubs] |
| `DrumCellDevice` (Drum Sampler) | `gain` | [LOM] [stubs] |
| `LooperDevice` | Transport functions, `record_length_index`, `overdub_after_record`, `loop_length`, `tempo`; `export_to_clip_slot(slot)` (12.1) | [LOM] [notes] |
| `CcControlDevice` | Custom target choices | [stubs] only |
| `MaxDevice` | `audio_inputs`, `audio_outputs`, `midi_inputs`, `midi_outputs` (`DeviceIO` objects with routing), parameter banks | [LOM] [stubs] |
| `PluginDevice` | `presets`, `selected_preset_index`; `is_editor_open` since **12.4.3** | [LOM] [notes] |
| `RackDevice` | see section 4 | |

Answers to the specific cases:

| Setting | Possible? | Detail | Source |
| --- | --- | --- | --- |
| Compressor sidechain source | Yes | `CompressorDevice.input_routing_type` / `_channel`. Sidechain on/off, gain, mix and EQ are ordinary parameters if they appear in `parameters`. | [LOM]; the last sentence [unverified] |
| Gate, Auto Filter, Glue Compressor, Multiband Dynamics sidechain source | **No** | no class has routing properties besides `CompressorDevice`. Whether Glue Compressor reports as a `CompressorDevice` is not stated. | [inferred] from absence; [unverified] |
| Simpler sample: read path | Yes | `SimplerDevice.sample.file_path` | [LOM] |
| Simpler sample: replace | Since **12.4** | `SimplerDevice.replace_sample(absolute_path)`. Before that, only by loading a sample from the browser onto the selected Simpler. | [notes] [LOM]; the browser route is [inferred] |
| Simpler slicing and warp | Yes | `Sample` slicing and warp members above | [LOM] |
| Sampler: zones, samples | **No** | no `SamplerDevice` class | [inferred] from absence |
| Operator: algorithm, oscillator waveforms | Only what is in `parameters` | no `OperatorDevice` class | [inferred] from absence; which Operator settings are parameters is [unverified] |
| EQ Eight mode and oversampling | Yes | `Eq8Device.global_mode`, `oversample` | [LOM] |
| Hybrid Reverb impulse response | Yes, from Live's own lists | category and file index. Loading a user file by path: absent. | [LOM]; [inferred] from absence |
| Max for Live device contents | **No** | only its parameters, banks and inputs/outputs | [LOM] |
| "Hi-Quality" and other context-menu switches | Not as such | only EQ Eight's `oversample` is exposed by name. Some may be ordinary parameters. | [inferred] from absence; [unverified] |

## 6. DeviceParameter

| Member | What it gives | Since | Source |
| --- | --- | --- | --- |
| `value` | Get, set, observe. "The internal value between min and max." | | [LOM] |
| `min`, `max` | Read | | [LOM] |
| `is_quantized` | "1 for booleans and enums, 0 for int/float parameters" | | [LOM] |
| `value_items` | The list of choices, only for quantised parameters; `short_value_items` in Python | | [LOM] [stubs] |
| `default_value` | Read; only for parameters that are not quantised | | [LOM] |
| `str_for_value(value)` | The display text for any raw value, such as "250 Hz". `__str__` gives it for the current value. | | [LOM] [stubs] |
| `display_value` | Get, set, observe. "The value as visible in the GUI", as a number | **12.2** | [notes] [LOM] [stubs] |
| `automation_state` | Read, observe: none, playing, overridden | | [LOM] |
| `state` | Read, observe: enabled, irrelevant, disabled | | [LOM] |
| `is_enabled` | Read; false when macro-mapped or held by a Max for Live device | | [LOM] |
| `name`, `original_name` | Read | | [LOM] |
| `re_enable_automation()` | Function | | [LOM] |
| `begin_gesture()`, `end_gesture()` | Bracket a change, for automation recording | | [stubs] |

**Setting from displayed text.** There is no function that takes "250 Hz" and sets the parameter. Three routes exist:

1. Quantised parameters: find the text in `value_items` and set `value` to its index. **[inferred]** from the LOM description
2. Since 12.2: set `display_value` to the number shown (250 for "250 Hz"). The release notes define it only as "the parameter's value as visible in the user interface"; how it treats units that change with range, such as ms and s, is **[unverified]**.
3. Otherwise: search raw values between `min` and `max` with `str_for_value` until the text matches. **[inferred]**

## 7. Clips

### Session clips

| Action | Possible? | Member | Source |
| --- | --- | --- | --- |
| Create a MIDI clip in a slot | Yes | `ClipSlot.create_clip(length)`; empty slot on a MIDI track | [LOM] [stubs] |
| Create an audio clip from a file | Yes | `ClipSlot.create_audio_clip(absolute_path)`; version added not found | [LOM] [stubs] |
| Delete | Yes | `ClipSlot.delete_clip()` | [LOM] |
| Duplicate | Yes | `ClipSlot.duplicate_clip_to(target_slot)`, `Track.duplicate_clip_slot(index)` | [LOM] |
| Fire, stop | Yes | `Clip.fire()`, `Clip.stop()`, `ClipSlot.fire()`, `ClipSlot.stop()`, `Track.stop_all_clips()`, `Song.stop_all_clips()` | [LOM] |

### Arrangement clips

| Action | Possible? | Member | Since | Source |
| --- | --- | --- | --- | --- |
| Read | Yes | `Track.arrangement_clips` | 11.0 | [LOM] [local] |
| Create a MIDI clip | Yes | `Track.create_midi_clip(start_time, length)` | **12.1.10** | [notes] [LOM] |
| Create an audio clip from a file | Yes | `Track.create_audio_clip(file_path, position)`; errors on a non-audio, frozen or recording track | not found; the 12.2 notes name the function for take lanes, and a 12.4 fix names it for the arrangement | [LOM] [stubs]; version [unverified] |
| Create clips in a take lane | Yes | `Track.create_take_lane()`, `TakeLane.create_midi_clip`, `TakeLane.create_audio_clip`, `TakeLane.arrangement_clips` | **12.2** | [notes] [LOM] |
| Copy a clip to the arrangement | Yes | `Track.duplicate_clip_to_arrangement(clip, destination_time)`; source may be a session or arrangement clip | 11.0 | [LOM] |
| Delete | Yes | `Track.delete_clip(clip)` | 11.0 | [LOM] [stubs] |
| Move | **No** direct way | `start_time` is read-only. Copy to the new time, then delete the old one. | | [LOM]; the two-step method is [inferred] |
| Split | **No** | absent | | [inferred] from absence |
| Change length | Unclear | `end_time` is read-only. `loop_end`, `end_marker` and `looping` are settable; whether they move an arrangement clip's right edge is not stated. | | [LOM]; [unverified] |
| Consolidate, crop to time selection, reverse, fades | **No** | absent. `Clip.crop()` crops to the loop or markers. | | [inferred] from absence; [LOM] |

Fixes that show these functions were unstable: a crash in `create_audio_clip` and `create_midi_clip` fixed in 12.4, and crashes in `duplicate_clip_to_arrangement` fixed in 12.3 and 12.4. **[notes]** The machine's 12.3.2 predates the 12.4 fixes.

### Clip properties

All get, set, observe unless noted. **[LOM] [stubs]**

| Property | Member | Note |
| --- | --- | --- |
| Name, colour | `name`, `color`, `color_index` | |
| Loop | `looping`, `loop_start`, `loop_end`, `position` (moves the loop, keeps its length) | Unwarped audio cannot loop; its values are in seconds |
| Start and end markers | `start_marker`, `end_marker` | |
| Activator | `muted` | |
| Warp | `warping`, `warp_mode` (Beats, Tones, Texture, Re-Pitch, Complex, REX, Complex Pro), `available_warp_modes` | Audio only. Live defers setting `warping`. |
| Warp markers | `warp_markers` (read); `add_warp_marker`, `move_warp_marker`, `remove_warp_marker` | Audio, warped. All three are already in the 11.0.0 Python listing |
| Gain, pitch | `gain` (0.0–1.0, with `gain_display_string`), `pitch_coarse` (−48…48), `pitch_fine` | Audio only |
| Launch | `launch_mode`, `launch_quantization`, `legato`, `velocity_amount` | 11.0 |
| Groove | `groove`, `has_groove` | 11.0 |
| Time signature | `signature_numerator`, `signature_denominator` | |
| File | `file_path`, `sample_length`, `sample_rate` | Read only |
| Place | `start_time`, `end_time`, `length`, `is_arrangement_clip`, `is_session_clip`, `is_take_lane_clip` | Read only |
| Quantise | `quantize(grid, amount)`, `quantize_pitch(...)` | LOM: "Quantizes all notes in the clip". Stubs: "Quantize all notes in a clip or align warp markers", so it may act on audio. [unverified] |

### MIDI notes

| Action | Possible? | Member | Source |
| --- | --- | --- | --- |
| Read | Yes | `Clip.get_notes_extended(from_pitch, pitch_span, from_time, time_span)`, `get_all_notes_extended()` (11.1), `get_notes_by_id`, `get_selected_notes_extended` | [LOM] [local] |
| Add | Yes | `Clip.add_new_notes(notes)`; returns the new note ids | [LOM] [stubs] |
| Modify | Yes | `Clip.apply_note_modifications(notes)`, with notes as returned by `get_notes_extended` | [LOM] |
| Remove | Yes | `Clip.remove_notes_extended(...)`, `remove_notes_by_id(ids)` | [LOM] |
| Duplicate, transpose | Yes | `duplicate_notes_by_id` (11.1.2), `duplicate_region`, `duplicate_loop` | [LOM] |
| Per-note fields | Yes | `pitch`, `start_time`, `duration`, `velocity`, `mute`, `probability`, `velocity_deviation`, `release_velocity`, `note_id` (read) | [LOM] [stubs] [code] |
| Per-note MPE curves (pitch bend, pressure, slide) | **No** | absent from the note fields | [inferred] from absence |

The stubs warn against editing by remove-then-add, "as that leads to loss of per-note events"; `apply_note_modifications` is the way to change a note. **[stubs]** In Python `add_new_notes` wants `MidiNoteSpecification` objects, which ableton-js does not build; its wrapped `set_notes` uses the older five-field tuple with no probability. **[stubs] [code]**

### Automation and clip envelopes

Envelopes are in the Python API and not in the LOM reference.

| Action | Possible? | Member | Source |
| --- | --- | --- | --- |
| Does a clip have automation | Yes | `Clip.has_envelopes`; `Clip.automation_envelopes` in Python | [LOM] [stubs] |
| Get the envelope of one parameter, Session clip | Yes | `Clip.automation_envelope(parameter)`. Returns None if there is none, and for parameters of another track | [stubs] |
| Same, arrangement clip | **No** | "Returns None for Arrangement clips" | [stubs] |
| Create an envelope | Yes | `Clip.create_automation_envelope(parameter)`; errors if it cannot. Behaviour on arrangement clips not stated | [stubs]; [unverified] |
| Read values | Yes | `Envelope.value_at_time(time)`; `Envelope.events_in_range(start, end)` gives breakpoints with `time`, `value` and curve coefficients (newer than 11.0, version not found) | [stubs] |
| Write values | Yes, as steps | `Envelope.insert_step(start_time, length, value)` | [stubs] |
| Write single breakpoints and curves | Unclear | ableton-js calls `Envelope.create_event`; not in the stubs | [code]; [unverified] |
| Delete part of an envelope | Yes | `Envelope.delete_events_in_range(start, end)` (newer than 11.0) | [stubs] |
| Clear | Yes | `Clip.clear_envelope(parameter)`, `Clip.clear_all_envelopes()` | [LOM] |
| Track automation in the arrangement (the lanes) | **No** | no envelope on `Track` or `Song` | [inferred] from absence |
| Record automation | Yes, by playing | `Song.session_automation_record`, `DeviceParameter.begin_gesture()` / `end_gesture()`, `re_enable_automation()` | [LOM] [stubs]; recording by script not tried [unverified] |
| Show an envelope to the user | Yes | `Clip.View.show_envelope()`, `hide_envelope()`, `select_envelope_parameter(parameter)` | [LOM] |

## 8. Scenes

| Action | Possible? | Member | Source |
| --- | --- | --- | --- |
| Create | Yes | `Song.create_scene(index)`, `capture_and_insert_scene()` | [LOM] |
| Delete, duplicate | Yes | `Song.delete_scene(index)`, `duplicate_scene(index)` | [LOM] |
| Fire | Yes | `Scene.fire(force_legato, can_select_scene_on_launch)`, `fire_as_selected()` | [LOM] |
| Rename, colour | Yes | `Scene.name`, `color`, `color_index` | [LOM] |
| Tempo | Yes | `Scene.tempo`, `tempo_enabled` (returns −1 when disabled); newer than 11.0 | [LOM] |
| Time signature | Yes | `Scene.time_signature_numerator`, `_denominator`, `_enabled` | [LOM] |
| Move a scene | No | absent | [inferred] from absence |

## 9. Browser

The browser is in the Python API (`Application.browser`) and not in the LOM reference.

| Question | Answer | Source |
| --- | --- | --- |
| Search by text? | **No.** `Browser` has `load_item`, `preview_item`, `stop_preview`, `relation_to_hotswap_target` and nothing else. | [stubs] |
| How is it walked? | From root items: `instruments`, `audio_effects`, `midi_effects`, `drums`, `sounds`, `samples`, `clips`, `packs`, `plugins`, `max_for_live`, `user_library`, `user_folders`, `current_project`, `colors`, `legacy_libraries`. Each `BrowserItem` has `name`, `uri`, `source`, `is_folder`, `is_device`, `is_loadable`, `children`, `iter_children`. | [stubs] |
| How slow is walking? | Not measured. Through ableton-js each folder is one request and each child is saved as an object. A device's presets sit under the device item, so finding a preset means opening its folders. | [code]; speed [unverified] |
| Stable handle for an item? | `BrowserItem.uri`, "a unique identifier". Nothing turns a URI back into an item, so the tree must be walked again. | [stubs]; [inferred] from absence |
| Load a device preset, rack, sample, clip, groove, Max for Live device, User Library item | Yes, any item with `is_loadable`, with `Browser.load_item(item)` | [stubs]; a native device and a plug-in were loaded this way [local]; the other kinds [inferred] |
| Audition | `Browser.preview_item(item)`, `stop_preview()` | [stubs] |
| Hot-swap | `Browser.hotswap_target`, `filter_type` | [stubs] |

## 10. View

| Action | Possible? | Member | Source |
| --- | --- | --- | --- |
| Select a track | Yes | `Song.View.selected_track` | [LOM] [local] |
| Select a scene | Yes | `Song.View.selected_scene` | [LOM] |
| Select a device | Yes | `Song.View.select_device(device)`. "The track containing the device will not be shown automatically". `Track.View.select_instrument()` selects and shows the instrument. | [LOM] |
| Select a rack chain, drum pad | Yes | `Song.View.selected_chain`; `RackDevice.View.selected_chain`, `selected_drum_pad` | [LOM] |
| Select a Session clip slot | Yes | `Song.View.highlighted_clip_slot` | [LOM] |
| Show a clip in the Detail View | Yes | `Song.View.detail_clip` (get, set) | [LOM] |
| Select an arrangement clip or a time range | Unclear | no selection property for arrangement clips; `detail_clip` may accept one | [unverified] |
| Switch Session / Arrangement | Yes | `Application.View.show_view(name)`, `focus_view(name)`, `hide_view(name)`, `is_view_visible(name)`. Names: Browser, Arranger, Session, Detail, Detail/Clip, Detail/DeviceChain. `focused_document_view` reads which is shown. | [LOM] |
| Open the device or clip detail view | Yes | `show_view("Detail/DeviceChain")`, `show_view("Detail/Clip")` | [LOM] |
| Fold a device | Yes | `Device.View.is_collapsed` | [LOM] |
| Zoom and scroll | Yes, in steps | `Application.View.scroll_view(direction, view, modifier)`, `zoom_view(...)`. Only Arranger, Browser, Session and Detail/DeviceChain scroll. No "go to bar N" or "zoom to fit". | [LOM] |
| Follow, draw mode | Yes | `Song.View.follow_song`, `draw_mode` | [LOM] |
| Message in the status bar | Yes | `ControlSurface.show_message(text)`, used by ableton-js | [code] |
| Read and press a dialog box | Yes | `Application.current_dialog_message`, `open_dialog_count`, `press_current_dialog_button(index)` | [LOM] |

## 11. Listeners

A listener is `add_<property>_listener(callback)` on the object. The stubs list which properties have one. ableton-js attaches any of them by name. **[stubs] [code]**

- **Set level.** Tempo, time signature, loop, playing, playback position, record modes, metronome, scale and root note, song length, and the lists of tracks, return tracks, scenes and cue points. Not observable: `can_undo`, `can_redo`.
- **Tracks.** Name, colour, mute, solo, arm, monitoring, routing, frozen state, the device list, the clip-slot and arrangement-clip lists, take lanes, all meters, performance impact. Not observable: `fold_state`, `is_grouped`.
- **Mixer.** Each volume, pan, send and crossfader through the parameter's `value` listener; the send list, pan mode and crossfade assign on the mixer.
- **Devices.** Name, active state, the parameter list, latency, A/B slot; rack chains, drum pads, macro count and variations; each device class's own properties.
- **DeviceParameter.** `value`, `display_value`, `name`, `automation_state`, `state`.
- **Clips.** Name, colour, loop and markers, mute, warp, gain, pitch, notes, warp markers, playing position and status, envelopes present, `start_time` (12.2) and `end_time`.
- **Clip slots and scenes.** Has-clip, triggered, playing status, colour; scene name, colour, tempo, time signature, triggered.
- **Browser.** Filter type, hot-swap target, and a full-refresh signal.
- **View.** Selected track, scene, chain, parameter, detail clip, follow, draw mode; which main view has focus; selected device per track.

Known gaps: ableton-js says the `output_meter_level` listener hangs "every few 100ms" (left and right work better) and that a clip slot's `playing_status` listener "never fires". **[code]** (README) In Max for Live, "changes to a Live Set and its contents are not possible from a notification"; whether the same holds in Python was not checked. **[unverified]**

## 12. Daily actions with no API

| Action in Live | In the API? | Nearest thing | Source |
| --- | --- | --- | --- |
| Save, Save As, Collect All and Save | No | `Song.file_path`, `name` (read) | [LOM] |
| Open or create a Set | No | | [inferred] from absence |
| Export audio or MIDI | No | | known; absent |
| Bounce in place, bounce to new track, freeze, flatten | No | `is_frozen` (read) | [LOM] |
| Consolidate | No | | [inferred] from absence |
| Split, move or resize an arrangement clip | No | copy with `duplicate_clip_to_arrangement`, then `delete_clip` | [LOM] |
| Cut, copy, paste, duplicate or delete time | No | | [inferred] from absence |
| Group and ungroup tracks; reorder tracks | No | | [inferred] from absence |
| Draw arrangement automation | No | Session clip envelopes only | [stubs] |
| Tempo and time-signature changes on the timeline | No | scene tempo | [inferred] from absence |
| Comp takes | No | take lanes and their clips | [LOM] |
| Clip fades and crossfades | No | | [inferred] from absence |
| Quantise audio, or quantise with settings | Partly | `Clip.quantize(grid, amount)` | [LOM] [stubs] |
| Edit warp markers | Yes | add, move, remove | [LOM] |
| Groove pool: add, remove, commit a groove | Partly | read the pool, edit a groove's amounts, assign `Clip.groove`; add by loading a groove from the browser [inferred] | [LOM] |
| Map a macro, a MIDI controller or a key | No for macros and keys | MIDI mapping exists for the script's own controls (`Live.MidiMap`) | [stubs] |
| Reverse a clip, edit a sample | No | `SimplerDevice.reverse()` for Simpler only | [LOM] |
| MIDI transform and generate tools | No | write notes directly | [inferred] from absence |
| Track delay, track height | No | `Track.View.is_collapsed` | [inferred] from absence |
| Search the browser, tag or collect items | No | walk the tree; `colors` lists collections | [stubs] |
| Open a plug-in window | Since 12.4.3 | `PluginDevice.is_editor_open` | [notes] |
| Change Live's preferences, audio device, sample rate | No | | [inferred] from absence |

## What was not verified

- **Nothing was run.** Every row is from documents and listings. Only the items marked [local] were seen working, in the earlier prototype.
- **The Live version behind the type stubs.** They were taken as a 12.3-era listing by what they contain and lack.
- **Whether the Python API has every LOM member, and under the same name.** The LOM reference is written for Max for Live. `SimplerDevice.replace_sample` and `PluginDevice.is_editor_open` are in the LOM reference and not in the stubs, which fits a version gap but was not confirmed in Python.
- **"Absent" as proof of "not possible".** A member missing from both sources may still exist in Live 12.4.x, or be reachable through a private module. The stubs do show a `save_current_set` on an internal licensing class, which a control surface is not given.
- **Undo.** What `begin_undo_step` / `end_undo_step` group, and whether each API call is its own undo step.
- **`Envelope.create_event`**, which ableton-js calls and the stubs lack. Whether `create_automation_envelope` works on an arrangement clip.
- **`display_value`** behaviour for parameters whose unit changes across the range.
- **Whether setting `loop_end` or `end_marker` resizes an arrangement clip.**
- **The version that added** `Track.create_audio_clip`, `ClipSlot.create_audio_clip`, `Track.duplicate_device`, `Envelope.events_in_range`, `Scene.tempo_enabled`.
- **Which settings of Operator, Sampler, Gate, Auto Filter and Glue Compressor are ordinary parameters.** This needs a parameter dump per device from a running Live.
- **Whether plain integers are accepted** for enum properties that ableton-js does not convert, and whether its `set_notes` wrapper accepts JSON lists.
- **Browser walking speed**, and loading of grooves, clips and Max for Live devices through `load_item`.
- **`Track.current_monitoring_state` in the LOM reference**: it is in the stubs and wrapped by ableton-js; its LOM entry was not captured.
- **Selecting an arrangement clip or a time range.**
- **The structure-void listing for Live 12** and the decompiled bundled scripts were not read.

## Sources

Cycling '74 — [Live Object Model](https://docs.cycling74.com/apiref/lom/) (version 12.4.5), pages read: [Song](https://docs.cycling74.com/apiref/lom/song/), [Song.View](https://docs.cycling74.com/apiref/lom/song_view/), [Track](https://docs.cycling74.com/apiref/lom/track/), [Track.View](https://docs.cycling74.com/apiref/lom/track_view/), [Clip](https://docs.cycling74.com/apiref/lom/clip/), [Clip.View](https://docs.cycling74.com/apiref/lom/clip_view/), [ClipSlot](https://docs.cycling74.com/apiref/lom/clipslot/), [Scene](https://docs.cycling74.com/apiref/lom/scene/), [CuePoint](https://docs.cycling74.com/apiref/lom/cuepoint/), [TakeLane](https://docs.cycling74.com/apiref/lom/takelane/), [Device](https://docs.cycling74.com/apiref/lom/device/), [DeviceParameter](https://docs.cycling74.com/apiref/lom/deviceparameter/), [MixerDevice](https://docs.cycling74.com/apiref/lom/mixerdevice/), [ChainMixerDevice](https://docs.cycling74.com/apiref/lom/chainmixerdevice/), [RackDevice](https://docs.cycling74.com/apiref/lom/rackdevice/), [Chain](https://docs.cycling74.com/apiref/lom/chain/), [DrumPad](https://docs.cycling74.com/apiref/lom/drumpad/), [DrumChain](https://docs.cycling74.com/apiref/lom/drumchain/), [SimplerDevice](https://docs.cycling74.com/apiref/lom/simplerdevice/), [Sample](https://docs.cycling74.com/apiref/lom/sample/), [CompressorDevice](https://docs.cycling74.com/apiref/lom/compressordevice/), [Eq8Device](https://docs.cycling74.com/apiref/lom/eq8device/), [WavetableDevice](https://docs.cycling74.com/apiref/lom/wavetabledevice/), [DriftDevice](https://docs.cycling74.com/apiref/lom/driftdevice/), [MeldDevice](https://docs.cycling74.com/apiref/lom/melddevice/), [HybridReverbDevice](https://docs.cycling74.com/apiref/lom/hybridreverbdevice/), [RoarDevice](https://docs.cycling74.com/apiref/lom/roardevice/), [ShifterDevice](https://docs.cycling74.com/apiref/lom/shifterdevice/), [SpectralResonatorDevice](https://docs.cycling74.com/apiref/lom/spectralresonatordevice/), [DrumCellDevice](https://docs.cycling74.com/apiref/lom/drumcelldevice/), [LooperDevice](https://docs.cycling74.com/apiref/lom/looperdevice/), [MaxDevice](https://docs.cycling74.com/apiref/lom/maxdevice/), [PluginDevice](https://docs.cycling74.com/apiref/lom/plugindevice/), [DeviceIO](https://docs.cycling74.com/apiref/lom/deviceio/), [GroovePool](https://docs.cycling74.com/apiref/lom/groovepool/), [Groove](https://docs.cycling74.com/apiref/lom/groove/), [Application](https://docs.cycling74.com/apiref/lom/application/), [Application.View](https://docs.cycling74.com/apiref/lom/application_view/)

Ableton — [Live 12 release notes](https://www.ableton.com/en/release-notes/live-12/) (12.0 to 12.4.6; the entries used are under 12.0.5, 12.1, 12.1.10, 12.2, 12.3, 12.4 and 12.4.3), [Live 11 release notes](https://www.ableton.com/en/release-notes/live-11/) (11.0.5, 11.1, 11.3.2)

Generated listings of the Python API
- Type stubs `midi-script/Live/*.pyi` in the [ableton-js](https://github.com/leolabs/ableton-js) v5.0.4 package (local copy)
- [NSUSpray Live API Doc, 11.0.0](https://nsuspray.github.io/Live_API_Doc/11.0.0.xml), used only to date members against 11.0

Transport
- ableton-js v5.0.4 Remote Script: `midi-script/AbletonJS.py`, `Socket.py`, `Namespaces/*.py`, and the package README and CHANGELOG (local copy)
