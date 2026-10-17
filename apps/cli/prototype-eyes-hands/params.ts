// PROTOTYPE (#70): a plug-in's parameters as Live gives them: value, min, max and Live's display text.
// Usage: params.ts <track name> <device name> [param=normalised ...]   (the setting is done through the API)
import { createClient, getProp, setProp, strForValue } from "../../../packages/tools/src/daws/ableton/client.ts";
const client = createClient(process.env.ABLETON_ADDRESS, process.env.ABLETON_PASSWORD);
const [trackName, deviceName, ...sets] = process.argv.slice(2);
type Obj = { id: string; name: string };
const [tracks] = (await client.send([getProp("song", "tracks")])) as [Obj[]];
const track = trackName === "Main" ? ((await client.send([getProp("song", "master_track")])) as [Obj])[0] : tracks.find((t) => t.name === trackName)!;
const [devices] = (await client.send([getProp("track", "devices", track.id)])) as [Obj[]];
const device = devices.find((d) => d.name === deviceName) ?? (console.error(devices.map((d) => d.name)), process.exit(1));
const [params] = (await client.send([getProp("device", "parameters", device.id)])) as [(Obj & { value: number })[]];
for (const s of sets) {
    const [name, v] = s.split("=");
    const p = params.find((p) => p.name === name)!;
    await client.send([setProp("device-parameter", "value", Number(v), p.id)]);
}
const [fresh] = (await client.send([getProp("device", "parameters", device.id)])) as [(Obj & { value: number })[]];
const shown = fresh.slice(0, Number(process.env.N ?? 20));
const texts = await client.send(shown.map((p) => strForValue(p.id, p.value)));
const ranges = await client.send(shown.flatMap((p) => [getProp("device-parameter", "min", p.id), getProp("device-parameter", "max", p.id)]));
console.log(JSON.stringify(shown.map((p, i) => ({ name: p.name, value: +p.value.toFixed(4), text: texts[i], range: [ranges[2 * i], ranges[2 * i + 1]] }))));
process.exit(0);
