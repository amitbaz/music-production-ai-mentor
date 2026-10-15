// Installing and removing the Remote Script the Ableton tools reach Live through (ADR 0012).
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

// The pinned ableton-js Remote Script, kept in the repo with its files unchanged but for our own
// Mentor.py and the one line of AbletonJS.py that registers it. What to try by hand in Live is in
// remote-scripts/checklist.md.
const SOURCE = join(import.meta.dirname, "..", "..", "..", "remote-scripts", "ableton-js");

// Our own folder name, so another app's AbletonJS folder is never touched. Live lists the script by it.
export const REMOTE_SCRIPT_NAME = "MusicMentor";

// The folder Live loads Remote Scripts from, or undefined on a platform not supported yet.
export function remoteScriptsFolder(platform: NodeJS.Platform, home: string): string | undefined {
    if (platform !== "darwin") return undefined;
    return join(home, "Music", "Ableton", "User Library", "Remote Scripts");
}

// Installs the script into the Remote Scripts folder with a new random password, replacing an
// earlier install. The caller keeps the password for the client and never shows it.
export async function installRemoteScript(remoteScripts: string) {
    const folder = join(remoteScripts, REMOTE_SCRIPT_NAME);
    await rm(folder, { recursive: true, force: true });
    await cp(SOURCE, folder, { recursive: true });

    // The script's own setting, off in the copy kept in the repo.
    const configFile = join(folder, "Config.py");
    const config = await readFile(configFile, "utf8");
    const unset = /^PASSWORD = None$/m;
    if (!unset.test(config)) throw new Error(`No password setting found in ${configFile}`);
    const password = randomBytes(32).toString("hex");
    await writeFile(configFile, config.replace(unset, `PASSWORD = "${password}"`));
    return { folder, password };
}

// Removes the installed script, and only ours. Says whether there was one to remove.
export async function removeRemoteScript(remoteScripts: string) {
    const folder = join(remoteScripts, REMOTE_SCRIPT_NAME);
    const removed = existsSync(folder);
    await rm(folder, { recursive: true, force: true });
    return { folder, removed };
}
