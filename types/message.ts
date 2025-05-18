import { User } from "./user";
import { v4 as uuidv4 } from "uuid";

export class MessageContent {
  content: string;
  constructor(content: string) {
    this.content = content;
  }
}

export class Message {
  id: string;
  senderId: string;
  receiverId: string;
  content: MessageContent;
  timestamp: Date;

  constructor(
    id: string,
    senderId: string,
    receiverId: string,
    content: MessageContent,
    timestamp: Date
  ) {
    this.id = id || uuidv4();
    this.senderId = senderId;
    this.receiverId = receiverId;
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
    });
  }
}
