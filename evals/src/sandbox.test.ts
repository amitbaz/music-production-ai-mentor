import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type Host, type Process, startSandbox } from "./sandbox.ts";

type Call = { command: string; args: string[]; input?: string };
type Reply = { code?: number; stdout?: string; stderr?: string };

// A fake machine: records every command, answers the ones a test scripts (matched on the command line,
// first match wins; anything else succeeds), and starts "processes" that stay up until killed.
function fake({ arch = "arm64", replies = [], vmOutput = "", vmExits = false, hang }: { arch?: string; replies?: [RegExp, Reply][]; vmOutput?: string; vmExits?: boolean; hang?: RegExp } = {}) {
    const home = mkdtempSync(join(tmpdir(), "sandbox-home-"));
    mkdirSync(join(home, ".mentor", "sandbox"), { recursive: true });
    writeFileSync(join(home, ".mentor", "sandbox", "pairing-password"), "s3cret\n");
    writeFileSync(join(home, ".mentor", "sandbox", "id_ed25519"), "key");
    const calls: Call[] = [];
    const started: (Call & { killed: boolean })[] = [];
    const stops: (() => void)[] = [];
    const line = (call: Call) => [call.command, ...call.args].join(" ");
    const host: Host = {
        platform: "darwin",
        arch,
        env: {},
        home,
        run: async (command, args, options) => {
            const call = { command, args, input: options?.input };
            calls.push(call);
            // `tart stop` ends the `tart run` it stopped.
            if (args[0] === "stop") for (const stop of stops) stop();
            // The VM that never starts never gets an address.
            if (vmExits && args[0] === "ip") return new Promise(() => {});
            // A command that never answers, until the test aborts the start.
            if (hang?.test(line(call))) return new Promise(() => {});
            const reply = replies.find(([pattern]) => pattern.test(line(call)))?.[1] ?? (args[0] === "ip" ? { stdout: "192.168.64.7\n" } : {});
            return { code: reply.code ?? 0, stdout: reply.stdout ?? "", stderr: reply.stderr ?? "" };
        },
        start: (command, args) => {
            const entry = { command, args, killed: false };
            started.push(entry);
            const isVm = args[0] === "run";
            let exit: (code: number) => void = () => {};
            const exited = vmExits && isVm ? Promise.resolve(1) : new Promise<number>((resolve) => (exit = resolve));
            const process: Process = { exited, output: () => (isVm ? vmOutput : ""), kill: () => {
                    entry.killed = true;
                    exit(0);
                },
            };
            stops.push(() => exit(0));
            return process;
        },
        freePort: async () => 40123,
        sleep: async () => {},
    };
    const tart = (verb: string) => calls.filter((call) => call.command === "tart" && call.args[0] === verb);
    return { host, calls, started, tart, line };
}

const BUILD = "scripts/build-sandbox-image.sh";

test("a sandbox is a copy of the image, started with no graphics and no audio, reached through a tunnel", async () => {
    const { host, calls, started, line } = fake();

    const sandbox = await startSandbox({ host });

    const clone = calls.find((call) => call.command === "tart" && call.args[0] === "clone");
    assert.deepEqual(clone?.args.slice(0, 2), ["clone", "mentor-sandbox"]);
    assert.equal(clone?.args[2], sandbox.name);
    assert.match(sandbox.name, /^mentor-eval-/);
    const [vm, tunnel] = started as [(typeof started)[number], (typeof started)[number]];
    assert.deepEqual(vm.args, ["run", "--no-graphics", "--no-audio", sandbox.name]);
    // The tunnel goes from a free local port, never 39031, to the VM's Remote Script.
    assert.equal(tunnel.command, "ssh");
    assert.ok(tunnel.args.join(" ").includes("-L 40123:127.0.0.1:39031"), tunnel.args.join(" "));
    assert.equal(sandbox.address, "ws://127.0.0.1:40123");
    assert.equal(sandbox.password, "s3cret");
    // Everything in the VM is reached as admin with the image's key.
    assert.ok(calls.some((call) => call.command === "ssh" && line(call).includes("admin@")));
    assert.ok(started.every((entry) => entry.args.join(" ").includes(join(".mentor", "sandbox", "id_ed25519")) || entry.command === "tart"));
});

