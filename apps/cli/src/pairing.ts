import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { installRemoteScript, REMOTE_SCRIPT_NAME, removeRemoteScript, remoteScriptsFolder } from "@mentor/mentor";
import type { Output } from "./render.ts";

export type CommandOptions = {
    platform: NodeJS.Platform;
    home: string;
    // The app's .env, where the password for Live is kept
    envFile: string;
    output: Output;
};

// pnpm pair ableton: installs the Remote Script and says what the user must choose in Live.
export async function pairAbleton({ platform, home, envFile, output }: CommandOptions) {
    const remoteScripts = remoteScriptsFolder(platform, home);
    if (!remoteScripts) {
        output.write(NOT_SUPPORTED);
        return;
    }
    const { folder, password } = await installRemoteScript(remoteScripts);
    await setEnv(envFile, PASSWORD_LINE, password);
    output.write(
        `Paired with Ableton Live: installed the ${REMOTE_SCRIPT_NAME} Remote Script in\n  ${folder}\n` +
            `Next: restart Live, then in Settings → Link, Tempo & MIDI choose ${REMOTE_SCRIPT_NAME} as a Control Surface.\n`,
    );
}

// pnpm unpair ableton: removes what pairing installed and wrote, and says what to undo in Live.
export async function unpairAbleton({ platform, home, envFile, output }: CommandOptions) {
    const remoteScripts = remoteScriptsFolder(platform, home);
    if (!remoteScripts) {
        output.write(NOT_SUPPORTED);
        return;
    }
    const { folder, removed } = await removeRemoteScript(remoteScripts);
    await setEnv(envFile, PASSWORD_LINE, undefined);
    if (!removed) {
        output.write(`Ableton Live is not paired: there is no ${REMOTE_SCRIPT_NAME} folder in\n  ${remoteScripts}\n`);
        return;
    }
    output.write(
        `Unpaired from Ableton Live: removed the ${REMOTE_SCRIPT_NAME} Remote Script from\n  ${folder}\n` +
            "Next: in Live's Settings → Link, Tempo & MIDI, set that Control Surface to None, then restart Live.\n",
    );
}

const NOT_SUPPORTED = "Pairing Ableton Live is not supported on this platform yet, only on macOS. Nothing was changed.\n";

// The .env line the client reads the password for Live from.
const PASSWORD_LINE = "ABLETON_PASSWORD";

// Sets one line of a .env file, or removes it when the value is undefined, keeping the other lines.
async function setEnv(envFile: string, name: string, value: string | undefined) {
    const lines = existsSync(envFile) ? (await readFile(envFile, "utf8")).split("\n") : [];
    // Also matches `export NAME=` and spaces around `=`, which Node's .env reader accepts.
    const kept = lines.filter((line) => !new RegExp(`^\\s*(export\\s+)?${name}\\s*=`).test(line));
    if (value === undefined && kept.length === lines.length) return;
    if (kept.at(-1) === "") kept.pop();
    if (value !== undefined) kept.push(`${name}=${value}`);
    await writeFile(envFile, kept.length ? `${kept.join("\n")}\n` : "");
}
