import { homedir } from "node:os";
import { join } from "node:path";
import { createMentor } from "@mentor/mentor";
import { connectAbleton, disconnectAbleton } from "./ableton-commands.ts";
import { runCli } from "./run.ts";

// `pnpm start connect ableton` and `pnpm start disconnect ableton`, a verb and then a DAW;
// with no command, a conversation.
const commands: Record<string, Record<string, typeof connectAbleton>> = {
    connect: { ableton: connectAbleton },
    disconnect: { ableton: disconnectAbleton },
};
const [verb, daw] = process.argv.slice(2);

if (verb !== undefined) {
    if (!Object.hasOwn(commands, verb)) {
        console.error(`Unknown command: ${verb}. Try connect ableton or disconnect ableton.`);
        process.exit(1);
    }
    if (daw === undefined || !Object.hasOwn(commands[verb], daw)) {
        console.error(`${daw === undefined ? "Which DAW?" : `${daw} is not a supported DAW.`} Try ${verb} ableton.`);
        process.exit(1);
    }
    await commands[verb][daw]({
        platform: process.platform,
        home: homedir(),
        envFile: join(import.meta.dirname, "..", ".env"),
        output: process.stdout,
    });
    process.exit();
}

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
