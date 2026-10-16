import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Sandbox } from "./run.ts";

// The real sandbox (ADR 0025): a Tart copy of the sandbox image that scripts/build-sandbox-image.sh
// builds, started with no window and no sound, and reached over ssh. Tart, ssh, scp, osascript and
// screencapture are run as processes; the Host below is how, so a test can record the commands instead.

export type Process = { exited: Promise<number>; output: () => string; kill: () => void };
export type Host = {
    platform: string;
    arch: string;
    env: Record<string, string | undefined>;
    home: string;
    // Runs a command to its end. A command that cannot start gives code 127.
    run: (command: string, args: string[], options?: { input?: string }) => Promise<{ code: number; stdout: string; stderr: string }>;
    // Starts a command that stays up (the VM, the tunnel).
    start: (command: string, args: string[]) => Process;
    freePort: () => Promise<number>;
    sleep: (ms: number) => Promise<void>;
};

// These four are also in scripts/build-sandbox-image.sh (REMOTE_SCRIPT_PORT, GUEST_USER, LIVE_APP, PATIENCE): change them together.
const REMOTE_SCRIPT_PORT = 39031;
const USER = "admin";
const LIVE_APP = "/Applications/Ableton Live 12 Suite.app";
const PATIENCE = `${LIVE_APP}/Contents/App-Resources/Core Library/Lessons/Demo Songs/Chuck Sutton - Patience (Live 12 Suite Demo).als`;
const BUILD = "scripts/build-sandbox-image.sh <live-installer.dmg> <licence.auz>";
const SHOT = "/private/tmp/mentor-eval-screen.png";

// Runs in the VM before every run. Reopens Patience, answers Live's "Save changes?" with "Don't Save", and
// waits until Live shows Patience and the Remote Script's port answers. Exits 1, saying why, if not.
//
// Opening a Set that is already open does not prove that it was read again: if Live has unsaved changes and
// the script returned as soon as the title and the port looked right, the run would grade the old Set. So
// the script asks, before `open`, whether Live has unsaved changes (File > Save Live Set is enabled), and
// then waits for proof that the Set was read from disk:
//   - Live was not running: it starts on Patience, which is read from disk.
//   - the "Save changes?" sheet was answered, and then Live went busy (no window title, or the port down)
//     and came back, or 20 s passed since the answer. Don't Save makes Live load the file, so 20 s without a
//     visible gap is taken as a load too fast to see.
//   - Live says nothing is unsaved: the Set on screen is the file.
// Unsaved changes with no sheet and no gap fail. When the question gets no answer, the script waits 20 s for
// a sheet or a gap and then goes on, as an unsaved Set that never asks would have gone on before.
//
// Not checked without a real Live: that File > Save Live Set is enabled exactly when the Set has unsaved
// changes (if Live leaves it enabled on a clean Set, a clean Set with no sheet fails here), that the
// sheet's button is named as the script expects, and that a load shows as a gap. The script's logic is
// tested against stand-ins in sandbox.test.ts.
const REOPEN = `set -u
app=${shellQuote(LIVE_APP)}
patience=${shellQuote(PATIENCE)}
# Asks System Events something about Live, giving up after 3 s: a Live that is loading does not answer.
ui() { osascript -e 'with timeout of 3 seconds' -e 'tell application "System Events"' -e 'tell process "Live"' -e "$1" -e 'end tell' -e 'end tell' -e 'end timeout' 2>/dev/null; }
# Clicks "Don't Save" on the sheet if there is one; fails if not.
answer() {
    osascript >/dev/null 2>&1 <<'AS'
with timeout of 3 seconds
    tell application "System Events" to tell process "Live"
        try
            click (first button of sheet 1 of window 1 whose name ends with "t Save")
        on error
            click (first button of window 1 whose name ends with "t Save")
        end try
    end tell
end timeout
AS
}
dirty=no
if pgrep -x Live >/dev/null; then
    case $(ui 'get enabled of menu item "Save Live Set" of menu 1 of menu bar item "File" of menu bar 1' || echo unknown) in
        true) dirty=yes ;;
        false) dirty=no ;;
        *) dirty=unknown ;;
    esac
fi
open -a "$app" "$patience" || { echo "open failed" >&2; exit 1; }
answered=0
gap=0
at=0
title=
for i in $(seq 1 90); do
    if answer; then
        answered=1
        gap=0
        at=$i
    fi
    title=$(ui 'get name of window 1' || true)
    up=0
    nc -z 127.0.0.1 ${REMOTE_SCRIPT_PORT} && up=1
    shown=0
    case "$title" in *Patience*) shown=1 ;; esac
    if [ "$up" = 1 ] && [ "$shown" = 1 ]; then
        if [ "$answered" = 1 ]; then
            if [ "$gap" = 1 ] || [ $((i - at)) -ge 20 ]; then exit 0; fi
        elif [ "$gap" = 1 ] || { [ "$dirty" = no ] && [ "$i" -ge 3 ]; }; then
            exit 0
        elif [ "$dirty" = unknown ] && [ "$i" -ge 20 ]; then
            exit 0
        fi
    else
        gap=1
    fi
    sleep 1
done
if [ "$answered" = 0 ] && [ "$dirty" != no ]; then
    echo "Live has unsaved changes but never asked 'Save changes?' and never reloaded, so it may still show the old Set (window: \${title:-none})" >&2
else
    echo "Live did not show Patience with the Remote Script answering in time (window: \${title:-none})" >&2
fi
exit 1
`;

