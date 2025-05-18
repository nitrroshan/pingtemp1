import { Message } from "../types/message";
import { addMessageToChat } from "./chat";

export function sendMessage(message: Message): string {
  // Find and connect to receiver
  const response = addMessageToChat(message);

  // Send message
  if (response === "Success") {
    console.log("Message sent successfully.");
  } else {
    console.error("Failed to send message.");
  }
  return response;
}
