// What the reading and the changing tools share.

// The most characters a tool result may hold (ADR 0018). The harness cuts past it, so a tool
// whose answer grows with the Live Set measures its own answer and answers short instead.
export const RESULT_LIMIT = 40_000;

// An optional argument that must be a number, such as from_bar.
export function numberArg(args: Record<string, unknown>, name: string) {
    const value = args[name];
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} must be a number`);
    return value;
}

// How many beats a bar holds, by the time signature: 3 in 6/8, since a beat is a quarter note.
export const beatsPerBar = (numerator: number, denominator: number) => (numerator * 4) / denominator;

// The bar number for a position in beats, as Live's ruler shows it: bar 1 is the start.
export function barOf(beats: number, beatsInBar: number) {
    return Math.round((beats / beatsInBar + 1) * 1000) / 1000;
}

// Beats to four decimals, enough for a sixty-fourth note.
export const roundBeats = (beats: number) => Math.round(beats * 10000) / 10000;
