import type { Tool } from "@mentor/harness";
import { createClient } from "./client.ts";
import { readSet } from "./tools/reads/read-set.ts";

// The Ableton tool set. Its tools reach the Live Set open in Ableton Live through the
// Remote Script, at the address the app gives, and share one client.
export function createAbleton(options: { address?: string }): Tool[] {
    const client = createClient(options.address);
    return [readSet(client)];
}
