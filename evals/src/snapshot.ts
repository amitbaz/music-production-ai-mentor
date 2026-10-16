import type { Tool } from "@mentor/harness";

// What the tools read of a Live Set, flat: one entry per thing a mentor can change, keyed by a label
// a person reads, such as "Sub Sub Bass (t1) / Utility (d1) / Gain", with the value as Live shows it.
// An entry for an object has its id, so one the mentor added can be deleted; an entry the runner can
// write back says how. Ids are the runner's own connection's, so they hold across its reads.
// ponytail: notes inside clips and automation are not read; a case that needs them reads them.
type Entry = { value: string; id?: string; write?: { target: string; parameter: string; choice: boolean } };
export type Snapshot = Record<string, Entry>;

type Parameter = { name: string; value: string; choices?: string[] };
type Device = { id: string; name: string; parameters?: Parameter[]; chains?: { id: string; name: string; mute?: true; solo?: true; devices?: Device[] }[] };
type Clip = { id: string; name: string; kind: string; scene?: number; start?: number; end?: number; muted?: true };
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
            shot[`${at} / ${parameter}`] = { value, write: { target: track.id, parameter, choice: false } };
        };
        mixer("volume", track.volume);
        mixer("pan", track.pan);
        for (const [to, value] of Object.entries(track.sends ?? {})) mixer(`send ${to}`, value);

        const read = await call("read_tracks", { tracks: [track.id] });
        const [detail] = read.tracks as { devices?: Device[]; session?: Clip[]; arrangement?: Clip[] }[];
        // A track too long for one result leaves devices out; each is read on its own, as the tool's note says.
        const { devices: leftOut = [], note, ...cut } = (read.left_out ?? {}) as { devices?: string[]; note?: string };
        if (Object.keys(cut).length) throw new Error(`${track.name} has clips cut from its read: ${JSON.stringify(cut)}`);
        for (const id of leftOut) {
            const [alone] = (await call("read_tracks", { tracks: [track.id], devices: [id] })).tracks as { devices?: Device[] }[];
            Object.assign(find(detail?.devices ?? [], id) as Device, find(alone?.devices ?? [], id));
        }
        devices(shot, at, detail?.devices ?? []);
        for (const { id, name, ...clip } of [...(detail?.session ?? []), ...(detail?.arrangement ?? [])]) {
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
        for (const { name, value, choices } of device.parameters ?? []) {
            shot[`${key} / ${name}`] = { value, write: { target: device.id, parameter: name, choice: Boolean(choices) } };
        }
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

// Puts `now` back to `base` as far as the tools can: deletes what was added, writes back the values
// that changed. What was removed cannot come back; the caller reads again to see what is left.
export async function restore(tools: Tool[], base: Snapshot, now: Snapshot): Promise<string[]> {
    const call = caller(tools);
    const lines: string[] = [];
    const added = only(now, base).map((key) => now[key]?.id as string);
    if (added.length) lines.push(...(await call("delete", { ids: added })).deleted.map(String));
    const changes = Object.entries(base).flatMap(([key, { value, write }]) =>
        write && key in now && now[key]?.value !== value ? [{ target: write.target, parameter: write.parameter, value: write.choice ? value : number(value) }] : [],
    );
    if (changes.length) lines.push(...(await call("set_parameters", { changes })).changes);
    return lines;
}

// A value as Live shows it, as the number set_parameters takes: "-1.0 dB" is -1, "2.50 kHz" is 2500
// (Live writes Hz), "12L" is -12, "C" is 0.
// ponytail: "-inf dB" has no number, so it is not written back and the series stops on it.
function number(shown: string): number {
    if (shown === "C") return 0;
    const pan = shown.match(/^(\d+)([LR])$/);
    if (pan) return (pan[2] === "L" ? -1 : 1) * Number(pan[1]);
    return Number.parseFloat(shown) * (/kHz$/.test(shown) ? 1000 : 1);
}
