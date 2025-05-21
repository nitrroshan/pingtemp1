import { User } from "./user";
import { Message } from "./message";
import { v4 as uuidv4 } from "uuid";

export class Chat {
  id: string;
  name: string;
  description: string;
  isGroup: boolean;
  messages: Message[];
  users: string[];

  constructor(
    id: string,
    name: string,
    description: string,
    isGroup: boolean = false
  ) {
    this.id = id || uuidv4();
    this.name = name;
    this.description = description;
    this.isGroup = isGroup;
    this.messages = [];
    this.users = [];
  }
}
