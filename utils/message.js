"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendMessage = sendMessage;
const chat_1 = require("./chat");
function sendMessage(message) {
    // Find and connect to receiver
    const response = (0, chat_1.addMessageToChat)(message);
    // Send message
    if (response === "Success") {
        console.log("Message sent successfully.");
    }
    else {
        console.error("Failed to send message.");
    }
    return response;
}
