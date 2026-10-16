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

// Runs in the VM before every run. Reopens Patience, answers Live's "Save changes?" with "Don't Save",
// and waits until Live's log says Patience loaded and the Remote Script listens again. The window title
// cannot tell: Live calls the demo Set "Untitled". Exits 1, saying why, if Patience does not come back.
const REOPEN = `set -u
app=${shellQuote(LIVE_APP)}
patience=${shellQuote(PATIENCE)}
log=$(echo "$HOME/Library/Preferences/Ableton/"Live*/Log.txt)
# Whether, after line $1 of the log, Live loaded Patience and the Remote Script listens again: after the
# "Loading document", Live logs both lines, in either order.
loaded_after() {
    local after
    after=$(tail -n +$(($1 + 1)) "$log" | sed -n '/Loading document .*Patience/,$p')
    case "$after" in *"End ExchangeDocument"*) case "$after" in *"listening on 127.0.0.1:${REMOTE_SCRIPT_PORT}"*) return 0 ;; esac ;; esac
    return 1
}
# Live opens Patience at login. Wait for that load first, so its lines are not taken for the reopen's.
# The log keeps every session; this boot's lines are those stamped after it.
boot=$(date -u -r "$(sysctl -n kern.boottime | sed 's/.*sec = \\([0-9]*\\).*/\\1/')" +%Y-%m-%dT%H:%M:%S)
for _ in $(seq 1 90); do
    first=$(awk -v boot="$boot" 'substr($0, 1, 19) >= boot { print NR - 1; exit }' "$log" 2>/dev/null)
    [ -n "$first" ] && loaded_after "$first" && break
    sleep 2
done
start=$(wc -l <"$log" | tr -d ' ')
open -a "$app" "$patience" || { echo "open failed" >&2; exit 1; }
# Live asks whether to save the Set it has open, even an unchanged one. Its dialog's buttons have no
# name; "Don’t Save" is the description.
for _ in $(seq 1 10); do
    osascript <<'AS' >/dev/null 2>&1 && break
tell application "System Events" to tell process "Live"
    click (first button of group 1 of window 1 whose description ends with "t Save")
end tell
AS
    sleep 1
done
for _ in $(seq 1 90); do
    loaded_after "$start" && exit 0
    sleep 2
done
echo "Live did not load Patience with the Remote Script listening within 3 minutes" >&2
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
    const got = await host.run(tart, ["get", image, "--format", "json"]);
    if (got.code !== 0) throw new Error(`The sandbox image ${image} does not exist. ${build}`);
    const { MACAddress: mac } = JSON.parse(got.stdout) as { MACAddress: string };
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
        // tart clone gives the copy a new MAC address, and Live's authorization is tied to it: with another
        // one, Live asks to be authorized again. Only one copy can run at a time with it.
        const keepMac = await guard(host.run(tart, ["set", name, "--mac", mac]));
        if (keepMac.code !== 0) throw new Error(`Could not give the copy ${name} the image's MAC address: ${keepMac.stderr.trim()}`);
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
