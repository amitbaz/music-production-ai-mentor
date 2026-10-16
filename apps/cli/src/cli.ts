// The mentor in the terminal:
//     pnpm start [--model provider:model]
import { parseArgs } from "node:util";
import { createMentor, keysFromEnv } from "@mentor/mentor";
import { runCli } from "./run.ts";

const { values } = parseArgs({ options: { model: { type: "string" } } });
const mentor = createMentor({
    keys: keysFromEnv(process.env),
    model: values.model,
    abletonAddress: process.env.ABLETON_ADDRESS,
    abletonPassword: process.env.ABLETON_PASSWORD,
    onRetry: ({ error, retry, maxRetries, waitMs }) =>
        console.error(
            `  (${error.message}, trying again in ${waitMs / 1000}s, retry ${retry} of ${maxRetries})`,
        ),
});

await runCli({
    mentor,
    input: process.stdin,
    output: process.stdout,
    errors: process.stderr,
    color: process.stdout.hasColors?.() ?? false,
    width: () => process.stdout.columns,
});

// The connection to Live, once opened, would keep the process running.
process.exit();
