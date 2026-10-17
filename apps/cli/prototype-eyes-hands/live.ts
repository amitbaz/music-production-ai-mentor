// PROTOTYPE (#70), throwaway: runs the mentor's Ableton tools from a script, one connection per process.
// Usage: node --env-file=.env prototype-eyes-hands/live.ts '<json list of [tool, args]>'
// Ids like t1, d1 hold only within one run, so each run starts with read_set.
import { createAbleton } from "../../../packages/tools/src/daws/ableton/ableton.ts";

const tools = createAbleton({ address: process.env.ABLETON_ADDRESS, password: process.env.ABLETON_PASSWORD });
const byName = new Map(tools.map((tool) => [tool.name, tool]));
const steps = JSON.parse(process.argv[2] ?? "[]") as [string, Record<string, unknown>][];
for (const [name, args] of [["read_set", {}] as [string, Record<string, unknown>], ...steps]) {
    try {
        const result = await byName.get(name)?.run(args, { signal: new AbortController().signal } as never);
        console.log(`== ${name} ${JSON.stringify(args)}\n${typeof result === "string" ? result : JSON.stringify(result)}`);
    } catch (error) {
        console.log(`== ${name} ${JSON.stringify(args)}\nERROR ${(error as Error).message}`);
    }
}
process.exit(0);
