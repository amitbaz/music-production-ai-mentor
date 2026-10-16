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
import { runCase, type Sandbox } from "./run.ts";

const { positionals, values } = parseArgs({ allowPositionals: true, options: { runs: { type: "string", default: "30" }, model: { type: "string" } } });
const chosen = cases.find((c) => c.name === positionals[0]);
if (!chosen) {
    if (positionals[0]) console.error(`No case ${positionals[0]}.`);
    for (const c of cases) console.log(`${c.name.padEnd(20)} ${c.plant.name}: "${c.message}"`);
    process.exit(positionals[0] ? 1 : 0);
}
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs must be a whole number above 0, got ${values.runs}`);

// The sandbox and where its Live answers: the tunnel's address and the pairing password.
// ponytail: the real sandbox (Tart, ADR 0025) lands in #110; until then a series has nowhere to run
// but the maintainer's own Live, and it must not.
async function startSandbox(): Promise<Sandbox & { address: string; password: string }> {
    throw new Error("pnpm eval needs the sandbox (ADR 0025), which is not built yet (#110). It will not run on your own Live.");
}

let sandbox: Awaited<ReturnType<typeof startSandbox>>;
try {
    sandbox = await startSandbox();
} catch (error) {
    console.error((error as Error).message);
    process.exit(1);
}

const keys = keysFromEnv(process.env);
const model = values.model ?? MODEL_ID;
const folder = join(homedir(), ".mentor", "evals", "runs", `${new Date().toISOString().replace(/[:.]/g, "-")}-${chosen.name}`);
const ableton = { abletonAddress: sandbox.address, abletonPassword: sandbox.password };
const result = await runCase({
    connect: () => ({
        tools: createAbleton({ address: sandbox.address, password: sandbox.password }),
        mentor: createMentor({ keys, model: values.model, ...ableton }),
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
if (result.stopped) {
    console.error(`Stopped after ${result.runs} runs: ${result.stopped.reason}\nScreenshot: ${join(folder, "stopped.png")}\nThe VM ${result.stopped.vm} is kept: open it with "tart run ${result.stopped.vm}", delete it with "tart delete ${result.stopped.vm}".`);
    process.exitCode = 1;
}
process.exit();
