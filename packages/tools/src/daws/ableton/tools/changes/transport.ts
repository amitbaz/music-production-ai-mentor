import type { Tool } from "@mentor/harness";
import { type Client, getProp, setProp } from "../../client.ts";
import { barOf, beatsPerBar, numberArg } from "../../reading.ts";

// The range of tempos Live accepts, in beats per minute.
const MIN_TEMPO = 20;
const MAX_TEMPO = 999;

const NOTHING = "Nothing to do. Give at least one of action, jump_to_bar, loop_from_bar and loop_to_bar, loop, tempo.";

// Play, stop, the position, the loop region and the tempo of the Live Set.
export function transport(client: Client): Tool {
    return {
        name: "transport",
        description: `Controls playback of the Live Set open in Ableton Live. Give any of the arguments; they are done in this order: tempo, loop, jump_to_bar, then action. Bars are numbered as Live's ruler shows them, from 1, by the Live Set's time signature; 17.5 is halfway through bar 17. The loop region runs from loop_from_bar to where loop_to_bar begins, so 17 to 25 is eight bars in 4/4. Giving a region switches the loop on, unless loop is false. play carries on from where the Live Set is, from the bar jumped to if there is one, and does nothing while it already plays; stop does nothing while it is stopped. The result gives before and after for what was asked.`,
        params: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["play", "stop"], description: "Start or stop playback." },
                jump_to_bar: { type: "number", description: "Move the playback position to this bar." },
                loop_from_bar: { type: "number", description: "Start of the loop region, a bar. Goes with loop_to_bar." },
                loop_to_bar: { type: "number", description: "End of the loop region: the bar where it stops, not played itself. After loop_from_bar." },
                loop: { type: "boolean", description: "Switch the loop on or off." },
                tempo: { type: "number", description: `Beats per minute, ${MIN_TEMPO} to ${MAX_TEMPO}.` },
            },
        },
        run: (args) => run(client, args),
    };
}

async function run(client: Client, args: Record<string, unknown>) {
    // All checked before anything is changed.
    const { action, loop } = args;
    if (action !== undefined && action !== "play" && action !== "stop") throw new Error(`action must be play or stop, not ${String(action)}`);
    const tempo = numberArg(args, "tempo");
    if (tempo !== undefined && !(tempo >= MIN_TEMPO && tempo <= MAX_TEMPO)) {
        throw new Error(`tempo must be between ${MIN_TEMPO} and ${MAX_TEMPO} BPM, not ${tempo}`);
    }
    const jump = numberArg(args, "jump_to_bar");
    if (jump !== undefined && jump < 1) throw new Error("jump_to_bar must be 1 or more");
    const from = numberArg(args, "loop_from_bar");
    const to = numberArg(args, "loop_to_bar");
    if ((from === undefined) !== (to === undefined)) throw new Error("loop_from_bar and loop_to_bar go together: give both to set the loop region");
    if (from !== undefined && to !== undefined) {
        if (from < 1) throw new Error("loop_from_bar must be 1 or more");
        if (to <= from) throw new Error("loop_to_bar must be after loop_from_bar");
    }
    if (loop !== undefined && typeof loop !== "boolean") throw new Error("loop must be true or false");
    if ([action, jump, from, loop, tempo].every((value) => value === undefined)) throw new Error(NOTHING);

    const before = await readState(client);
    const perBar = beatsPerBar(before.numerator, before.denominator);

    const loopOn = loop ?? (from === undefined ? undefined : true);
    const playing = action === undefined ? undefined : action === "play";
    // Playing or stopping again would send Live back to where it started, so it is left alone.
    const toggle = playing !== undefined && playing !== before.playing;
    await client.send([
        ...(tempo === undefined ? [] : [setProp("song", "tempo", tempo)]),
        ...(from === undefined || to === undefined
            ? []
            : [setProp("song", "loop_start", (from - 1) * perBar), setProp("song", "loop_length", (to - from) * perBar)]),
        ...(loopOn === undefined ? [] : [setProp("song", "loop", loopOn)]),
        ...(jump === undefined ? [] : [setProp("song", "current_song_time", (jump - 1) * perBar)]),
        ...(toggle ? [{ ns: "song", name: playing ? "continue_playing" : "stop_playing" }] : []),
    ]);
    const after = await readState(client);

    const region = (state: State) => ({ on: state.loop, from_bar: barOf(state.loopStart, perBar), to_bar: barOf(state.loopStart + state.loopLength, perBar) });
    return JSON.stringify({
        ...(tempo !== undefined && { tempo: { before: before.tempo, after: after.tempo } }),
        ...((from !== undefined || loop !== undefined) && { loop: { before: region(before), after: region(after) } }),
        // The position is not read again: while it plays it has already moved on.
        ...(jump !== undefined && { position: { before: barOf(before.position, perBar), after: jump } }),
        ...(playing !== undefined && { playing: { before: before.playing, after: after.playing } }),
    });
}

type State = Awaited<ReturnType<typeof readState>>;

async function readState(client: Client) {
    const [tempo, loop, loopStart, loopLength, position, playing, numerator, denominator] = (await client.send(
        ["tempo", "loop", "loop_start", "loop_length", "current_song_time", "is_playing", "signature_numerator", "signature_denominator"].map((prop) =>
            getProp("song", prop),
        ),
    )) as [number, boolean, number, number, number, boolean, number, number];
    return { tempo, loop, loopStart, loopLength, position, playing, numerator, denominator };
}
