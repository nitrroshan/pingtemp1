/**
 * Scratchpad — Agent's private thinking space (Zone 1)
 *
 * Provides:
 * - Key-value notes for recording observations
 * - Todo list for internal task tracking
 * - "Remember" facts that can be injected back into context
 * - Temporary files (trial scripts, research docs)
 * - promote() to move files from scratchpad → workspace (Zone 1 → Zone 2)
 *
 * Storage: `.scratch/` directory within workspace, gitignored.
 *
 * @see feature_implementation_planning.md §Phase 6
 * @see AGENT_WORKSPACE_RESEARCH.md §4 — Zone 1: Scratchpad
 */

import fs from "fs";
import path from "path";
import { rootLogger } from "../../logging.js";

const logger = rootLogger.child({ module: "Scratchpad" });

export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: string;
  completedAt?: string;
}

export class Scratchpad {
  private readonly scratchDir: string;
  private readonly filesDir: string;
  private readonly notesPath: string;
  private readonly todosPath: string;
  private readonly rememberedPath: string;

  constructor(private readonly workspaceBasePath: string) {
    this.scratchDir = path.join(workspaceBasePath, ".scratch");
    this.filesDir = path.join(this.scratchDir, "files");
    this.notesPath = path.join(this.scratchDir, "notes.json");
    this.todosPath = path.join(this.scratchDir, "todos.json");
    this.rememberedPath = path.join(this.scratchDir, "remembered.json");
  }

