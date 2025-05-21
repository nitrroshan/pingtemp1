import { User } from "../types/user";
export const usersDb: User[] = [];
export const isValidUser = (user: User): boolean => {
  return usersDb.some((u: User) => {
    if (u.id === user.id) {
      return true;
    }
    return false;
  });
};
export const isValidUserId = (userId: string): boolean => {
  return usersDb.some((u: User) => {
    if (u.id === userId) {
      return true;
    }
    return false;
  });
};
