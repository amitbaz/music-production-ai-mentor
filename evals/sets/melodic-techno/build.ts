// Builds the melodic techno base Set through the mentor's own Ableton tools, into the Live Set open
// in Live. 124 BPM, A minor, Am-F-C-G; Intro 1-8, Breakdown 9-16, Drop 17-32. No fault is planted:
// problems for the listening evals are planted on top of this Set as parameter changes (#54).
//
// Run from apps/cli, where the Remote Script's address and password are:
//     cd apps/cli && node --env-file-if-exists=.env ../../evals/sets/melodic-techno/build.ts [--clear]
// The Set open in Live must be empty; --clear deletes whatever tracks it has first. Live gives a
// script no way to save: the saved result is "set-1 Project/set-1.als" next to this file.
import { createAbleton } from "../../../packages/tools/src/daws/ableton/ableton.ts";

const tools = createAbleton({ address: process.env.ABLETON_ADDRESS, password: process.env.ABLETON_PASSWORD });
type Track = { id: string; name: string; kind: string; devices?: { id: string; name: string }[] };
async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    const out = await tool.run(args);
    try { return typeof out === "string" ? JSON.parse(out) : out; } catch { return out; }
}
const readSet = async () => (await call("read_set")) as { tracks: Track[] };
const log = (step: string, r: unknown) => console.log(step, JSON.stringify(r).slice(0, 300));

const TEMPO = 124;
const MIDI = ["Kick", "Hats", "Shaker", "Clap", "Bass", "Arp", "Pad"] as const;
const ALL = [...MIDI, "FX"] as const;
const FX_DIR = "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Core Library/Samples/One Shots/FX";
const RISER = { file: `${FX_DIR}/Riser White Noise.wav`, seconds: 3.807687 };
const IMPACT = { file: `${FX_DIR}/Impact Flanged.wav` };

// 1. An empty Set, or --clear. Live keeps at least one track, so the last old one goes after the new ones exist.
let s = await readSet();
const old = s.tracks.filter((t) => t.kind !== "main");
if (old.length && !process.argv.includes("--clear")) {
    console.error(`The Set open in Live has ${old.length} tracks. Open an empty Set, or run with --clear to delete them.`);
    process.exit(1);
}
const keep = old[old.length - 1];
if (old.length > 1) log("delete", await call("delete", { ids: old.filter((t) => t !== keep).map((t) => t.id) }));
log("create", await call("edit_tracks", { changes: [...MIDI.map((n) => ({ action: "create", kind: "midi", name: n })), { action: "create", kind: "audio", name: "FX" }] }));
if (keep) log("delete", await call("delete", { ids: [keep.id] }));
s = await readSet();
const T = Object.fromEntries(ALL.map((n) => [n, s.tracks.find((t) => t.name === n)!]));
// The user's default track may add devices to a new track; the base has none but its own.
const defaults = ALL.flatMap((n) => (T[n]!.devices ?? []).map((d) => d.id));
if (defaults.length) log("delete default devices", await call("delete", { ids: defaults }));

// 2. Instruments and effects: Drift on every MIDI track, stock Delay and Reverb where the sound needs space.
log("add devices", await call("edit_devices", { edits: [
    ...MIDI.map((n) => ({ action: "add", name: "Drift", to: T[n]!.id })),
    { action: "add", name: "Delay", to: T.Arp!.id }, { action: "add", name: "Reverb", to: T.Arp!.id },
    { action: "add", name: "Reverb", to: T.Pad!.id }, { action: "add", name: "Reverb", to: T.Clap!.id },
] }));
s = await readSet();
const device = (track: string, name: string) => (s.tracks.find((t) => t.name === track)!.devices ?? []).find((d) => d.name === name)!.id;
const D = Object.fromEntries(MIDI.map((n) => [n, device(n, "Drift")]));

