import type { Tool } from "@mentor/harness";
import { type Client, type Command, createClient, getProp } from "./client.ts";

// What the script returns for a track, a device and a parameter; only the fields we use.
type LiveTrack = { id: string; name: string; type: string; mute: boolean; solo: boolean };
type LiveDevice = { id: string; name: string; class_name: string };
type LiveParameter = { id: string; value: number };

// The Ableton tool set. It reaches the Live Set open in Ableton Live through the Remote Script,
// at the address the app gives.
export function createAbleton(options: { address?: string }): Tool[] {
    const client = createClient(options.address);

    return [
        {
            name: "read_set",
            description:
                "Overview of the Live Set open in Ableton Live: tempo, time signature, and every track (returns and Main included) with its object id, kind, group, volume, pan, sends, mute and solo, and its devices with their object ids. Third-party plug-ins are marked plugin. Sends are keyed by the object id of their return track. Fields that are false or empty are left out. Gives no device parameters and no clips.",
            params: { type: "object", properties: {} },
            run: () => readSet(client),
        },
    ];
}

// Reads the overview in four messages, whatever the size of the Live Set.
async function readSet(client: Client) {
    const [tempo, numerator, denominator, tracks, returns, main] = await client.send([
        getProp("song", "tempo"),
        getProp("song", "signature_numerator"),
        getProp("song", "signature_denominator"),
        getProp("song", "tracks"),
        getProp("song", "return_tracks"),
        getProp("song", "master_track"),
    ]);
    const allTracks = [...(tracks as LiveTrack[]), ...(returns as LiveTrack[]), main as LiveTrack];
    // Given in the order Live shows the tracks, so ids read top to bottom.
    const trackIds = allTracks.map((track) => client.objectId("t", track.id));
    const returnIds = trackIds.slice((tracks as LiveTrack[]).length, -1);

    const trackParts = (await sendEach(client, allTracks, (track) => [
        getProp("track", "devices", track.id),
        getProp("track", "mixer_device", track.id),
        getProp("track", "group_track", track.id),
    ])) as [LiveDevice[], { id: string }, LiveTrack | null][];

    const mixerParameters = (await sendEach(client, trackParts, ([, mixer]) => [
        getProp("mixer-device", "volume", mixer.id),
        getProp("mixer-device", "panning", mixer.id),
        getProp("mixer-device", "sends", mixer.id),
    ])) as [LiveParameter, LiveParameter, LiveParameter[]][];

    // Values as Live shows them, such as "-3.0 dB" or "12L".
    const shownValues = (await sendEach(client, mixerParameters, ([volume, pan, sends]) =>
        [volume, pan, ...sends].map((parameter) => ({
            ns: "device-parameter",
            nsid: parameter.id,
            name: "str_for_value",
            args: [parameter.value],
        })),
    )) as string[][];

    const overview = allTracks.map((track, index) => {
        const [devices, , group] = trackParts[index] as (typeof trackParts)[number];
        const [volume, pan, ...sends] = shownValues[index] as string[];
        return {
            id: trackIds[index],
            name: track.name,
            kind: track.type,
            ...(group && { group: client.objectId("t", group.id) }),
            volume,
            pan,
            ...(sends.length > 0 && {
                sends: Object.fromEntries(sends.map((send, i) => [returnIds[i], send])),
            }),
            ...(track.mute && { mute: true }),
            ...(track.solo && { solo: true }),
            ...(devices.length > 0 && {
                devices: devices.map((device) => ({
                    id: client.objectId("d", device.id),
                    name: device.name,
                    ...(isPlugin(device) && { plugin: true }),
                })),
            }),
        };
    });

    return JSON.stringify({ tempo, time_signature: `${numerator}/${denominator}`, tracks: overview });
}

// Sends the commands for every item in one message, and gives back each item's results.
async function sendEach<T>(client: Client, items: T[], commands: (item: T) => Command[]) {
    const perItem = items.map(commands);
    const results = await client.send(perItem.flat());
    let start = 0;
    return perItem.map((itemCommands) => {
        const end = start + itemCommands.length;
        const itemResults = results.slice(start, end);
        start = end;
        return itemResults;
    });
}

// A third-party plug-in, VST or Audio Unit, as opposed to a native device.
function isPlugin(device: LiveDevice) {
    return device.class_name === "PluginDevice" || device.class_name === "AuPluginDevice";
}
