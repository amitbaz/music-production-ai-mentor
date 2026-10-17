# Evals

The evals check whether the mentor, with the prompt and tools it has, fixes a fault planted on a base Set. A **base Set** is a finished Live Set that sounds right. A **plant** is a fault applied to it, such as the sub bass turned up 6 dB. A **case** is a plant plus what the user says about it. A run passes when the Set read back after the mentor's turn equals the base ([ADR 0020](../docs/adr/0020-evals-grade-the-set-against-its-base.md)).

The evals call the real model, so they run on demand and cost API credit. `pnpm test` never runs them.

## Before you run

`pnpm eval` runs in a **sandbox**: a throwaway virtual Mac (Tart) copied from a sandbox image that holds Live, authorized and paired ([ADR 0025](../docs/adr/0025-evals-run-in-a-throwaway-vm.md)). The VM has no window and no sound, and your own Live is never touched, so you can keep working while a series runs.

- A Mac with Apple Silicon, [Tart](https://tart.run) installed (`tart` on PATH, or `TART=/path/to/tart`), and about 60 GB of free disk.
- The sandbox image, built once: see [Building the sandbox image](#building-the-sandbox-image). Without it, `pnpm eval <case>` stops and names the build command.
- A key in `apps/cli/.env` for each model you run on: `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`. The eval scripts read that file. The keys stay on your Mac and never go into the VM.
- `pnpm plant` is different: it works on the Live you have open, with the base Set ([*Patience*](sets/patience/README.md#where-it-is), Ableton's demo song) open in it. Never save over it.

## Running

Run from the repo root:

```sh
pnpm plant                                   # lists the plants
pnpm plant <name> [--revert]                 # applies or reverts one on the Set open in your Live, without saving
pnpm eval                                    # lists the cases
pnpm eval <case> [--runs 30] [--model provider:model] [--no-kb]
```

With `KB_PATH` set in `apps/cli/.env`, every run has the knowledge base: the runner starts its server once, before the sandbox, and stops at once if it can't. It prints `knowledge base: mentor-kb @ <commit>` (`-dirty` when the clone has changes not committed, new notes included; commit the notes before a series that counts) or `knowledge base: none`, and saves that line with every run. `--no-kb` leaves the knowledge base out. A line in `scores.md` for a series with it names the commit in `change`, such as "with knowledge base (mentor-kb 2ceb6fe)": a score compares only at the same notes.

`pnpm eval` runs the case 30 times by default, on the mentor's default model unless `--model` names another. It copies the sandbox image under a new name, starts the copy, and runs the series in it, one series at a time. Before every run, a script in the VM reopens Patience from disk and answers Live's "Save changes?" with "Don't Save", so every run starts from the base. Then the run plants the fault, gives the mentor one turn, reads the Set back and grades it against the base:

```text
run 1: fail (1 differences, stop finished)
run 2: pass
...
low-end-hot-told on claude:claude-haiku-5-5: 0/30 passed. Runs in ~/.mentor/evals/runs/<date>-low-end-hot-told
```

When the series ends, the copy is deleted. Every run is saved in full under `~/.mentor/evals/runs/`, outside the repo: the conversation, the verdict, and how the Set differed from its base.

If Patience does not come back after a reopen, the series stops. The runs made so far are kept, a screenshot of the VM's screen is saved as `stopped.png` in the series folder, and the VM is kept. The CLI names it and says how to look and clean up:

```sh
tart run <name>       # opens the VM's window
tart delete <name>    # when you are done; a kept VM takes disk
```

Other errors name their fix: no Tart, a Mac without Apple Silicon, no sandbox image, or macOS's limit of two macOS VMs running at once (`tart list` shows them, `tart stop <name>` frees one).

## Building the sandbox image

A series runs in a sandbox copied from a **sandbox image** (ADR 0025). Build it once, and again after a Live or macOS update:

```sh
scripts/build-sandbox-image.sh <live-installer.dmg> <licence.auz> [image-name]   # image-name defaults to mentor-sandbox
```

- The machine needs Apple Silicon, [Tart](https://tart.run) (`tart` on PATH, or `TART=/path/to/tart`), `pnpm install` done, and about 60 GB of free disk.
- You pass the Live 12 Suite installer and the licence file (`.auz`) from outside the repo. The script refuses a file inside it, and keeps neither: the installer and the licence file are deleted from the VM after use. What stays is Live's authorization inside the image.
- It copies the Cirrus Labs macOS base, grows its disk to 100 GB (`SANDBOX_DISK_GB`), boots it with no window and no sound, installs Live, authorizes it, pairs it (the same install as `pnpm pair ableton`, with a new password), sets auto-login and Patience at login, checks the System Events permission the "Don't Save" click needs, then reboots the VM and reads Patience's tracks through an SSH tunnel on a port other than 39031. It prints the image's size and the boot-to-Patience time. A failed build stops the VM but keeps it, with its progress: rerun the same command to resume. The steps already done are listed in `~/.mentor/sandbox/<image-name>.done` and are skipped. To start over, `tart delete <image-name>` and remove that file; `SANDBOX_DELETE_ON_FAIL=1` deletes the half-built image after a failure instead.
- It leaves two files on your Mac in `~/.mentor/sandbox/`: `pairing-password` and the SSH key `id_ed25519`. The sandbox reads them.
- The image never leaves your Mac: the script never calls `tart push`. Do not push it.
- Live's authorization is tied to the image's MAC address, and `tart clone` gives a copy a new one. The sandbox sets each copy back to the image's MAC, so only one copy can run at a time: a second one running beside it gets a new MAC from Tart, and its Live asks to be authorized.
- Live's Control Surface choice and its first-launch dialogs cannot be scripted. If the final check says the Remote Script does not answer, build again with `SANDBOX_GUI=1`: the VM then shows a window and the script waits for you to choose MusicMentor in Live's settings (and to allow System Events, if macOS asks). The header of the script lists every setting.

## Don't know what to do? Run the loop

```text
1. Take the case with the lowest score in scores.md, skipping any marked "out of the loop".
   No cases? Write one: a plant in sets/<set>/plants.ts and what the user says in sets/<set>/cases.ts.
2. Run it 10 times. Read every failing run under ~/.mentor/evals/runs/.
3. Change ONE thing, cheapest first: system prompt → a tool's description → a tool's shape → a new tool.
4. Run it 30 times, on every model in the panel. Add a line per model to scores.md.
5. Score up on the panel, and no other case down? Keep the change. Otherwise revert it.
6. Back to 1.
```

10 runs is a look: 0/10 says "broken" clearly. 30 runs is a decision: 6/10 against 8/10 can be luck, 18/30 against 24/30 mostly isn't.

## The panel

The user brings the model ([ADR 0022](../docs/adr/0022-one-harness-and-the-user-brings-a-key.md)), so a case runs on every supported model, not one. Today the panel is:

- `gemini:gemini-3.5-flash-lite` (the default)
- `claude:claude-haiku-5-5`

The supported models are listed in each provider adapter under [`packages/harness/src/providers/`](../packages/harness/src/providers/). Read the scores as a matrix:

- Low on all models → a product problem: prompt, tool or knowledge. Fix it.
- Low on one model → a model problem. Don't fix it; the line in `scores.md` records it.
- A change is kept when it lifts the panel, never for one model.

## Judgment plants

A plant with one right fix, such as a muted track, passes when its values are back at the base. A judgment plant, such as a level, passes within a range around the base, and the range comes from how far apart good engineers set the same element ([ADR 0024](../docs/adr/0024-a-judgment-plant-passes-within-a-range.md)). A judgment case with no range yet is marked "out of the loop" in `scores.md`: its score is a baseline, not something to tune toward.

## scores.md

[`scores.md`](scores.md) has one line per case, per model, per series. It is the only score the repo keeps; the runs themselves stay outside it. It is internal: nothing in the README says which models score what. When the log gets too long to read the latest score per case and model at a glance, a small matrix goes at its top, kept by hand.

## Layout

```text
evals/
├── src/           # the runner: plant, snapshot, grade
├── sets/
│   └── patience/  # the first base Set: its README, plants.ts and cases.ts
└── scores.md
```
