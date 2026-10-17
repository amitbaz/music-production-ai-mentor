import type { Tool } from "@mentor/harness";

// What the tools read of a Live Set, flat: one entry per thing a mentor can change, keyed by a label
// a person reads, such as "Sub Sub Bass (t1) / Utility (d1) / Gain", with the value as Live shows it.
// An entry for an object has its id, so an object added or removed is one line of difference, not one
// per thing inside it. Ids are the runner's own connection's, so they hold across its reads.
// ponytail: notes inside clips and automation are not read; a case that needs them reads them.
type Entry = { value: string; id?: string };
export type Snapshot = Record<string, Entry>;

type Parameter = { name: string; value: string };
type Device = { id: string; name: string; parameters?: Parameter[]; chains?: { id: string; name: string; mute?: true; solo?: true; devices?: Device[] }[] };
type Clip = { id: string; name: string; kind: string; scene?: number; start?: number; end?: number; muted?: true };
type Detail = { devices?: Device[]; session?: Clip[]; arrangement?: Clip[] };
type Track = { id: string; name: string; kind: string; group?: string; volume: string; pan: string; sends?: Record<string, string>; mute?: true; solo?: true };

const caller = (tools: Tool[]) => async (name: string, args: Record<string, unknown>) =>
    JSON.parse(await (tools.find((tool) => tool.name === name) as Tool).run(args));

// Reads the whole Set: the overview, then each track in full, one track per read to stay under the result limit.
export async function snapshot(tools: Tool[]): Promise<Snapshot> {
    const call = caller(tools);
    const set = (await call("read_set", {})) as { tempo: number; time_signature: string; tracks: Track[] };
    const shot: Snapshot = { tempo: { value: String(set.tempo) }, "time signature": { value: set.time_signature } };
    for (const track of set.tracks) {
        const at = `${track.name} (${track.id})`;
        shot[at] = { value: [track.kind, track.group && `in ${track.group}`, track.mute && "muted", track.solo && "soloed"].filter(Boolean).join(", "), id: track.id };
        const mixer = (parameter: string, value: string) => {
            shot[`${at} / ${parameter}`] = { value };
        };
        mixer("volume", track.volume);
        mixer("pan", track.pan);
        for (const [to, value] of Object.entries(track.sends ?? {})) mixer(`send ${to}`, value);

        const read = await call("read_tracks", { tracks: [track.id] });
        const [detail] = read.tracks as Detail[];
        // A track too long for one result leaves devices out; each is read on its own, as the tool's note says.
        const { devices: leftOut = [], clips, note, ...unknown } = (read.left_out ?? {}) as { devices?: string[]; clips?: Record<string, number>; note?: string };
        if (Object.keys(unknown).length) throw new Error(`${track.name} has more left out of its read than devices and clips: ${JSON.stringify(unknown)}`);
        // It may cut clips too; with every device by name only, they get the whole result.
        // ponytail: one more read; clips that alone pass the limit stop the series, read them in pages if a Set ever has them.
        let clipped = detail;
        if (clips) {
            const again = await call("read_tracks", { tracks: [track.id], devices: [] });
            if (again.left_out?.clips) throw new Error(`${track.name} has clips cut from its read: ${JSON.stringify(again.left_out.clips)}`);
            [clipped] = again.tracks as Detail[];
        }
        for (const id of leftOut) {
            const [alone] = (await call("read_tracks", { tracks: [track.id], devices: [id] })).tracks as Detail[];
            Object.assign(find(detail?.devices ?? [], id) as Device, find(alone?.devices ?? [], id));
        }
        devices(shot, at, detail?.devices ?? []);
        for (const { id, name, ...clip } of [...(clipped?.session ?? []), ...(clipped?.arrangement ?? [])]) {
            shot[`${at} / ${name} (${id})`] = { value: JSON.stringify(clip), id };
        }
    }
    return shot;
}

function devices(shot: Snapshot, at: string, list: Device[]) {
    shot[`${at} / devices`] = { value: list.map((device) => `${device.name} (${device.id})`).join(", ") };
    for (const device of list) {
        const key = `${at} / ${device.name} (${device.id})`;
        shot[key] = { value: "device", id: device.id };
        for (const { name, value } of device.parameters ?? []) shot[`${key} / ${name}`] = { value };
        for (const chain of device.chains ?? []) {
            const chainKey = `${key} / ${chain.name} (${chain.id})`;
            shot[chainKey] = { value: [chain.mute && "muted", chain.solo && "soloed"].filter(Boolean).join(", ") || "chain" };
            devices(shot, chainKey, chain.devices ?? []);
        }
    }
}

// The device of that id, also inside racks.
function find(list: Device[], id: string): Device | undefined {
    for (const device of list) {
        const found = device.id === id ? device : find((device.chains ?? []).flatMap((chain) => chain.devices ?? []), id);
        if (found) return found;
    }
}

// The keys of objects in one snapshot and not the other, outermost only: what is inside them goes with them.
function only(here: Snapshot, there: Snapshot): string[] {
    const keys = Object.keys(here).filter((key) => here[key]?.id && !(key in there));
    return keys.filter((key) => !keys.some((outer) => key.startsWith(`${outer} / `)));
}

// Every way `now` differs from `base`, one line each, as "label: before → after"; an object added or
// removed is one line, not one per thing inside it.
export function difference(base: Snapshot, now: Snapshot): string[] {
    const objects = [...only(base, now), ...only(now, base)];
    const inside = (key: string) => objects.some((object) => key.startsWith(`${object} / `));
    const keys = [...new Set([...Object.keys(base), ...Object.keys(now)])].filter((key) => !inside(key));
    return keys.filter((key) => base[key]?.value !== now[key]?.value).map((key) => `${key}: ${base[key]?.value ?? "none"} → ${now[key]?.value ?? "none"}`);
}
