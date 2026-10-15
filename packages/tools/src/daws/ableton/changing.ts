// What the changing tools share.

// An object the user deleted in Live since its id was given fails in the script like this.
export function isGone(error: unknown) {
    return error instanceof Error && error.message.includes("Unknown object id");
}

export const goneMessage = (id: string) => `${id} is no longer in the Live Set. Read again with read_set to get current ids.`;
