import type { Tool } from "@mentor/harness";
import { type Client, getProp } from "../../client.ts";
import type { LiveClip, LiveCuePoint, LiveTrack } from "../../live.ts";
import { numberArg, RESULT_LIMIT } from "../../reading.ts";

// The Live Set along time: the locators, and where each track has clips in the Arrangement View.
export function readArrangement(client: Client): Tool {
    return {
        name: "read_arrangement",
        description:
            "The Arrangement View of the Live Set open in Ableton Live: the locators, and for each track its arrangement clips as rows [object id, name, start, end]. Positions are bar numbers as Live's ruler shows them, counted from 1 by the Live Set's time signature; 17.5 is halfway through bar 17, and a clip's end is where the next bar after it begins. Bars are counted by the time signature the Live Set has now; a change of time signature along the arrangement cannot be read. Tracks with no arrangement clips are left out, and so are Session View clips, group tracks (the clips are on the tracks inside), return tracks and Main. If the clips would be too many to list, it gives only the number of clips and the first and last bar for each track, and says to ask again for less. Use tracks (object ids from read_set) and from_bar and to_bar to ask for less.",
        params: {
            type: "object",
            properties: {
                tracks: {
                    type: "array",
                    items: { type: "string" },
                    description: "Object ids of the tracks to read, such as t3. Every track when left out.",
                },
                from_bar: { type: "number", description: "Only clips that reach into the Live Set from this bar on." },
                to_bar: { type: "number", description: "Only clips that start before this bar." },
            },
        },
        run: (args) => read(client, args),
    };
}

// The bar number for a position in beats: bar 1 is the start, and a bar holds as many beats
// as the time signature says (3 in 6/8, since a beat is a quarter note).
function barOf(beats: number, beatsPerBar: number) {
    return Math.round((beats / beatsPerBar + 1) * 1000) / 1000;
}

// Reads in two messages, whatever the size of the Live Set.
async function read(client: Client, args: Record<string, unknown>) {
    if (args.tracks !== undefined && (!Array.isArray(args.tracks) || args.tracks.some((id) => typeof id !== "string"))) {
        throw new Error("tracks must be a list of object ids");
    }
    const asked = args.tracks as string[] | undefined;
    const fromBar = numberArg(args, "from_bar");
    const toBar = numberArg(args, "to_bar");

    const [numerator, denominator, tracks, cuePoints] = (await client.send([
        getProp("song", "signature_numerator"),
        getProp("song", "signature_denominator"),
        getProp("song", "tracks"),
        getProp("song", "cue_points"),
    ])) as [number, number, LiveTrack[], LiveCuePoint[]];
    const beatsPerBar = (numerator * 4) / denominator;
    const bar = (beats: number) => barOf(beats, beatsPerBar);

    // Every track gets its id, in Live's order, so the ids match read_set; a group track holds
    // no clips of its own, and Live refuses to give it any.
    const trackIds = tracks.map((track) => client.objectId("t", track.id));
    const holdsClips = tracks.map((track) => track.type !== "group");
    for (const id of asked ?? []) {
        if (!trackIds.some((trackId, index) => trackId === id && holdsClips[index])) {
            throw new Error(`${id} is not a track that holds arrangement clips. Use the object ids of audio and MIDI tracks from read_set; group tracks, return tracks and Main have none.`);
        }
    }
    const chosen = tracks.filter((_, index) => holdsClips[index] && (!asked || asked.includes(trackIds[index] as string)));

    const clipLists = (await client.sendEach(chosen, (track) => [
        getProp("track", "arrangement_clips", track.id),
    ])) as [LiveClip[]][];

    // Clips that reach into the bars asked for, in the order Live gives them.
    const from = fromBar === undefined ? -Infinity : (fromBar - 1) * beatsPerBar;
    const to = toBar === undefined ? Infinity : (toBar - 1) * beatsPerBar;
    const withClips = chosen
        .map((track, index) => ({
            track,
            id: client.objectId("t", track.id),
            clips: (clipLists[index] as [LiveClip[]])[0].filter((clip) => clip.end_time > from && clip.start_time < to),
        }))
        .filter(({ clips }) => clips.length > 0);

    const locators = cuePoints.map((cue) => ({ name: cue.name, bar: bar(cue.time) }));
    const listed = JSON.stringify({
        locators,
        tracks: withClips.map(({ track, id, clips }) => ({
            id,
            name: track.name,
            clips: clips.map((clip) => [client.objectId("c", clip.id), clip.name, bar(clip.start_time), bar(clip.end_time)]),
        })),
    });
    if (listed.length <= RESULT_LIMIT) return listed;

    return JSON.stringify({
        locators,
        tracks: withClips.map(({ track, id, clips }) => ({
            id,
            name: track.name,
            clip_count: clips.length,
            first_bar: bar(Math.min(...clips.map((clip) => clip.start_time))),
            last_bar: bar(Math.max(...clips.map((clip) => clip.end_time))),
        })),
        note: "Too many clips to list. Ask again with tracks (object ids) for some of these tracks, or with from_bar and to_bar for a part of the song.",
    });
}
