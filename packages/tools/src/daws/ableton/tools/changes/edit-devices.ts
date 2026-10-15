import type { Tool } from "@mentor/harness";
import { type Client, type Command, getProp, setProp } from "../../client.ts";
import type { LiveDevice, LiveDeviceParameter } from "../../live.ts";

type Edit = Record<string, unknown>;
type Order = { id: string; name: string }[];
type Target = { id: string; ns: "track" | "chain"; scriptId: string };

// Builds an effect chain: adds a native device to a track or rack chain at a place, moves a device,
// and switches one on or off. It has no way to delete a device.
export function editDevices(client: Client): Tool {
    return {
        name: "edit_devices",
        description:
            "Builds and reorders effect chains. Takes a list of edits, applied in order; each is reported, and one that fails does not stop the rest. Object ids come from read_set or read_tracks. An edit is one of: {action: \"add\", name, to, position?} adds a native device by the name Live shows, such as \"EQ Eight\" or \"Compressor\", to the track or rack chain `to`; its result gives the new device's object id. {action: \"move\", device, to, position} moves a device to `position` in the chain of the track or rack chain `to`, which can be the chain it is in. {action: \"switch\", device, on} switches a device on (true) or off (false), and reports before and after. Positions count from 1 in the devices of the chain; an add without a position goes at the end. Each result for add and move gives the chain's devices in their new order. Only native devices can be added: a third-party plug-in cannot. A device cannot be deleted with this tool.",
        params: {
            type: "object",
            properties: {
                edits: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            action: { type: "string", enum: ["add", "move", "switch"] },
                            name: { type: "string", description: "add: the native device to add, as Live shows its name." },
                            device: { type: "string", description: "move, switch: object id of the device, such as d4." },
                            to: { type: "string", description: "add, move: object id of the track or rack chain whose devices it goes into, such as t1 or ch2." },
                            position: { type: "number", description: "add, move: where it goes among the devices of the chain, from 1. add: the end if left out." },
                            on: { type: "boolean", description: "switch: true to switch the device on, false to switch it off." },
                        },
                        required: ["action"],
                    },
                    description: "The edits, applied in order.",
                },
            },
            required: ["edits"],
        },
        run: (args) => run(client, args),
    };
}

async function run(client: Client, args: Record<string, unknown>) {
    const { edits } = args;
    if (!Array.isArray(edits) || edits.length === 0 || edits.some((edit) => typeof edit !== "object" || edit === null || Array.isArray(edit))) {
        throw new Error('edits must be a list of one or more edits, such as [{"action": "add", "name": "EQ Eight", "to": "t1"}]');
    }
    const results: Record<string, unknown>[] = [];
    for (const edit of edits as Edit[]) {
        try {
            results.push(await apply(client, edit));
        } catch (error) {
            results.push({ action: typeof edit.action === "string" ? edit.action : undefined, error: error instanceof Error ? error.message : String(error) });
        }
    }
    return JSON.stringify({ edits: results });
}

function apply(client: Client, edit: Edit) {
    if (edit.action === "add") return add(client, edit);
    if (edit.action === "move") return move(client, edit);
    if (edit.action === "switch") return switchDevice(client, edit);
    throw new Error(`${JSON.stringify(edit.action)} is not an action of edit_devices, which can add, move or switch devices but not delete them.`);
}

function deviceId(edit: Edit) {
    const { device } = edit;
    if (typeof device !== "string" || !/^d\d+$/.test(device)) throw new Error("device must be the object id of a device, such as d4");
    return device;
}

function target(client: Client, edit: Edit): Target {
    const { to } = edit;
    if (typeof to !== "string" || !/^(t|ch)\d+$/.test(to)) throw new Error("to must be the object id of a track or a rack chain, such as t1 or ch2");
    return { id: to, ns: to.startsWith("t") ? "track" : "chain", scriptId: client.scriptId(to) };
}

// A place among the devices of a chain, counted from 1, as read_tracks lists them; `last` is the highest.
function position(value: unknown, last: number, required: boolean) {
    if (value === undefined && !required) return undefined;
    if (value === undefined) throw new Error(`position is needed, from 1 to ${last}`);
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new Error("position must be a whole number from 1");
    if (value > last) throw new Error(`position must be from 1 to ${last}`);
    return value;
}

async function devicesOf(client: Client, { ns, scriptId }: Target) {
    const [devices] = (await client.send([getProp(ns, "devices", scriptId)])) as [LiveDevice[]];
    return devices;
}

const orderOf = (client: Client, devices: LiveDevice[]): Order => devices.map((device) => ({ id: client.objectId("d", device.id), name: device.name }));

async function add(client: Client, edit: Edit) {
    const { name } = edit;
    if (typeof name !== "string" || name.trim() === "") throw new Error('name must be the name of a native device, such as "EQ Eight"');
    const into = target(client, edit);
    const place = position(edit.position, (await devicesOf(client, into)).length + 1, false);

    // A track and a chain name the index differently; left out, Live adds at the end.
    const index = place === undefined ? {} : { [into.ns === "track" ? "target_index" : "device_index"]: place - 1 };
    const insert: Command = { ns: into.ns, nsid: into.scriptId, name: "insert_device", args: { device_name: name, ...index } };
    let added: LiveDevice;
    try {
        [added] = (await client.send([insert])) as [LiveDevice];
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message} (Live only adds native devices, by the name Live shows, such as "EQ Eight".)`);
    }

    const order = orderOf(client, await devicesOf(client, into));
    const id = client.objectId("d", added.id);
    return { action: "add", device: id, name: added.name, in: into.id, position: order.findIndex((device) => device.id === id) + 1, order };
}

async function move(client: Client, edit: Edit) {
    const device = deviceId(edit);
    const into = target(client, edit);
    const scriptId = client.scriptId(device);
    // A device moved within its own chain is already one of its devices, so the chain has no extra place for it.
    const devices = await devicesOf(client, into);
    const last = devices.length + (devices.some((candidate) => candidate.id === scriptId) ? 0 : 1);
    const place = position(edit.position, last, true) as number;

    await client.send([{ ns: "mentor", name: "move_device", args: { device_id: scriptId, target_id: into.scriptId, position: place - 1 } }]);

    const order = orderOf(client, await devicesOf(client, into));
    return { action: "move", device, in: into.id, position: order.findIndex((moved) => moved.id === device) + 1, order };
}

async function switchDevice(client: Client, edit: Edit) {
    const device = deviceId(edit);
    if (typeof edit.on !== "boolean") throw new Error("on must be true or false");
    const scriptId = client.scriptId(device);

    const [name, parameters] = (await client.send([getProp("device", "name", scriptId), getProp("device", "parameters", scriptId)])) as [string, LiveDeviceParameter[]];
    // Every device has its switch as a parameter of this name.
    const power = parameters.find((parameter) => parameter.name === "Device On");
    if (!power) throw new Error(`${name} has no Device On switch, so it cannot be switched`);

    const [before, , after] = await client.send([
        getProp("device-parameter", "value", power.id),
        setProp("device-parameter", "value", edit.on ? 1 : 0, power.id),
        getProp("device-parameter", "value", power.id),
    ]);
    const shown = (value: unknown) => (Number(value) === 0 ? "off" : "on");
    return { action: "switch", device, name, before: shown(before), after: shown(after) };
}
