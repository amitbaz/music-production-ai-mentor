// Runs a case against the real model on the base Set open in Live, and prints its rate (ADR 0020):
//     pnpm eval                                        lists the cases
//     pnpm eval <case> [--runs 10] [--model provider:model]
// Every run is kept in full under evals/runs/, which git ignores.
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createMentor, MODEL_ID } from "@mentor/mentor";
import { createAbleton } from "@mentor/tools/daws/ableton";
import { cases } from "../sets/patience/cases.ts";
import { runCase } from "./run.ts";

const { positionals, values } = parseArgs({ allowPositionals: true, options: { runs: { type: "string", default: "10" }, model: { type: "string" } } });
const chosen = cases.find((c) => c.name === positionals[0]);
if (!chosen) {
    if (positionals[0]) console.error(`No case ${positionals[0]}.`);
    for (const c of cases) console.log(`${c.name.padEnd(20)} ${c.plant.name}: "${c.message}"`);
    process.exit(positionals[0] ? 1 : 0);
}
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs must be a whole number above 0, got ${values.runs}`);

const ableton = { abletonAddress: process.env.ABLETON_ADDRESS, abletonPassword: process.env.ABLETON_PASSWORD };
const mentor = createMentor({ keys: { gemini: process.env.GEMINI_API_KEY }, model: values.model, ...ableton });
const model = values.model ?? MODEL_ID;
const folder = new URL(`../runs/${new Date().toISOString().replace(/[:.]/g, "-")}-${chosen.name}/`, import.meta.url);
const result = await runCase({
    tools: createAbleton({ address: ableton.abletonAddress, password: ableton.abletonPassword }),
    mentor,
    model,
    case: chosen,
    runs,
    onRun: async (run) => {
        mkdirSync(folder, { recursive: true });
        writeFileSync(new URL(`run-${String(run.run).padStart(2, "0")}.json`, folder), `${JSON.stringify(run, null, 2)}\n`);
        console.log(`run ${run.run}: ${run.passed ? "pass" : `fail (${run.difference.length} differences, stop ${run.stop})`}`);
    },
});
console.log(`${chosen.name} on ${model}: ${result.passed}/${result.runs} passed. Runs in ${folder.pathname}`);
if (result.left) {
    console.error(`Stopped: the Set still differs from its base. Reopen Patience without saving.\n${result.left.join("\n")}`);
    process.exitCode = 1;
}
process.exit();
