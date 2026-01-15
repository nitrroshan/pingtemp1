"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findChat = findChat;
exports.findChatById = findChatById;
exports.createChat = createChat;
exports.addMessageToChat = addMessageToChat;
const uuid_1 = require("uuid");
const chat_1 = require("../types/chat");
const users_1 = require("./users");
const chatDb = [];
function findChat(senderId, receiverId) {
    for (const chat of chatDb) {
        if (chat.users.some((userId) => userId === senderId) &&
            chat.users.some((userId) => userId === receiverId)) {
            return chat;
        }
    }
    return createChat("New Chat", "This is a new chat", [senderId, receiverId], false);
}
function findChatById(chatId) {
    return chatDb.find((chat) => chat.id === chatId);
}
function createChat(name, description, users, isGroup = false) {
    for (const userId of users) {
        if (!(0, users_1.isValidUserId)(userId)) {
            throw new Error(`User with ID ${userId} not found`);
        }
    }
    const newChat = new chat_1.Chat((0, uuid_1.v4)(), name, description, isGroup);
    newChat.users = users;
    chatDb.push(newChat);
    return newChat;
}
function addMessageToChat(message) {
    let chat = undefined;
    if (message.isGroup) {
        chat = findChatById(message.receiverId);
        if (!chat) {
            return "Failure";
        }
    }
    else {
        if (!(0, users_1.isValidUserId)(message.receiverId)) {
            return "User not found";
        }
        chat = findChat(message.senderId, message.receiverId);
        if (!chat) {
            return "Failure";
        }
    }
    chat.messages.push(message);
    return "Success";
}
