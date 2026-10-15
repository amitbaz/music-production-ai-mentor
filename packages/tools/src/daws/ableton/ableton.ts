import type { Tool } from "@mentor/harness";
import { createClient } from "./client.ts";
import {
    deleteTool,
    editDevices,
    editTracks,
    findInBrowser,
    liveChange,
    liveGet,
    readArrangement,
    readClip,
    readSet,
    readTracks,
    setParameters,
    show,
    transport,
} from "./tools/index.ts";

// The Ableton tool set. Its tools reach the Live Set open in Ableton Live through the
// Remote Script, at the address and with the password the app gives, and share one client.
export function createAbleton(options: { address?: string; password?: string }): Tool[] {
    const client = createClient(options.address, options.password);
    return [
        readSet(client),
        readTracks(client),
        readArrangement(client),
        readClip(client),
        setParameters(client),
        editTracks(client),
        transport(client),
        show(client),
        editDevices(client),
        findInBrowser(client),
        deleteTool(client),
        liveGet(client),
        liveChange(client),
    ];
}

export { installRemoteScript, REMOTE_SCRIPT_NAME, removeRemoteScript, remoteScriptsFolder } from "./remote-script.ts";