test("each sandbox gets a name of its own", async () => {
    const [a, b] = await Promise.all([startSandbox({ host: fake().host }), startSandbox({ host: fake().host })]);
    assert.notEqual(a.name, b.name);
});

test("the Tart binary is the TART variable, else tart", async () => {
    const plain = fake();
    await startSandbox({ host: plain.host });
    assert.equal(plain.tart("clone").length, 1);

    const custom = fake();
    custom.host.env = { TART: "/opt/tart/bin/tart" };
    await startSandbox({ host: custom.host });
    assert.ok(custom.calls.some((call) => call.command === "/opt/tart/bin/tart" && call.args[0] === "clone"));
    assert.equal(custom.started[0]?.command, "/opt/tart/bin/tart");
});

test("a Mac that is not Apple Silicon is told so, before anything is run", async () => {
    const { host, calls } = fake({ arch: "x64" });

    await assert.rejects(startSandbox({ host }), /Apple Silicon/);
    assert.equal(calls.length, 0);
});

test("without Tart the error says how to install it", async () => {
    const { host, calls } = fake({ replies: [[/--version/, { code: 127, stderr: "spawn tart ENOENT" }]] });

    await assert.rejects(startSandbox({ host }), /Tart is not installed.*brew install cirruslabs\/cli\/tart.*TART/s);
    assert.equal(calls.length, 1);
});

test("without the image the error names the command that builds it, and nothing is copied", async () => {
    const { host, tart } = fake({ replies: [[/tart get/, { code: 1, stderr: "VM not found" }]] });

    await assert.rejects(startSandbox({ host }), (error: Error) => error.message.includes("mentor-sandbox") && error.message.includes(BUILD));
    assert.equal(tart("clone").length, 0);
});

test("without the pairing password the error names the command that builds the image", async () => {
    const { host, tart } = fake();
    writeFileSync(join(host.home, ".mentor", "sandbox", "pairing-password"), "");
    await assert.rejects(startSandbox({ host }), (error: Error) => error.message.includes("pairing password") && error.message.includes(BUILD));
    assert.equal(tart("clone").length, 0);
});

test("when macOS will not run another VM the error says so, and the copy is deleted", async () => {
    const { host, tart } = fake({ vmExits: true, vmOutput: "Error: The number of VMs exceeds the system limit." });

    await assert.rejects(startSandbox({ host }), /at most two macOS VMs.*tart list/s);
    assert.equal(tart("delete").length, 1);
});

test("only Tart's message about the limit is taken for the limit; other output with the same words is shown as Tart said it", async () => {
    const { host } = fake({ vmExits: true, vmOutput: "Error: disk quota limit exceeds what the volume allows" });

    await assert.rejects(startSandbox({ host }), (error: Error) => error.message.includes("disk quota limit exceeds") && !/at most two/.test(error.message));
});

test("a copy that fails is deleted, in case it was left half made", async () => {
    const { host, tart } = fake({ replies: [[/tart clone/, { code: 1, stderr: "no space left" }]] });

    await assert.rejects(startSandbox({ host }), /Could not copy.*no space left/s);
    assert.equal(tart("delete").length, 1);
    assert.equal(tart("run").length, 0);
});

test("a start that fails after the copy deletes the copy", async () => {
    const { host, tart } = fake({ replies: [[/tart ip/, { stdout: "" }]] });

    await assert.rejects(startSandbox({ host }), /no IP address/);
    assert.equal(tart("stop").length, 1);
    assert.equal(tart("delete").length, 1);
});

test("Ctrl-C while the VM boots stops it and deletes the copy", async () => {
    const { host, tart } = fake({ hang: /tart ip/ });
    const controller = new AbortController();
    const starting = startSandbox({ host, signal: controller.signal });
    const outcome = assert.rejects(starting, /Interrupted/);
    await new Promise((resolve) => setTimeout(resolve, 10));

    controller.abort();
    await outcome;

    assert.equal(tart("stop").length, 1);
    assert.equal(tart("delete").length, 1);
});

