// What the changing tools share.
import { type Client, type Command, getProp, setProp } from "./client.ts";
import { isPlugin, type LiveChain, type LiveDevice, type LiveTrack } from "./live.ts";

// An object deleted since its id was given fails in one of two ways: the script no longer knows the
// id, or it still holds the object and Live refuses it as a dead handle (seen in Live 12.4.6, for
// what was inside a deleted track or rack, or for a track deleted through live_change).
export function isGone(error: unknown) {
    return error instanceof Error && (error.message.includes("Unknown object id") || error.message.includes("None.None("));
}

// `read` names the tool that gives current ids for this kind of object.
export const goneMessage = (id: string, read = "read_set") => `${id} is no longer in the Live Set. Read again with ${read} to get current ids.`;

// Asks Live about an object by its id, and reports one deleted meanwhile as gone.
export async function reportingGone<T>(id: string, ask: () => Promise<T>, read = "read_set") {
    try {
        return await ask();
    } catch (error) {
        throw isGone(error) ? new Error(goneMessage(id, read)) : error;
    }
}

// The panel at the bottom of Live that shows the devices of the selected track.
export const DEVICE_VIEW = "Detail/DeviceChain";

export const showView = (view: string) => ({ ns: "application-view", name: "show_view", args: [view] });

// Every device and rack chain of the Live Set, also inside racks, with the track it is on. Live does
// not say which track a device is on, so this walks down from the tracks, three messages for each
// level of racks inside racks.
export async function findTracksOfDevices(client: Client) {
    const [tracks, returns, main] = (await client.send([
        getProp("song", "tracks"),
        getProp("song", "return_tracks"),
        getProp("song", "master_track"),
    ])) as [LiveTrack[], LiveTrack[], LiveTrack];
    const owners = [...tracks, ...returns, main];
    const lists = await client.sendEach(owners, (track) => [getProp("track", "devices", track.id)]);
    let level = owners.flatMap((track, index) => (lists[index] as [LiveDevice[]])[0].map((device) => ({ device, track })));

    const tracksOf = new Map<string, { id: string; name: string }>();
    while (level.length > 0) {
        for (const { device, track } of level) tracksOf.set(device.id, { id: track.id, name: track.name });
        const native = level.filter(({ device }) => !isPlugin(device));
        const canHaveChains = await client.sendEach(native, ({ device }) => [getProp("device", "can_have_chains", device.id)]);
        const racks = native.filter((_, index) => canHaveChains[index]?.[0]);
        const chainLists = await client.sendEach(racks, ({ device }) => [getProp("device", "chains", device.id)]);
        const chains = racks.flatMap(({ track }, index) => (chainLists[index] as [LiveChain[]])[0].map((chain) => ({ chain, track })));
        for (const { chain, track } of chains) tracksOf.set(chain.id, { id: track.id, name: track.name });
        const deviceLists = await client.sendEach(chains, ({ chain }) => [getProp("chain", "devices", chain.id)]);
        level = chains.flatMap(({ track }, index) => (deviceLists[index] as [LiveDevice[]])[0].map((device) => ({ device, track })));
    }
    return tracksOf;
}

// Opens the folded groups a track is in, since a track in one cannot be seen, inner group first.
async function unfoldGroups(client: Client, trackId: string) {
    const groupOf = async (id: string) => ((await client.send([getProp("track", "group_track", id)])) as [LiveTrack | null])[0];
    for (let group = await groupOf(trackId); group; group = await groupOf(group.id)) {
        const [fold] = await client.send([getProp("track", "fold_state", group.id)]);
        // Live takes a bool here, not 0.
        if (fold) await client.send([setProp("track", "fold_state", false, group.id)]);
    }
}

// Opens a track that the Arrangement View shows as a thin strip. A track that has no such state,
// as Main may not, is shown anyway.
async function expand(client: Client, trackId: string) {
    try {
        const [collapsed] = await client.send([getProp("track-view", "is_collapsed", trackId)]);
        if (collapsed) await client.send([setProp("track-view", "is_collapsed", false, trackId)]);
    } catch {
        // Nothing to open.
    }
}

const scroll = (view: string, direction: string) => ({
    ns: "application-view",
    name: "scroll_view",
    args: { direction, view, modifier_pressed: false },
});

// Live scrolls to what an arrow key selects, not to what a script selects. So after a script
// selects something, scroll_view moves the selection one step away and back, which makes Live
// scroll to it, and the script selects it again in case the selection did not end there. The step
// goes toward the thing that exists: a first track or device has nothing before it.
async function scrollTo(client: Client, view: string, [before, after]: [string, string], first: boolean, select: Command) {
    const steps = first ? [after, before] : [before, after];
    await client.send([...steps.map((direction) => scroll(view, direction)), select]);
}

// Brings a track into view for the user: its groups and the track are opened, it is selected, and Live is made
// to scroll to it.
export async function revealTrack(client: Client, trackId: string) {
    await unfoldGroups(client, trackId);
    await expand(client, trackId);
    const select = setProp("song-view", "selected_track", trackId);
    await client.send([select]);
    // The tracks are one under another in the Arrangement View, and side by side in the Session View.
    const [visible, tracks] = (await client.send([getProp("application-view", "focused_document_view"), getProp("song", "tracks")])) as [string, LiveTrack[]];
    const session = visible === "Session";
    const view = session ? "Session" : "Arranger";
    // The scroll goes to the focused view, and Live may not be where the user is looking.
    await client.send([{ ns: "application-view", name: "focus_view", args: [view] }]);
    await scrollTo(client, view, session ? ["left", "right"] : ["up", "down"], tracks[0]?.id === trackId, select);
}

// Brings a device into view: its track first, then the device in the device view, scrolled to. A
// device inside a rack is taken for one that has others before it. Without its track, only the device.
export async function revealDevice(client: Client, deviceId: string, trackId?: string) {
    if (trackId) await revealTrack(client, trackId);
    const select = { ns: "song-view", name: "select_device", args: { device_id: deviceId } };
    await client.send([select, showView(DEVICE_VIEW)]);
    const [devices] = trackId ? ((await client.send([getProp("track", "devices", trackId)])) as [LiveDevice[]]) : [[]];
    await scrollTo(client, DEVICE_VIEW, ["left", "right"], devices[0]?.id === deviceId, select);
}

// For a tool that changes the Live Set, so the user sees what it changes. The change matters more
// than the view, so a view that fails to move is not an error but a problem the result reports, and
// one track or device is shown once for a call, however many changes it gets.
export function revealer(client: Client) {
    const shown = new Set<string>();
    const problems: string[] = [];
    const once = async (id: string, label: string, reveal: () => Promise<void>) => {
        if (shown.has(id)) return;
        shown.add(id);
        await reveal().catch((error: Error) => {
            problems.push(`Live could not be scrolled to ${label}: ${error.message}`);
        });
    };
    return {
        problems,
        track: (trackId: string, label: string) => once(trackId, label, () => revealTrack(client, trackId)),
        device: (deviceId: string, label: string, trackId?: string) => once(deviceId, label, () => revealDevice(client, deviceId, trackId)),
    };
}
