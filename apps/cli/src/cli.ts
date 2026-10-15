import { createMentor } from "@mentor/mentor";
import { runCli } from "./run.ts";

const mentor = createMentor({
    keys: { gemini: process.env.GEMINI_API_KEY },
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
