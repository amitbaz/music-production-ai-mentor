# What to try by hand in Live before a release

Our Python file, `ableton-js/Mentor.py`, and the script it is part of only run inside Ableton Live, so the offline tests cannot check them. Try each item below in a running Live, on the Live version the release names (12.4 or later), and write down what you saw and the Live version.

Set up once: `pnpm pair ableton`, restart Live, choose `MusicMentor` as a Control Surface in Settings → Link, Tempo & MIDI. Open a Live Set with a MIDI track and an audio track. Run the calls below by asking the mentor in the terminal, or from a throwaway script that sends them to the script's WebSocket. Names in `code` are functions of our file or tools.

## The connection

1. **Password, right one.** With the paired install, any tool call works (`read_set`).
2. **Password, wrong one.** Put another value in `ABLETON_PASSWORD` in `apps/cli/.env`: the tool result says Live refused the password and to pair again. Put the right one back.
3. **Password, none.** Remove `ABLETON_PASSWORD`: the tool result says Ableton is not paired and to run `pnpm pair ableton`.
4. **Version check, a copy without our file.** In `Remote Scripts/MusicMentor/AbletonJS.py` delete the line that registers `"mentor"`, restart Live: the tool result names the script version and says `mentor file missing`, to pair again and restart Live. Run `pnpm pair ableton` and restart Live to put it back.
5. **Version check, our file of another version.** Change `VERSION` in the installed `Mentor.py` to `"0"`, restart Live: the tool result says `mentor file 0`. Pair again to put it back.
6. **Version check, a copy that matches.** After pairing, the tool call works and nothing is said about versions.

## Our file's functions (`Mentor.py`)

Each is called with `ns: "mentor"` and the script's own ids for Live objects, such as `live_123`: a script returns them for tracks, devices and clips. The mentor's tools do not call items 10 and 11 yet.

7. **`get_version`** gives the `VERSION` string of the file.
8. **`move_device`**, with a device, a target track or rack chain and a position counted from 0.
   - Within a chain: with devices A, B, C on a track, move C to 0. The order in Live is C, A, B, and the call gives `0`.
   - To another track: the device leaves the first track and is at the position on the second.
   - A position past the end: Live refuses it or clamps it. Write down which, since `edit_devices` assumes the first.
9. **`add_notes`**, on a MIDI clip, with two notes, one with `probability: 0.5` and one without: both appear in the clip, the first shows 50% in the note's chance in Live's clip view, and the call gives two note ids. Check `mute`, `velocity_deviation` and `release_velocity` as well. Then **`modify_notes`**, with a note's `note_id` and a new `velocity` and `start_time`: the note changes in Live. Drag the clip's start marker later, so a note sits before the start, and change that one too: it changes, where the script's own `apply_note_modifications` leaves it as it was.
10. **`set_compressor_sidechain`**, on a Compressor with sidechain on, with the name of another track as `routing_type`: the Audio From chooser in the sidechain section shows that track. Then with a `routing_channel` such as `Post FX`. A name that does not exist gives `Routing type not found`.
11. **`replace_simpler_sample`**, on a Simpler, with the absolute path of a sample file: Simpler shows the new sample and the call gives the path. A path that does not exist gives an error. (Live 12.4 or later.)
12. **`delete`**, with the id of each of these, one at a time: a track, a return track, a device on a track, a device inside a rack chain, an Arrangement clip, a Session clip. Each disappears from Live and the call gives its name. Main gives `Main cannot be deleted`. The same id again gives `Unknown object id`.

## The ableton-js functions the tools use

13. **`edit_devices` add.** Add `"EQ Eight"` to a track at position 1, in the middle, and at the end: each lands where asked, and the result gives an object id and the new order. A name Live does not know (`"Serum"`) is reported as an error. Add into a rack chain (an id from `read_tracks`).
14. **`edit_devices` move.** As item 8, through the tool, with the result's order matching what Live shows.
15. **`edit_devices` switch.** Switch a device off, then on: the device turns off and on in Live, and the result says `before` and `after`. Try it on an instrument, a rack and a third-party plug-in.
16. **`edit_devices` cannot delete.** `{action: "delete"}` is refused and the device is still there.
17. **`find_in_browser`.** Look for `compressor`, `808` and `bass` with each `kind`: matches have the right kind (a device is `device`, a `.adv` or `.adg` is `preset`, a `.wav` is `sample`), and the path is where the item is in Live's browser. Write down how long the first search of a large library takes, and whether it stops at 5000 items.
18. **`delete` through the tool.** Ask the mentor to delete a track: the terminal asks first, and a no leaves the track. A yes removes it and the result names it; Cmd+Z in Live brings it back. Delete two notes of a MIDI clip by the ids `read_clip` gives: only those two go.
19. **`live_get` and `live_change`.** `live_get` `song` `available_properties`, then a property it lists; a track's `devices` gives object ids. `live_change` `song` `groove_amount` asks first and gives before and after; a function such as `tap_tempo` runs. A property that does not exist gives Live's own error.
20. **`write_notes`.** Add two notes, one with `probability: 0.5`: both appear, the note's chance shows 50% in the clip view, and `read_clip` gives both with the ids the result gave. Change one note's start, velocity and probability: Live shows the change and the result gives before and after. Change a note before the clip's start the same way (`read_clip` lists it with a negative start). `{remove: [...]}` is refused and the notes stay.
21. **`edit_arrangement` clips.** Create a MIDI clip at a bar with a length; duplicate it to another bar and to another MIDI track; move it, and see the original gone and the playback position where it was; move a MIDI clip to an audio track and see it refused with the original kept. Duplicate a clip onto bars that hold another and see it refused with nothing changed. Move a clip two bars along its own track, onto bars it covers itself: one clip remains, at the new place, whole. In Live 12.4.6 a copy onto the middle of a longer clip split that clip in two, which is why the overlap is refused; check it still does.
22. **`edit_arrangement` clip settings.** On a MIDI clip change name, mute and loop. On an audio clip set warp to each mode and to off, gain to −12, 0 and 12 dB and `"-inf"` (Live shows those exact texts), and pitch; the loop of an unwarped clip is refused.
23. **`edit_arrangement` locators.** Add a locator at a bar with a name and without, rename it, remove it; the playback position stays where it was each time. A bar with a locator, a bar past the end of the arrangement and a bar like 9.5 are refused. While Live plays, adding and removing are refused with a word to stop first, and renaming still works.
24. **`edit_arrangement` refusals.** `split`, `insert_time`, `cut_time` and `automation` give steps that work when done by hand in Live; `delete` is refused and the clip stays.
25. **`edit_arrangement` samples.** Place a short sample (a one-shot) and a long one (a vocal or a loop of several bars) with `place_sample` on an empty audio track at bar 9: each lands at bar 9, is named after its file, and the result's bars and warp match what Live shows. Place one between two clips where it fits: it lands at its bar, and no extra clip is left past the last one. Place one where it would reach the next clip: it is refused naming that clip, the clip is whole, and nothing is left past the last clip. After each, the playback position is where it was; after the last two, the arrangement ends where it did. A MIDI track, a relative path and a missing file are refused.
