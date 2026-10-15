import type { Tool } from "@mentor/harness";

// One parameter of a base Set that a plant changes: the track by name, the device by its names
// down the racks (device, chain, device, …; none for the mixer), and the value before and after,
// as the tools take it: a number in the units Live shows, or the name of a choice.
export type Change = { track: string; device?: string[]; parameter: string; before: number | string; after: number | string };

// A plant: one known fault on a base Set, applied and reverted by name (ADR 0020). `bars` is where
// it sounds and `says` what a good mentor says of it; both are the answer key a human reads.
export type Plant = { name: string; title: string; bars: string; says: string; changes: Change[] };

type Named = { id: string; name: string };
type Device = Named & { parameters?: { name: string; value: string }[]; chains?: (Named & { devices?: Device[] })[] };
type Track = Named & { volume?: string; pan?: string; sends?: Record<string, string>; devices?: Named[] };

// Applies the plant: every change must hold its before value in Live, or nothing is written.
export const applyPlant = (tools: Tool[], plant: Plant) => write(tools, plant, "before", "after");

// Reverts the plant: every change must hold its after value in Live, or nothing is written.
export const revertPlant = (tools: Tool[], plant: Plant) => write(tools, plant, "after", "before");

async function write(tools: Tool[], plant: Plant, from: "before" | "after", to: "before" | "after"): Promise<string[]> {
    const call = async (name: string, args: Record<string, unknown>) => JSON.parse(await (tools.find((tool) => tool.name === name) as Tool).run(args));
    const { tracks } = (await call("read_set", {})) as { tracks: Track[] };

    // Each change's object id and the value Live holds now, read before anything is written.
    const targets: { target: string; label: string; value: string }[] = [];
    for (const change of plant.changes) {
        const track = one(tracks, change.track, `track ${change.track}`);
        if (!change.device) {
            targets.push({ target: track.id, label: `${track.name} / ${change.parameter}`, value: mixer(track, change.parameter) });
            continue;
        }
        // Down the racks: a device's chains come with its parameters, one read per level.
        let device = one(track.devices ?? [], change.device[0] as string, `device ${change.device[0]} on ${track.name}`) as Device;
        let detail = await read(call, track.id, device.id);
        for (let i = 1; i < change.device.length; i += 2) {
            const chain = one(detail.chains ?? [], change.device[i] as string, `chain ${change.device[i]} in ${device.name}`);
            device = one(chain.devices ?? [], change.device[i + 1] as string, `device ${change.device[i + 1]} in chain ${chain.name}`);
            detail = await read(call, track.id, device.id);
        }
        const parameter = one(detail.parameters ?? [], change.parameter, `parameter ${change.parameter} of ${device.name}`);
        targets.push({ target: device.id, label: `${track.name} / ${device.name} / ${parameter.name}`, value: parameter.value });
    }

    const wrong = plant.changes.flatMap((change, i) => {
        const { label, value } = targets[i] as (typeof targets)[number];
        return holds(value, change[from]) ? [] : [`${label} is ${value}, not ${change[from]}`];
    });
    if (wrong.length) throw new Error(`Not written: ${wrong.join("; ")}`);
    const result = await call("set_parameters", {
        changes: plant.changes.map((change, i) => ({ target: (targets[i] as (typeof targets)[number]).target, parameter: change.parameter, value: change[to] })),
    });
    return result.changes as string[];
}

const read = async (call: (name: string, args: Record<string, unknown>) => Promise<{ tracks: { devices?: Device[] }[] }>, track: string, device: string) => {
    const { tracks } = await call("read_tracks", { tracks: [track], devices: [device] });
    return find(tracks[0]?.devices ?? [], device) as Device;
};

function find(devices: Device[], id: string): Device | undefined {
    for (const device of devices) {
        if (device.id === id) return device;
        const inner = find((device.chains ?? []).flatMap((chain) => chain.devices ?? []), id);
        if (inner) return inner;
    }
    return undefined;
}

// The one item of that name, whatever its case; two of the same name is a plant that must say more.
function one<T extends { name: string }>(items: T[], name: string, what: string): T {
    const found = items.filter((item) => item.name.toLowerCase() === name.toLowerCase());
    if (found.length !== 1) throw new Error(`${found.length ? "More than one" : "No"} ${what}`);
    return found[0] as T;
}

function mixer(track: Track, parameter: string): string {
    const value = parameter === "volume" ? track.volume : parameter === "pan" ? track.pan : track.sends?.[parameter.replace(/^send /, "")];
    if (value === undefined) throw new Error(`No ${parameter} on ${track.name}`);
    return value;
}

// Whether a value as Live shows it, such as "-1.0 dB" or "Off", is the plant's number or choice.
const holds = (shown: string, expected: number | string) =>
    typeof expected === "number" ? Math.abs(Number.parseFloat(shown) - expected) < 0.051 : shown.toLowerCase() === expected.toLowerCase();
