"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = router;
// Either agent can decide to end
function router(state) {
    const messages = state.messages;
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.tool_calls && lastMessage.tool_calls.length > 0) {
        // The previous agent is invoking a tool
        return "call_tool";
    }
    if (typeof lastMessage.content === "string" &&
        lastMessage.content.includes("FINAL ANSWER")) {
        // Any agent decided the work is done
        return "end";
    }
    return "continue";
}
