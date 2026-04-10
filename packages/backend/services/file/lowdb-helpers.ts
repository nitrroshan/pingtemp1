import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { promises as fs } from "fs";
import path from "path";

export function now(): string {
  return new Date().toISOString();
}

export async function createDb<T>(filePath: string, defaultData: T): Promise<Low<T>> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const adapter = new JSONFile<T>(filePath);
  const db = new Low(adapter, defaultData);
  await db.read();
  return db;
}
