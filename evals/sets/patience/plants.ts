import type { Plant } from "../../src/plant.ts";

// The plants for Patience (#75): the seven faults of #54, rewritten for its tracks and sections.
// Values are as Live shows them in the base Set; bars are Live's ruler numbers. Sections: Intro 1,
// Verse 1 9, Chorus 17, Verse 2 25, Chorus 33, Breakdown 41, Instrumental 57, Chorus 81, Outro 89.
export const plants: Plant[] = [
    {
        name: "low-end-hot",
        title: "Low end too hot",
        bars: "25–33, 65–73, 81–89",
        says: "The sub bass is several dB too loud for the kick.",
        changes: [{ track: "Sub Sub Bass", parameter: "volume", before: -1, after: 5 }],
    },
    {
        name: "main-clips",
        title: "Clipping on Main",
        bars: "17–25, 33–41, 81–89 (the choruses sum highest)",
        says: "The master clips; bring it down.",
        changes: [{ track: "Main", parameter: "volume", before: 0, after: 6 }],
    },
    {
        name: "mono",
        title: "Mono image",
        bars: "1–41",
        says: "The pad and the drums are mono; the mix has no width until the breakdown.",
        changes: [
            { track: "Coffee Leaf", device: ["Utility"], parameter: "Mono", before: "Off", after: "On" },
            { track: "Drums", device: ["Utility"], parameter: "Mono", before: "Off", after: "On" },
        ],
    },
    {
        name: "kick-bass-fight",
        title: "Kick and bass fight",
        bars: "25–33, 65–73, 81–89",
        says: "The sub sits an octave up, on the kick's body; they mask each other in the low end.",
        changes: [{ track: "Sub Sub Bass", device: ["Sub Sub Bass", "Bassline", "Operator"], parameter: "Transpose", before: -24, after: -12 }],
    },
    {
        name: "tail-smears",
        title: "Vocal tail smears",
        bars: "11–42, 82–90",
        says: "The lead vocal's reverb (6.8 s) washes over everything; the words blur.",
        changes: [{ track: "Vocal Main", device: ["Reverb"], parameter: "Dry/Wet", before: 0, after: 60 }],
    },
    {
        name: "clicks",
        title: "Clicks",
        bars: "1–9, 17–25, 33–41, each chord change",
        says: "Something clicks on the pad's chord changes.",
        changes: [
            { track: "Coffee Leaf", device: ["Coffee Leaf"], parameter: "Env 1 Attack", before: 114, after: 0 },
            { track: "Coffee Leaf", device: ["Coffee Leaf"], parameter: "Env 1 Release", before: 544, after: 10 },
        ],
    },
    {
        name: "chorus-flat",
        title: "The chorus does not lift",
        bars: "17–25 against 9–17",
        says: "The chorus is no bigger than the verse; the pad that should carry it is buried.",
        changes: [{ track: "Coffee Leaf", parameter: "volume", before: -4, after: -20 }],
    },
];
