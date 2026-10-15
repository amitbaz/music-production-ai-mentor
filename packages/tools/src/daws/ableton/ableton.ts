import type { Tool } from "@mentor/harness";
import { createClient } from "./client.ts";
import { readSet } from "./tools/reads/read-set.ts";

// The Ableton tool set. Its tools reach the Live Set open in Ableton Live through the
// Remote Script, at the address and with the password the app gives, and share one client.
export function createAbleton(options: { address?: string; password?: string }): Tool[] {
    const client = createClient(options.address, options.password);
    return [readSet(client)];
}

export { installRemoteScript, REMOTE_SCRIPT_NAME, removeRemoteScript, remoteScriptsFolder } from "./remote-script.ts";
