// Our client for the ableton-js Remote Script, which listens inside Live on a local WebSocket.
import { createHmac } from "node:crypto";

// One call on a Live object: `ns` is the kind of object, `nsid` the script's id for it.
export type Command = { ns: string; nsid?: string; name: string; args?: unknown };

type Reply = { event: string; uuid: string | null; data: unknown };
type Result = { ok: true; data: unknown } | { ok: false; error: string; errorType: string };
type Waiting = { resolve: (results: Result[]) => void; reject: (error: Error) => void };

export type Client = ReturnType<typeof createClient>;

// The version of the pinned script that pairing installs, in remote-scripts/ableton-js/version.py.
const SCRIPT_VERSION = "5.0.4";

// How long Live has to greet a new connection, accept the password and give its versions, so a
// stalled Live, or another program on the port, cannot hang a tool.
const HANDSHAKE_MS = 5000;
// How long Live has to answer a message once connected: room for a heavy action, while a stalled
// Live still gives the model an answer within its round.
const COMMAND_MS = 10_000;

// What the user is told when Live cannot be used. Without a password Ableton was never paired;
// with one, pairing again writes a new one into both places, and Live reads its copy when it starts.
const CONTROL_SURFACE = "MusicMentor as a Control Surface in Settings → Link, Tempo & MIDI";
const NOT_PAIRED = `Ableton Live is not paired with the mentor yet. Run pnpm pair ableton, restart Live, and choose ${CONTROL_SURFACE}.`;
const REFUSED = "Ableton Live refused the password. Pair Ableton again with pnpm pair ableton, then restart Live.";
const UNREACHABLE = "Could not reach Ableton Live. Is it open, with MusicMentor chosen as a Control Surface in Settings → Link, Tempo & MIDI?";
const WRONG_SCRIPT = (version: string) =>
    `The MusicMentor script in Ableton Live is version ${version}, and the mentor needs ${SCRIPT_VERSION}. Pair Ableton again with pnpm pair ableton, then restart Live.`;
const OLD_LIVE = (version: string) => `Ableton Live ${version} is too old: the mentor needs Live 12.4 or later. Update Live, then try again.`;
const LOST =
    "The connection to Ableton Live was lost, as when Live is closed or another Live Set is opened. Try again; object ids from before must be read again.";
const NO_REPLY = `Ableton Live did not answer within ${COMMAND_MS / 1000} seconds. It may be busy. What was asked may still happen, so read again before trying again.`;
const UNKNOWN_ID = (objectId: string) =>
    `${objectId} is not an object id from the current connection to Ableton Live. Read again with read_set to get current ids.`;
const NO_ANSWER = "Ableton Live did not answer. If it is busy, try again; if this keeps happening, restart Live.";

