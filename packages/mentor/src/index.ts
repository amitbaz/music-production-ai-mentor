export type {
    LoopResult,
    Message,
    RetryReport,
    ToolCall,
} from "@mentor/harness";
export {
    connectKnowledgeBase,
    createMentor,
    keysFromEnv,
    MODEL_ID,
    type MentorOptions,
    type TurnOptions,
    type Update,
} from "./mentor.ts";
// Pairing Ableton Live: installing and removing the Remote Script the mentor reaches Live through.
export { installRemoteScript, REMOTE_SCRIPT_NAME, removeRemoteScript, remoteScriptsFolder } from "@mentor/tools/daws/ableton";
