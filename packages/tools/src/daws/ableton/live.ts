// What the Remote Script sends back for Live's objects; only the fields the tools use.
export type LiveTrack = { id: string; name: string; type: string; mute: boolean; solo: boolean };
export type LiveDevice = { id: string; name: string; class_name: string };
export type LiveParameter = { id: string; value: number };
export type LiveDeviceParameter = LiveParameter & { name: string; is_quantized: boolean };
export type LiveChain = { id: string; name: string; mute: boolean; solo: boolean };
export type LiveClipSlot = { id: string; has_clip: boolean };
export type LiveClip = { id: string; name: string; is_midi_clip: boolean; start_time: number; end_time: number; muted: boolean };

// A third-party plug-in, VST or Audio Unit, as opposed to a native device.
export function isPlugin(device: LiveDevice) {
    return device.class_name === "PluginDevice" || device.class_name === "AuPluginDevice";
}
