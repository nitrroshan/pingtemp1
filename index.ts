import express, { Request, Response } from "express";
import { User } from "./types/user";
import { createChat, findChat } from "./utils/chat";
import { v4 as uuidv4 } from "uuid";
import { sendMessage } from "./utils/message";
import { Message } from "./types/message";
import { usersDb } from "./utils/users";

const app = express();
const port = 3000;

// Middleware to parse JSON request bodies
app.use(express.json());
app.get("/", (req: Request, res: Response) => {
  res.send("Hello World!");
});
app.post("/user/register", (req: Request, res: Response) => {
  const { name, email } = req.body;
  const userId = uuidv4();
  const user = new User(userId, name, email);
  usersDb.push(user);
  res.status(201).send(user);
});
app.get("/user/:userId/chat", (req: Request, res: Response) => {
  const senderId = req.params.userId;
  const receiverId = req.query.receiverId as string;

  const chat = findChat(senderId, receiverId);
  if (chat) {
    res.status(200).send(chat);
  } else {
    res.status(404).send("Chat not found");
  }
});

app.post("/user/:userId/groupchat", (req: Request, res: Response) => {
  const userId = req.params.userId;
  const { name, description, users } = req.body;

  const chat = createChat(name, description, users, true);
  if (chat) {
    res.status(200).send({ chatId: chat.id });
  } else {
    res.status(404).send("Error creating group chat");
  }
});

app.post("/user/:userId/sendmessage", (req: Request, res: Response) => {
  const senderId = req.params.userId;

  const message = req.body.message;
  const result = sendMessage(message);
  if (result == "Success") {
    res.status(200).send("Message Sent");
  } else {
    res.status(400).send("Error sending message");
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
