import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../../client.ts";
import { ADDRESS, liveSet, StandInSocket, useStandIn } from "../../stand-in-live.ts";
import { findInBrowser } from "./find-in-browser.ts";

// A small browser: devices, a device with presets, a folder of sounds and some samples.
function setup(t: TestContext, extra: Record<string, { name: string; children?: unknown[]; loadable?: boolean; device?: boolean }[]> = {}) {
    const { live, browser } = liveSet({ tempo: 120, numerator: 4, denominator: 4 });
    browser({
        instruments: [
            { name: "Operator", device: true },
            { name: "Simpler", device: true },
        ],
        audio_effects: [
            {
                name: "Dynamics",
                children: [
                    { name: "Compressor", device: true, children: [{ name: "Bass Compressor.adv", loadable: true }] },
                    { name: "Glue Compressor", device: true },
                ],
            },
            { name: "EQ Eight", device: true },
        ],
        sounds: [{ name: "Bass", children: [{ name: "Sub Bass.adg", loadable: true }] }],
        samples: [
            { name: "Kick 808.wav", loadable: true },
            { name: "Loops", children: [{ name: "Bass Loop.wav", loadable: true }] },
        ],
        ...extra,
    });
    useStandIn(t, live);
    const tool = findInBrowser(createClient(ADDRESS));
    return async (args: Record<string, unknown>) => JSON.parse(await tool.run(args)) as { matches: { name: string; kind: string; path: string }[]; note?: string };
}

const requestedProps = () =>
    StandInSocket.opened.flatMap((socket) =>
        socket.sent.flatMap((request) => request.commands.filter((command) => command.ns === "browser").map((command) => (command.args as { prop: string }).prop)),
    );

test("find_in_browser finds by name, ignoring case, and says what kind each match is and where it is", async (t) => {
    const find = setup(t);

    const { matches } = await find({ query: "COMPRESSOR" });

    assert.deepEqual(matches, [
        { name: "Compressor", kind: "device", path: "audio_effects/Dynamics/Compressor" },
        { name: "Glue Compressor", kind: "device", path: "audio_effects/Dynamics/Glue Compressor" },
        { name: "Bass Compressor.adv", kind: "preset", path: "audio_effects/Dynamics/Compressor/Bass Compressor.adv" },
    ]);
});

test("find_in_browser tells devices, presets, samples and folders apart", async (t) => {
    const find = setup(t);

    const { matches } = await find({ query: "bass" });

    assert.deepEqual(
        Object.fromEntries(matches.map((match) => [match.name, match.kind])),
        { Bass: "folder", "Bass Compressor.adv": "preset", "Sub Bass.adg": "preset", "Bass Loop.wav": "sample" },
    );
});

test("find_in_browser with a kind gives only that kind, and does not walk the rest of the browser", async (t) => {
    const find = setup(t);

    const { matches } = await find({ query: "bass", kind: "sample" });

    assert.deepEqual(matches, [{ name: "Bass Loop.wav", kind: "sample", path: "samples/Loops/Bass Loop.wav" }]);
    assert.equal(requestedProps().includes("audio_effects"), false);
    assert.equal(requestedProps().includes("instruments"), false);
});

// Plug-ins as Live's browser holds them, by format and then maker, in Live's order. A VST2 name
// carries the maker, and its folder is not always the maker. Nothing here is marked a device, since
// what Live marks a plug-in has not been seen.
const plugins = [
    {
        name: "AUv2",
        children: [
            { name: "FabFilter", children: [{ name: "Pro-C 2", loadable: true }, { name: "Pro-R 2", loadable: true }] },
            { name: "Other", children: [{ name: "Pro-C 2", loadable: true }] },
        ],
    },
    { name: "VST3", children: [{ name: "FabFilter", children: [{ name: "Pro-C 2", loadable: true }] }] },
    {
        name: "VST",
        children: [{ name: "Local", children: [{ name: "FabFilter Pro-C 2", loadable: true }, { name: "FabFilter Pro-R 2", loadable: true }, { name: "Old Pro", loadable: true }] }],
    },
];