test("Ctrl-C while the image is being copied deletes the partial copy", async () => {
    const { host, tart } = fake({ hang: /tart clone/ });
    const controller = new AbortController();
    const outcome = assert.rejects(startSandbox({ host, signal: controller.signal }), /Interrupted/);
    await new Promise((resolve) => setTimeout(resolve, 10));

    controller.abort();
    await outcome;

    assert.equal(tart("delete").length, 1);
    assert.equal(tart("run").length, 0);
});

test("a Ctrl-C that came before the start deletes nothing and starts nothing", async () => {
    const { host, tart } = fake();
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(startSandbox({ host, signal: controller.signal }), /Interrupted/);
    assert.equal(tart("run").length, 0);
});

test("a VM that dies for another reason shows what Tart said", async () => {
    const { host } = fake({ vmExits: true, vmOutput: "Error: out of disk space" });

    await assert.rejects(startSandbox({ host }), /out of disk space/);
});

test("reopenBase runs the fixed script in the VM over ssh", async () => {
    const { host, calls } = fake();
    const sandbox = await startSandbox({ host });
    const before = calls.length;

    await sandbox.reopenBase();

    const [call] = calls.slice(before);
    assert.equal(call?.command, "ssh");
    assert.deepEqual(call?.args.slice(-3), ["admin@192.168.64.7", "bash", "-s"]);
    const script = call?.input ?? "";
    assert.match(script, /open -a/);
    assert.match(script, /Patience/);
    assert.match(script, /osascript/);
    assert.match(script, /System Events/);
    assert.match(script, /t Save/);
    assert.match(script, /39031/);
    // The script is valid bash, so it cannot fail on its own syntax in the VM.
    assert.equal(spawnSync("bash", ["-n"], { input: script }).status, 0);
});

test("reopenBase throws, with what the script said, when Patience does not come back", async () => {
    const { host } = fake({ replies: [[/bash -s/, { code: 1, stderr: "Live did not open Patience within 3 minutes" }]] });
    const sandbox = await startSandbox({ host });

    await assert.rejects(sandbox.reopenBase(), /Live did not open Patience within 3 minutes/);
});

test("screenshot takes the picture in the VM and copies it back", async () => {
    const { host, calls, line } = fake();
    const sandbox = await startSandbox({ host });
    const before = calls.length;

    await sandbox.screenshot("/tmp/series/stopped.png");

    const [capture, copy] = calls.slice(before) as [Call, Call];
    assert.equal(capture.command, "ssh");
    assert.match(line(capture), /screencapture/);
    assert.equal(copy.command, "scp");
    assert.equal(copy.args.at(-1), "/tmp/series/stopped.png");
    assert.match(copy.args.at(-2) ?? "", /^admin@.*:\/private\/tmp\/.*\.png$/);
});

test("screenshot throws when the picture could not be taken", async () => {
    const { host } = fake({ replies: [[/screencapture/, { code: 1, stderr: "could not create image" }]] });
    const sandbox = await startSandbox({ host });

    await assert.rejects(sandbox.screenshot("/tmp/x.png"), /could not create image/);
});

test("close stops the VM and the tunnel, and deletes the copy", async () => {
    const { host, started, tart } = fake();
    const sandbox = await startSandbox({ host });

    await sandbox.close();

    assert.equal(tart("stop")[0]?.args.at(-1), sandbox.name);
    assert.equal(tart("delete")[0]?.args.at(-1), sandbox.name);
    assert.ok(started.some((entry) => entry.args[0] !== "run" && entry.killed), "the tunnel is killed");
});

test("close with keep stops the VM and leaves the copy", async () => {
    const { host, tart } = fake();
    const sandbox = await startSandbox({ host });

    await sandbox.close({ keep: true });

    assert.equal(tart("stop").length, 1);
    assert.equal(tart("delete").length, 0);
});

test("closing twice stops and deletes once", async () => {
    const { host, tart } = fake();
    const sandbox = await startSandbox({ host });

    await sandbox.close({ keep: true });
    await sandbox.close();

    assert.equal(tart("stop").length, 1);
    assert.equal(tart("delete").length, 0);
});

test("a copy that cannot be deleted says how to delete it", async () => {
    const { host } = fake({ replies: [[/tart delete/, { code: 1, stderr: "busy" }]] });
    const sandbox = await startSandbox({ host });

    await assert.rejects(sandbox.close(), (error: Error) => error.message.includes(`tart delete ${sandbox.name}`));
});

