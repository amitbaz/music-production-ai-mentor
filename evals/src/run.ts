import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Tool } from "@mentor/harness";
import type { createMentor, Message } from "@mentor/mentor";
import { applyPlant, type Plant } from "./plant.ts";
import { difference, snapshot } from "./snapshot.ts";

// A case: a plant and what the user says about it, nothing more (ADR 0020).
export type Case = { name: string; plant: Plant; message: string };

// One run, kept in full: the conversation, the verdict, the model, and how the Set differed from its
// base after the turn.
export type Run = {
    case: string;
    run: number;
    model: string;
    message: string;
    passed: boolean;
    difference: string[];
    stop: string;
    error?: string;
    messages: Message[];
};

// The throwaway Live a series runs on (ADR 0025). `name` is the VM's name, for whoever looks at a kept one.
export type Sandbox = {
    name: string;
    // Reopens the base Set from disk, answers "Don't Save" and waits until it is open; throws if it doesn't come back.
    reopenBase: () => Promise<void>;
    // Saves the sandbox's screen to a file.
    screenshot: (file: string) => Promise<void>;
    // Stops the sandbox, and deletes it unless `keep`.
    close: (options?: { keep?: boolean }) => Promise<void>;
};

type Options = {
    // Makes the runner's tools and a mentor, each pair on a connection of its own.
    connect: () => { tools: Tool[]; mentor: ReturnType<typeof createMentor> };
    sandbox: Sandbox;
    // The series folder: where a stopped series puts its screenshot.
    folder: string;
    model: string;
    case: Case;
    runs: number;
    onRun: (run: Run) => Promise<void>;
};

// Runs a case `runs` times in the sandbox: reopen the base Set, snapshot it, plant, one mentor turn,
// read back, grade against that snapshot. A run passes when the Set equals it. Every run connects
// afresh, so object ids from an earlier run are never used. If the base does not come back, the series
// stops: a screenshot goes into `folder` and the sandbox is closed with `keep`, and `stopped` says why
// and which VM to look at. A series that finishes closes the sandbox and deletes it.
export async function runCase({ connect, sandbox, folder, model, case: { name, plant, message }, runs, onRun }: Options): Promise<{ passed: number; runs: number; stopped?: { reason: string; vm: string } }> {
    let passed = 0;
    for (let run = 1; run <= runs; run++) {
        try {
            await sandbox.reopenBase();
        } catch (error) {
            mkdirSync(folder, { recursive: true });
            try {
                await sandbox.screenshot(join(folder, "stopped.png"));
            } finally {
                await sandbox.close({ keep: true });
            }
            return { passed, runs: run - 1, stopped: { reason: (error as Error).message, vm: sandbox.name } };
        }
        const { tools, mentor } = connect();
        const base = await snapshot(tools);
        await applyPlant(tools, plant);
        // Nobody is at the keyboard: the mentor's removals are approved, as a trusting user would.
        const result = await mentor.generate([], message, { approve: () => true });
        const diff = difference(base, await snapshot(tools));
        // A refused turn is a failed run, even when the Set equals its base.
        const ok = !diff.length && result.stop !== "refused";
        if (ok) passed++;
        await onRun({
            case: name,
            run,
            model,
            message,
            passed: ok,
            difference: diff,
            stop: result.stop,
            ...(result.stop === "error" && { error: result.error.message }),
            messages: result.messages,
        });
    }
    await sandbox.close();
    return { passed, runs };
}
