// Our client for the ableton-js Remote Script, which listens inside Live on a local WebSocket.
import { createHmac } from "node:crypto";

// One call on a Live object: `ns` is the kind of object, `nsid` the script's id for it.
export type Command = { ns: string; nsid?: string; name: string; args?: unknown };

type Reply = { event: string; uuid: string | null; data: unknown };
type Result = { ok: true; data: unknown } | { ok: false; error: string; errorType: string };
type Waiting = { resolve: (results: Result[]) => void; reject: (error: Error) => void };

export type Client = ReturnType<typeof createClient>;

// What the user is told when Live cannot be used. Without a password Ableton was never paired;
// with one, pairing again writes a new one into both places, and Live reads its copy when it starts.
const CONTROL_SURFACE = "MusicMentor as a Control Surface in Settings → Link, Tempo & MIDI";
const NOT_PAIRED = `Ableton Live is not paired with the mentor yet. Run pnpm pair ableton, restart Live, and choose ${CONTROL_SURFACE}.`;
const REFUSED = "Ableton Live refused the password. Pair Ableton again with pnpm pair ableton, then restart Live.";
const UNREACHABLE = "Could not reach Ableton Live. Is it open, with MusicMentor chosen as a Control Surface in Settings → Link, Tempo & MIDI?";

// The address is the script's WebSocket, such as ws://127.0.0.1:39031, and the password the one
// pairing Ableton wrote into the installed script. The app gives both.
export function createClient(address: string | undefined, password?: string) {
    // Opened on the first send, not before.
    let connection: Promise<WebSocket> | undefined;
    const waiting = new Map<string, Waiting>();
    let nextUuid = 1;
    // Object ids last as long as the connection: script id -> object id, and a count per kind.
    const objectIds = new Map<string, string>();
    const counts = new Map<string, number>();

    function connect(address: string) {
        return new Promise<WebSocket>((resolve, reject) => {
            const socket = new WebSocket(address);
            const fail = (message: string) => {
                reject(new Error(message));
                socket.close();
            };
            socket.addEventListener("message", (event) => {
                const reply = JSON.parse(String(event.data)) as Reply;
                // The script greets each new connection before it takes commands. With its password
                // on, the greeting carries a salt, and the first command must prove the password.
                if (reply.event === "connect") {
                    const { requiresAuth, salt } = (reply.data ?? {}) as { requiresAuth?: boolean; salt?: string };
                    if (!requiresAuth) return resolve(socket);
                    if (!password) return fail(NOT_PAIRED);
                    const uuid = String(nextUuid++);
                    waiting.set(uuid, {
                        resolve: () => resolve(socket),
                        reject: () => fail(REFUSED),
                    });
                    const hash = createHmac("sha256", password).update(salt ?? "").digest("hex");
                    socket.send(JSON.stringify({ uuid, commands: [{ ns: "internal", name: "authenticate", args: { hash } }] }));
                    return;
                }
                const wait = reply.uuid === null ? undefined : waiting.get(reply.uuid);
                if (!wait || reply.uuid === null) return;
                waiting.delete(reply.uuid);
                if (reply.event === "result") wait.resolve(reply.data as Result[]);
                else wait.reject(new Error(String(reply.data)));
            });
            // When nothing listens, Node's WebSocket sends only an error, with no close after it.
            const lost = () => {
                connection = undefined;
                objectIds.clear();
                counts.clear();
                const error = new Error("The connection to Ableton Live was lost");
                for (const wait of waiting.values()) wait.reject(error);
                waiting.clear();
                reject(new Error(password ? UNREACHABLE : NOT_PAIRED));
            };
            socket.addEventListener("error", lost);
            socket.addEventListener("close", lost);
        });
    }

    // Sends several commands in one message and returns their results in order.
    async function send(commands: Command[]): Promise<unknown[]> {
        if (!address) throw new Error("No address for Ableton Live is set, so it cannot be reached");
        connection ??= connect(address);
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
    }

    return {
        send,

        // Sends the commands for every item in one message, and gives back each item's results.
        async sendEach<T>(items: T[], commands: (item: T) => Command[]): Promise<unknown[][]> {
            const perItem = items.map(commands);
            const results = await send(perItem.flat());
            let start = 0;
            return perItem.map((itemCommands) => {
                const end = start + itemCommands.length;
                const itemResults = results.slice(start, end);
                start = end;
                return itemResults;
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