// Drift parameters, in the units Live shows. Env 2 modulates pitch and filter (Mod Amt 1).
const sounds: Record<string, Record<string, number | string>> = {
    Kick: { "Osc 1 Wave": "Sine", "Osc 1 Gain": 0, "Osc 2 On": "Off", "Noise On": "Off", "LP Freq": 20000, "LP Mod Amt 1": 0,
        "Env 1 Attack": 0, "Env 1 Decay": 350, "Env 1 Sustain": 0, "Env 1 Release": 50, "Env 2 Attack": 0, "Env 2 Decay": 50, "Env 2 Sustain": 0, "Env 2 Release": 10,
        "Pitch Mod Amt 1": 65, "Vel > Vol": 0, Volume: 0, Spread: 0, Drift: 0 },
    Hats: { "Osc 1 On": "Off", "Osc 2 On": "Off", "Noise On": "On", "Noise Gain": 0, "HP Freq": 8000, "LP Freq": 20000, "LP Mod Amt 1": 0,
        "Env 1 Attack": 0, "Env 1 Decay": 60, "Env 1 Sustain": 0, "Env 1 Release": 40, "Vel > Vol": 60, Volume: 0, Spread: 0 },
    Shaker: { "Osc 1 On": "Off", "Osc 2 On": "Off", "Noise On": "On", "Noise Gain": 0, "HP Freq": 3000, "LP Freq": 9000, "LP Mod Amt 1": 0,
        "Env 1 Attack": 5, "Env 1 Decay": 45, "Env 1 Sustain": 0, "Env 1 Release": 30, "Vel > Vol": 100, Volume: 0, Spread: 40 },
    Clap: { "Osc 1 On": "Off", "Osc 2 On": "Off", "Noise On": "On", "Noise Gain": 0, "HP Freq": 900, "LP Freq": 6500, "LP Mod Amt 1": 0,
        "Env 1 Attack": 0, "Env 1 Decay": 110, "Env 1 Sustain": 0, "Env 1 Release": 140, "Vel > Vol": 30, Volume: 0, Spread: 50 },
    Bass: { "Osc 1 Wave": "Saw", "Osc 1 Gain": -2, "Osc 2 On": "On", "Osc 2 Wave": "Sine", "Osc 2 Oct": -1, "Osc 2 Gain": -2, "Noise On": "Off",
        "LP Freq": 220, "LP Mod Amt 1": 45, "Env 2 Attack": 0, "Env 2 Decay": 180, "Env 2 Sustain": 0,
        "Env 1 Attack": 1, "Env 1 Decay": 200, "Env 1 Sustain": 0, "Env 1 Release": 60, "Vel > Vol": 0, Volume: 0, Spread: 0, Drift: 0, "Glide Time": 0 },
    Arp: { "Osc 1 Wave": "Saw", "Osc 1 Gain": -3, "Osc 2 On": "On", "Osc 2 Wave": "Saw", "Osc 2 Oct": 0, "Osc 2 Detune": 0.12, "Osc 2 Gain": -4, "Noise On": "Off",
        "LP Freq": 900, "LP Mod Amt 1": 55, "Env 2 Attack": 0, "Env 2 Decay": 160, "Env 2 Sustain": 0,
        "Env 1 Attack": 1, "Env 1 Decay": 180, "Env 1 Sustain": 0, "Env 1 Release": 120, "Vel > Vol": 40, Volume: -3, Spread: 100 },
    Pad: { "Osc 1 Wave": "Saw", "Osc 1 Gain": -4, "Osc 2 On": "On", "Osc 2 Wave": "Saw", "Osc 2 Oct": 0, "Osc 2 Detune": 0.25, "Osc 2 Gain": -4, "Noise On": "Off",
        "LP Freq": 800, "LP Mod Amt 1": 10, "Env 1 Attack": 400, "Env 1 Decay": 1000, "Env 1 Sustain": 90, "Env 1 Release": 900, "Vel > Vol": 0, Volume: -6, Spread: 100 },
};
const volumes: Record<string, number> = { Kick: 0, Hats: -16, Shaker: -20, Clap: -11, Bass: -6, Arp: -11, Pad: -16, FX: -10 };
const effects = [
    { target: device("Arp", "Delay"), parameter: "Dry/Wet", value: 28 }, { target: device("Arp", "Delay"), parameter: "Feedback", value: 45 },
    { target: device("Arp", "Reverb"), parameter: "Decay Time", value: 2500 }, { target: device("Arp", "Reverb"), parameter: "Dry/Wet", value: 18 },
    { target: device("Pad", "Reverb"), parameter: "Decay Time", value: 5000 }, { target: device("Pad", "Reverb"), parameter: "Dry/Wet", value: 35 },
    { target: device("Clap", "Reverb"), parameter: "Decay Time", value: 1200 }, { target: device("Clap", "Reverb"), parameter: "Dry/Wet", value: 22 },
];
const set = await call("set_parameters", { changes: [
    ...MIDI.flatMap((n) => Object.entries(sounds[n]!).map(([parameter, value]) => ({ target: D[n], parameter, value }))),
    ...ALL.map((n) => ({ target: T[n]!.id, parameter: "volume", value: volumes[n] })),
    ...effects,
] });
const refused = (set.changes ?? []).filter((line: string) => !line.includes("→"));
console.log("set_parameters:", refused.length ? refused.join("\n") : `${set.changes.length} changed`);

