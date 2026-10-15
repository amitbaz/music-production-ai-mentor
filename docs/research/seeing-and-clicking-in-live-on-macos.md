# Research: seeing and clicking in Live's windows on macOS

Date: 2026-10-15 · Status: research note, not a decision · Ticket: [#68](https://github.com/amitbaz/music-production-ai-mentor/issues/68), for [Map #67](https://github.com/amitbaz/music-production-ai-mentor/issues/67)

The question: on macOS, how can a Node process capture only Live's windows (the main window and a third-party plug-in window), and send mouse and keyboard input to them? Can input reach a window without moving the user's cursor or taking focus? Do custom-drawn plug-in UIs accept synthetic events? Which permissions are needed, granted to which process, and what does the user see? What works with no native code and no runtime dependency, and what needs a helper?

This note builds on route 7 of [reaching third-party plug-ins](reaching-third-party-plug-ins.md#7-looking-at-the-plug-in-window), which covers opening a plug-in window (`PluginDevice.is_editor_open`, Live 12.4.3+) and names ScreenCaptureKit and `screencapture -l`. That material is not repeated here.

Machine: macOS 27.0.1 (26A434), Apple silicon, Live 12 Suite 12.4.6 (`com.ableton.live`), Node 22.23.3, Xcode with the macOS 27 SDK. Live was running with a Set open for the first part of the checks, and the user quit it partway through.

Markers: **[verified]** read in a primary source (an SDK header, Apple or Ableton documentation, or the project's own source) · **[local]** observed on this machine · **[inferred]** my reasoning from verified or local facts · **[unverified]** could not confirm.

What was run: the checks only read. They listed windows, captured Live's windows to PNG files in a temp folder, read Live's Accessibility tree, called the permission preflight functions, and read the system log. **No mouse or keyboard event was sent to any app, no Accessibility action was performed, and nothing in Live was changed.** No plug-in window was open, and none was opened.

## Short answer

1. **A Node process can see Live's windows with no native code of ours and no dependency.** `osascript -l JavaScript` (JXA, part of macOS) reaches CoreGraphics through its Objective-C bridge. `CGWindowListCopyWindowInfo` gives each window's id, owning pid, frame and title. `CGWindowListCreateImage` captured Live's main window with real content in 116 to 122 ms, including once when Live was not on the current screen. **[local]** The SDK marks that function obsolete from macOS 15, so new native code can no longer be compiled against it, but at run time it still works on macOS 27. **[verified]** (header) **[local]** (run). It could be removed in a later release.
2. **`screencapture -l <id>` now runs on ScreenCaptureKit, and it failed on Live's window** with "could not create image from window", while ScreenCaptureKit reported the window as not on screen. TCC allowed the capture. **[local]** (system log) Whether it works while Live is in front could not be tried, because the user quit Live first. **[unverified]**
3. **Live 12 exposes its own interface to the Accessibility API**, a side effect of its screen reader support. Its main window has a tree of 428 elements: 83 sliders, 92 checkboxes, 69 pop-up buttons, each named ("Tempo", "Metronome") with its value, its frame on screen and actions such as `AXPress`, `AXIncrement` and `AXDecrement`. **[local]** Ableton says third-party devices are supported for screen readers "only to a certain extent". **[verified]** Plug-ins built with JUCE 6.1 or later expose their components to Accessibility by default. **[verified]** (JUCE source) Whether a given plug-in window shows real controls there was not checked. **[unverified]**
4. **Input without moving the cursor or taking focus exists in two forms, and neither is proven for plug-ins.** Accessibility actions such as `AXPress` and `AXIncrement` act on an element directly. `CGEventPostToPid` posts an event to one process instead of to the screen. **[verified]** (headers) Whether a background plug-in view acts on a mouse event posted to its process: **[unverified]**. The dependable form is a system-level event (`CGEventPost` at the HID tap), the same as a real mouse. **[inferred]** That form moves the cursor and brings Live to the front, and it collides with the user's own hand on the mouse. **[inferred]**
5. **Turning a knob by dragging is not deterministic.** JUCE sliders switch between velocity-sensitive and absolute drag when Ctrl, Alt or Cmd is held, and the default mode depends on the plug-in. **[verified]** (JUCE source) FabFilter knobs follow drag speed, take Shift for fine control, take a double-click to type a value, and reset on Cmd-click. **[verified]** (FabFilter manual) **Typing a value (double-click, type, Return) is the reliable write**, and it needs Live in front with the plug-in window holding keyboard focus. **[inferred]**
6. **Permissions: Screen Recording to capture and to read window titles; Accessibility to read the tree and to post events.** Both are granted to the *responsible* app, which for a Node process started in a terminal is the terminal app. tccd attributed `osascript` and `screencapture` to the app that hosts the terminal. **[local]** The user grants each one once in System Settings → Privacy & Security. **[verified]** (Apple support)
7. **A native helper is needed only for ScreenCaptureKit** (its calls take completion blocks, and JXA could not import it **[local]**), or when the legacy capture call stops working. A 30-line Swift helper compiled here, and the linker ad-hoc signed it on its own. **[local]** Existing helpers: cliclick (BSD-style licence, input only), robotjs (MIT, a native Node addon), nut.js (prebuilt packages only on a paid subscription). **[verified]**

| Need | No native code (JXA via `osascript`) | Needs a helper | Permission |
| --- | --- | --- | --- |
| Find Live's windows: id, frame, title | `CGWindowListCopyWindowInfo` **[local]** | — | Screen Recording, for titles only **[local]** |
| Capture one window | `CGWindowListCreateImage` (obsolete in the SDK, works at run time) **[local]** | ScreenCaptureKit (`SCScreenshotManager`) **[local]** compiles; capture of Live not shown | Screen Recording |
| Capture with a system tool | `screencapture -l` fails on Live's window here **[local]** | — | Screen Recording |
| Read Live's own controls, values, frames | `AXUIElement…` through JXA **[local]** | — | Accessibility |
| Press or step Live's own controls, no cursor | `AXUIElementPerformAction` (functions present, not run) **[inferred]** | — | Accessibility |
| Click, drag, scroll, type as a real mouse | `CGEventCreateMouseEvent` + `CGEventPost` are callable from JXA (not run) **[local]** | cliclick, robotjs, or our own | Accessibility **[local]** (post-event preflight true under it) |
| Event to one process, no cursor | `CGEventPostToPid` callable from JXA (not run) **[local]** | — | Accessibility **[inferred]** |

## 1. Finding Live's windows

**The window list.** `CGWindowListCopyWindowInfo(kCGWindowListOptionAll, kCGNullWindowID)` returns one dictionary per window, with `kCGWindowNumber` (the id), `kCGWindowOwnerPID`, `kCGWindowOwnerName`, `kCGWindowBounds`, `kCGWindowLayer`, `kCGWindowAlpha`, `kCGWindowSharingState`, and `kCGWindowName` and `kCGWindowIsOnscreen` when present. **[verified]** (`CGWindow.h`: "If present, the name of the window"; "If the key is not present, then the window is not ordered on screen") From JXA:

```js
ObjC.import('CoreGraphics');
const all = ObjC.deepUnwrap(ObjC.castRefToObject(
  $.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll, $.kCGNullWindowID)));
const live = all.filter(w => w.kCGWindowOwnerPID === livePid);
```

Node runs it with `execFile('osascript', ['-l', 'JavaScript', file, ...args])` and reads JSON from stdout. A full listing took 0.1 s including process start. **[local]**

**What Live's list held** (one Set open, no plug-in window open): **[local]**

- 7 windows owned by the `Live` process, all layer 0, all with sharing state 1 (read only, so capturable).
- One main window, 1728 × 1084 points, titled with the Set's name. Its frame matched the AX frame of the same window.
- Six untitled helpers: 1728 × 33 strips (four), a 1728 × 44 strip with alpha 0, and a 500 × 500 window for which `CGWindowListCreateImage` returned no image (never drawn).
- A usable filter: Live's pid, layer 0, a non-empty title, alpha above 0. **[inferred]**

**Titles need Screen Recording.** With the permission held, titles of other apps' windows came back. Inside Claude Code's Bash sandbox, which hides them, no regular app's window had a title, and Live's windows were not marked on screen, although the preflight functions still returned true. **[local]** So the mentor running under a sandbox (in development) sees ids and frames but cannot tell windows apart by title. **[inferred]**

**A plug-in window.** None was opened, to leave Live unchanged. What can be said: **[inferred]**

- In Live, VST and AU v2 plug-ins run inside Live's process, so their editor window belongs to Live's pid and shows up in the same list as a new layer-0 window with a title.
- The window to capture is the one that appears after `is_editor_open` is set to 1: take the list before and after and compare.
- The title format Live gives plug-in windows (plug-in name, track name): **[unverified]**.

**The Accessibility tree as a second index.** `AXUIElementCreateApplication(pid)` and the attribute `AXMainWindow` returned Live's main window with `AXTitle` (the Set name), `AXFrame` and its children. **[local]** `AXWindows` returned an empty list while Live was on another Space, but `AXMainWindow` still worked. **[local]**

## 2. Capturing one window

**Legacy CoreGraphics through JXA: works today.**

```js
const img = $.CGWindowListCreateImage($.CGRectNull, $.kCGWindowListOptionIncludingWindow,
  windowId, $.kCGWindowImageBoundsIgnoreFraming | $.kCGWindowImageNominalResolution);
// NSBitmapImageRep → PNG → file
```

- Live's main window: 1728 × 1084 PNG at nominal resolution (3456 × 2168 at full Retina resolution), about 200 KB, 116 to 122 ms. **[local]**
- The image showed only Live's window, not what covered it. A second capture, taken while Live was not among the on-screen windows (another Space or hidden; which one is unknown), returned current content. The track and device selection had changed between the two captures. **[local]** Whether a window that stays off-screen keeps redrawing, or the image goes stale: **[unverified]**
- The SDK declares it `SCREEN_CAPTURE_OBSOLETE(10.5,14.0,15.0)`. **[verified]** (`CGWindow.h`) Through JXA it is resolved at run time, so the compile-time block does not apply. **[local]** Apple can remove it at any release. **[inferred]**
- Never-drawn windows return NULL, which the caller has to handle. **[local]**

**`screencapture -l`: fails on Live here.** The system log for one attempt shows the tool takes the ScreenCaptureKit path. It calls `SCShareableContent getWindowForWindowId`, which found the window with `isOnScreen=0`, then `SCContentFilter initWithDesktopIndependentWindow` and `SCScreenshotManager captureScreenshotWithRect`. The capture failed with "Failed to start stream due to audio/video capture failure". tccd answered `authValue=2` (allowed) for the screen-capture check. **[local]** The same command captured the desktop wallpaper window. **[local]** So the failure is about the window's state, not the permission. **[inferred]** Whether `screencapture -l` works while Live is on screen in front: **[unverified]** (Live was quit before this could be tried). Retrying with `-l<id>`, `-o` or `-x` made no difference. **[local]**

**ScreenCaptureKit through a helper.** `SCContentFilter(desktopIndependentWindow:)` "captures just the independent window passed in". `SCShareableContent` with `onScreenWindowsOnly` lists the windows "available to capture". **[verified]** (`SCStream.h`, `SCShareableContent.h`) In the macOS 27 SDK, `SCScreenshotManager.captureImage` is offered only with a completion handler in Swift, not as an async overload. **[local]** (compile error) A 30-line Swift probe compiled. **[local]** In its one run, the shareable list held none of Live's windows. Live may already have been quitting by then, so the run proves nothing either way. **[unverified]**

**Why not ScreenCaptureKit from JXA.** `ObjC.import('ScreenCaptureKit')` fails with "nothing found to import". The framework ships no bridge metadata for JXA, and its calls take completion blocks. **[local]**

**Prototype B in the plug-in note asked** "a capture … when the window is behind others and when it is on a second display". The answer for the legacy route: behind others, yes. Not on the current screen, yes once. Second display: not tried. **[local]** / **[unverified]**

## 3. Reading Live through Accessibility

Live 12 added screen reader support. It covers "Transport controls, Browser search, Arrangement View, Session View, Clip and Scene properties, MIDI clip editing, Native effects and instruments". Not covered: "Automation, modulation, and MPE editing", "Max for Live devices". "Third-party devices are supported for screen reader use, but only to a certain extent." **[verified]** ([Live 12 release notes](https://www.ableton.com/en/release-notes/live-12/), Screen Reader Support)

What the tree held, read through JXA with the host app's Accessibility permission (no VoiceOver running): **[local]**

- The main window, `AXStandardWindow`, 428 elements in 8 levels: groups "Control" (with "Tempo and timing", "Scale", "Playback", "Record and capture", "Arrangement looping", "Modes", "Monitoring"), "Arrangement" (one group per track by name), "Device Detail" (one group per device, e.g. "EQ Eight", "Reverb", "Choir Reverb, Operator"), "Status".
- Each control has a description and a value. The "Tempo" slider reads value 126, min 20, max 999, value description "126.00", with actions `AXIncrement`, `AXDecrement` and `AXShowMenu`. The "Metronome" checkbox reads 0, with actions `AXPress` and `AXShowMenu`. Each has `AXFrame` and `AXPosition`.
- `AXValue` is not settable on those two, so the actions are the way in.
- The menu bar is there too: 10 menus, 416 items.

What this means: **[inferred]**

- Live's own controls are reachable by name, with their frames. A frame tells the hands where to click, without reading the picture.
- API first still holds: none of this replaces ableton-js. It is a map for the cases the API misses, such as a dialog, a control the LOM lacks, or finding a device's place on screen.
- For third-party plug-ins, the tree is a per-plug-in question. JUCE added accessibility support in 6.1.0. `Component::setAccessible` is "By default … set to true". **[verified]** ([JUCE CHANGE_LIST](https://github.com/juce-framework/JUCE/blob/master/CHANGE_LIST.md), [`juce_Component.h`](https://github.com/juce-framework/JUCE/blob/454fe89/modules/juce_gui_basics/components/juce_Component.h)) So a JUCE plug-in that uses stock `Slider`s likely shows them as AX sliders with values, and fully custom-drawn ones likely do not. **[inferred]** Not one plug-in window was inspected. **[unverified]**

## 4. Sending input

Nothing in this section was run. CoreGraphics' event functions are callable from JXA: `CGEventCreateMouseEvent`, `CGEventPost`, `CGEventPostToPid`, `CGEventKeyboardSetUnicodeString`, `CGWarpMouseCursorPosition` all resolve as functions. **[local]**

**Three ways in.**

1. **`CGEventPost(kCGHIDEventTap, …)`**: "Post an event into the event stream at a specified location". **[verified]** (`CGEvent.h`) At the HID tap the event is handled like the user's own mouse: the cursor moves to the event's location, a click on a background window brings Live to the front, and a real mouse movement during a drag breaks it. **[inferred]** cliclick, which works this way, offers "-r Restore initial mouse location when finished". **[verified]** ([cliclick README](https://github.com/BlueM/cliclick/blob/master/README.md)) So the cursor can be put back, and the previous app can be brought back to the front, but the user sees both happen. **[inferred]**
2. **`CGEventPostToPid(pid, event)`**: posts "into the event stream for a specific application". **[verified]** (`CGEvent.h`, macOS 10.11+) It does not go through the window server's hit-testing, so it does not move the cursor or activate Live. **[inferred]** For mouse events, which window receives one is decided by fields the header lists as `kCGMouseEventWindowUnderMousePointer` (91) and `…ThatCanHandleThisEvent` (92), "made public in 10.7", with no documented meaning. **[verified]** (`CGEventTypes.h`) Whether Live and a plug-in view act on a click or drag sent this way: **[unverified]**. This is the main thing a prototype must find out.
3. **Accessibility actions** (`AXUIElementPerformAction` with `AXPress`, `AXIncrement`, `AXDecrement`): they act on one element, with no cursor and no focus change. **[inferred]** Live's own controls offer them. **[local]** For plug-ins, only where the plug-in exposes the element. `AXUIElementPostKeyboardEvent`, which sent keys to one app, is deprecated since 10.9. **[verified]** (`AXUIElement.h`)

**Do custom-drawn plug-in UIs accept synthetic events?** A plug-in editor is an `NSView` inside Live's window. It gets mouse events from AppKit the same way whether a hand or `CGEventPost` made them. **[inferred]** The event does carry `kCGEventSourceUnixProcessID`, so a plug-in could tell, but no reason was found for one to check. **[verified]** (field exists) / **[unverified]** (that any plug-in checks) Events posted with `CGEventPostToPid` to a window that is not key are the doubtful case (point 2 above).

**Knobs, fine control, typing a value.**

- JUCE `Slider`: in velocity mode the value follows drag speed. Holding the "modifier to swap modes" switches between velocity and absolute drag. Its default is `ModifierKeys::ctrlAltCommandModifiers`. Double-click-to-default is off unless the plug-in turns it on (`setDoubleClickReturnValue`, single-click modifier Alt). **[verified]** ([`juce_Slider.cpp`](https://github.com/juce-framework/JUCE/blob/454fe89/modules/juce_gui_basics/widgets/juce_Slider.cpp) L1182–1184, L1337–1342; [`juce_Slider.h`](https://github.com/juce-framework/JUCE/blob/454fe89/modules/juce_gui_basics/widgets/juce_Slider.h) L275–279, L642–644)
- FabFilter Pro-Q 4: "The knob reacts to the speed with which you are dragging"; "To fine-tune a value … hold down the Shift key while dragging or moving the mouse wheel"; "Double-click a knob to enter an exact value using the keyboard"; reset with Command-click on macOS; the mouse wheel works on hover. **[verified]** ([Pro-Q 4 help: Knobs](https://www.fabfilter.com/help/pro-q/using/knobs))
- Synthetic events carry `kCGMouseEventClickState` (1 single, 2 double), so a double-click can be built. **[verified]** (`CGEventTypes.h`) Text goes in with `CGEventKeyboardSetUnicodeString` and then Return. **[inferred]**

What follows: **[inferred]**

- A drag's result depends on the timing between events and on the plug-in's mode. The same pixels can give different values.
- The dependable write is to double-click, type the value, press Return, then look again to confirm.
- Typing needs keyboard focus. Live must be the active app and the plug-in window the key window, so a typed write takes focus from the user for that moment.
- The mouse wheel needs the cursor over the knob, so a scroll write moves the cursor.

**What the user sees during hand actions.** With HID events, the cursor jumps and Live comes to the front. Any key the user presses at the same time lands in Live. **[inferred]** No synthetic input was sent in this research, so none of this was observed.

## 5. Permissions

| Permission | Needed for | Check without prompting | Ask (prompts once) |
| --- | --- | --- | --- |
| Screen Recording ("Screen & System Audio Recording") | Window titles, any capture | `CGPreflightScreenCaptureAccess` | `CGRequestScreenCaptureAccess` |
| Accessibility | Reading the AX tree, AX actions, posting events | `AXIsProcessTrusted`, `CGPreflightPostEventAccess` | `AXIsProcessTrustedWithOptions` with `kAXTrustedCheckOptionPrompt`; `CGRequestPostEventAccess` |

Sources: `CGWindow.h`, `CGEvent.h` and `AXUIElement.h` in the macOS 27 SDK. **[verified]** A denied process "is not re-prompted; the user must enable access in System Settings > Privacy & Security > Screen Recording". **[verified]** (`CGWindow.h`) All four checks are callable from JXA through `ObjC.bindFunction`. The bridge does not know them by default. **[local]**

**Who gets the permission.** macOS grants it to the *responsible* app. For `osascript` and `screencapture` started from a shell in a terminal, tccd's log names the terminal's host app as responsible, and that app's grant applied. **[local]** So:

- From Terminal, iTerm, VS Code or any other host, the user grants that app. Every program run in it then has the same access. **[inferred]**
- A helper binary spawned by the mentor inherits the same responsible app. It does not need its own entry unless it is launched as its own app (for example by `open`, or as a login item). **[inferred]**
- On this machine, an Accessibility grant alone made `CGPreflightPostEventAccess` true; there is no separate "post events" entry for the host app. **[local]**

**What the user sees.**

- For Accessibility, an alert with Open System Settings and Deny, then a switch to turn on in Privacy & Security → Accessibility. **[verified]** ([Apple: Allow accessibility apps](https://support.apple.com/guide/mac-help/allow-accessibility-apps-to-access-your-mac-mh43185/mac))
- For Screen Recording, a switch in Privacy & Security → Screen & System Audio Recording, with the + button to add an app. **[verified]** ([Apple: Control access to screen and system audio recording](https://support.apple.com/guide/mac-help/control-access-screen-system-audio-recording-mchld6aa7d23/mac))
- Whether the host app must be restarted after the grant, and how often macOS asks again: **[unverified]**.
- On the ScreenCaptureKit path, `replayd` logs an "attribution" update when a capture starts, which drives the system's screen-capture indicator. **[local]** Whether the legacy call shows the indicator too: **[unverified]**.

**For `pnpm pair ableton`** (a map item): it can call the preflight checks, then the request functions, and tell the user which app to switch on, by name. That is the terminal's host app, which the process can find from its parent chain. **[inferred]**

## 6. No native code versus a helper

**No native code, no dependency: JXA via `osascript`.** It ships with macOS and is still there in macOS 27. **[local]** From Node it is `child_process.execFile` with a script file and JSON on stdout, about 0.1 s per call. **[local]** It covers the window list, legacy capture, the Accessibility tree and actions, and CGEvent creation and posting. **[local]** (callable; posting not run) Its limits: **[local]**

- It cannot reach ScreenCaptureKit.
- Functions newer than its bridge metadata, such as the preflight checks, need `ObjC.bindFunction`.
- Each call starts a process. A long drag means one script that posts every event, not one call per event. **[inferred]**

**A helper binary**, if the legacy capture goes away or `CGEventPostToPid` needs tuning that JXA cannot do:

- **Our own Swift helper.** MIT, like the project. It needs Xcode or the Command Line Tools to build. The linker ad-hoc signed it on its own (`flags=0x20002(adhoc,linker-signed)`), which is enough to run on the machine that built it. **[local]** Shipping it to other users downloaded through a browser needs a Developer ID signature and notarization. If it is built on the user's machine or arrives through npm, it is not quarantined: **[unverified]**.
- **cliclick**: input only (move, click, drag, type, restore the cursor). Objective-C, a BSD-style licence ("Redistribution and use in source and binary forms … are permitted" with the usual three conditions). It needs the terminal to hold Accessibility. **[verified]** ([LICENSE](https://github.com/BlueM/cliclick/blob/master/LICENSE), README)
- **robotjs**: MIT, a native Node addon (built per Node version). **[verified]** (GitHub licence field) This would be a runtime dependency.
- **nut.js**: "Pre-built packages are available for subscription plans"; no licence detected by GitHub. **[verified]** (README, API) It does not fit.

## Recommendation

**Build the eyes and the Accessibility reads on JXA first, with no native code. Keep a Swift helper as the fallback for capture. Prototype the hands before deciding how they post events.**

1. **Eyes.** List windows with `CGWindowListCopyWindowInfo`, find the plug-in window by comparing the list before and after `is_editor_open`, and capture it with `CGWindowListCreateImage`. Everything is in macOS, and it works when Live is covered. Its risk is the obsolete call: write the capture behind one function, so a Swift ScreenCaptureKit helper can replace it.
2. **A second sense, Accessibility.** For Live's own interface, read names, values and frames before reaching for pixels. For each plug-in in the proof case, check whether its window exposes controls. If it does, the hands may not need the mouse at all.
3. **Hands: prototype three things on a scratch Set** before choosing between them:
   - (a) `CGEventPostToPid` click and drag on a plug-in window that is not in front;
   - (b) HID-level double-click, type, Return, with the cursor and previous app restored afterwards;
   - (c) AX actions on a plug-in that exposes them.

   Measure for each whether the value changed, whether the cursor moved, and whether focus moved.

## Open decisions for the maintainer

1. Is relying on an obsolete-but-working call (`CGWindowListCreateImage`) acceptable for the first version, with a helper as the planned replacement?
2. Is it acceptable that typing a value takes focus for a moment and moves the cursor, if the prototype shows `CGEventPostToPid` does not work on plug-in views?
3. Should Accessibility reads of Live's own interface be in scope (for gaps the API misses), or should the hands stay limited to plug-in windows?
4. Should the mentor's terminal host be the app the user grants, or should a helper app with its own name and grant be the one on the permission list?

## What was not verified

- Any mouse or keyboard input, and any AX action: none was sent.
- Any plug-in window: none was open. That covers its title, its frame, its AX tree, and whether it accepts `CGEventPostToPid`.
- `screencapture -l` and ScreenCaptureKit on Live's window while Live is on screen; capture on a second display.
- Whether a window that stays off-screen keeps redrawing.
- Whether the legacy capture shows the screen-capture indicator; how often macOS asks again for Screen Recording; whether a restart is needed after a grant.
- Distribution of a signed helper (Developer ID, notarization, quarantine through npm).
- Live's own fine-control modifier: the Live manual's shortcut page could not be read as text.
- How well a model reads a captured plug-in window, which is still the open question from route 7.

## Local observations

- JXA scripts used: window list, per-app title counts, on-screen list, sharing state, legacy capture to PNG, AX tree walk, AX actions and settability, permission preflight. All ran through `osascript -l JavaScript`, read only.
- In Claude Code's Bash sandbox: titles hidden for every regular app, Live's windows not marked on screen, `screencapture -l` failed, while all four preflight checks returned true. Outside the sandbox, with the host app holding both permissions, titles and capture worked.
- The system log for `screencapture -l` showed `RPDaemonProxy fetchWindow`, `SCContentFilter initWithDesktopIndependentWindow`, `SCScreenshotManager captureScreenshotWithRect`, a TCC allow, then "Error in creating screenshot" and "Failed to start stream due to audio/video capture failure".
- `CGWindowListCreateImage` on the wallpaper window and on Live's main window both returned images; on the 500 × 500 helper it returned NULL.
- The Swift probe was built with `swiftc -O` against the macOS 27 SDK; the async `captureImage(contentFilter:configuration:)` was not available, the completion-handler form was.
- All captures were written to a temporary folder outside the repo; none was committed.

## Sources

Apple
- macOS 27 SDK headers: `CoreGraphics/CGWindow.h` (`kCGWindowName`, `CGWindowListCreateImage` with `SCREEN_CAPTURE_OBSOLETE(10.5,14.0,15.0)`, `CGPreflightScreenCaptureAccess`, `CGRequestScreenCaptureAccess`), `CoreGraphics/CGEvent.h` (`CGEventPost`, `CGEventPostToPid`, `CGPreflightPostEventAccess`, `CGRequestPostEventAccess`), `CoreGraphics/CGEventTypes.h` (`kCGMouseEventClickState`, `kCGEventSourceUnixProcessID`, `kCGMouseEventWindowUnderMousePointer`), `HIServices/AXUIElement.h` (`AXIsProcessTrustedWithOptions`, `AXUIElementPostKeyboardEvent`), `ScreenCaptureKit/SCStream.h`, `SCShareableContent.h`, `SCScreenshotManager.h`
- [Allow accessibility apps to access your Mac](https://support.apple.com/guide/mac-help/allow-accessibility-apps-to-access-your-mac-mh43185/mac), [Control access to screen and system audio recording on Mac](https://support.apple.com/guide/mac-help/control-access-screen-system-audio-recording-mchld6aa7d23/mac)

Ableton
- [Live 12 release notes](https://www.ableton.com/en/release-notes/live-12/): Screen Reader Support, Accessibility, plug-in windows through the LOM

Plug-in frameworks and vendors
- JUCE at `454fe89`: [`juce_Slider.cpp`](https://github.com/juce-framework/JUCE/blob/454fe89/modules/juce_gui_basics/widgets/juce_Slider.cpp), [`juce_Slider.h`](https://github.com/juce-framework/JUCE/blob/454fe89/modules/juce_gui_basics/widgets/juce_Slider.h), [`juce_Component.h`](https://github.com/juce-framework/JUCE/blob/454fe89/modules/juce_gui_basics/components/juce_Component.h), [`juce_Accessibility_mac.mm`](https://github.com/juce-framework/JUCE/blob/454fe89/modules/juce_gui_basics/native/accessibility/juce_Accessibility_mac.mm), [CHANGE_LIST.md](https://github.com/juce-framework/JUCE/blob/454fe89/CHANGE_LIST.md), [BREAKING_CHANGES.md](https://github.com/juce-framework/JUCE/blob/454fe89/BREAKING_CHANGES.md)
- [FabFilter Pro-Q 4 help: Knobs](https://www.fabfilter.com/help/pro-q/using/knobs)

Helpers
- [BlueM/cliclick](https://github.com/BlueM/cliclick): README, LICENSE
- [octalmage/robotjs](https://github.com/octalmage/robotjs), [nut-tree/nut.js](https://github.com/nut-tree/nut.js) (README and GitHub licence field)