// The reopen script, run on this machine against stand-ins for open, osascript, nc, pgrep and sleep, with
// a clock that only `sleep` moves. It checks the script's logic; whether Live behaves as the stand-ins say
// is what a real VM has to show.
async function reopen(env: Record<string, string>) {
    const { host, calls } = fake();
    const sandbox = await startSandbox({ host });
    const before = calls.length;
    await sandbox.reopenBase();
    const script = calls[before]?.input ?? "";

    const sim = mkdtempSync(join(tmpdir(), "reopen-sim-"));
    writeFileSync(join(sim, "clock"), "0");
    const bin = join(sim, "bin");
    mkdirSync(bin);
    const stub = (name: string, body: string) => {
        writeFileSync(join(bin, name), `#!/bin/bash\nSIM=${sim}\nnow() { cat "$SIM/clock"; }\nbusy() { [ -f "$SIM/clicked" ] && [ "$(now)" -lt $(( $(cat "$SIM/clicked") + \${BUSY:-4} )) ]; }\n${body}\n`);
        chmodSync(join(bin, name), 0o755);
    };
    stub("sleep", 'echo $(( $(now) + $1 )) > "$SIM/clock"');
    stub("open", 'now > "$SIM/opened"');
    stub("pgrep", '[ "$RUNNING" != 0 ]');
    stub("nc", "busy && exit 1; exit 0");
    stub(
        "osascript",
        `if [ "$1" = -e ]; then
    case "$*" in
        *"Save Live Set"*) [ -n "\${PROBE:-}" ] && { echo "$PROBE"; exit 0; }; exit 1 ;;
        *"name of window"*) busy && exit 1; echo "Chuck Sutton - Patience (Live 12 Suite Demo)"; exit 0 ;;
    esac
    exit 1
fi
cat >/dev/null
if [ -n "\${SHEET_AT:-}" ] && [ ! -f "$SIM/clicked" ] && [ "$(now)" -ge $(( $(cat "$SIM/opened") + SHEET_AT )) ]; then now > "$SIM/clicked"; exit 0; fi
exit 1`,
    );
    const result = spawnSync("bash", ["-s"], { input: script, env: { ...process.env, ...env, PATH: `${bin}:${process.env.PATH}` }, encoding: "utf8" });
    const read = (file: string) => {
        try {
            return Number(readFileSync(join(sim, file), "utf8"));
        } catch {
            return undefined;
        }
    };
    return { code: result.status, stderr: result.stderr, clicked: read("clicked"), end: read("clock") as number };
}

test("a Live that was not running reads Patience from disk, so there is nothing to answer", async () => {
    const run = await reopen({ RUNNING: "0" });
    assert.equal(run.code, 0, run.stderr);
    assert.equal(run.clicked, undefined);
});

test("a Set Live says is unchanged is ready as soon as Patience shows", async () => {
    const run = await reopen({ PROBE: "false" });
    assert.equal(run.code, 0, run.stderr);
    assert.equal(run.end < 5, true);
});

test("an unsaved Set is not ready before the Save changes sheet has been answered and Live has reloaded", async () => {
    const run = await reopen({ PROBE: "true", SHEET_AT: "9", BUSY: "4" });
    assert.equal(run.code, 0, run.stderr);
    assert.ok(run.clicked !== undefined && run.clicked >= 9, "the sheet was answered");
    assert.ok(run.end > (run.clicked ?? 0), "it waited after the answer");
});

test("after the answer it waits for the reload even when Live shows nothing while it loads", async () => {
    const run = await reopen({ PROBE: "true", SHEET_AT: "2", BUSY: "0" });
    assert.equal(run.code, 0, run.stderr);
    assert.ok(run.end - (run.clicked ?? 0) >= 20, `ready ${run.end - (run.clicked ?? 0)}s after the answer`);
});

test("an unsaved Set that never asks and never reloads fails, saying Live may still show the old Set", async () => {
    const run = await reopen({ PROBE: "true" });
    assert.equal(run.code, 1);
    assert.match(run.stderr, /unsaved/);
});
