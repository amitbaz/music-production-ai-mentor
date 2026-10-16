import type { Tool } from "@mentor/harness";
import { type Client, getProp } from "../../client.ts";
import type { LiveBrowserItem } from "../../live.ts";

// Where each kind of thing is kept in Live's browser, so a search for one does not walk the others.
const ROOTS = {
    device: ["instruments", "audio_effects", "midi_effects", "max_for_live"],
    preset: ["instruments", "audio_effects", "midi_effects", "drums", "sounds", "user_library"],
    sample: ["samples", "user_library"],
};
// The file names of the samples Live's browser holds.
export const SAMPLE_FILE = /\.(wav|aiff?|mp3|flac|ogg|m4a)$/i;
export const ALL_ROOTS = ["instruments", "audio_effects", "midi_effects", "drums", "sounds", "samples", "user_library", "max_for_live"];

// The most items looked at, and the most folders asked for their children in one message, so a
// large library neither runs for long nor makes Live miss its answer time.
const MAX_ITEMS = 5000;
const PER_MESSAGE = 250;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

type Kind = keyof typeof ROOTS;
type Found = { item: LiveBrowserItem; path: string };

// Finds a device, preset or sample by name. Live gives a script no search, so this walks the
// browser's tree level by level and checks each name.
export function findInBrowser(client: Client): Tool {
    return {
        name: "find_in_browser",
        description:
            "Finds devices, presets and samples in Ableton Live's browser by name: every item whose name contains `query`, ignoring case. Each match is {name, kind, path}: kind is device, preset, sample or folder, and path is its browser path, the folders down to it and then its name, such as \"audio_effects/Glue Compressor/Glue Punch.adv\". Give kind to look only for devices, presets or samples; this is also faster. Use it to find the exact name of a native device before adding it with edit_devices, to find a preset, kit or sample to load with edit_devices, giving its path as item, or to tell the user where something is. It looks at the first 5000 items, shallowest first, and says when it stopped early.",
        params: {
            type: "object",
            properties: {
                query: { type: "string", description: "Part of the name to look for, such as \"compressor\" or \"808\"." },
                kind: { type: "string", enum: ["device", "preset", "sample"], description: "Only matches of this kind. Left out, folders are found too." },
                limit: { type: "number", description: `The most matches to give, from 1 to ${MAX_LIMIT}. Default ${DEFAULT_LIMIT}.` },
            },
            required: ["query"],
        },
        run: (args) => find(client, args),
    };
}

// What an item is, from the flags Live gives it. Nothing marks a sample, so a sample is any other
// loadable item in the sample folders or named like an audio file.
function kindOf(item: LiveBrowserItem, root: string): Kind | "folder" | undefined {
    if (item.is_device) return "device";
    if (!item.is_loadable) return item.is_folder ? "folder" : undefined;
    return root === "samples" || SAMPLE_FILE.test(item.name) ? "sample" : "preset";
}

async function find(client: Client, args: Record<string, unknown>) {
    const { query, kind, limit = DEFAULT_LIMIT } = args;
    if (typeof query !== "string" || query.trim() === "") throw new Error("query must be some text to look for in the names");
    if (kind !== undefined && !(typeof kind === "string" && kind in ROOTS)) throw new Error("kind must be device, preset or sample");
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        throw new Error(`limit must be a whole number from 1 to ${MAX_LIMIT}`);
    }
    const wanted = query.trim().toLowerCase();
    const roots = kind === undefined ? ALL_ROOTS : ROOTS[kind as Kind];

    const matches: { name: string; kind: string; path: string }[] = [];
    const rootItems = (await client.send(roots.map((root) => getProp("browser", root)))) as (LiveBrowserItem[] | null)[];
    let level: Found[] = rootItems.flatMap((items, index) => (items ?? []).map((item) => ({ item, path: roots[index] as string })));
    let seen = 0;
    while (level.length > 0) {
        for (const { item, path } of level) {
            seen++;
            const itemKind = kindOf(item, path.split("/")[0] as string);
            if (!itemKind || (kind !== undefined && itemKind !== kind) || !item.name.toLowerCase().includes(wanted)) continue;
            matches.push({ name: item.name, kind: itemKind, path: `${path}/${item.name}` });
            if (matches.length === limit) return answer(matches, `Stopped at the first ${limit} matches; ask again with a more exact name for others.`);
        }
        if (seen >= MAX_ITEMS) return answer(matches, `Stopped after ${MAX_ITEMS} items, so some folders have not been searched. Ask again with a more exact name, or a kind.`);

        // A device can hold presets, so it is asked for its children too.
        // Folders are asked for their children only until the items come to MAX_ITEMS, and the level is
        // cut there, so one wide level cannot bring back far more.
        const parents = level.filter(({ item }) => item.is_folder || item.is_device);
        const children: unknown[][] = [];
        let fetched = 0;
        for (let start = 0; start < parents.length && seen + fetched < MAX_ITEMS; start += PER_MESSAGE) {
            const batch = await client.sendEach(parents.slice(start, start + PER_MESSAGE), ({ item }) => [getProp("browser-item", "children", item.id)]);
            children.push(...batch);
            fetched += batch.reduce((count, [list]) => count + ((list as unknown[] | null)?.length ?? 0), 0);
        }
        level = parents
            .slice(0, children.length)
            .flatMap(({ item, path }, index) => ((children[index]?.[0] ?? []) as LiveBrowserItem[]).map((child) => ({ item: child, path: `${path}/${item.name}` })))
            .slice(0, MAX_ITEMS - seen);
    }
    return answer(matches);
}

const answer = (matches: object[], note?: string) => JSON.stringify({ matches, ...(note && { note }) });
