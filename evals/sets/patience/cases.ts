import type { Case } from "../../src/run.ts";
import { plants } from "./plants.ts";

const plant = (name: string) => plants.find((p) => p.name === name) as Case["plant"];

// The cases on Patience: a plant and what the user says about it (ADR 0020).
export const cases: Case[] = [{ name: "low-end-hot-told", plant: plant("low-end-hot"), message: "The sub bass is way too loud, can you fix it?" }];
