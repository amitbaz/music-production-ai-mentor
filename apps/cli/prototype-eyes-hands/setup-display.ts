// PROTOTYPE (#70), throwaway: puts a drum loop on the Prototype track with its own Pro-C 2, opens the
// plug-in's window and loops the first bars, all through the mentor's tools in one connection.
import { createAbleton } from "../../../packages/tools/src/daws/ableton/ableton.ts";

const LOOP = "/Users/amitbaz/Splice/sounds/packs/Groove House 2K20/GH2K20_Construction_Kits/GH2K20_Kit2_124_A_major/GH2K20_Drum_loops/GH2K20_Kit2_Full_Drum_Loop_124.wav";
const tools = new Map(createAbleton({ address: process.env.ABLETON_ADDRESS, password: process.env.ABLETON_PASSWORD }).map((t) => [t.name, t]));
async function call(name: string, args: Record<string, unknown>) {
    const result = await tools.get(name)!.run(args, { signal: new AbortController().signal } as never);
    const text = typeof result === "string" ? result : JSON.stringify(result);
    console.log(`== ${name}\n${text.slice(0, 600)}`);
    return JSON.parse(text);
}
const set = await call("read_set", {});
const track = set.tracks.find((t: { name: string }) => t.name === "Prototype").id;
const placed = await call("edit_arrangement", { edits: [{ action: "place_sample", track, bar: 1, file: LOOP, name: "Drums" }] });
const loaded = await call("edit_devices", { edits: [{ action: "load", item: "plugins/AUv2/FabFilter/Pro-C 2", to: track }] });
const device = loaded.edits[0].device;
await call("live_change", { object: device, property: "is_editor_open", value: 1 });
await call("transport", { loop_from_bar: 1, loop_to_bar: 1 + Math.max(1, Math.round(placed.edits[0].bars ?? 2)), jump_to_bar: 1, action: "play" });
process.exit(0);