  /**
   * Initialize the scratchpad directory and data files.
   * Called by AgentWorkspace.initialize().
   */
  async initialize(): Promise<void> {
    await fs.promises.mkdir(this.filesDir, { recursive: true });

    // Create data files if they don't exist
    for (const fp of [this.notesPath, this.todosPath, this.rememberedPath]) {
      try {
        await fs.promises.access(fp);
      } catch {
        const initial = fp === this.rememberedPath ? "[]" : "{}";
        await fs.promises.writeFile(
          fp,
          fp === this.todosPath ? "[]" : initial,
          "utf-8",
        );
      }
    }

    logger.debug(`Scratchpad initialized at: ${this.scratchDir}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NOTES (key-value pairs for observations, decisions, context)
  // ═══════════════════════════════════════════════════════════════════════════

  async note(key: string, value: string): Promise<void> {
    const notes = await this.loadJson<Record<string, string>>(
      this.notesPath,
      {},
    );
    notes[key] = value;
    await this.saveJson(this.notesPath, notes);
  }

  async getNote(key: string): Promise<string | null> {
    const notes = await this.loadJson<Record<string, string>>(
      this.notesPath,
      {},
    );
    return notes[key] ?? null;
  }

  async listNotes(): Promise<Record<string, string>> {
    return this.loadJson<Record<string, string>>(this.notesPath, {});
  }

  async deleteNote(key: string): Promise<boolean> {
    const notes = await this.loadJson<Record<string, string>>(
      this.notesPath,
      {},
    );
    if (!(key in notes)) return false;
    delete notes[key];
    await this.saveJson(this.notesPath, notes);
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TODOS (internal task tracking)
  // ═══════════════════════════════════════════════════════════════════════════

  async addTodo(text: string): Promise<string> {
    const todos = await this.loadJson<Todo[]>(this.todosPath, []);
    const id = `todo-${Date.now().toString(36)}`;
    todos.push({
      id,
      text,
      completed: false,
      createdAt: new Date().toISOString(),
    });
    await this.saveJson(this.todosPath, todos);
    return id;
  }

  async completeTodo(todoId: string): Promise<boolean> {
    const todos = await this.loadJson<Todo[]>(this.todosPath, []);
    const todo = todos.find((t) => t.id === todoId);
    if (!todo) return false;
    todo.completed = true;
    todo.completedAt = new Date().toISOString();
    await this.saveJson(this.todosPath, todos);
    return true;
  }

  async listTodos(): Promise<Todo[]> {
    return this.loadJson<Todo[]>(this.todosPath, []);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REMEMBER (facts to inject back into agent context)
  // ═══════════════════════════════════════════════════════════════════════════

  async remember(fact: string): Promise<void> {
    const facts = await this.loadJson<string[]>(this.rememberedPath, []);
    // Avoid duplicates
    if (!facts.includes(fact)) {
      facts.push(fact);
      await this.saveJson(this.rememberedPath, facts);
    }
  }

  async getRemembered(): Promise<string[]> {
    return this.loadJson<string[]>(this.rememberedPath, []);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FILES (trial scripts, research docs)
  // ═══════════════════════════════════════════════════════════════════════════

  async writeFile(subpath: string, content: string): Promise<void> {
    const safePath = this.sanitizeSubpath(subpath);
    const fullPath = path.join(this.filesDir, safePath);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, content, "utf-8");
  }

  async readFile(subpath: string): Promise<string> {
    const safePath = this.sanitizeSubpath(subpath);
    const fullPath = path.join(this.filesDir, safePath);
    try {
      return await fs.promises.readFile(fullPath, "utf-8");
    } catch (err: any) {
      if (err.code === "ENOENT") {
        throw new Error(`Scratch file not found: ${safePath}`);
      }
      throw err;
    }
  }

  async listFiles(): Promise<string[]> {
    return this.collectFiles(this.filesDir, "");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Clear all scratchpad data (notes, todos, remembered, files).
   */
  async clear(): Promise<void> {
    await this.saveJson(this.notesPath, {});
    await this.saveJson(this.todosPath, []);
    await this.saveJson(this.rememberedPath, []);

    // Remove all files in files/ directory
    try {
      await fs.promises.rm(this.filesDir, { recursive: true, force: true });
      await fs.promises.mkdir(this.filesDir, { recursive: true });
    } catch {
      // Ignore cleanup failures
    }

    logger.debug("Scratchpad cleared");
  }

  /**
   * Archive scratchpad contents to a zip or directory (for debug/inspection).
   * Simply copies the .scratch/ directory to the specified path.
   */
  async archive(archivePath: string): Promise<void> {
    await this.copyDir(this.scratchDir, archivePath);
    logger.debug(`Scratchpad archived to: ${archivePath}`);
  }

  /**
   * Get a summary of scratchpad contents (for debugging / identity card).
   */
  async getSummary(): Promise<{
    notesCount: number;
    todosTotal: number;
    todosDone: number;
    rememberedCount: number;
    filesCount: number;
  }> {
    const notes = await this.loadJson<Record<string, string>>(
      this.notesPath,
      {},
    );
    const todos = await this.loadJson<Todo[]>(this.todosPath, []);
    const remembered = await this.loadJson<string[]>(this.rememberedPath, []);
    const files = await this.listFiles();

    return {
      notesCount: Object.keys(notes).length,
      todosTotal: todos.length,
      todosDone: todos.filter((t) => t.completed).length,
      rememberedCount: remembered.length,
      filesCount: files.length,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private async loadJson<T>(filePath: string, fallback: T): Promise<T> {
    try {
      const raw = await fs.promises.readFile(filePath, "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private async saveJson(filePath: string, data: unknown): Promise<void> {
    await fs.promises.writeFile(
      filePath,
      JSON.stringify(data, null, 2),
      "utf-8",
    );
  }

  private sanitizeSubpath(subpath: string): string {
    const normalized = path.normalize(subpath).replace(/\\/g, "/");
    if (normalized.startsWith("..") || normalized.startsWith("/")) {
      throw new Error(
        `Invalid scratchpad path: '${subpath}' — cannot escape scratchpad`,
      );
    }
    return normalized.replace(/^\.\//, "");
  }

  private async collectFiles(dir: string, prefix: string): Promise<string[]> {
    const result: string[] = [];
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isFile()) {
          result.push(relPath);
        } else if (entry.isDirectory()) {
          const sub = await this.collectFiles(
            path.join(dir, entry.name),
            relPath,
          );
          result.push(...sub);
        }
      }
    } catch {
      // Directory may not exist
    }
    return result;
  }

  private async copyDir(src: string, dest: string): Promise<void> {
    await fs.promises.mkdir(dest, { recursive: true });
    const entries = await fs.promises.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await this.copyDir(srcPath, destPath);
      } else {
        await fs.promises.copyFile(srcPath, destPath);
      }
    }
  }
}
