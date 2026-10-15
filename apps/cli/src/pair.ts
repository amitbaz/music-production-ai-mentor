import { homedir } from "node:os";
import { join } from "node:path";
import { pairAbleton, unpairAbleton } from "./pairing.ts";

// `pnpm pair <DAW>` and `pnpm unpair <DAW>`: the verb comes from the package script, the DAW from the user.
const commands: Record<string, Record<string, typeof pairAbleton>> = {
    pair: { ableton: pairAbleton },
    unpair: { ableton: unpairAbleton },
};
const [verb = "", daw] = process.argv.slice(2);
const daws = Object.hasOwn(commands, verb) ? commands[verb] : {};

if (daw === undefined || !Object.hasOwn(daws, daw)) {
    console.error(`${daw === undefined ? "Which DAW?" : `${daw} is not a supported DAW.`} Try pnpm ${verb} ableton.`);
    process.exit(1);
}

await daws[daw]({
    platform: process.platform,
    home: homedir(),
    envFile: join(import.meta.dirname, "..", ".env"),
    output: process.stdout,
});