function shellQuote(text: string): string {
    return `'${text.replaceAll("'", `'\\''`)}'`;
}

const realHost: Host = {
    platform: process.platform,
    arch: process.arch,
    env: process.env,
    home: homedir(),
    run: (command, args, { input } = {}) =>
        new Promise((resolve) => {
            const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
            let stdout = "";
            let stderr = "";
            child.stdout.on("data", (chunk) => {
                stdout += chunk;
            });
            child.stderr.on("data", (chunk) => {
                stderr += chunk;
            });
            child.stdin.on("error", () => {});
            child.on("error", (error) => resolve({ code: 127, stdout, stderr: error.message }));
            child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
            child.stdin.end(input);
        }),
    start: (command, args) => {
        const child: ChildProcess = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
        let output = "";
        const keep = (chunk: Buffer) => {
            output = (output + chunk).slice(-2000);
        };
        child.stdout?.on("data", keep);
        child.stderr?.on("data", keep);
        const exited = new Promise<number>((resolve) => {
            child.on("error", (error) => {
                output += error.message;
                resolve(127);
            });
            child.on("close", (code) => resolve(code ?? 1));
        });
        return { exited, output: () => output, kill: () => void child.kill() };
    },
    freePort: () =>
        new Promise((resolve, reject) => {
            const server = createServer();
            server.on("error", reject);
            server.listen(0, "127.0.0.1", () => {
                const { port } = server.address() as { port: number };
                server.close(() => resolve(port));
            });
        }),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

// The text of Tart's own refusal when macOS will not run another VM.
const VM_LIMIT = /number of VMs exceeds the system limit/i;

// Copies the image under a new name, starts the copy, waits for ssh and opens the tunnel to its Live.
// Throws, saying what to do, when the Mac, Tart or the image is not ready or the VM will not start. When
// it throws, or `signal` aborts the start (Ctrl-C), the VM is stopped and the copy deleted, so nothing is left.
export async function startSandbox({ host = realHost, image = "mentor-sandbox", signal }: { host?: Host; image?: string; signal?: AbortSignal } = {}): Promise<Sandbox & { address: string; password: string }> {
    if (host.platform !== "darwin" || host.arch !== "arm64") throw new Error("pnpm eval needs a Mac with Apple Silicon: Tart runs macOS VMs only there.");
    const tart = host.env.TART || "tart";
    if ((await host.run(tart, ["--version"])).code !== 0) {
        throw new Error("Tart is not installed. Install it with `brew install cirruslabs/cli/tart`, or set TART to the path of the tart binary.");
    }
    const build = `Build the sandbox image once with ${BUILD} (see evals/README.md).`;
    if ((await host.run(tart, ["get", image])).code !== 0) throw new Error(`The sandbox image ${image} does not exist. ${build}`);
    const dir = join(host.home, ".mentor", "sandbox");
    const key = join(dir, "id_ed25519");
    let password = "";
    try {
        password = readFileSync(join(dir, "pairing-password"), "utf8").trim();
        readFileSync(key);
    } catch {}
    if (!password) throw new Error(`The pairing password or the ssh key is missing from ${dir}. ${build}`);
    if (signal?.aborted) throw new Error("Interrupted.");

    const name = `mentor-eval-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const sshOptions = ["-i", key, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR", "-o", "ConnectTimeout=5", "-o", "ServerAliveInterval=15"];
    let vm: Process | undefined;
    let tunnel: Process | undefined;
    let tunnelExited = false;
    let closed = false;
    const stop = async () => {
        tunnel?.kill();
        if (!vm) return;
        await host.run(tart, ["stop", name]);
        vm.kill();
        await Promise.race([vm.exited, host.sleep(30_000)]);
    };
    const remove = async () => {
        const deleted = await host.run(tart, ["delete", name]);
        if (deleted.code !== 0) throw new Error(`Could not delete the VM ${name}: ${deleted.stderr.trim()}. Delete it with "tart delete ${name}".`);
    };

    try {
        // Whichever comes first: what a step waits for, or the start being aborted or the VM stopping under it.
        let fail: (error: Error) => void = () => {};
        const failed = new Promise<never>((_, reject) => {
            fail = reject;
        });
        failed.catch(() => {});
        signal?.addEventListener("abort", () => fail(new Error("Interrupted.")), { once: true });
        const guard = <T>(promise: Promise<T>) => Promise.race([promise, failed]);

        // The copy is made inside the try: one that fails or is interrupted may be left half made, and is deleted below.
        const clone = await guard(host.run(tart, ["clone", image, name]));
        if (clone.code !== 0) throw new Error(`Could not copy the sandbox image ${image} (about 60 GB of free disk are needed): ${clone.stderr.trim()}`);
        const started = host.start(tart, ["run", "--no-graphics", "--no-audio", name]);
        vm = started;
        void started.exited.then((code) => fail(new Error(`The VM stopped (exit ${code}).`)));

        const ip = (await guard(host.run(tart, ["ip", name, "--wait", "180"]))).stdout.trim();
        if (!ip) throw new Error("The VM got no IP address.");
        const target = `${USER}@${ip}`;
        const ssh = (command: string[], options?: { input?: string }) => host.run("ssh", [...sshOptions, target, ...command], options);

        // Up, with auto-login done: open, osascript and System Events need the desktop session.
        let ready = false;
        for (let attempt = 0; attempt < 90 && !ready; attempt++) {
            ready = (await guard(ssh(['[ "$(stat -f %Su /dev/console)" = admin ]']))).code === 0;
            if (!ready) await guard(host.sleep(2000));
        }
        if (!ready) throw new Error("The VM did not take ssh within 3 minutes.");

        let port = await host.freePort();
        while (port === REMOTE_SCRIPT_PORT) port = await host.freePort();
        tunnel = host.start("ssh", ["-N", ...sshOptions, "-o", "ExitOnForwardFailure=yes", "-L", `${port}:127.0.0.1:${REMOTE_SCRIPT_PORT}`, target]);
        void tunnel.exited.then(() => {
            tunnelExited = true;
        });

        return {
            name,
            address: `ws://127.0.0.1:${port}`,
            password,
            reopenBase: async () => {
                const result = await ssh(["bash", "-s"], { input: REOPEN });
                if (result.code !== 0) throw new Error(result.stderr.trim() || `the reopen script failed (exit ${result.code})`);
                if (tunnelExited) throw new Error("The tunnel to the VM's Live is down.");
            },
            screenshot: async (file) => {
                const shot = await ssh(["screencapture", "-x", SHOT]);
                if (shot.code !== 0) throw new Error(shot.stderr.trim() || "screencapture failed");
                const copy = await host.run("scp", [...sshOptions, `${target}:${SHOT}`, file]);
                if (copy.code !== 0) throw new Error(copy.stderr.trim() || "could not copy the screenshot");
            },
            close: async ({ keep = false } = {}) => {
                if (closed) return;
                closed = true;
                await stop();
                if (!keep) await remove();
            },
        };
    } catch (error) {
        // Give the VM's exit a moment to register: then its output says why it stopped.
        await new Promise((resolve) => setImmediate(resolve));
        const output = vm?.output().trim() ?? "";
        await stop().catch(() => {});
        await remove().catch(() => {});
        if (!/^The VM stopped/.test((error as Error).message)) throw error;
        if (VM_LIMIT.test(output)) {
            throw new Error(`The VM would not start: macOS allows at most two macOS VMs running at once. Look with "tart list" and stop another with "tart stop <name>". Tart said: ${output}`);
        }
        throw new Error(`The VM stopped before it was ready. Tart said: ${output || "nothing"}`);
    }
}
