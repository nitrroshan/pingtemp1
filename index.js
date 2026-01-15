"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const user_1 = require("./types/user");
const chat_1 = require("./utils/chat");
const uuid_1 = require("uuid");
const message_1 = require("./utils/message");
const users_1 = require("./utils/users");
const api_1 = __importDefault(require("./src/taskManager/api"));
const app = (0, express_1.default)();
const port = 3000;
// Middleware to parse JSON request bodies
app.use(express_1.default.json());
app.get("/", (req, res) => {
    res.send("Hello World!");
});
app.post("/user/register", (req, res) => {
    const { name, email } = req.body;
    const userId = (0, uuid_1.v4)();
    const user = new user_1.User(userId, name, email);
    users_1.usersDb.push(user);
    res.status(201).send(user);
});
app.get("/user/:userId/chat", (req, res) => {
    const senderId = req.params.userId;
    const receiverId = req.query.receiverId;
    const chat = (0, chat_1.findChat)(senderId, receiverId);
    if (chat) {
        res.status(200).send(chat);
    }
    else {
        res.status(404).send("Chat not found");
    }
});
app.post("/user/:userId/groupchat", (req, res) => {
    const userId = req.params.userId;
    const { name, description, users } = req.body;
    const chat = (0, chat_1.createChat)(name, description, users, true);
    if (chat) {
        res.status(200).send({ chatId: chat.id });
    }
    else {
        res.status(404).send("Error creating group chat");
    }
});
app.post("/user/:userId/sendmessage", (req, res) => {
    const senderId = req.params.userId;
    const message = req.body.message;
    const result = (0, message_1.sendMessage)(message);
    if (result == "Success") {
        res.status(200).send("Message Sent");
    }
    else {
        res.status(400).send("Error sending message");
    }
});
app.use("/api", api_1.default);
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
