"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidUserId = exports.isValidUser = exports.usersDb = void 0;
exports.usersDb = [];
const isValidUser = (user) => {
    return exports.usersDb.some((u) => {
        if (u.id === user.id) {
            return true;
        }
        return false;
    });
};
exports.isValidUser = isValidUser;
const isValidUserId = (userId) => {
    return exports.usersDb.some((u) => {
        if (u.id === userId) {
            return true;
        }
        return false;
    });
};
exports.isValidUserId = isValidUserId;
