import { spawn } from "node:child_process";
import type { Sandbox } from "./run.ts";
import { REOPEN } from "./sandbox.ts";

// PROTOTYPE (mentor-kb #43): no VM. The Live to run against is already open on this machine, with the
// Remote Script installed and ABLETON_PASSWORD its password; reopen and screenshot run here, close is nothing.
// Throwaway: the real host sandbox is a client work item named by the spec.
const REMOTE_SCRIPT_PORT = 39031;

function run(command: string, args: string[], input?: string): Promise<{ code: number; stderr: string }> {
    return new Promise((resolve) => {
        const child = spawn(command, args, { stdio: ["pipe", "inherit", "pipe"] });
        let stderr = "";
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        child.on("error", (error) => resolve({ code: 127, stderr: error.message }));
        child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
        child.stdin.end(input);
    });
}

export async function startHostSandbox(_options: { signal?: AbortSignal } = {}): Promise<Sandbox & { address: string; password: string }> {
    const password = process.env.ABLETON_PASSWORD;
    if (!password) throw new Error("EVAL_SANDBOX=host needs ABLETON_PASSWORD: the password of the Remote Script in this machine's Live.");
    return {
        name: "host",
        address: `ws://127.0.0.1:${REMOTE_SCRIPT_PORT}`,
        password,
        reopenBase: async () => {
            const result = await run("bash", ["-s"], REOPEN);
            if (result.code !== 0) throw new Error(result.stderr.trim() || `the reopen script failed (exit ${result.code})`);
        },
        screenshot: async (file) => {
            const shot = await run("screencapture", ["-x", file]);
            if (shot.code !== 0) throw new Error(shot.stderr.trim() || "screencapture failed");
        },
        close: async () => {},
    };
}
