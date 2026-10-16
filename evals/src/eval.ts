// Runs a case against the real model in a sandbox and prints its rate (ADR 0020, ADR 0025):
//     pnpm eval                                        lists the cases
//     pnpm eval <case> [--runs 30] [--model provider:model]
// Every run is kept in full under ~/.mentor/evals/runs/, outside the repo, so runs outlast the worktree they ran in.
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createMentor, keysFromEnv, MODEL_ID } from "@mentor/mentor";
import { createAbleton } from "@mentor/tools/daws/ableton";
import { cases } from "../sets/patience/cases.ts";
import { runCase } from "./run.ts";
import { startSandbox } from "./sandbox.ts";

const { positionals, values } = parseArgs({ allowPositionals: true, options: { runs: { type: "string", default: "30" }, model: { type: "string" } } });
const chosen = cases.find((c) => c.name === positionals[0]);
if (!chosen) {
    if (positionals[0]) console.error(`No case ${positionals[0]}.`);
    for (const c of cases) console.log(`${c.name.padEnd(20)} ${c.plant.name}: "${c.message}"`);
    process.exit(positionals[0] ? 1 : 0);
}
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs must be a whole number above 0, got ${values.runs}`);

// Ctrl-C ends the series: the VM is stopped and deleted, not left running. The handler is in place before
// the VM starts, so a Ctrl-C while it is being copied or booted deletes the copy too (startSandbox does).
const interrupt = new AbortController();
let started: Awaited<ReturnType<typeof startSandbox>> | undefined;
process.once("SIGINT", () => {
    interrupt.abort();
    if (started) void started.close().catch(() => {}).finally(() => process.exit(130));
});
// The sandbox and where its Live answers: the tunnel's address and the pairing password.
try {
    started = await startSandbox({ signal: interrupt.signal });
} catch (error) {
    console.error((error as Error).message);
    process.exit(interrupt.signal.aborted ? 130 : 1);
}
// A Ctrl-C that came as the start finished.
const sandbox = started;
if (interrupt.signal.aborted) {
    await sandbox.close().catch(() => {});
    process.exit(130);
}
const kept = (vm: string) => `The VM ${vm} is kept: open it with "tart run ${vm}", delete it with "tart delete ${vm}".`;

const keys = keysFromEnv(process.env);
const model = values.model ?? MODEL_ID;
const folder = join(homedir(), ".mentor", "evals", "runs", `${new Date().toISOString().replace(/[:.]/g, "-")}-${chosen.name}`);
try {
    const result = await runCase({
        connect: () => ({
            tools: createAbleton({ address: sandbox.address, password: sandbox.password }),
            mentor: createMentor({ keys, model: values.model, abletonAddress: sandbox.address, abletonPassword: sandbox.password }),
        }),
        sandbox,
        folder,
        model,
        case: chosen,
        runs,
        onRun: async (run) => {
            mkdirSync(folder, { recursive: true });
            writeFileSync(join(folder, `run-${String(run.run).padStart(2, "0")}.json`), `${JSON.stringify(run, null, 2)}\n`);
            console.log(`run ${run.run}: ${run.passed ? "pass" : `fail (${run.difference.length} differences, stop ${run.stop})`}`);
        },
    });
    console.log(`${chosen.name} on ${model}: ${result.passed}/${result.runs} passed. Runs in ${folder}`);
    if (result.closeError) {
        console.error(`${result.closeError}\nThe VM may be left over: look with "tart list".`);
        process.exitCode = 1;
    }
    if (result.stopped) {
        console.error(`Stopped after ${result.runs} runs: ${result.stopped.reason}\nScreenshot: ${join(folder, "stopped.png")}\n${kept(result.stopped.vm)}`);
        process.exitCode = 1;
    }
} catch (error) {
    // Something unplanned: the series is over, and the VM is kept for a look.
    console.error(`The series failed: ${(error as Error).message}\n${kept(sandbox.name)}`);
    process.exitCode = 1;
} finally {
    // A no-op when runCase has closed it already.
    await sandbox.close({ keep: true }).catch((error: Error) => console.error(error.message));
}
process.exit();
