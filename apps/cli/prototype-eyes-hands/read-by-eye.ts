// PROTOTYPE (#70), throwaway: sets Pro-C 2 on Main through the API, captures its window, asks models
// to read five controls off the picture, and scores them against the text Live gives for each parameter.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient, getProp, setProp, strForValue } from "../../../packages/tools/src/daws/ableton/client.ts";

const OUT = process.env.OUT ?? "/tmp";
const MODELS = (process.env.MODELS ?? "gemini:gemini-3.5-flash-lite,claude:claude-haiku-5-5,claude:claude-sonnet-5-5").split(",");
// Normalised values: Threshold, Knee, Range, Style (0-7), Auto Gain (0/1).
const CONFIGS = [
    [0.7, 0.25, 1, 0, 1],
    [0.4, 0.1, 0.5, 2, 0],
    [0.9, 0.6, 0.2, 4, 1],
    [0.15, 0.0, 0.8, 5, 0],
    [0.55, 0.9, 0.35, 1, 1],
    [0.8, 0.45, 0.65, 6, 0],
    [0.3, 0.75, 0.1, 3, 1],
    [0.62, 0.33, 0.9, 7, 0],
];
const NAMES = ["Threshold", "Knee", "Range", "Style", "Auto Gain"];
const PROMPT =
    "This is a screenshot of the FabFilter Pro-C 2 compressor plug-in window. Read its current settings off the picture. Answer with JSON only, no prose: " +
    '{"threshold_db": number (-60 to 0), "knee_db": number (0 hard to 72 soft), "range_db": number (0 to 60), "style": the name shown on the Style button, "auto_gain": true if AUTO GAIN is lit, else false}';

const client = createClient(process.env.ABLETON_ADDRESS, process.env.ABLETON_PASSWORD);
type P = { id: string; name: string; value: number };
const [master] = (await client.send([getProp("song", "master_track")])) as [{ id: string }];
const [devices] = (await client.send([getProp("track", "devices", master.id)])) as [{ id: string; name: string }[]];
const device = devices.find((d) => d.name === "Pro-C 2")!;
const [all] = (await client.send([getProp("device", "parameters", device.id)])) as [P[]];
const params = NAMES.map((n) => all.find((p) => p.name === n)!);

function windowId() {
    const list = JSON.parse(execFileSync("osascript", ["-l", "JavaScript", `${import.meta.dirname}/eyes.js`, "windows"], { encoding: "utf8" }));
    return list.find((w: { title: string }) => w.title.startsWith("Pro-C 2/")).id;
}

function capture(file: string) {
    const front = execFileSync("osascript", ["-e", 'tell application "System Events" to get name of first process whose frontmost is true'], { encoding: "utf8" }).trim();
    execFileSync("osascript", ["-e", 'tell application "Ableton Live 12 Suite" to activate']);
    execFileSync("sleep", ["0.8"]);
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

const score: Record<string, Record<string, number>> = {};
for (const [i, config] of CONFIGS.entries()) {
    await client.send(params.map((p, k) => setProp("device-parameter", "value", config[k], p.id)));
    const texts = (await client.send(params.map((p, k) => strForValue(p.id, config[k])))) as string[];
    const truth = { threshold_db: Number(texts[0]), knee_db: Number(texts[1]), range_db: Number(texts[2]), style: texts[3], auto_gain: texts[4] === "On" };
    execFileSync("sleep", ["0.4"]);
    const file = `${OUT}/read-${i}.png`;
    capture(file);
    const png = readFileSync(file).toString("base64");
    const answers = await Promise.all(MODELS.map((m) => ask(m, png).catch((e) => `ERROR ${e}`)));
    console.log(`\n# config ${i} truth ${JSON.stringify(truth)}`);
    for (const [k, m] of MODELS.entries()) {
        const raw = answers[k] as string;
        let got: Record<string, unknown> = {};
        try {
            got = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
        } catch {}
        const hits = {
            threshold: Math.abs(Number(got.threshold_db) - truth.threshold_db) <= 3,
            knee: Math.abs(Number(got.knee_db) - truth.knee_db) <= 6,
            range: Math.abs(Number(got.range_db) - truth.range_db) <= 5,
            style: String(got.style).toLowerCase() === truth.style.toLowerCase(),
            auto_gain: got.auto_gain === truth.auto_gain,
        };
        score[m] ??= {};
        for (const [key, hit] of Object.entries(hits)) score[m][key] = (score[m][key] ?? 0) + (hit ? 1 : 0);
        console.log(`${m}: ${JSON.stringify(got)} ${Object.entries(hits).filter(([, h]) => !h).map(([k]) => `MISS ${k}`).join(" ")}`);
    }
}
console.log(`\n# right out of ${CONFIGS.length} (threshold ±3 dB, knee ±6 dB, range ±5 dB, style and auto gain exact)`);
for (const [m, s] of Object.entries(score)) console.log(m, JSON.stringify(s));
process.exit(0);