// The address is the script's WebSocket, such as ws://127.0.0.1:39031, and the password the one
// pairing Ableton wrote into the installed script. The app gives both.
export function createClient(address: string | undefined, password?: string) {
    // Opened on the first send, not before.
    let connection: Promise<WebSocket> | undefined;
    const waiting = new Map<string, Waiting>();
    let nextUuid = 1;
    // Object ids last as long as the connection: script id -> object id, and back. The count per
    // kind outlives the connection, so an id from before a loss never names another object.
    const objectIds = new Map<string, string>();
    const scriptIds = new Map<string, string>();
    const counts = new Map<string, number>();

    function connect(address: string) {
        const opening = new Promise<WebSocket>((resolve, reject) => {
            const socket = new WebSocket(address);
            const timer = setTimeout(() => fail(NO_ANSWER), HANDSHAKE_MS);
            const ready = () => {
                clearTimeout(timer);
                resolve(socket);
            };
            // Forgets this connection and the ids it gave out, unless a newer one has taken its place,
            // so a late event from an old socket cannot drop a newer connection.
            const drop = () => {
                if (connection !== opening) return;
                connection = undefined;
                objectIds.clear();
                scriptIds.clear();
                const error = new Error(LOST);
                for (const wait of waiting.values()) wait.reject(error);
                waiting.clear();
            };
            const fail = (message: string) => {
                clearTimeout(timer);
                // Rejected first: drop() rejects the handshake's own wait, which calls fail() again.
                reject(new Error(message));
                drop();
                socket.close();
            };
            socket.addEventListener("message", (event) => {
                const reply = JSON.parse(String(event.data)) as Reply;
                // The script greets each new connection before it takes commands. With its password
                // on, the greeting carries a salt, and the first command must prove the password.
                // The versions are checked in the same message.
                if (reply.event === "connect") {
                    const { requiresAuth, salt } = (reply.data ?? {}) as { requiresAuth?: boolean; salt?: string };
                    if (requiresAuth && !password) return fail(NOT_PAIRED);
                    const commands: Command[] = [
                        { ns: "internal", name: "get_version" },
                        { ns: "application", name: "get_major_version" },
                        { ns: "application", name: "get_minor_version" },
                    ];
                    if (requiresAuth && password) {
                        const hash = createHmac("sha256", password).update(salt ?? "").digest("hex");
                        commands.unshift({ ns: "internal", name: "authenticate", args: { hash } });
                    }
                    const uuid = String(nextUuid++);
                    waiting.set(uuid, {
                        resolve: (results) => {
                            // The versions are the last three results, after the password's if there is one.
                            const [script, major, minor] = results.slice(-3).map((result) => (result.ok ? result.data : undefined));
                            if (script !== SCRIPT_VERSION) return fail(WRONG_SCRIPT(String(script)));
                            // A version that could not be read counts as too old.
                            const newEnough = Number(major) > 12 || (Number(major) === 12 && Number(minor) >= 4);
                            if (!newEnough) return fail(OLD_LIVE(`${major}.${minor}`));
                            ready();
                        },
                        reject: (error) => fail(requiresAuth ? REFUSED : error.message),
                    });
                    socket.send(JSON.stringify({ uuid, commands }));
                    return;
                }
                const wait = reply.uuid === null ? undefined : waiting.get(reply.uuid);
                if (!wait || reply.uuid === null) return;
                waiting.delete(reply.uuid);
                if (reply.event === "result") wait.resolve(reply.data as Result[]);
                else wait.reject(new Error(String(reply.data)));
            });
            // When nothing listens, Node's WebSocket sends only an error, with no close after it.
            // A socket can also send both; drop() ignores the second. The connection is refused
            // before drop() rejects the handshake, so a Live that quits mid-handshake is reported
            // as not reachable, not as a refused password.
            const lost = () => {
                clearTimeout(timer);
                reject(new Error(password ? UNREACHABLE : NOT_PAIRED));
                drop();
            };
            socket.addEventListener("error", lost);
            socket.addEventListener("close", lost);
        });
        return opening;
    }

    // Sends several commands in one message and returns their results in order.
    async function send(commands: Command[]): Promise<unknown[]> {
        if (commands.length === 0) return [];
        if (!address) throw new Error("No address for Ableton Live is set, so it cannot be reached");
        connection ??= connect(address);
        const socket = await connection;
        const uuid = String(nextUuid++);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const results = await new Promise<Result[]>((resolve, reject) => {
            waiting.set(uuid, { resolve, reject });
            // A late answer finds nothing waiting and is dropped.
            timer = setTimeout(() => {
                waiting.delete(uuid);
                reject(new Error(NO_REPLY));
            }, COMMAND_MS);
            socket.send(JSON.stringify({ uuid, commands }));
        }).finally(() => clearTimeout(timer));
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
                scriptIds.set(id, scriptId);
            }
            return id;
        },

        // The script's id for an object id this connection gave out. Any other id, such as one
        // from before the connection was lost, is refused with a message to read again.
        scriptId(objectId: string) {
            const scriptId = scriptIds.get(objectId);
            if (!scriptId) {
                throw new Error(UNKNOWN_ID(objectId));
            }
            return scriptId;
        },
    };
}

export function getProp(ns: string, prop: string, nsid?: string): Command {
    return { ns, nsid, name: "get_prop", args: { prop } };
}

export function setProp(ns: string, prop: string, value: unknown, nsid?: string): Command {
    return { ns, nsid, name: "set_prop", args: { prop, value } };
}

// Asks Live for the text it shows for a value of a parameter, such as "-3.0 dB" or "12L".
export function strForValue(parameterId: string, value: unknown): Command {
    return { ns: "device-parameter", nsid: parameterId, name: "str_for_value", args: [value] };
}
