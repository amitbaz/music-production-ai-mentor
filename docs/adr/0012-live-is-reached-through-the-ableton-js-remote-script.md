# 0012 — Live is reached through the ableton-js Remote Script and our own small client

Date: 2026-10-13 · Status: accepted

## Context

Ableton Live lets an outside program read and change a Live Set only through a Remote Script, Python code that runs inside Live. The Ableton tool set has acted on a fake until now. A prototype used the Remote Script of the open-source project ableton-js (MIT licence), unchanged, on Live 12.3.2: it read a whole Live Set, created and deleted tracks, and loaded devices, driven by about 15 lines on Node's built-in `WebSocket`. Research notes: `docs/research/connecting-to-ableton-live.md` and `docs/research/what-live-lets-a-script-do.md`.

## Decision

- The Remote Script is ableton-js's. The repo keeps a pinned copy (5.0.4, with its licence file), and a setup command copies it into Live's Remote Scripts folder.
- Their files stay untouched. What the script cannot reach (reordering a device, notes with probability, Compressor's sidechain source, Simpler's sample) goes into one Python file of our own, registered with one added line.
- The Node side is our own small client on the built-in `WebSocket`. The project keeps zero runtime dependencies.
- The client connects when an Ableton tool is first used, and again on the next tool call if the connection was lost. When Live cannot be reached, the tool result is an error that says why and what to do.
- On connect the client checks the script version and the Live version, and the error names the fix (run setup again and restart Live, or update Live).
- The script's password option is on. Setup creates a random password, writes it into the installed copy of the script, and saves it in the app's `.env`.

Rejected:

- Our own Remote Script: a second language to write and keep working with every Live update, and weeks of work before the first real tool.
- AbletonOSC: UDP messages can be lost without notice, and it offers a fixed list of commands.
- Editing ableton-js's files directly: every update of theirs becomes a merge by hand.
- The ableton-js npm package: it replaces only the thin layer under our tools, its version must match the installed script, and tests would fake a library we do not own.
- Downloading the script at setup, or asking the user to install it by hand: the script and the client could get out of step, and a script broken by a Live update could only be fixed upstream.
- Connecting at start with a status display: a background task and a status line in every app, before there is a need.
- No password: any program on the machine could control Live.

## Consequences

- The repo holds Python: about 40 files we did not write and one we did. Our file can only be tried by hand inside Live.
- An ableton-js update is a folder swap plus the one registering line.
- A user learns that Live is unreachable only when the mentor first uses an Ableton tool.
- Live loads Remote Scripts when it starts, so a script update needs a restart of Live.
- Offline tests replace the socket with scripted replies, as adapter tests replace `fetch`, and replies recorded from Live are saved as test inputs with personal names removed. Fake Ableton is deleted when the real tools arrive.
- Tried in Live 12.4.6 (#3): the script loads and answers, our own file registers with one added line to the script's table of handlers, and the password accepts the right one and refuses a wrong one. The script does not check which web page a connection comes from; with the password on, a page can connect but cannot run a command.
