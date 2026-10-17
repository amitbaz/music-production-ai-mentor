import type { Tool } from "@mentor/harness";
import { findTracksOfDevices, goneMessage, isGone } from "../../changing.ts";
import { type Client, type Command, getProp, setProp } from "../../client.ts";
import type { LiveBrowserItem, LiveDevice, LiveDeviceParameter, LiveTrack } from "../../live.ts";
import { ALL_ROOTS, SAMPLE_FILE } from "./find-in-browser.ts";

type Edit = Record<string, unknown>;
type Order = { id: string; name: string }[];
type Target = { id: string; ns: "track" | "chain"; scriptId: string };

// Builds an effect chain: adds a native device or loads a browser item to a track or rack chain at a
// place, moves a device, and switches one on or off. It has no way to delete a device.
export function editDevices(client: Client): Tool {
    return {
        name: "edit_devices",
        description:
            "Builds and reorders effect chains. Takes a list of edits, applied in order; each is reported, and one that fails does not stop the rest. Object ids come from read_set or read_tracks. An edit is one of: {action: \"add\", name, to, position?} adds a native device by the name Live shows, such as \"EQ Eight\" or \"Compressor\", to the track or rack chain `to`; its result gives the new device's object id. {action: \"load\", item, to, position?} loads a preset, kit, sample or third-party plug-in from Live's browser, by the path find_in_browser gives, such as \"audio_effects/Glue Compressor/Glue Punch.adv\": an effect goes into the track or rack chain `to` like add, though Live keeps an audio effect after a MIDI track's instrument, so the result gives where it went; an instrument, kit or sample goes onto the MIDI track `to`, with no position, in the instrument's place, and is refused where the track already has an instrument, which you delete first with delete; a plug-in is refused there too, since Live does not say before the load whether it is an instrument. {action: \"move\", device, to, position} moves a device to `position` in the chain of the track or rack chain `to`, which can be the chain it is in. {action: \"switch\", device, on} switches a device on (true) or off (false), and reports before and after. Positions count from 1 in the devices of the chain; an add without a position goes at the end. Each result for add, load and move gives the chain's devices in their new order. Only native devices can be added by name: a third-party plug-in is loaded with load instead. A device cannot be deleted with this tool.",
        params: {
            type: "object",
            properties: {
                edits: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            action: { type: "string", enum: ["add", "load", "move", "switch"] },
                            name: { type: "string", description: "add: the native device to add, as Live shows its name." },
                            item: { type: "string", description: "load: the browser path of what to load, as find_in_browser gives it." },
                            device: { type: "string", description: "move, switch: object id of the device, such as d4." },
                            to: { type: "string", description: "add, load, move: object id of the track or rack chain whose devices it goes into, such as t1 or ch2." },
                            position: { type: "number", description: "add, load, move: where it goes among the devices of the chain, from 1. add, load: the end if left out." },
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
            // Either object of the edit may be the one deleted meanwhile, so both are named.
            const ids = [edit.device, edit.to].filter((id) => typeof id === "string").join(" or ");
            const message = isGone(error) ? goneMessage(ids) : error instanceof Error ? error.message : String(error);
            results.push({ action: typeof edit.action === "string" ? edit.action : undefined, error: message });
        }
    }
    return JSON.stringify({ edits: results });
}

function apply(client: Client, edit: Edit) {
    if (edit.action === "add") return add(client, edit);
    if (edit.action === "load") return load(client, edit);
    if (edit.action === "move") return move(client, edit);
    if (edit.action === "switch") return switchDevice(client, edit);
    throw new Error(`${JSON.stringify(edit.action)} is not an action of edit_devices, which can add, load, move or switch devices but not delete them.`);
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

// What add and load answer: the new device, and the devices of the track or chain it is in.
async function placed(client: Client, into: Target, device: LiveDevice) {
    const order = orderOf(client, await devicesOf(client, into));
    const id = client.objectId("d", device.id);
    return { device: id, name: device.name, in: into.id, position: order.findIndex((other) => other.id === id) + 1, order };
}

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
        throw new Error(`${message} (Live only adds native devices, by the name Live shows, such as "EQ Eight". A plug-in is loaded instead, with load, by the path find_in_browser gives.)`);
    }
    return { action: "add", ...(await placed(client, into, added)) };
}

