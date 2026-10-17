import type { Tool } from "@mentor/harness";
import { reportingGone } from "../../changing.ts";
import { type Client, getProp, setProp } from "../../client.ts";
import { KIND_OF_PROPERTY, LIVE_NAME, liveObject, objectParam, withinLimit, withObjectIds } from "./live-get.ts";

// The script's own functions, which it runs in place of Live's of the same name: none of them is Live's,
// nor are its serialize_ helpers, which a list of args could otherwise reach.
const SCRIPT_FUNCTIONS = new Set(["add_listener", "remove_listener", "get_prop", "set_prop", "dispatch", "get_ns", "get_obj", "save_obj", "format_result", "log_debug", "drop_connection"]);

const AUTOMATION_STEPS = "The mentor cannot reach automation yet, so give the user the steps instead.";

// The functions, and the one property, that take a Live object in their args or value. An object id
// there reaches the script or Live as it is, and is not found (#100), so each is refused with what to do instead.
const TAKES_A_LIVE_OBJECT: Record<string, string> = {
    delete_clip: "Use delete with the clip's object id.",
    duplicate_clip_to_arrangement: "Use edit_arrangement with duplicate.",
    automation_envelope: AUTOMATION_STEPS,
    create_automation_envelope: AUTOMATION_STEPS,
    clear_envelope: AUTOMATION_STEPS,
    export_to_clip_slot: "The mentor cannot reach clip slots, so give the user the steps instead.",
    move_device: "Use edit_devices with move.",
    find_device_position: "Use edit_devices with move, which finds the position itself.",
    appointed_device: "Use show with the device's object id.",
};

// Sets any property or calls any function Live offers to scripts, by Live's own name. It can do
// anything, removing included, so it always asks (ADR 0014).
export function liveChange(client: Client): Tool {
    return {
        name: "live_change",
        description:
            'Sets any property or calls any function Live offers to scripts, for what the other tools cannot do, by Live\'s own name as in the Live Object Model. The user is asked first, and can refuse. Give either property and value, such as {object: "song", property: "groove_amount", value: 0.5}, and get the value before and after; or function and its args, such as {object: "song", function: "tap_tempo"}, and get Live\'s answer. Use live_get with available_properties or available_functions to see what an object offers.',
        params: {
            type: "object",
            properties: {
                object: objectParam,
                property: { type: "string", description: "Live's name of the property to set." },
                value: { description: "The value to set the property to, as Live takes it." },
                function: { type: "string", description: "Live's name of the function to call." },
                args: {
                    description: "The function's arguments: a list in order, or an object by name. None when left out.",
                },
            },
            required: ["object"],
        },
        needsApproval: true,
        run: (args) => change(client, args),
    };
}

async function change(client: Client, args: Record<string, unknown>) {
    const { object, property, value, function: name } = args;
    const { ns, nsid } = liveObject(client, object);
    const setting = property !== undefined && value !== undefined && name === undefined;
    if (!setting && (name === undefined || property !== undefined || value !== undefined)) {
        throw new Error("Give either property with value, or function with its args, not both");
    }

    if (setting) {
        if (typeof property !== "string" || !LIVE_NAME.test(property)) throw new Error("property must be one of Live's names, such as tempo or mute");
        refuseTakingALiveObject(property);
        const [before, , after] = await reportingGone(String(object), () =>
            client.send([getProp(ns, property, nsid), setProp(ns, property, value, nsid), getProp(ns, property, nsid)]),
        );
        const kind = KIND_OF_PROPERTY[property];
        const shown = withObjectIds(client, after, kind);
        return withinLimit({ object, property, before: withObjectIds(client, before, kind), after: shown }, shown);
    }

    if (typeof name !== "string" || !LIVE_NAME.test(name)) throw new Error("function must be one of Live's names, such as tap_tempo");
    if (SCRIPT_FUNCTIONS.has(name) || name.startsWith("serialize_")) throw new Error(`${name} belongs to the script that reaches Live, not to Live. Use live_get to read and property with value to set.`);
    refuseTakingALiveObject(name);
    const callArgs = args.args ?? {};
    if (typeof callArgs !== "object" || callArgs === null) throw new Error("args must be a list or an object");
    const [result] = await reportingGone(String(object), () => client.send([{ ns, nsid, name, args: callArgs }]));
    const shown = withObjectIds(client, result);
    return withinLimit({ object, function: name, result: shown }, shown);
}

function refuseTakingALiveObject(name: string) {
    if (Object.hasOwn(TAKES_A_LIVE_OBJECT, name)) throw new Error(`${name} takes a Live object, which live_change cannot pass on. ${TAKES_A_LIVE_OBJECT[name]}`);
}
