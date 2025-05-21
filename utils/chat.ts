import { v4 as uuidv4 } from "uuid";
import { Message } from "../types/message";
import { Chat } from "../types/chat";
import { isValidUserId } from "./users";

const chatDb: Chat[] = [];

export function findChat(senderId: string, receiverId: string): Chat {
  for (const chat of chatDb) {
    if (
      chat.users.some((userId) => userId === senderId) &&
      chat.users.some((userId) => userId === receiverId)
    ) {
      return chat;
    }
  }
  return createChat(
    "New Chat",
    "This is a new chat",
    [senderId, receiverId],
    false
  );
}

export function findChatById(chatId: string): Chat | undefined {
  return chatDb.find((chat) => chat.id === chatId);
}

export function createChat(
  name: string,
  description: string,
  users: string[],
  isGroup: boolean = false
): Chat {
  for (const userId of users) {
    if (!isValidUserId(userId)) {
      throw new Error(`User with ID ${userId} not found`);
    }
  }
  const newChat = new Chat(uuidv4(), name, description, isGroup);
  newChat.users = users;
  chatDb.push(newChat);
  return newChat;
}

export function addMessageToChat(message: Message): string {
  let chat: Chat | undefined = undefined;
  if (message.isGroup) {
    chat = findChatById(message.receiverId);
    if (!chat) {
      return "Failure";
    }
  } else {
    if (!isValidUserId(message.receiverId)) {
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
