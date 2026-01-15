"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.User = void 0;
const uuid_1 = require("uuid");
class User {
    constructor(id, username, email) {
        this.id = id || (0, uuid_1.v4)();
        this.name = username;
        this.email = email;
    }
}
exports.User = User;
