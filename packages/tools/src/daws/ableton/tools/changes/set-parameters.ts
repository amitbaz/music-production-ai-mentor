import type { Tool } from "@mentor/harness";
import { type Client, getProp, setProp, strForValue } from "../../client.ts";
import { findTracksOfDevices, goneMessage, isGone, revealer } from "../../changing.ts";
import { isPlugin, type LiveDeviceParameter, type LiveParameter, type LiveTrack } from "../../live.ts";

// A parameter of a device or of a track's mixer, as the script describes it.
type Parameter = LiveParameter & { is_quantized?: boolean };
type Written = { before: string; after: string };

// What a change is called in the result: the ids as given at first, the names once Live has told them.
type Label = { text: string };

// Changes the parameters of native devices and the mixer: volume, pan and sends of a track.
export function setParameters(client: Client): Tool {
    return {
        name: "set_parameters",
        description:
            "Changes device parameters and the mixer, in the order given, in one call. Each change is {target, parameter, value}. target: the object id of a device (d..., also one inside a rack) or of a track (t...), as given by read_set or read_tracks. parameter: for a device, the name of one of its parameters as read_tracks gives it; for a track, volume, pan, or send followed by the object id of a return track, such as \"send t2\". value: for a number, the number in the units Live shows, such as -3 for \"-3.0 dB\" or 250 for \"250 Hz\" (Live writes Hz where it shows kHz, so 2500 for \"2.50 kHz\"); for a parameter that is a list, the name of the choice, such as \"High Pass\". Each change is reported as track / device / parameter: before → after, with the values as Live shows them. A change that cannot be made, such as an unknown parameter, a value outside the range, or a parameter of a third-party plug-in (their parameters cannot be changed), is reported as not changed with the reason, and the other changes still run. It does not ask for approval: take a change back by writing the old value again.",
        params: {
            type: "object",
            properties: {
                changes: {
                    type: "array",
                    description: "The changes, applied in this order.",
                    items: {
                        type: "object",
                        properties: {
                            target: { type: "string", description: "Object id of a device or a track, such as d12 or t1." },
                            parameter: { type: "string", description: "Parameter name, such as Gain; for a track volume, pan or send t2." },
                            value: { description: "A number in the units Live shows, or the name of a choice for a list parameter." },
                        },
                        required: ["target", "parameter", "value"],
                    },
                },
            },
            required: ["changes"],
        },
        run: (args) => run(client, args),
    };
}

