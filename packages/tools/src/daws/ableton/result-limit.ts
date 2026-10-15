// The most characters a tool result may hold (ADR 0018). The harness cuts past it, so a tool
// whose answer grows with the Live Set measures its own answer and answers short instead.
export const RESULT_LIMIT = 40_000;
