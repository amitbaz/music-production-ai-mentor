import type { Case } from "../../src/run.ts";
import { plants } from "./plants.ts";

const plant = (name: string) => plants.find((p) => p.name === name) as Case["plant"];

// The cases on Patience: a plant and what the user says about it (ADR 0020).
export const cases: Case[] = [
    { name: "low-end-hot-told", plant: plant("low-end-hot"), message: "The sub bass is way too loud, can you fix it?" },
    { name: "kick-bass-fight-told", plant: plant("kick-bass-fight"), message: "The kick and the sub are fighting in the low end, can you sort it out?" },
    // Control for kick-bass-fight-told: the fix is named, so a failure here is a tool failure, not missing knowledge (mentor-kb #19).
    { name: "kick-bass-fight-named", plant: plant("kick-bass-fight"), message: "The sub is sitting an octave too high, drop it back." },
];
