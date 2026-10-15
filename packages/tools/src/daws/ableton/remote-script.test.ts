import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installRemoteScript } from "./remote-script.ts";

test("the installed script has our own file, registered by one line of the script's table of handlers", async (t) => {
    const remoteScripts = await mkdtemp(join(tmpdir(), "remote-scripts-"));
    t.after(() => rm(remoteScripts, { recursive: true, force: true }));

    const { folder } = await installRemoteScript(remoteScripts);

    assert.equal(existsSync(join(folder, "Mentor.py")), true);
    const lines = (await readFile(join(folder, "AbletonJS.py"), "utf8")).split("\n").filter((line) => line.includes("Mentor"));
    assert.equal(lines.length, 1);
    assert.match(lines[0] as string, /^\s+"mentor": /);
});
