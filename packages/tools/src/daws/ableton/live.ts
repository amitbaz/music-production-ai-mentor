// What the Remote Script sends back for Live's objects; only the fields the tools use.
export type LiveTrack = { id: string; name: string; type: string; mute: boolean; solo: boolean };
// type is what Live calls the kind of device, such as "instrument" or "audio_effect".
export type LiveDevice = { id: string; name: string; class_name: string; type?: string };
export type LiveParameter = { id: string; value: number };
export type LiveDeviceParameter = LiveParameter & { name: string; is_quantized: boolean };
export type LiveChain = { id: string; name: string; mute: boolean; solo: boolean };
export type LiveClipSlot = { id: string; has_clip: boolean };
export type LiveClip = { id: string; name: string; is_midi_clip: boolean; start_time: number; end_time: number; muted: boolean };

// A third-party plug-in, VST or Audio Unit, as opposed to a native device.
export function isPlugin(device: LiveDevice) {
    return device.class_name === "PluginDevice" || device.class_name === "AuPluginDevice";
}
export type LiveBrowserItem = { id: string; name: string; is_loadable: boolean; is_device: boolean; is_folder: boolean };
export type LiveCuePoint = { id: string; name: string; time: number };
export type LiveNote = { note_id: number; pitch: number; start_time: number; duration: number; velocity: number; probability: number };

// Live gives a clip's warp mode as its number, and takes it by its name in Live's Python API.
// Number 5 is REX, which Live sets only for a REX file.
export const WARP_MODES: Record<string, string> = { 0: "beats", 1: "tones", 2: "texture", 3: "repitch", 4: "complex", 5: "rex", 6: "complex_pro" };
