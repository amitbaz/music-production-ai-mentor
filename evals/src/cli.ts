// Applies or reverts a plant on the base Set open in Live, by name, and never saves it:
//     pnpm plant                      lists the plants
//     pnpm plant <name>               applies one
//     pnpm plant <name> --revert      puts its before values back
import { createAbleton } from "@mentor/tools/daws/ableton";
import { plants } from "../sets/patience/plants.ts";
import { applyPlant, revertPlant } from "./plant.ts";

const [name, flag] = process.argv.slice(2);
const plant = plants.find((p) => p.name === name);
if (!plant) {
    if (name) console.error(`No plant ${name}.`);
    for (const p of plants) console.log(`${p.name.padEnd(16)} ${p.title} (bars ${p.bars})`);
    process.exit(name ? 1 : 0);
}
const tools = createAbleton({ address: process.env.ABLETON_ADDRESS, password: process.env.ABLETON_PASSWORD });
try {
    const lines = await (flag === "--revert" ? revertPlant : applyPlant)(tools, plant);
    console.log(lines.join("\n"));
} catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
}
process.exit();
