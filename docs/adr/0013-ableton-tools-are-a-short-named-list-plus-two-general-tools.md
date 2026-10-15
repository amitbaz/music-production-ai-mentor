# 0013 — The Ableton tools are a short named list plus two general tools

Date: 2026-10-13 · Status: accepted

## Context

Live offers a script hundreds of properties and functions. The model sees only the tools it is given, all of them on every model call, and a turn is capped at 10 rounds. The model can ask for several tool calls in one round, so what costs rounds is a call that needs the answer of an earlier one. A real Live Set is large: the one used in the prototype has 58 tracks and over 100 devices, EQ Eight alone has 84 parameters, and reading every detail took 16 seconds.

## Decision

- Named tools cover what the mentor does often; two general tools reach everything else. The first list:
  - Read: `read_set`, `read_arrangement`, `read_tracks`, `read_clip`.
  - Change: `set_parameters`, `edit_tracks`, `edit_devices`, `edit_arrangement`, `write_notes`, `transport`, `find_in_browser`, `show`.
  - Remove: `delete`.
  - General: `live_get`, `live_change`.
- The list is a first list. An action the mentor keeps doing through the general tools earns a named tool; a named tool that goes unused is removed.
- Three rules keep a request near two rounds, read then act:
  - a read returns what the next action needs;
  - an action says which object it means without a lookup;
  - an action's result states the value before and after.
- Reading is overview first, details on request. Nothing is cached and the client does not listen for changes; each read asks Live. Read results are compact text. (The format of read results is replaced by ADR 0017.)
- Tracks, devices and clips are addressed by object ids: short ids such as `t17` and `d204`, made by the client the first time an object is read. Parameters inside a device are addressed by name. Every result repeats the names.
- Values are read and written in the units Live shows (dB, Hz, %).

Rejected:

- Only general tools: the model must know Live's internal names, raw results fill the conversation, most requests take four or more rounds, and approval cannot tell a harmless call from a destructive one.
- Only named tools: control is never wider than the list, and the list grows without end.
- Addressing by name: two objects with the same name can be swapped between the read and the action, and the change lands on the wrong one without an error.
- Addressing by position, alone or together with the name: any track added or moved above shifts the positions, so the call hits the wrong object or is refused needlessly.
- The script's own ids: long numbers the model must copy digit for digit, costly in tokens and unreadable in the conversation.
- Reading the whole Live Set once and keeping a copy fresh: a long wait at the start, much code to keep the copy true, and a stale copy gives confident wrong answers.
- A cap of about ten named tools per tool set: wider tools have more complex arguments. The growth of the tool list across tool sets is left to the harness (issue #1, loading a tool set only when needed).

## Consequences

- The client keeps a table from object id to Live object. It is emptied when the connection is lost, and an old id then gives an error that tells the model to read again.
- A detail the mentor did not ask for is a detail it does not know; the overview must name enough for it to know where to look.
- The list can only be proven by measuring real requests: rounds per request and uses of the general tools.
- Tried in Live 12.4.6 (#3). A parameter is written in shown units through its `display_value`, which clamps a value out of range without an error, so the client checks the range itself; a list parameter takes the index of the choice, so the client maps the name. An id of a deleted object fails with a Python `ArgumentError` that the client turns into the read-again error. Loading another Live Set closes the connection, so the table is emptied by the rule above.
- Built in `set_parameters` (#9). Live gives a device no link to its track, so the tool walks down from the tracks, racks included, to name the track in its result. A track's sends are named `send t2`, by the object id of the return track, as `read_set` keys them. The range check writes the number, reads what Live kept, and if Live clamped it writes the old value back and refuses, naming the range from Live's own text: it is exact in every unit, and a refused change shows in Live for a moment before it is put back.
- Limits of `set_parameters`, known and not yet tried against every device in Live. The range check allows 0.1% of the kept value for rounding, so a number only that far past an end is taken, and a parameter that rounds more coarsely than that at an end could be refused wrongly. A number written to a parameter Live holds still is reported as written; only a list is read back to check. A device inside a rack's return chain cannot be changed, because `read_tracks` lists only a rack's `chains` and so never gives those devices an object id.
