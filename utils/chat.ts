import { v4 as uuidv4 } from "uuid";
import { User } from "../types/user";
import { Message } from "../types/message";
import { Chat } from "../types/chat";

const chats: Chat[] = [];

export function findChat(senderId: string, receiverId: string): Chat {
  for (const chat of chats) {
    if (
      chat.users.some((userId) => userId === senderId) &&
      chat.users.some((userId) => userId === receiverId)
    ) {
      return chat;
    }
  }
  return createChat("New Chat", "This is a new chat");
}

export function createChat(name: string, description: string): Chat {
  const newChat = new Chat(uuidv4(), name, description);
  chats.push(newChat);
  return newChat;
}

export function addMessageToChat(message: Message): string {
  const chat = findChat(message.senderId, message.receiverId);
  if (!chat) {
    return "Failure";
  }
  chat.messages.push(message);
  if (!chat.users.some((userId) => userId === message.senderId)) {
    chat.users.push(message.senderId);
  }
  if (!chat.users.some((userId) => userId === message.receiverId)) {
    chat.users.push(message.receiverId);
  }
  return "Success";
}
