import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { installRemoteScript } from "./remote-script.ts";

test("the installed script has our own file, registered by one line of the script's table of handlers", async (t) => {
    const remoteScripts = await mkdtemp(join(tmpdir(), "remote-scripts-"));
    t.after(() => rm(remoteScripts, { recursive: true, force: true }));

    const { folder } = await installRemoteScript(remoteScripts);

    assert.equal(existsSync(join(folder, "Mentor.py")), true);
    const lines = (await readFile(join(folder, "AbletonJS.py"), "utf8")).split("\n").filter((line) => line.includes("Mentor"));
    assert.equal(lines.length, 1);
    assert.match(lines[0] as string, /^\s+"mentor": /);
});

// Runs the installed script's own dispatch in python3, with Live and the script's other files left out,
// on a function the script defines in place of Live's, as Track does with create_audio_clip.
const DISPATCH = `
import importlib.util, json, sys, types
folder, calls = sys.argv[1], json.loads(sys.argv[2])
for name, values in [("s", {}), ("s.Namespaces", {}), ("s.Config", {"DEBUG": False}), ("s.Logging", {"logger": None})]:
    module = types.ModuleType(name)
    module.__path__ = []
    module.__dict__.update(values)
    sys.modules[name] = module
spec = importlib.util.spec_from_file_location("s.Namespaces.Interface", folder + "/Namespaces/Interface.py")
interface = importlib.util.module_from_spec(spec)
spec.loader.exec_module(interface)
class Track(interface.Interface):
    def create_audio_clip(self, ns, file_path, position):
        return [ns, file_path, position]
nsid = interface.Interface.save_obj("a track")
print(json.dumps([Track(None, None).dispatch({"name": "create_audio_clip", "nsid": nsid, "args": args}, None) for args in calls]))
`;

test("a function the script defines in place of Live's takes its args as a list in order, or as an object by name", async (t) => {
    const remoteScripts = await mkdtemp(join(tmpdir(), "remote-scripts-"));
    t.after(() => rm(remoteScripts, { recursive: true, force: true }));
    const { folder } = await installRemoteScript(remoteScripts);

    const calls = [["/kick.wav", 64], { file_path: "/kick.wav", position: 64 }];
    const { stdout } = await promisify(execFile)("python3", ["-I", "-c", DISPATCH, folder, JSON.stringify(calls)]);

    assert.deepEqual(JSON.parse(stdout), [
        ["a track", "/kick.wav", 64],
        ["a track", "/kick.wav", 64],
    ]);
});
