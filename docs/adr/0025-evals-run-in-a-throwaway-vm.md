# 0025 — Evals run in a throwaway VM

Date: 2026-10-16 · Status: accepted · Amends 0020

## Context

ADR 0020 runs a series on the Live the maintainer works in. While a series runs, that Live is busy and the maintainer can't use it. Between runs the runner restores the Set through the tools. When it can't, the series stops, and the maintainer has to reopen Patience and click "Don't Save" in the dialog Live shows. ADR 0020 turned down reopening before every run because, done by hand, ten runs means ten reopens.

Tart (`openai/tart`, formerly Cirrus Labs) runs macOS VMs on Apple Silicon. It can copy a VM in seconds, run it with no window, and reach it over SSH. macOS allows at most two macOS VMs running at once. The Remote Script listens on 127.0.0.1:39031 on the machine Live runs on. The Ableton client already takes any address and password.

## Decision

- A series runs in a sandbox: a fresh copy of the sandbox image, started for that series. The sandbox image is macOS with Live installed, authorized and paired. Every series starts from the same clean state.
- The runner stays on the maintainer's Mac, and so do the code, the API keys and the saved runs. It reaches Live through an SSH tunnel to a port other than 39031, so the maintainer's own Live is never touched. The VM runs with no window and no sound.
- Before every run, a fixed script in the VM reopens Patience, clicks "Don't Save" through `osascript`, waits for the Set and reconnects. The screen and mouse are used for this and nothing else. No agent looks at the screen.
- If the Set is not back after a reopen, the series stops. The runner saves a screenshot to the series folder and keeps the stopped VM so it can be inspected. After a good series, the VM is deleted.
- `pnpm eval` runs in the sandbox only. Restoring through the tools, and its "reopen Patience by hand" path, are removed. `pnpm plant` stays on the maintainer's own Live, because the maintainer listens to a plant while writing it and the VM has no sound.
- One series runs at a time.
- A script in the repo builds the sandbox image. It installs Live, pairs it, grants the permission the click needs, authorizes Live with a licence file passed as an argument, and checks that Patience opens. The image is kept only on the Mac it was built on, because it holds a licence.
- Offline tests give the runner a fake sandbox and check three things: Patience is reopened before every run, a failed reopen stops the series and keeps the VM, and the VM is deleted after a good series. The real Tart side is checked by one real series, reported as observed.

Rejected:

- Keeping evals on the maintainer's own Live, with the sandbox as an option. That leaves two reset paths to keep working.
- Reopening only when restoring through the tools fails. It is faster, but leftovers the snapshot doesn't see could reach the next run.
- An agent that reads the screen and clicks whatever dialog is up. It handles dialogs nobody planned for, but it costs API credit on every reset and sometimes clicks wrong. An unknown dialog stops the series and shows up in the screenshot.
- Running the whole evals loop in the VM, with an agent that changes the prompt and opens pull requests. That would spend API credit with nobody watching, and it is a separate design.
- Running everything inside the VM. The keys would live in the VM, and the code would have to be synced before every series.
- One VM that stays up between series. It starts faster, but a crash or a stray dialog would carry over to the next series.
- Two VMs at once, one per panel model. It halves the wait but takes both VM slots and 8–16 GB of RAM. Add it if the wait starts to hurt.

## Consequences

- An eval needs a Mac with Apple Silicon, about 60 GB of disk for the image, and the sandbox image built first.
- Each run is slower: Live reopens the Set every time.
- Nobody had reported running Live in a macOS VM. The first step is to boot one, start Live, and connect to the Remote Script.
- Ableton's offline licence file is tied to the machine's hardware code. Copies of the image keep the macOS machine identifier, so they should keep the authorization. That is untested.
- A run that deletes a clip no longer stops the series, because the next run starts from the file.