// 3. Notes, one bar at a time. Pitches are MIDI numbers as Live names them (60 = C3).
type Note = { pitch: number; start: number; length: number; velocity: number };
const bar = (notes: [number, number, number, number][]): Note[] => notes.map(([pitch, start, length, velocity]) => ({ pitch, start, length, velocity }));
const roots = [45, 41, 48, 43]; // A1 F1 C2 G1
const triads = [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]]; // Am F C G
const kick = bar([[31, 0, 0.3, 120], [31, 1, 0.3, 120], [31, 2, 0.3, 120], [31, 3, 0.3, 120]]); // G0
const hats = bar([[72, 0.5, 0.1, 95], [72, 1.5, 0.1, 95], [72, 2.5, 0.1, 95], [72, 3.5, 0.1, 95]]);
const shaker = bar(Array.from({ length: 16 }, (_, i) => [72, i / 4, 0.1, [50, 85, 60, 95][i % 4]!] as [number, number, number, number]));
const clap = bar([[50, 1, 0.25, 110], [50, 3, 0.25, 110]]);
const bass = (i: number) => { const p = roots[i % 4]!; return bar([[p, 0.5, 0.35, 110], [p, 1.5, 0.35, 110], [p, 2.5, 0.35, 110], [p, 3.5, 0.35, 110], [p, 3.75, 0.2, 90]]); };
const arp = (i: number) => {
    const [a, b, c] = triads[i % 4]! as [number, number, number];
    const seq = [a + 12, c + 12, a + 24, b + 24, c + 24, b + 24, a + 24, c + 12];
    return bar(seq.flatMap((p, k) => [[p, k / 4, 0.2, k % 2 ? 80 : 100], [p, 2 + k / 4, 0.2, k % 2 ? 80 : 100]] as [number, number, number, number][]));
};
const pad = (i: number) => bar(triads[i % 4]!.map((p) => [p, 0, 4, 90] as [number, number, number, number]));
// Clips: track, first bar, length in bars, the notes of bar i.
const clips: [string, number, number, (i: number) => Note[]][] = [
    ["Kick", 1, 8, () => kick], ["Kick", 17, 16, () => kick],
    ["Hats", 1, 8, () => hats], ["Hats", 17, 16, () => hats],
    ["Shaker", 13, 4, () => shaker], ["Shaker", 17, 16, () => shaker],
    ["Clap", 17, 16, () => clap],
    ["Bass", 5, 4, bass], ["Bass", 17, 16, bass],
    ["Arp", 9, 8, arp], ["Arp", 17, 16, arp],
    ["Pad", 1, 8, pad], ["Pad", 9, 8, pad], ["Pad", 17, 16, pad],
];
const made = await call("edit_arrangement", { edits: clips.map(([n, b, len]) => ({ action: "create_clip", track: T[n]!.id, bar: b, bars: len, name: `${n} ${b}-${b + len - 1}` })) });
for (const [i, [n, , len, pattern]] of clips.entries()) {
    const add = Array.from({ length: len }, (_, k) => pattern(k).map((note) => ({ ...note, start: note.start + 4 * k }))).flat();
    const written = await call("write_notes", { clip: made.edits[i].clip, add });
    console.log(`notes ${n}: ${(written.added ?? []).length} of ${add.length}`);
}

// 4. The riser ends on bar 17 and the impact lands on it. edit_arrangement makes MIDI clips only, so the
// audio clips go through live_change and the Remote Script's create_audio_clip, which takes named arguments.
const beat = (b: number) => (b - 1) * 4;
for (const [file, position] of [[RISER.file, beat(17) - (RISER.seconds * TEMPO) / 60], [IMPACT.file, beat(17)]] as [string, number][]) {
    const clip = await call("live_change", { object: T.FX!.id, function: "create_audio_clip", args: { file_path: file, position } });
    console.log("audio clip", clip.result?.name, "from beat", clip.result?.start_time);
}
log("locators", await call("edit_arrangement", { edits: [{ action: "add_locator", bar: 1, name: "Intro" }, { action: "add_locator", bar: 9, name: "Breakdown" }, { action: "add_locator", bar: 17, name: "Drop" }] }));
log("transport", await call("transport", { tempo: TEMPO, loop_from_bar: 1, loop_to_bar: 33, jump_to_bar: 1 }));
console.log("Built. Save it in Live next to this script.");
process.exit(0);
