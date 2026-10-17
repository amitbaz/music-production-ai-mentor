// PROTOTYPE (#70): lists Live's plugins browser folder, two levels, to find a plug-in's path.
import { createClient, getProp } from "../../../packages/tools/src/daws/ableton/client.ts";
const client = createClient(process.env.ABLETON_ADDRESS, process.env.ABLETON_PASSWORD);
const want = (process.argv[2] ?? "").toLowerCase();
const [top] = (await client.send([getProp("browser", "plugins")])) as [{ id: string; name: string; is_folder: boolean }[]];
for (const a of top) {
    const [kids] = a.is_folder ? ((await client.send([getProp("browser-item", "children", a.id)])) as [{ id: string; name: string; is_folder: boolean }[]]) : [[]];
    for (const b of kids) {
        if (!b.is_folder) { if (`${a.name}/${b.name}`.toLowerCase().includes(want)) console.log(`plugins/${a.name}/${b.name}`); continue; }
        const [leaves] = (await client.send([getProp("browser-item", "children", b.id)])) as [{ name: string }[]];
        for (const c of leaves) if (`${b.name}/${c.name}`.toLowerCase().includes(want)) console.log(`plugins/${a.name}/${b.name}/${c.name}`);
    }
}
process.exit(0);