async function run(client: Client, args: Record<string, unknown>) {
    const { changes } = args;
    if (!Array.isArray(changes) || changes.length === 0) {
        throw new Error('changes must be a list of one or more changes, such as [{"target": "t1", "parameter": "volume", "value": -6}]');
    }
    // The tracks of the devices are looked up once, and only if a change needs them.
    let trackOf: Promise<Map<string, { id: string; name: string }>> | undefined;
    const tracksOfDevices = () => (trackOf ??= findTracksOfDevices(client));

    const reveal = revealer(client);
    const lines: string[] = [];
    for (const change of changes) {
        const { target, parameter, value } = (typeof change === "object" && change !== null ? change : {}) as Record<string, unknown>;
        const label: Label = { text: [target, parameter].filter((part) => typeof part === "string").join(" / ") || "change" };
        try {
            if (typeof target !== "string" || typeof parameter !== "string" || value === undefined) {
                throw new Error("A change needs a target, a parameter and a value");
            }
            const { before, after } = await apply(client, { target, parameter, value }, label, tracksOfDevices, reveal);
            lines.push(`${label.text}: ${before} → ${after}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const reason = isGone(error) ? goneMessage(String(target)) : message;
            lines.push(`${label.text}: not changed. ${reason}`);
        }
    }
    return JSON.stringify({ changes: lines, ...(reveal.problems.length > 0 && { view_problems: reveal.problems }) });
}

type Reveal = ReturnType<typeof revealer>;
type TracksOfDevices = () => Promise<Map<string, { id: string; name: string }>>;
type Change = { target: string; parameter: string; value: unknown };

function apply(client: Client, change: Change, label: Label, tracksOfDevices: TracksOfDevices, reveal: Reveal): Promise<Written> {
    if (/^t\d+$/.test(change.target)) return changeMixer(client, change, label, reveal);
    if (/^d\d+$/.test(change.target)) return changeDevice(client, change, label, tracksOfDevices, reveal);
    throw new Error(`${change.target} is not a track or a device. set_parameters takes object ids such as t1 or d12.`);
}

async function changeMixer(client: Client, { target, parameter, value }: Change, label: Label, reveal: Reveal) {
    const trackId = client.scriptId(target);
    const [name, mixer, returns] = (await client.send([
        getProp("track", "name", trackId),
        getProp("track", "mixer_device", trackId),
        getProp("song", "return_tracks"),
    ])) as [string, { id: string }, LiveTrack[]];
    label.text = `${name} / ${parameter}`;
    const [volume, panning, sends] = (await client.send([
        getProp("mixer-device", "volume", mixer.id),
        getProp("mixer-device", "panning", mixer.id),
        getProp("mixer-device", "sends", mixer.id),
    ])) as [LiveParameter, LiveParameter, LiveParameter[]];

    // Sends are in the order of the return tracks, and named by the object id of theirs, as read_set shows them.
    const options: { name: string; label: string; parameter: LiveParameter; returned?: LiveTrack }[] = [
        { name: "volume", label: "Volume", parameter: volume },
        { name: "pan", label: "Pan", parameter: panning },
        // A send with no return track to match is left out.
        ...sends.flatMap((send, index) => {
            const returned = returns[index];
            return returned ? [{ name: `send ${client.objectId("t", returned.id)}`, label: `Send to ${returned.name}`, parameter: send, returned }] : [];
        }),
    ];
    const option = options.find((option) => option.name === parameter.trim().toLowerCase());
    if (!option) {
        const names = options.map((option) => (option.returned ? `${option.name} (${option.returned.name})` : option.name));
        throw new Error(`${name} has no parameter ${parameter}. The parameters are: ${names.join(", ")}`);
    }
    label.text = `${name} / ${option.label}`;
    await reveal.track(trackId, target);
    return write(client, option.parameter, option.label, value);
}

async function changeDevice(client: Client, { target, parameter, value }: Change, label: Label, tracksOfDevices: TracksOfDevices, reveal: Reveal) {
    const deviceId = client.scriptId(target);
    const [name, className] = (await client.send([getProp("device", "name", deviceId), getProp("device", "class_name", deviceId)])) as [string, string];
    const track = (await tracksOfDevices()).get(deviceId);
    if (!track) throw new Error(`${target} is no longer in the Live Set. Read again with read_tracks to get current ids.`);
    label.text = `${track.name} / ${name} / ${parameter}`;
    if (isPlugin({ id: deviceId, name, class_name: className })) {
        throw new Error(
            `${name} is a third-party plug-in, and the mentor cannot change the parameters of a plug-in yet. Tell the user which control to change and to what value, to do by hand.`,
        );
    }

    const [parameters] = (await client.send([getProp("device", "parameters", deviceId)])) as [LiveDeviceParameter[]];
    const wanted = parameter.trim();
    // The exact name first, so a parameter that is another's name in other letters can still be asked for.
    const exact = parameters.filter((candidate) => candidate.name === wanted);
    const found = exact.length > 0 ? exact : parameters.filter((candidate) => candidate.name.toLowerCase() === wanted.toLowerCase());
    if (found.length === 0) throw new Error(`${name} has no parameter ${parameter}. The parameters are: ${parameters.map((candidate) => candidate.name).join(", ")}`);
    if (found.length > 1) throw new Error(`More than one parameter of ${name} is named ${parameter}, so the mentor cannot tell which one is meant.`);
    const [chosen] = found as [LiveDeviceParameter];
    label.text = `${track.name} / ${name} / ${chosen.name}`;
    await reveal.device(deviceId, target, track.id);
    return write(client, chosen, chosen.name, value);
}

// Writes one parameter and says what it was and what it is, as Live shows them.
async function write(client: Client, parameter: Parameter, name: string, value: unknown): Promise<Written> {
    return parameter.is_quantized ? writeChoice(client, parameter, name, value) : writeNumber(client, parameter, name, value);
}

// A list parameter takes the index of the choice, so the name is looked up in its choices.
async function writeChoice(client: Client, parameter: Parameter, name: string, value: unknown) {
    const [items] = (await client.send([getProp("device-parameter", "value_items", parameter.id)])) as [string[]];
    if (typeof value !== "string") throw new Error(`${name} is a list: give the name of a choice, one of: ${items.join(", ")}`);
    const index = items.findIndex((item) => item.toLowerCase() === value.trim().toLowerCase());
    if (index < 0) throw new Error(`"${value}" is not a choice of ${name}. The choices are: ${items.join(", ")}`);
    const [, kept] = (await client.send([
        setProp("device-parameter", "value", index, parameter.id),
        getProp("device-parameter", "value", parameter.id),
    ])) as [unknown, number];
    // A parameter Live holds still, such as one an automation drives, takes the write and keeps its value.
    if (kept !== index) throw new Error(`${name} is still ${items[kept]}: Live did not take "${items[index]}".`);
    return { before: items[parameter.value] as string, after: items[kept] as string };
}

// A number is written through display_value, in the units Live shows. Live clamps a number outside
// the range without an error, so the number is checked by what Live kept: if it sits at an end of
// the range and is not the number given, the old value is written back and the change refused.
async function writeNumber(client: Client, parameter: Parameter, name: string, value: unknown) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`${name} is a number: give a number in the units Live shows, such as -3 for "-3.0 dB"`);
    }
    const [min, max, before] = (await client.send([
        getProp("device-parameter", "min", parameter.id),
        getProp("device-parameter", "max", parameter.id),
        strForValue(parameter.id, parameter.value),
    ])) as [number, number, string];
    const restore = () => client.send([setProp("device-parameter", "value", parameter.value, parameter.id)]);
    let kept: number;
    let shown: number;
    try {
        [, kept, shown] = (await client.send([
            setProp("device-parameter", "display_value", value, parameter.id),
            getProp("device-parameter", "value", parameter.id),
            getProp("device-parameter", "display_value", parameter.id),
        ])) as [unknown, number, number];
    } catch (error) {
        // The write may have landed before the read failed, so the old value goes back; if Live cannot be reached, that fails too.
        await restore().catch(() => {});
        throw error;
    }

    // A little room for the rounding Live does, such as 15.004 kept as 15.0, but not for 15.05.
    const clamped = (kept <= min || kept >= max) && Math.abs(shown - value) > 0.001 * Math.abs(shown) + 1e-9;
    if (clamped) {
        const [, low, high] = (await client.send([
            setProp("device-parameter", "value", parameter.value, parameter.id),
            strForValue(parameter.id, min),
            strForValue(parameter.id, max),
        ])) as [unknown, string, string];
        throw new Error(`${value} is outside the range of ${name}, which is ${low} to ${high}. Its value is still ${before}.`);
    }
    const [after] = (await client.send([strForValue(parameter.id, kept)])) as [string];
    return { before, after };
}
