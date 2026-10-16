import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// The real entry point, run with a model id the provider lookup cannot use, so the first turn fails before any network.
test("--model is passed to the provider lookup", () => {
    const run = spawnSync(process.execPath, ["src/cli.ts", "--model", "nope:some-model"], {
        cwd: new URL("..", import.meta.url),
        input: "hello\nexit\n",
        env: { PATH: process.env.PATH },
        encoding: "utf8",
        timeout: 10_000,
    });

    assert.match(run.stderr, /Unknown provider "nope" in model id "nope:some-model"/);
});
