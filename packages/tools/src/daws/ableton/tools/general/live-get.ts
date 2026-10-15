import type { Tool } from "@mentor/harness";
import { reportingGone } from "../../changing.ts";
import { type Client, getProp } from "../../client.ts";
import { RESULT_LIMIT } from "../../reading.ts";

// The script's namespace for each kind of object id.
const NAMESPACES: Record<string, string> = { t: "track", d: "device", c: "clip", ch: "chain" };

// The kind of the Live objects a property holds, by its name, so they are given as object ids.
export const KIND_OF_PROPERTY: Record<string, string> = {
    tracks: "t",
    return_tracks: "t",
    visible_tracks: "t",
    master_track: "t",
    group_track: "t",
    devices: "d",
    chains: "ch",
    arrangement_clips: "c",
};

// One of Live's own names for a property or function.
export const LIVE_NAME = /^[a-z_][a-z0-9_]*$/;

export const objectParam = {
    type: "string",
    description: 'The song itself as "song", or the object id of a track, device, clip or rack chain, such as t3, d4, c2 or ch1.',
};

// The namespace and script id of the object a general tool is given.
export function liveObject(client: Client, object: unknown) {
    if (object === "song") return { ns: "song", nsid: undefined };
    const kind = typeof object === "string" ? /^(t|d|c|ch)\d+$/.exec(object)?.[1] : undefined;
    if (!kind) throw new Error('object must be "song" or the object id of a track, device, clip or rack chain, such as t3, d4, c2 or ch1');
    return { ns: NAMESPACES[kind] as string, nsid: client.scriptId(object as string) };
}

// Live's answer with every Live object in it given as an object id of `kind`, or without its id
// when its kind is not known, so the script's own ids never reach the model.
export function withObjectIds(client: Client, value: unknown, kind?: string): unknown {
    if (Array.isArray(value)) return value.map((item) => withObjectIds(client, item, kind));
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(
        Object.entries(value).flatMap(([key, item]): [string, unknown][] => {
            if (key !== "id" || typeof item !== "string") return [[key, withObjectIds(client, item)]];
            return kind ? [[key, client.objectId(kind, item)]] : [];
        }),
    );
}

// A general tool's answer, kept under the result limit by the tool itself: past it, the answer gives
// how many items the value holds instead of the value, and how to read less.
export function withinLimit(answer: Record<string, unknown>, value: unknown) {
    const whole = JSON.stringify(answer);
    if (whole.length <= RESULT_LIMIT) return whole;
    const { object, property, function: name } = answer;
    return JSON.stringify({
        object,
        property,
        function: name,
        ...(Array.isArray(value) && { count: value.length }),
        note: `The answer is ${whole.length} characters, past the result limit of ${RESULT_LIMIT}. Read with read_set, read_tracks, read_arrangement or read_clip, or ask for a narrower property.`,
    });
}

// Reads any property Live offers to scripts, by Live's own name. It only reads, so it never asks.
export function liveGet(client: Client): Tool {
    return {
        name: "live_get",
        description:
            'Reads any property Live offers to scripts, for what the read tools do not give, by Live\'s own name as in the Live Object Model, such as {object: "song", property: "groove_amount"} or {object: "t3", property: "current_monitoring_state"}. The property available_properties lists the properties of an object, and available_functions its functions. Live objects in the answer are given as object ids when they are tracks, devices, clips or rack chains. It cannot change anything; live_change does.',
        params: {
            type: "object",
            properties: {
                object: objectParam,
                property: { type: "string", description: "Live's name of the property, such as tempo or arm." },
            },
            required: ["object", "property"],
        },
        run: (args) => read(client, args),
    };
}

async function read(client: Client, args: Record<string, unknown>) {
    const { object, property } = args;
    const { ns, nsid } = liveObject(client, object);
    if (typeof property !== "string" || !LIVE_NAME.test(property)) throw new Error("property must be one of Live's names, such as tempo or arm");
    const [value] = await reportingGone(String(object), () => client.send([getProp(ns, property, nsid)]));
    const shown = withObjectIds(client, value, KIND_OF_PROPERTY[property]);
    return withinLimit({ object, property, value: shown }, shown);
}
