import type { Tool } from "@mentor/harness";
import { type Client, getProp, setProp } from "../../client.ts";
import { DEVICE_VIEW, findTracksOfDevices, goneMessage, isGone, revealDevice, revealTrack, showView } from "../../changing.ts";

// For each kind of object id: what it is, who Live asks its name, and the panel that shows it.
const KINDS = {
    t: { kind: "track", ns: "track" },
    d: { kind: "device", ns: "device", view: DEVICE_VIEW, panel: "device view" },
    c: { kind: "clip", ns: "clip", view: "Detail/Clip", panel: "clip view" },
} as const;

const EXAMPLE = "such as t1, d1 or c1, from read_set, read_tracks or read_arrangement";

// Selects a track, device or clip in Live, so the user is looking at what the mentor talks about.
export function show(client: Client): Tool {
    return {
        name: "show",
        description:
            "Selects a track, device or clip in Ableton Live by its object id, so the user is looking at what you are talking about. A device or a clip also opens the panel at the bottom of Live that shows it (the device view or the clip view), which changes what the user sees on screen. Use it when you point the user at something, for example to give the exact steps for what the tools cannot do. Changes nothing in the Live Set.",
        params: {
            type: "object",
            properties: {
                object: { type: "string", description: `Object id of a track, device or clip, ${EXAMPLE}.` },
            },
            required: ["object"],
        },
        run: (args) => run(client, args),
    };
}

async function run(client: Client, args: Record<string, unknown>) {
    const id = args.object;
    if (typeof id !== "string") throw new Error(`object is needed: the object id of a track, device or clip, ${EXAMPLE}`);
    const letter = id.match(/^([tdc])\d+$/)?.[1] as keyof typeof KINDS | undefined;
    if (!letter) throw new Error(`${id} is not a track, device or clip. Use an object id ${EXAMPLE}.`);
    const object = KINDS[letter];
    const scriptId = client.scriptId(id);

    // The name comes first, so that an object that is gone is found before anything is selected.
    let name: unknown;
    try {
        [name] = await client.send([getProp(object.ns, "name", scriptId)]);
    } catch (error) {
        throw isGone(error) ? new Error(goneMessage(id)) : error;
    }

    if (letter === "t") await revealTrack(client, scriptId);
    else if (letter === "d") await revealDevice(client, scriptId, (await findTracksOfDevices(client)).get(scriptId)?.id);
    else await client.send([setProp("song-view", "detail_clip", scriptId), showView(KINDS.c.view)]);

    return JSON.stringify({ shown: id, kind: object.kind, name, ...("panel" in object && { panel: object.panel }) });
}
