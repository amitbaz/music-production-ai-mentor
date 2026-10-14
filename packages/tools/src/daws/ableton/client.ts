// Our client for the ableton-js Remote Script, which listens inside Live on a local WebSocket.
const ADDRESS = "ws://127.0.0.1:39031";

// One call on a Live object: `ns` is the kind of object, `nsid` the script's id for it.
export type Command = { ns: string; nsid?: string; name: string; args?: unknown };

type Reply = { event: string; uuid: string | null; data: unknown };
type Result = { ok: true; data: unknown } | { ok: false; error: string; errorType: string };
type Waiting = { resolve: (results: Result[]) => void; reject: (error: Error) => void };

export type Client = ReturnType<typeof createClient>;

export function createClient() {
    // Opened on the first send, not before.
    let connection: Promise<WebSocket> | undefined;
    const waiting = new Map<string, Waiting>();
    let nextUuid = 1;
    // Object ids last as long as the connection: script id -> object id, and a count per kind.
    const objectIds = new Map<string, string>();
    const counts = new Map<string, number>();

    function connect() {
        return new Promise<WebSocket>((resolve, reject) => {
            const socket = new WebSocket(ADDRESS);
            socket.addEventListener("message", (event) => {
                const reply = JSON.parse(String(event.data)) as Reply;
                // The script greets each new connection before it takes commands.
                if (reply.event === "connect") resolve(socket);
                const wait = reply.uuid === null ? undefined : waiting.get(reply.uuid);
                if (!wait || reply.uuid === null) return;
                waiting.delete(reply.uuid);
                if (reply.event === "result") wait.resolve(reply.data as Result[]);
                else wait.reject(new Error(String(reply.data)));
            });
            socket.addEventListener("close", () => {
                connection = undefined;
                objectIds.clear();
                counts.clear();
                const error = new Error("The connection to Ableton Live was lost");
                for (const wait of waiting.values()) wait.reject(error);
                waiting.clear();
                reject(new Error("Could not reach Ableton Live"));
            });
        });
    }

    return {
        // Sends several commands in one message and returns their results in order.
        async send(commands: Command[]): Promise<unknown[]> {
            connection ??= connect();
            const socket = await connection;
            const uuid = String(nextUuid++);
            const results = await new Promise<Result[]>((resolve, reject) => {
                waiting.set(uuid, { resolve, reject });
                socket.send(JSON.stringify({ uuid, commands }));
            });
            return results.map((result) => {
                if (!result.ok) throw new Error(result.error);
                return result.data;
            });
        },

        // The short id for an object the script returned, such as t17: a letter for the kind
        // and a number. The same object gets the same id for as long as the connection lasts.
        objectId(letter: string, scriptId: string) {
            let id = objectIds.get(scriptId);
            if (!id) {
                const count = (counts.get(letter) ?? 0) + 1;
                counts.set(letter, count);
                id = `${letter}${count}`;
                objectIds.set(scriptId, id);
            }
            return id;
        },
    };
}

export function getProp(ns: string, prop: string, nsid?: string): Command {
    return { ns, nsid, name: "get_prop", args: { prop } };
}
