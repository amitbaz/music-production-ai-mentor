// The lines of a streamed reply, as they arrive. A line can be cut across two reads, so the end
// of each read waits for the next.
export async function* lines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    const decoder = new TextDecoder();
    // The end of what was read so far, when it stops in the middle of a line
    let rest = "";
    for await (const bytes of body) {
        const read = (rest + decoder.decode(bytes, { stream: true })).split("\n");
        rest = read.pop() ?? "";
        yield* read;
    }
    // The last line has no newline after it when the stream ends there.
    yield rest + decoder.decode();
}
