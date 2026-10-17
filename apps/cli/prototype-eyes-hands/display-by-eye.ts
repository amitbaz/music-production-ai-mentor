// PROTOTYPE (#70), throwaway: plays a drum loop through Pro-C 2 on the Prototype track in four states,
// captures the plug-in's display, and asks models what the compressor is doing to the sound.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient, getProp, setProp } from "../../../packages/tools/src/daws/ableton/client.ts";

const OUT = process.env.OUT ?? "/tmp";
const MODELS = (process.env.MODELS ?? "gemini:gemini-3.5-flash-lite,claude:claude-haiku-5-5,claude:claude-sonnet-5-5").split(",");
// Threshold and Ratio normalised; playing or not. Threshold v gives -60 + 60v dB; Ratio 0.6 is 4:1.
const STATES = [
    { name: "A none", threshold: 1.0, ratio: 0.6, play: true },
    { name: "B moderate", threshold: 0.667, ratio: 0.6, play: true },
    { name: "C heavy", threshold: 0.25, ratio: 0.9, play: true },
    { name: "D stopped", threshold: 0.667, ratio: 0.6, play: false },
];
const PROMPT =
    "This is a screenshot of the FabFilter Pro-C 2 compressor plug-in window on a drum track in Ableton Live, taken while the user works. " +
    "Look at its display: the level and gain-reduction history, the meters and the curve. Tell me what the compressor is doing to the sound right now. " +
    'Answer with JSON only: {"audio_playing": boolean, "compressing": boolean, "max_gain_reduction_db": number (0 if none), ' +
    '"what_triggers_it": "which parts of the signal it reacts to, in a few words", "advice": "one sentence to the producer"}';

const client = createClient(process.env.ABLETON_ADDRESS, process.env.ABLETON_PASSWORD);
type O = { id: string; name: string };
const [tracks] = (await client.send([getProp("song", "tracks")])) as [O[]];
const track = tracks.find((t) => t.name === "Prototype")!;
const [devices] = (await client.send([getProp("track", "devices", track.id)])) as [O[]];
const device = devices.find((d) => d.name === "Pro-C 2")!;
const [params] = (await client.send([getProp("device", "parameters", device.id)])) as [O[]];
const param = (n: string) => params.find((p) => p.name === n)!.id;

function windowId() {
    const list = JSON.parse(execFileSync("osascript", ["-l", "JavaScript", `${import.meta.dirname}/eyes.js`, "windows"], { encoding: "utf8" }));
    return list.find((w: { title: string }) => w.title === "Pro-C 2/Prototype").id;
}

function capture(file: string) {
    const front = execFileSync("osascript", ["-e", 'tell application "System Events" to get name of first process whose frontmost is true'], { encoding: "utf8" }).trim();
    execFileSync("osascript", ["-e", 'tell application "Ableton Live 12 Suite" to activate']);
    execFileSync("sleep", [process.env.VISIBLE ?? "2.5"]);
    execFileSync("screencapture", ["-x", "-o", "-l", String(windowId()), file]);
    execFileSync("osascript", ["-e", `tell application "${front}" to activate`]);
}

async function ask(model: string, png: string): Promise<string> {
    const [provider, name] = model.split(":");
    if (provider === "gemini") {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${name}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
            body: JSON.stringify({ contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/png", data: png } }, { text: PROMPT }] }] }),
        });
        const j = await r.json();
        return j.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? JSON.stringify(j).slice(0, 300);
    }
    const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
            model: name,
            max_tokens: 4000,
            messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: png } }, { type: "text", text: PROMPT }] }],
        }),
    });
    const j = await r.json();
    return j.content?.map((c: { text?: string }) => c.text ?? "").join("") ?? JSON.stringify(j).slice(0, 300);
}

for (const state of STATES) {
    await client.send([setProp("device-parameter", "value", state.threshold, param("Threshold")), setProp("device-parameter", "value", state.ratio, param("Ratio"))]);
    await client.send([setProp("song", "is_playing", state.play)]);
    for (const take of [1, 2]) {
        execFileSync("sleep", [state.play ? "3" : "4"]);
        const file = `${OUT}/display-${state.name.split(" ")[0]}${take}.png`;
        const [playing] = (await client.send([getProp("song", "is_playing")])) as [boolean];
        capture(file);
        const png = readFileSync(file).toString("base64");
        const answers = await Promise.all(MODELS.map((m) => ask(m, png).catch((e) => `ERROR ${e}`)));
        console.log(`\n# ${state.name}, take ${take}, is_playing ${playing} (${file})`);
        for (const [k, m] of MODELS.entries()) {
            const raw = answers[k] as string;
            console.log(`${m}: ${raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1).replace(/\s+/g, " ")}`);
        }
    }
}
await client.send([setProp("song", "is_playing", false)]);
process.exit(0);
