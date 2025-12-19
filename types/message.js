"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Message = exports.MessageContent = void 0;
const uuid_1 = require("uuid");
class MessageContent {
    constructor(content) {
        this.content = content;
    }
}
exports.MessageContent = MessageContent;
class Message {
    constructor(id, senderId, receiverId, content, isGroup, timestamp) {
        this.id = id || (0, uuid_1.v4)();
        this.senderId = senderId;
        this.receiverId = receiverId;
        this.isGroup = isGroup;
        this.content = content;
        this.timestamp = timestamp;
    }
    toJSON() {
        return JSON.stringify({
            id: this.id,
            senderId: this.senderId,
            receiverId: this.receiverId,
            content: this.content,
            timestamp: this.timestamp,
            isGroup: this.isGroup,
        });
    }
}
exports.Message = Message;