test("find_in_browser counts plug-ins as devices, and gives each plug-in once, as VST3, else AU, else VST2", async (t) => {
    const find = setup(t, { plugins });

    const { matches } = await find({ query: "pro", kind: "device" });

    assert.deepEqual(matches, [
        { name: "Pro-C 2", kind: "device", path: "plugins/VST3/FabFilter/Pro-C 2" },
        { name: "Pro-R 2", kind: "device", path: "plugins/AUv2/FabFilter/Pro-R 2" },
        { name: "Pro-C 2", kind: "device", path: "plugins/AUv2/Other/Pro-C 2" },
        { name: "Old Pro", kind: "device", path: "plugins/VST/Local/Old Pro" },
    ]);
});

test("find_in_browser does not count the plug-in copies it leaves out toward the limit", async (t) => {
    const find = setup(t, { plugins });

    const { matches } = await find({ query: "pro", kind: "device", limit: 3 });

    assert.deepEqual(
        matches.map((match) => match.path),
        ["plugins/VST3/FabFilter/Pro-C 2", "plugins/AUv2/FabFilter/Pro-R 2", "plugins/AUv2/Other/Pro-C 2"],
    );
});

test("find_in_browser with no kind looks at plug-ins before samples, so a large library at the same depth does not hide them", async (t) => {
    const filler = Array.from({ length: 5_000 }, (_, index) => ({ name: `Filler ${index}.wav`, loadable: true }));
    const find = setup(t, { plugins, samples: [{ name: "Library", children: [{ name: "Pack", children: filler }] }] });

    const result = await find({ query: "pro-c" });

    assert.deepEqual(result.matches[0], { name: "Pro-C 2", kind: "device", path: "plugins/VST3/FabFilter/Pro-C 2" });
});

test("find_in_browser gives an empty list when nothing matches", async (t) => {
    const find = setup(t);

    assert.deepEqual(await find({ query: "Wavetable" }), { matches: [] });
});

test("find_in_browser stops at the limit and says so", async (t) => {
    const find = setup(t);

    const result = await find({ query: "e", limit: 2 });

    assert.equal(result.matches.length, 2);
    assert.match(result.note ?? "", /first 2 matches.*more exact name/i);
});

test("find_in_browser stops after a number of items and says folders may not have been searched", async (t) => {
    const filler = Array.from({ length: 5_000 }, (_, index) => ({ name: `Filler ${index}.wav`, loadable: true }));
    const find = setup(t, { user_library: [...filler, { name: "Deep", children: [{ name: "Needle.wav", loadable: true }] }] });

    const result = await find({ query: "needle" });

    assert.deepEqual(result.matches, []);
    assert.match(result.note ?? "", /stopped after 5000 items.*folders.*not been searched/i);
});

test("find_in_browser stops asking folders for their children once a wide level reaches the item limit", async (t) => {
    const folders = Array.from({ length: 600 }, (_, folder) => ({
        name: `Folder ${folder}`,
        children: Array.from({ length: 20 }, (_, item) => ({ name: folder === 599 ? "Needle.wav" : `Item ${folder}-${item}.wav`, loadable: true })),
    }));
    const find = setup(t, { user_library: folders });

    const result = await find({ query: "needle" });

    const asked = StandInSocket.opened.flatMap((socket) => socket.sent.flatMap((request) => request.commands.filter((command) => command.ns === "browser-item")));
    assert.ok(asked.length < 600, `asked ${asked.length} folders`);
    assert.deepEqual(result.matches, []);
    assert.match(result.note ?? "", /stopped after 5000 items/i);
});

test("find_in_browser needs a name to look for, and a kind it knows", async (t) => {
    const find = setup(t);

    for (const query of [undefined, "", "  ", 3]) {
        await assert.rejects(async () => find({ query }), /query must be some text/i);
    }
    await assert.rejects(async () => find({ query: "a", kind: "folder" }), /kind must be device, preset or sample/i);
    await assert.rejects(async () => find({ query: "a", limit: 0 }), /limit must be a whole number from 1 to 50/i);
});

test("find_in_browser is not marked as needing approval", (t) => {
    setup(t);

    assert.equal(findInBrowser(createClient(ADDRESS)).needsApproval, undefined);
});
