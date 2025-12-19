"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Chat = void 0;
const uuid_1 = require("uuid");
class Chat {
    constructor(id, name, description, isGroup = false) {
        this.id = id || (0, uuid_1.v4)();
        this.name = name;
        this.description = description;
        this.isGroup = isGroup;
        this.messages = [];
        this.users = [];
    }
}
exports.Chat = Chat;
