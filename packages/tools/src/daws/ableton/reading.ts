// What the reading tools share.

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
