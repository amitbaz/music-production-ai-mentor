import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectAbleton, disconnectAbleton } from "./ableton-commands.ts";

// Where Live loads Remote Scripts from on macOS, below the home folder.
const REMOTE_SCRIPTS = join("Music", "Ableton", "User Library", "Remote Scripts");

// A temporary home folder and .env for each test, so no test touches the real ones.
async function setUp(t: TestContext, platform: NodeJS.Platform = "darwin") {
    const home = await mkdtemp(join(tmpdir(), "mentor-home-"));
    t.after(() => rm(home, { recursive: true, force: true }));
    const envFile = join(home, ".env");
    return {
        home,
        envFile,
        installed: join(home, REMOTE_SCRIPTS, "MusicMentor"),
        // Runs a command and gives back what it printed.
        async run(command: typeof connectAbleton) {
            let said = "";
            await command({ platform, home, envFile, output: { write: (text) => (said += text) } });
            return said;
        },
    };
}

test("connect ableton installs the Remote Script as MusicMentor and says what to choose in Live", async (t) => {
    const { run, installed } = await setUp(t);

    const said = await run(connectAbleton);

    assert.match(await readFile(join(installed, "version.py"), "utf8"), /version = "5\.0\.4"/);
    assert.match(await readFile(join(installed, "LICENSE"), "utf8"), /^MIT License/);
    assert.ok(existsSync(join(installed, "Namespaces", "Song.py")));
    assert.match(said, /choose MusicMentor as a Control Surface/);
});

test("connect ableton puts the same new password in the script and the app's .env, and never prints it", async (t) => {
    const { run, installed, envFile } = await setUp(t);
    await writeFile(envFile, "GEMINI_API_KEY=not-a-real-key\nABLETON_ADDRESS=ws://127.0.0.1:39031\n");

    const said = await run(connectAbleton);

    const env = await readFile(envFile, "utf8");
    const password = env.match(/^ABLETON_PASSWORD=(.+)$/m)?.[1] ?? "";
    assert.ok(password.length >= 32, "a long random password");
    assert.match(env, /^GEMINI_API_KEY=not-a-real-key$/m);
    assert.match(env, /^ABLETON_ADDRESS=ws:\/\/127\.0\.0\.1:39031$/m);
    assert.match(await readFile(join(installed, "Config.py"), "utf8"), new RegExp(`^PASSWORD = "${password}"$`, "m"));
    assert.ok(!said.includes(password), "the password is not printed");
});

test("connect ableton again replaces the installed folder and the password", async (t) => {
    const { run, installed, envFile } = await setUp(t);
    await run(connectAbleton);
    const first = await readFile(envFile, "utf8");
    // Left over from an earlier version of the script.
    await writeFile(join(installed, "Old.py"), "");

    await run(connectAbleton);

    const env = await readFile(envFile, "utf8");
    const passwords = [...env.matchAll(/^ABLETON_PASSWORD=(.+)$/gm)].map((match) => match[1]);
    assert.equal(passwords.length, 1);
    assert.notEqual(env, first);
    assert.match(await readFile(join(installed, "Config.py"), "utf8"), new RegExp(`^PASSWORD = "${passwords[0]}"$`, "m"));
    assert.ok(!existsSync(join(installed, "Old.py")));
});

test("disconnect ableton removes the MusicMentor folder and the password, and says what to do in Live", async (t) => {
    const { run, installed, envFile } = await setUp(t);
    await writeFile(envFile, "GEMINI_API_KEY=not-a-real-key\n");
    await run(connectAbleton);

    const said = await run(disconnectAbleton);

    assert.ok(!existsSync(installed));
    assert.equal(await readFile(envFile, "utf8"), "GEMINI_API_KEY=not-a-real-key\n");
    assert.match(said, /set that Control Surface to None/);
});

test("disconnect ableton leaves another app's AbletonJS folder alone", async (t) => {
    const { run, home } = await setUp(t);
    const theirs = join(home, REMOTE_SCRIPTS, "AbletonJS");
    await mkdir(theirs, { recursive: true });
    await writeFile(join(theirs, "Config.py"), "PASSWORD = None\n");
    await run(connectAbleton);

    await run(disconnectAbleton);

    assert.equal(await readFile(join(theirs, "Config.py"), "utf8"), "PASSWORD = None\n");
});

test("disconnect ableton with nothing installed says so and changes nothing", async (t) => {
    const { run, home, envFile } = await setUp(t);
    // Written by hand, without a last newline.
    await writeFile(envFile, "GEMINI_API_KEY=not-a-real-key");

    const said = await run(disconnectAbleton);

    assert.match(said, /not connected/);
    assert.equal(await readFile(envFile, "utf8"), "GEMINI_API_KEY=not-a-real-key");
    assert.ok(!existsSync(join(home, "Music")));
});

test("on Windows, both commands say the platform is not supported yet and change nothing", async (t) => {
    const { run, home, envFile } = await setUp(t, "win32");
    await writeFile(envFile, "ABLETON_PASSWORD=from-before\n");

    for (const command of [connectAbleton, disconnectAbleton]) {
        assert.match(await run(command), /not supported on this platform yet/);
    }

    assert.equal(await readFile(envFile, "utf8"), "ABLETON_PASSWORD=from-before\n");
    assert.ok(!existsSync(join(home, "Music")));
});
