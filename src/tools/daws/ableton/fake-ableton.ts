import type { Tool } from "../../../agent/types.ts";

export function createFakeAbleton(): Tool[] {
    // The whole fake: created fresh on every call, so callers never share state.
    const session = { tempo: 120, tracks: ["Drums", "Bass"] };

    return [
        {
            name: "get_session",
            description: "Returns the current session information",
            params: {
                type: "object",
                properties: {},
            },
            run: () => JSON.stringify(session),
        },
        {
            name: "set_tempo",
            description: "Sets the tempo of the session",
            params: {
                type: "object",
                properties: {
                    bpm: {
                        type: "number",
                        description: "Tempo in BPM, from 20 to 999",
                    },
                },
                required: ["bpm"],
            },
            run: ({ bpm }) => {
                // Arguments come from the model, so check them before use.
                if (typeof bpm !== "number" || bpm < 20 || bpm > 999) {
                    throw new Error("bpm must be a number between 20 and 999");
                }
                session.tempo = bpm;
                return JSON.stringify(session);
            },
        },
        {
            name: "create_track",
            description:
                "Add a new track with the given name at the end of the track list",
            params: {
                type: "object",
                properties: {
                    name: {
                        type: "string",
                        description: "Name of the new track",
                    },
                },
                required: ["name"],
            },
            run: ({ name }) => {
                if (typeof name !== "string" || name.trim() === "") {
                    throw new Error("name must be a non-empty string");
                }
                session.tracks.push(name);
                return JSON.stringify(session);
            },
        },
        {
            name: "delete_track",
            description:
                "Deletes the track with the given name. The name must match exactly; call get_session first to see the track names.",
            params: {
                type: "object",
                properties: {
                    name: {
                        type: "string",
                        description: "Name of the track to delete",
                    },
                },
                required: ["name"],
            },
            needsApproval: true,
            run: ({ name }) => {
                const index = session.tracks.indexOf(name as string);
                if (index === -1) {
                    // Say what does exist, so the model can correct itself.
                    throw new Error(
                        `no track named ${name}. Tracks: ${session.tracks.join(", ")}`,
                    );
                }
                session.tracks.splice(index, 1);
                return JSON.stringify(session);
            },
        },
    ];
}