// Finds a browser item by its path, one level of the browser at a time. Live gives a script the
// item's id only when it has sent the item on this connection, so the path is walked for each load.
async function browserItem(client: Client, item: unknown) {
    const [root, ...names] = typeof item === "string" ? item.split("/") : [];
    if (!root || !ALL_ROOTS.includes(root) || names.length === 0) {
        throw new Error(`item must be a browser path as find_in_browser gives it, starting with one of ${ALL_ROOTS.join(", ")}, such as "drums/505 Core Kit.adg"`);
    }
    let [children] = (await client.send([getProp("browser", root)])) as [LiveBrowserItem[]];
    let path = root;
    let found: LiveBrowserItem | undefined;
    for (const [index, name] of names.entries()) {
        found = children.find((child) => child.name === name);
        if (!found) throw new Error(`${path} has no ${name}. Find the item again with find_in_browser.`);
        path = `${path}/${name}`;
        if (index < names.length - 1) [children] = (await client.send([getProp("browser-item", "children", found.id)])) as [LiveBrowserItem[]];
    }
    if (!found?.is_loadable) throw new Error(`${path} is a folder and cannot be loaded`);
    return found;
}

// Whether a browser item loads as an instrument or an effect, told from where it is, since Live does
// not say before it is loaded: its root, a sample's file name, then a folder named Audio or MIDI
// Effects (only a folder, so a preset named for its effects is not taken for one). An item elsewhere,
// such as a preset at the top of the user library, is not known until it is loaded.
function loadsAs(path: string) {
    const [root, ...rest] = path.split("/");
    if (root === "audio_effects" || root === "midi_effects") return "effect";
    if (root === "instruments" || root === "drums" || root === "sounds" || root === "samples" || SAMPLE_FILE.test(path)) return "instrument";
    if (rest.slice(0, -1).some((folder) => /(Audio|MIDI) Effects?\b/i.test(folder))) return "effect";
    return undefined;
}

// Loads a browser item onto the track `to` is on, as Live does, then moves an effect into place. Live
// loads only onto the selected track, so the track is selected for the load and the user's own
// selection is put back after.
async function load(client: Client, edit: Edit) {
    const into = target(client, edit);
    const item = await browserItem(client, edit.item);
    const kind = loadsAs(edit.item as string);
    if (kind === "instrument" && (into.ns === "chain" || edit.position !== undefined)) {
        throw new Error("An instrument goes onto a track, in the instrument's place. Give a track as to, with no position.");
    }
    // The load adds no device to a chain, and Live puts an effect last on a track, so this count is
    // also the last place for the move after.
    const count = (await devicesOf(client, into)).length;
    const place = position(edit.position, count + 1, false);
    const track = into.ns === "track" ? into.scriptId : (await findTracksOfDevices(client)).get(into.scriptId)?.id;
    if (!track) throw new Error(goneMessage(into.id, "read_tracks"));
    const onTrack: Target = { id: client.objectId("t", track), ns: "track", scriptId: track };

    const devices = await devicesOf(client, onTrack);
    const midi = (await client.send([getProp("track", "has_midi_input", track)]))[0] as boolean;
    if (kind === "instrument" && !midi) throw new Error(`${onTrack.id} is an audio track; an instrument, kit or sample loads only onto a MIDI track`);
    // Live would replace the instrument there, and only delete removes the user's work (ADR 0014). An
    // item of a kind not known before loading is held to the same rule.
    const instrument = devices.find((device) => device.type === "instrument");
    if (instrument && kind !== "effect") {
        const has = `${onTrack.id} already has an instrument, ${client.objectId("d", instrument.id)} ${instrument.name}`;
        if (kind === undefined) {
            throw new Error(
                `${has}, and Live does not say before the load whether ${String(edit.item)} is an instrument, which would replace it. If it is an effect, give the user the steps to load it; if it is an instrument, delete ${instrument.name} first with delete, then load.`,
            );
        }
        throw new Error(`${has}. Delete it first with delete, then load.`);
    }

    const before = new Set(devices.map((device) => device.id));
    const [selected] = (await client.send([getProp("song-view", "selected_track")])) as [LiveTrack | null];
    try {
        await client.send([setProp("song-view", "selected_track", track), { ns: "browser", name: "load_item", args: { id: item.id } }]);
    } finally {
        if (selected) await client.send([setProp("song-view", "selected_track", selected.id)]);
    }
    const added = (await devicesOf(client, onTrack)).find((device) => !before.has(device.id));
    if (!added) {
        const why = midi ? "it may be a sample, which loads only where the track has no instrument" : "an instrument, kit, sample or MIDI effect loads only onto a MIDI track";
        throw new Error(`Live loaded nothing from ${String(edit.item)}; ${why}.`);
    }
    // Live puts an instrument in its own place on the track.
    if (added.type === "instrument") return { action: "load", item: edit.item, ...(await placed(client, onTrack, added)) };

    // Live puts an effect last on the track, whatever is selected.
    if (into.ns === "chain" || place !== undefined) {
        try {
            await client.send([{ ns: "mentor", name: "move_device", args: { device_id: added.id, target_id: into.scriptId, position: (place ?? count + 1) - 1 } }]);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`${added.name} was loaded as ${client.objectId("d", added.id)}, last on ${onTrack.id}, but could not be moved: ${message}`);
        }
    }
    return { action: "load", item: edit.item, ...(await placed(client, into, added)) };
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
