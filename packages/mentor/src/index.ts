export type {
    LoopResult,
    Message,
    RetryReport,
    ToolCall,
    TurnOptions,
    Update,
} from "@mentor/harness";
export { createMentor, MODEL_ID, type MentorOptions } from "./mentor.ts";
// Pairing Ableton Live: installing and removing the Remote Script the mentor reaches Live through.
export { installRemoteScript, REMOTE_SCRIPT_NAME, removeRemoteScript, remoteScriptsFolder } from "@mentor/tools/daws/ableton";
