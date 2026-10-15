import type { Tool } from "@mentor/harness";
import { type Client, getProp, strForValue } from "../../client.ts";
import { isPlugin, type LiveDevice, type LiveParameter, type LiveTrack } from "../../live.ts";

// The overview of the Live Set: enough for the mentor to know where to look next.
export function readSet(client: Client): Tool {
    return {
        name: "read_set",
        description:
            "Overview of the Live Set open in Ableton Live: tempo, time signature, and every track (returns and Main included) with its object id, kind, group, volume, pan, sends, mute and solo, and its devices with their object ids. Third-party plug-ins are marked plugin. Sends are keyed by the object id of their return track. Fields that are false or empty are left out. Gives no device parameters and no clips.",
        params: { type: "object", properties: {} },
        run: () => read(client),
    };
}

// Reads the overview in four messages, whatever the size of the Live Set.
async function read(client: Client) {
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

    const trackParts = (await client.sendEach(allTracks, (track) => [
        getProp("track", "devices", track.id),
        getProp("track", "mixer_device", track.id),
        getProp("track", "group_track", track.id),
    ])) as [LiveDevice[], { id: string }, LiveTrack | null][];

    const mixerParameters = (await client.sendEach(trackParts, ([, mixer]) => [
        getProp("mixer-device", "volume", mixer.id),
        getProp("mixer-device", "panning", mixer.id),
        getProp("mixer-device", "sends", mixer.id),
    ])) as [LiveParameter, LiveParameter, LiveParameter[]][];

    // Values as Live shows them, such as "-3.0 dB" or "12L".
    const shownValues = (await client.sendEach(mixerParameters, ([volume, pan, sends]) =>
        [volume, pan, ...sends].map((parameter) => strForValue(parameter.id, parameter.value)),
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
