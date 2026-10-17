import type { Tool } from "@mentor/harness";
import { type Client, getProp } from "../../client.ts";
import type { LiveBrowserItem } from "../../live.ts";

// Where each kind of thing is kept in Live's browser, so a search for one does not walk the others.
const ROOTS = {
    device: ["instruments", "audio_effects", "midi_effects", "max_for_live", "plugins"],
    preset: ["instruments", "audio_effects", "midi_effects", "drums", "sounds", "user_library"],
    sample: ["samples", "user_library"],
};
// The file names of the samples Live's browser holds.
export const SAMPLE_FILE = /\.(wav|aiff?|mp3|flac|ogg|m4a)$/i;
// Devices and plug-ins come before samples, so a large sample library does not fill the walk first.
export const ALL_ROOTS = ["instruments", "audio_effects", "midi_effects", "max_for_live", "plugins", "drums", "sounds", "samples", "user_library"];
// The plug-ins folder holds a folder per format. The one to load is VST3, then AU, then VST2.
const formatRank = (folder: string) => (folder.startsWith("VST3") ? 0 : /^au/i.test(folder) ? 1 : 2);

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
            "Finds devices, presets and samples in Ableton Live's browser by name: every item whose name contains `query`, ignoring case. Each match is {name, kind, path}: kind is device, preset, sample or folder, and path is its browser path, the folders down to it and then its name, such as \"audio_effects/Glue Compressor/Glue Punch.adv\". Give kind to look only for devices, presets or samples; this is also faster. Devices include the user's third-party plug-ins, found by maker or name and each given once, in the format to load; a plug-in is loaded with edit_devices load by its path, never added by name. Use it to find the exact name of a native device before adding it with edit_devices, to find a plug-in, preset, kit or sample to load with edit_devices, giving its path as item, or to tell the user where something is. It looks at the first 5000 items, shallowest first, and says when it stopped early.",
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
// loadable item in the sample folders or named like an audio file. A plug-in is a device, whatever
// Live marks it.
function kindOf(item: LiveBrowserItem, root: string): Kind | "folder" | undefined {
    if (item.is_device || (root === "plugins" && item.is_loadable)) return "device";
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
    // The format folders go best first, so the walk meets the copy of a plug-in to keep first, since
    // Live puts every copy at the same depth.
    let level: Found[] = rootItems.flatMap((items, index) => {
        const root = roots[index] as string;
        const listed = items ?? [];
        const sorted = root === "plugins" ? listed.toSorted((a, b) => formatRank(a.name) - formatRank(b.name)) : listed;
        return sorted.map((item) => ({ item, path: root }));
    });
    // The plug-ins met so far, by maker folder and name. A VST2 name carries the maker, such as
    // "FabFilter Pro-C 2", so a name alone matches one too.
    const metPlugins = new Set<string>();
    let seen = 0;
    while (level.length > 0) {
        for (const { item, path } of level) {
            seen++;
            const root = path.split("/")[0] as string;
            const itemKind = kindOf(item, root);
            if (!itemKind || (kind !== undefined && itemKind !== kind)) continue;
            // A plug-in is looked for by its maker and name, and a copy met after the first is passed
            // over whether it matches or not, so the query cannot change which copy is given.
            let named = item.name;
            if (root === "plugins" && itemKind === "device") {
                named = `${path.split("/").at(-1)} ${item.name}`;
                if (metPlugins.has(named) || metPlugins.has(item.name)) continue;
                metPlugins.add(named);
            }
            if (!named.toLowerCase().includes(wanted)) continue;
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
