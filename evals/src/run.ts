import type { Tool } from "@mentor/harness";
import type { createMentor, Message } from "@mentor/mentor";
import { applyPlant, type Plant } from "./plant.ts";
import { difference, restore, snapshot } from "./snapshot.ts";

// A case: a plant and what the user says about it, nothing more (ADR 0020).
export type Case = { name: string; plant: Plant; message: string };

// One run, kept in full: the conversation, the verdict, the model, how the Set differed from its
// base after the turn, what the runner did to restore it, and what it could not put back.
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
    restored: string[];
    left: string[];
};

type Options = {
    // Makes the runner's tools and a mentor, each pair on a connection of its own.
    connect: () => { tools: Tool[]; mentor: ReturnType<typeof createMentor> };
    model: string;
    case: Case;
    runs: number;
    onRun: (run: Run) => Promise<void>;
};

// Runs a case `runs` times on the Set open in Live: plant, one mentor turn, read back, grade against
// the snapshot taken first, restore. A run passes when the Set equals that snapshot. The series stops
// at a run whose changes the runner cannot undo; `left` says what still differs. Every run connects
// afresh and takes its own base snapshot, so object ids from an earlier run are never used.
export async function runCase({ connect, model, case: { name, plant, message }, runs, onRun }: Options): Promise<{ passed: number; runs: number; left?: string[] }> {
    let passed = 0;
    for (let run = 1; run <= runs; run++) {
        const { tools, mentor } = connect();
        const base = await snapshot(tools);
        await applyPlant(tools, plant);
        // Nobody is at the keyboard: the mentor's removals are approved, as a trusting user would.
        const result = await mentor.generate([], message, { approve: () => true });
        const after = await snapshot(tools);
        const diff = difference(base, after);
        const restored = diff.length ? await restore(tools, base, after) : [];
        const left = diff.length ? difference(base, await snapshot(tools)) : [];
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
            restored,
            left,
        });
        if (left.length) return { passed, runs: run, left };
    }
    return { passed, runs };
}
