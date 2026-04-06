/**
 * Workspace Tools — LangChain StructuredTool implementations for agent workspace operations
 *
 * These tools are injected into agents via WorkerPool to give them
 * file CRUD, git commit, activity logging, and workspace lifecycle capabilities.
 *
 * Tools:
 * - workspace_status: Get workspace status (branch, changes, activity)
 * - workspace_create_file: Create a file in artifacts/
 * - workspace_read_file: Read a file from workspace
 * - workspace_write_file: Write/update a file
 * - workspace_delete_file: Delete a file
 * - workspace_file_exists: Check if a file exists
 * - workspace_list_files: List files in a directory
 * - workspace_commit: Commit all changes
 * - workspace_get_history: Get commit history
 * - workspace_publish: Publish workspace artifacts
 * - workspace_reactivate: Reactivate a published workspace for continued work
 * - workspace_discard: Discard workspace (delete branch)
 * - workspace_info: Get workspace identity info
 * - workspace_log_activity: Log an activity entry
 *
 * @see feature_implementation_planning.md §7
 */

import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { AgentWorkspace } from "../AgentWorkspace.js";

// ═══════════════════════════════════════════════════════════════════════════════
// STATUS & INFO TOOLS
// ═══════════════════════════════════════════════════════════════════════════════

class WorkspaceStatusTool extends StructuredTool {
  name = "workspace_status";
  description =
    "Get workspace status including uncommitted changes, current task, last commit, and activity stats";
  schema = z.object({});

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(): Promise<string> {
    try {
      const status = await this.workspace.getWorkspaceStatus();
      return JSON.stringify(status, null, 2);
    } catch (error: any) {
      return `Error getting status: ${error.message}`;
    }
  }
}

class WorkspaceInfoTool extends StructuredTool {
  name = "workspace_info";
  description =
    "Get workspace identity information (ID, branch, agent, task, base path)";
  schema = z.object({});

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(): Promise<string> {
    return JSON.stringify(
      {
        id: this.workspace.id,
        taskId: this.workspace.taskId,
        agentId: this.workspace.agentId,
        branchName: this.workspace.branchName,
        basePath: this.workspace.basePath,
        status: this.workspace.status,
      },
      null,
      2,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FILE OPERATION TOOLS
// ═══════════════════════════════════════════════════════════════════════════════

class WorkspaceCreateFileTool extends StructuredTool {
  name = "workspace_create_file";
  description =
    "Create a new file in the workspace. Path is relative to workspace root.";
  schema = z.object({
    path: z
      .string()
      .describe("Relative file path (e.g., 'artifacts/code/handler.ts')"),
    content: z.string().describe("File content to write"),
  });

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(input: { path: string; content: string }): Promise<string> {
    try {
      const info = await this.workspace.createFile(input.path, input.content);
      return `File created: ${info.path} (${info.size} bytes)`;
    } catch (error: any) {
      return `Error creating file: ${error.message}`;
    }
  }
}

class WorkspaceReadFileTool extends StructuredTool {
  name = "workspace_read_file";
  description = "Read a file from the workspace";
  schema = z.object({
    path: z.string().describe("Relative file path to read"),
  });

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(input: { path: string }): Promise<string> {
    try {
      return await this.workspace.readFile(input.path);
    } catch (error: any) {
      return `Error reading file: ${error.message}`;
    }
  }
}

class WorkspaceWriteFileTool extends StructuredTool {
  name = "workspace_write_file";
  description = "Write or update a file in the workspace";
  schema = z.object({
    path: z.string().describe("Relative file path to write"),
    content: z.string().describe("Content to write"),
  });

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(input: { path: string; content: string }): Promise<string> {
    try {
      // Try update first, fall back to create
      try {
        const info = await this.workspace.updateFile(input.path, input.content);
        return `File updated: ${info.path} (${info.size} bytes)`;
      } catch {
        const info = await this.workspace.createFile(input.path, input.content);
        return `File created: ${info.path} (${info.size} bytes)`;
      }
    } catch (error: any) {
      return `Error writing file: ${error.message}`;
    }
  }
}

class WorkspaceDeleteFileTool extends StructuredTool {
  name = "workspace_delete_file";
  description = "Delete a file from the workspace";
  schema = z.object({
    path: z.string().describe("Relative file path to delete"),
  });

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(input: { path: string }): Promise<string> {
    try {
      await this.workspace.deleteFile(input.path);
      return `File deleted: ${input.path}`;
    } catch (error: any) {
      return `Error deleting file: ${error.message}`;
    }
  }
}

class WorkspaceFileExistsTool extends StructuredTool {
  name = "workspace_file_exists";
  description = "Check if a file exists in the workspace";
  schema = z.object({
    path: z.string().describe("Relative file path to check"),
  });

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(input: { path: string }): Promise<string> {
    try {
      const exists = await this.workspace.fileExists(input.path);
      return exists ? "true" : "false";
    } catch (error: any) {
      return `Error checking file: ${error.message}`;
    }
  }
}

class WorkspaceListFilesTool extends StructuredTool {
  name = "workspace_list_files";
  description = "List files and directories in a workspace directory";
  schema = z.object({
    directory: z
      .string()
      .optional()
      .describe("Relative directory path (default: workspace root)"),
  });

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(input: { directory?: string }): Promise<string> {
    try {
      const files = await this.workspace.listFiles(input.directory || ".");
      if (files.length === 0) return "No files found";
      return files
        .map(
          (f) =>
            `${f.type === "directory" ? "📁" : "📄"} ${f.path}${f.size ? ` (${f.size}B)` : ""}`,
        )
        .join("\n");
    } catch (error: any) {
      return `Error listing files: ${error.message}`;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VERSION CONTROL TOOLS
// ═══════════════════════════════════════════════════════════════════════════════

class WorkspaceCommitTool extends StructuredTool {
  name = "workspace_commit";
  description = "Commit all changes in the workspace with a message";
  schema = z.object({
    message: z.string().describe("Commit message describing the changes"),
  });

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(input: { message: string }): Promise<string> {
    try {
      const info = await this.workspace.commit(input.message);
      return `Committed: ${info.hash.substring(0, 7)} — ${input.message}`;
    } catch (error: any) {
      return `Error committing: ${error.message}`;
    }
  }
}

class WorkspaceGetHistoryTool extends StructuredTool {
  name = "workspace_get_history";
  description = "Get commit history for this workspace branch";
  schema = z.object({
    limit: z
      .number()
      .optional()
      .describe("Maximum number of commits to return (default: 10)"),
  });

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(input: { limit?: number }): Promise<string> {
    try {
      const history = await this.workspace.getHistory();
      const limited = history.slice(0, input.limit || 10);
      if (limited.length === 0) return "No commits yet";
      return limited
        .map((c) => `${c.hash.substring(0, 7)} | ${c.author} | ${c.message}`)
        .join("\n");
    } catch (error: any) {
      return `Error getting history: ${error.message}`;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIFECYCLE TOOLS
// ═══════════════════════════════════════════════════════════════════════════════

class WorkspacePublishTool extends StructuredTool {
  name = "workspace_publish";
  description =
    "Publish workspace — commit all changes and extract artifacts for team memory. Call this when task work is complete.";
  schema = z.object({});

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(): Promise<string> {
    try {
      const manifest = await this.workspace.publish();
      if (manifest.outputs.length === 0) {
        return "No artifacts to publish";
      }
      return `Published ${manifest.outputs.length} outputs:\n${manifest.outputs.map((o) => `  - ${o.path} (${o.category})`).join("\n")}`;
    } catch (error: any) {
      return `Error publishing: ${error.message}`;
    }
  }
}

class WorkspaceReactivateTool extends StructuredTool {
  name = "workspace_reactivate";
  description =
    "Reactivate a published workspace to allow further file operations. Use when workspace is locked in 'published' status but more work is needed.";
  schema = z.object({});

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(): Promise<string> {
    try {
      await this.workspace.reactivate();
      return `Workspace '${this.workspace.id}' reactivated — you can now create/edit files and commit again.`;
    } catch (error: any) {
      return `Error reactivating: ${error.message}`;
    }
  }
}

class WorkspaceDiscardTool extends StructuredTool {
  name = "workspace_discard";
  description =
    "Discard workspace — delete branch without merging. Use when task is cancelled or work should be abandoned.";
  schema = z.object({
    confirm: z.boolean().describe("Must be true to confirm discard"),
  });

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(input: { confirm: boolean }): Promise<string> {
    if (!input.confirm) {
      return "Discard cancelled — confirm must be true";
    }
    try {
      await this.workspace.discard();
      return `Workspace '${this.workspace.id}' discarded successfully`;
    } catch (error: any) {
      return `Error discarding: ${error.message}`;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTIVITY TOOLS
// ═══════════════════════════════════════════════════════════════════════════════

class WorkspaceLogActivityTool extends StructuredTool {
  name = "workspace_log_activity";
  description =
    "Log an activity entry (decision, observation, or note) to the workspace activity log";
  schema = z.object({
    type: z
      .enum(["decision", "observation", "error"])
      .describe("Type of activity entry"),
    message: z.string().describe("Description of the activity"),
    metadata: z
      .record(z.string(), z.any())
      .optional()
      .describe("Optional metadata to attach"),
  });

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(input: {
    type: "decision" | "observation" | "error";
    message: string;
    metadata?: Record<string, any>;
  }): Promise<string> {
    try {
      await this.workspace.logActivity({
        timestamp: new Date(),
        type: input.type,
        output: input.message,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      });
      return `Activity logged: [${input.type}] ${input.message}`;
    } catch (error: any) {
      return `Error logging activity: ${error.message}`;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCRATCHPAD TOOLS (Phase 6)
// ═══════════════════════════════════════════════════════════════════════════════

class ScratchNoteTool extends StructuredTool {
  name = "scratch_note";
  description =
    "Write or read private notes in the scratchpad. Notes are key-value pairs not tracked in git. Use for observations, decisions, context tracking.";
  schema = z.object({
    action: z
      .enum(["write", "read", "list", "delete"])
      .describe("Action to perform"),
    key: z
      .string()
      .optional()
      .describe("Note key (required for write/read/delete)"),
    value: z.string().optional().describe("Note value (required for write)"),
  });

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(input: {
    action: "write" | "read" | "list" | "delete";
    key?: string;
    value?: string;
  }): Promise<string> {
    try {
      switch (input.action) {
        case "write":
          if (!input.key || !input.value)
            return "Error: key and value required for write";
          await this.workspace.scratchpad.note(input.key, input.value);
          return `Note saved: ${input.key}`;
        case "read":
          if (!input.key) return "Error: key required for read";
          const val = await this.workspace.scratchpad.getNote(input.key);
          return val ?? `Note not found: ${input.key}`;
        case "list":
          const notes = await this.workspace.scratchpad.listNotes();
          const keys = Object.keys(notes);
          if (keys.length === 0) return "No notes";
          return keys.map((k) => `${k}: ${notes[k]}`).join("\n");
        case "delete":
          if (!input.key) return "Error: key required for delete";
          const deleted = await this.workspace.scratchpad.deleteNote(input.key);
          return deleted
            ? `Note deleted: ${input.key}`
            : `Note not found: ${input.key}`;
      }
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
}

class ScratchTodoTool extends StructuredTool {
  name = "scratch_todo";
  description =
    "Manage internal TODOs in the scratchpad. Track sub-tasks, follow-ups, and things to remember during task execution.";
  schema = z.object({
    action: z.enum(["add", "complete", "list"]).describe("Action to perform"),
    text: z.string().optional().describe("Todo text (required for add)"),
    todoId: z.string().optional().describe("Todo ID (required for complete)"),
  });

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(input: {
    action: "add" | "complete" | "list";
    text?: string;
    todoId?: string;
  }): Promise<string> {
    try {
      switch (input.action) {
        case "add":
          if (!input.text) return "Error: text required";
          const id = await this.workspace.scratchpad.addTodo(input.text);
          return `Todo added: ${id} — ${input.text}`;
        case "complete":
          if (!input.todoId) return "Error: todoId required";
          const ok = await this.workspace.scratchpad.completeTodo(input.todoId);
          return ok
            ? `Todo completed: ${input.todoId}`
            : `Todo not found: ${input.todoId}`;
        case "list":
          const todos = await this.workspace.scratchpad.listTodos();
          if (todos.length === 0) return "No TODOs";
          return todos
            .map((t) => `${t.completed ? "✅" : "⬜"} [${t.id}] ${t.text}`)
            .join("\n");
      }
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
}

class ScratchRememberTool extends StructuredTool {
  name = "scratch_remember";
  description =
    "Store important facts to remember. These facts can be injected into context for future steps. Use for key discoveries, constraints, patterns.";
  schema = z.object({
    action: z.enum(["add", "list"]).describe("Action to perform"),
    fact: z.string().optional().describe("Fact to remember (required for add)"),
  });

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(input: {
    action: "add" | "list";
    fact?: string;
  }): Promise<string> {
    try {
      switch (input.action) {
        case "add":
          if (!input.fact) return "Error: fact required";
          await this.workspace.scratchpad.remember(input.fact);
          return `Remembered: ${input.fact}`;
        case "list":
          const facts = await this.workspace.scratchpad.getRemembered();
          if (facts.length === 0) return "Nothing remembered yet";
          return facts.map((f, i) => `${i + 1}. ${f}`).join("\n");
      }
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
}

class ScratchFileTool extends StructuredTool {
  name = "scratch_file";
  description =
    "Write or read files in the scratchpad. Use for trial scripts, research docs, experiments. These files are NOT tracked in git.";
  schema = z.object({
    action: z.enum(["write", "read", "list"]).describe("Action to perform"),
    path: z
      .string()
      .optional()
      .describe(
        "Relative file path within scratchpad (required for write/read)",
      ),
    content: z
      .string()
      .optional()
      .describe("File content (required for write)"),
  });

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(input: {
    action: "write" | "read" | "list";
    path?: string;
    content?: string;
  }): Promise<string> {
    try {
      switch (input.action) {
        case "write":
          if (!input.path || !input.content)
            return "Error: path and content required";
          await this.workspace.scratchpad.writeFile(input.path, input.content);
          return `Scratch file written: ${input.path}`;
        case "read":
          if (!input.path) return "Error: path required";
          return await this.workspace.scratchpad.readFile(input.path);
        case "list":
          const files = await this.workspace.scratchpad.listFiles();
          if (files.length === 0) return "No scratch files";
          return files.join("\n");
      }
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
}

class PromoteToWorkspaceTool extends StructuredTool {
  name = "promote_to_workspace";
  description =
    "Move a file from the scratchpad (Zone 1) to the workspace (Zone 2). The file becomes git-tracked.";
  schema = z.object({
    scratchPath: z.string().describe("Source path within scratchpad"),
    workspacePath: z
      .string()
      .describe(
        "Destination path within workspace (e.g., 'artifacts/code/handler.ts')",
      ),
  });

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(input: {
    scratchPath: string;
    workspacePath: string;
  }): Promise<string> {
    try {
      const content = await this.workspace.scratchpad.readFile(
        input.scratchPath,
      );
      // Create or update file in workspace (git-tracked)
      try {
        await this.workspace.updateFile(input.workspacePath, content);
      } catch {
        await this.workspace.createFile(input.workspacePath, content);
      }
      return `Promoted: .scratch/${input.scratchPath} → ${input.workspacePath}`;
    } catch (error: any) {
      return `Error promoting: ${error.message}`;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEARCH & FILE UTILITY TOOLS (Phase 5)
// ═══════════════════════════════════════════════════════════════════════════════

class WorkspaceGrepTool extends StructuredTool {
  name = "workspace_grep";
  description =
    "Search for a regex or literal pattern across workspace files using ripgrep. Returns matching lines with file path, line number, and content.";
  schema = z.object({
    pattern: z.string().describe("Search pattern (regex or literal text)"),
    glob: z
      .string()
      .optional()
      .describe("Glob filter for files (e.g., '*.ts', 'src/**/*.js')"),
    ignoreCase: z
      .boolean()
      .optional()
      .describe("Case-insensitive search (default: true)"),
    maxResults: z
      .number()
      .optional()
      .describe("Maximum results to return (default: 100)"),
    contextLines: z
      .number()
      .optional()
      .describe("Number of surrounding context lines (default: 0)"),
  });

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(input: {
    pattern: string;
    glob?: string;
    ignoreCase?: boolean;
    maxResults?: number;
    contextLines?: number;
  }): Promise<string> {
    try {
      const results = await this.workspace.grep(input.pattern, {
        glob: input.glob,
        ignoreCase: input.ignoreCase,
        maxResults: input.maxResults,
        contextLines: input.contextLines,
      });
      if (results.length === 0) return "No matches found";
      return results.map((r) => `${r.file}:${r.line}: ${r.content}`).join("\n");
    } catch (error: any) {
      return `Error searching: ${error.message}`;
    }
  }
}

class WorkspaceGlobTool extends StructuredTool {
  name = "workspace_glob";
  description =
    "Find files matching a glob pattern in the workspace. Returns relative file paths.";
  schema = z.object({
    pattern: z
      .string()
      .describe("Glob pattern (e.g., '**/*.ts', 'src/**/*.test.js')"),
    maxResults: z
      .number()
      .optional()
      .describe("Maximum results (default: 200)"),
    onlyDirectories: z
      .boolean()
      .optional()
      .describe("Find only directories (default: false)"),
  });

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(input: {
    pattern: string;
    maxResults?: number;
    onlyDirectories?: boolean;
  }): Promise<string> {
    try {
      const files = await this.workspace.glob(input.pattern, {
        maxResults: input.maxResults,
        onlyDirectories: input.onlyDirectories,
      });
      if (files.length === 0) return "No files found";
      return files.join("\n");
    } catch (error: any) {
      return `Error globbing: ${error.message}`;
    }
  }
}

class WorkspaceSearchAndReplaceTool extends StructuredTool {
  name = "workspace_search_and_replace";
  description =
    "Find and replace text within a single file. Returns the number of replacements made.";
  schema = z.object({
    path: z.string().describe("Relative file path"),
    search: z.string().describe("Text or regex pattern to find"),
    replace: z.string().describe("Replacement text"),
    isRegex: z
      .boolean()
      .optional()
      .describe("Treat search as regex (default: false)"),
    all: z
      .boolean()
      .optional()
      .describe("Replace all occurrences (default: true)"),
  });

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(input: {
    path: string;
    search: string;
    replace: string;
    isRegex?: boolean;
    all?: boolean;
  }): Promise<string> {
    try {
      const content = await this.workspace.readFile(input.path);

      let pattern: string | RegExp;
      if (input.isRegex) {
        const flags = input.all !== false ? "g" : "";
        pattern = new RegExp(input.search, flags);
      } else {
        if (input.all !== false) {
          // Escape special regex chars for literal replacement
          const escaped = input.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          pattern = new RegExp(escaped, "g");
        } else {
          pattern = input.search;
        }
      }

      const newContent = content.replace(pattern, input.replace);
      const original = content;
      if (newContent === original) {
        return "No matches found — file unchanged";
      }

      await this.workspace.updateFile(input.path, newContent);

      // Count replacements
      const oldMatches =
        typeof pattern === "string"
          ? content.includes(pattern)
            ? 1
            : 0
          : (content.match(pattern)?.length ?? 0);
      return `Replaced ${oldMatches} occurrence(s) in ${input.path}`;
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
}

class WorkspaceFileStatsTool extends StructuredTool {
  name = "workspace_file_stats";
  description =
    "Get file metadata (size, last modified, extension) without reading the full content. Useful for checking file details before reading.";
  schema = z.object({
    path: z.string().describe("Relative file path"),
  });

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(input: { path: string }): Promise<string> {
    try {
      const stats = await this.workspace.fileStats(input.path);
      return JSON.stringify(
        {
          ...stats,
          size: `${stats.size} bytes`,
          lastModified: stats.lastModified.toISOString(),
        },
        null,
        2,
      );
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// KEYWORD SEARCH TOOL (Phase 8)
// ═══════════════════════════════════════════════════════════════════════════════

class WorkspaceKeywordSearchTool extends StructuredTool {
  name = "keyword_search";
  description =
    "Relevance-ranked keyword search across workspace files using BM25-like scoring. Returns the most relevant file sections for a natural language query. Better than grep for concept-level search (e.g. 'authentication handler').";
  schema = z.object({
    query: z
      .string()
      .describe(
        "Natural language search query (e.g., 'error handling middleware')",
      ),
    topK: z
      .number()
      .optional()
      .describe("Maximum results to return (default: 10)"),
  });

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(input: { query: string; topK?: number }): Promise<string> {
    try {
      const results = this.workspace.search.keywordSearch(
        input.query,
        input.topK ?? 10,
      );
      if (results.length === 0) return "No matches found";
      return results
        .map(
          (r) =>
            `[${r.score.toFixed(2)}] ${r.file}:${r.lineStart}-${r.lineEnd}\n${r.content}`,
        )
        .join("\n\n");
    } catch (error: any) {
      return `Error searching: ${error.message}`;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// IDENTITY TOOLS (Phase 9)
// ═══════════════════════════════════════════════════════════════════════════════

class WhoAmITool extends StructuredTool {
  name = "whoami";
  description =
    "Get your identity: role, skills, current task, and goal. Use this to understand who you are and what you should be doing.";
  schema = z.object({});

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(): Promise<string> {
    const card = this.workspace.identityCard;
    if (!card) return "Identity card not configured for this workspace.";
    try {
      const snap = await card.toJSON();
      return JSON.stringify(
        { identity: snap.identity, task: snap.task },
        null,
        2,
      );
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
}

class MyProgressTool extends StructuredTool {
  name = "my_progress";
  description =
    "See what you have accomplished so far: files created, commits made, scratchpad notes, elapsed time.";
  schema = z.object({});

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(): Promise<string> {
    const card = this.workspace.identityCard;
    if (!card) return "Identity card not configured for this workspace.";
    try {
      const progress = await card.getProgress();
      return JSON.stringify(progress, null, 2);
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
}

class MyToolsTool extends StructuredTool {
  name = "my_tools";
  description =
    "List all tools available to you with their descriptions. Use this to discover capabilities you may not be aware of.";
  schema = z.object({});

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(): Promise<string> {
    const card = this.workspace.identityCard;
    if (!card) return "Identity card not configured for this workspace.";
    try {
      const tools = card.getToolManifest();
      if (tools.length === 0) return "No tools registered in identity card.";
      return tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
}

class MyContextTool extends StructuredTool {
  name = "my_context";
  description =
    "See the big picture: team goal, loaded knowledge, dependency outputs, plan overview.";
  schema = z.object({});

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(): Promise<string> {
    const card = this.workspace.identityCard;
    if (!card) return "Identity card not configured for this workspace.";
    try {
      const context = card.getCurrentContext();
      return JSON.stringify(context, null, 2);
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CODE INTELLIGENCE TOOLS (Phase 10) — gated by codeIntel flag
// ═══════════════════════════════════════════════════════════════════════════════

import { RepoMapBuilder } from "../codeintel/RepoMapBuilder.js";
import { SymbolIndex } from "../codeintel/SymbolIndex.js";
import { TreeSitterService } from "../codeintel/TreeSitterService.js";
import { IndexPersistence } from "../codeintel/persistence/IndexPersistence.js";

/**
 * Lazily-initialized code intel singletons per workspace root
 * (shared across all code intel tools for the same workspace)
 */
const codeIntelCache = new WeakMap<
  AgentWorkspace,
  {
    treeSitter: TreeSitterService;
    repoMap: RepoMapBuilder;
    symbolIndex: SymbolIndex;
    persistence: IndexPersistence | null;
    initialized: boolean;
  }
>();

function getCodeIntel(workspace: AgentWorkspace) {
  let ci = codeIntelCache.get(workspace);
  if (!ci) {
    const ts = new TreeSitterService();
    ci = {
      treeSitter: ts,
      repoMap: new RepoMapBuilder(workspace.basePath, ts),
      symbolIndex: new SymbolIndex(workspace.basePath, ts),
      persistence: null,
      initialized: false,
    };
    codeIntelCache.set(workspace, ci);
  }
  return ci;
}

async function ensureCodeIntelInit(workspace: AgentWorkspace) {
  const ci = getCodeIntel(workspace);
  if (!ci.initialized) {
    await ci.treeSitter.initialize();

    // Try to hydrate from L2 snapshot before full rebuild
    const branchId = workspace.branchName;
    const persistence = new IndexPersistence(
      branchId,
      ci.symbolIndex,
      workspace.search,
      "main",
    );

    const loaded = await persistence.load().catch(() => null);
    if (loaded) {
      // Snapshot loaded — only re-index changed files would go here
      // For now, snapshot gives us a warm start
      ci.persistence = persistence;
    } else {
      // No snapshot — full rebuild
      await ci.symbolIndex.indexAllSymbols();
      // Schedule initial save to L2
      ci.persistence = persistence;
      persistence.scheduleSave();
    }

    ci.initialized = true;
  }
  return ci;
}

class GetRepoMapTool extends StructuredTool {
  name = "get_repo_map";
  description =
    "Get a compressed overview of the entire codebase: classes, functions, interfaces ranked by importance. Use this to understand the project structure before diving into files.";
  schema = z.object({
    budgetTokens: z
      .number()
      .optional()
      .describe("Max tokens for the map (default: 4096)"),
    focusFiles: z
      .array(z.string())
      .optional()
      .describe("Files to prioritize in the map"),
  });

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(input: {
    budgetTokens?: number;
    focusFiles?: string[];
  }): Promise<string> {
    try {
      const ci = await ensureCodeIntelInit(this.workspace);
      const map = await ci.repoMap.buildRepoMap(
        input.budgetTokens ?? 4096,
        input.focusFiles,
      );
      return `Repo Map (${map.fileCount} files, ${map.symbolCount} symbols, ~${map.tokenCount} tokens):\n\n${map.text}`;
    } catch (error: any) {
      return `Error building repo map: ${error.message}`;
    }
  }
}

class GetSymbolsTool extends StructuredTool {
  name = "get_symbols";
  description =
    "Get all symbols (classes, functions, interfaces, exports) in a specific file. Use this to understand a file's structure without reading its full content.";
  schema = z.object({
    filePath: z.string().describe("Relative path to the file"),
  });

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(input: { filePath: string }): Promise<string> {
    try {
      const ci = await ensureCodeIntelInit(this.workspace);
      const summary = await ci.repoMap.getFileSummary(input.filePath);
      if (!summary) return `File not parseable or not found: ${input.filePath}`;

      const lines = [
        `${summary.file} (${summary.language}, ${summary.lineCount} lines)`,
      ];
      for (const sym of summary.symbols) {
        const indent = sym.kind === "method" ? "    " : "  ";
        lines.push(
          `${indent}${sym.kind} ${sym.signature} [line ${sym.line + 1}]`,
        );
      }
      return lines.join("\n");
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
}

class FindSymbolTool extends StructuredTool {
  name = "find_symbol";
  description =
    "Search for a symbol (class, function, interface, etc.) across the entire workspace. Supports exact, prefix, and fuzzy matching. Use this to find where something is defined.";
  schema = z.object({
    name: z.string().describe("Symbol name to search for"),
    mode: z
      .enum(["exact", "prefix", "fuzzy"])
      .optional()
      .describe("Match mode (default: exact)"),
    kind: z
      .string()
      .optional()
      .describe(
        "Filter by kind: class, function, method, interface, type, enum, variable",
      ),
  });

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(input: {
    name: string;
    mode?: "exact" | "prefix" | "fuzzy";
    kind?: string;
  }): Promise<string> {
    try {
      const ci = await ensureCodeIntelInit(this.workspace);
      const results = ci.symbolIndex.findSymbol(input.name, {
        mode: input.mode,
        kind: input.kind as any,
        limit: 20,
      });

      if (results.length === 0)
        return `No symbols found matching "${input.name}"`;

      return results
        .map((r) => `${r.kind} ${r.signature} → ${r.file}:${r.line + 1}`)
        .join("\n");
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
}

class GetDependenciesTool extends StructuredTool {
  name = "get_dependencies";
  description =
    "Get the imports and exports of a specific file. Use this to understand what a file depends on and what it provides.";
  schema = z.object({
    filePath: z.string().describe("Relative path to the file"),
  });

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(input: { filePath: string }): Promise<string> {
    try {
      const ci = await ensureCodeIntelInit(this.workspace);
      const deps = await ci.repoMap.getDependencies(input.filePath);
      if (!deps) return `File not parseable or not found: ${input.filePath}`;

      const lines: string[] = [];
      if (deps.imports.length > 0) {
        lines.push("Imports:");
        for (const imp of deps.imports) lines.push(`  ${imp}`);
      }
      if (deps.exports.length > 0) {
        lines.push("Exports:");
        for (const exp of deps.exports) lines.push(`  ${exp}`);
      }
      return lines.length > 0
        ? lines.join("\n")
        : "No imports or exports found.";
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
}

class GetFileSummaryTool extends StructuredTool {
  name = "get_file_summary";
  description =
    "Get a structural summary of a file: symbol outline with line numbers, language, and line count. Shows the skeleton without implementation bodies.";
  schema = z.object({
    filePath: z.string().describe("Relative path to the file"),
  });

  constructor(private workspace: AgentWorkspace) {
    super();
  }

  async _call(input: { filePath: string }): Promise<string> {
    try {
      const ci = await ensureCodeIntelInit(this.workspace);
      const summary = await ci.repoMap.getFileSummary(input.filePath);
      if (!summary) return `File not parseable or not found: ${input.filePath}`;

      const lines = [
        `File: ${summary.file}`,
        `Language: ${summary.language}`,
        `Lines: ${summary.lineCount}`,
        `Symbols: ${summary.symbols.length}`,
        "",
      ];

      for (const sym of summary.symbols) {
        const indent = sym.kind === "method" ? "    " : "  ";
        const span =
          sym.endLine > sym.line
            ? ` (${sym.endLine - sym.line + 1} lines)`
            : "";
        lines.push(
          `${indent}[L${sym.line + 1}-${sym.endLine + 1}] ${sym.kind} ${sym.signature}${span}`,
        );
      }

      return lines.join("\n");
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create all workspace tools for injection into an agent
 *
 * @param workspace - The agent's workspace instance
 * @param options - Optional configuration
 * @param options.codeIntel - Include code intelligence tools (tree-sitter based). Default: false
 */
export function createWorkspaceTools(
  workspace: AgentWorkspace,
  options?: { codeIntel?: boolean },
): StructuredTool[] {
  const tools: StructuredTool[] = [
    // Status & info
    new WorkspaceStatusTool(workspace),
    new WorkspaceInfoTool(workspace),
    // File operations
    new WorkspaceCreateFileTool(workspace),
    new WorkspaceReadFileTool(workspace),
    new WorkspaceWriteFileTool(workspace),
    new WorkspaceDeleteFileTool(workspace),
    new WorkspaceFileExistsTool(workspace),
    new WorkspaceListFilesTool(workspace),
    // Version control
    new WorkspaceCommitTool(workspace),
    new WorkspaceGetHistoryTool(workspace),
    // Lifecycle
    new WorkspacePublishTool(workspace),
    new WorkspaceReactivateTool(workspace),
    new WorkspaceDiscardTool(workspace),
    // Activity
    new WorkspaceLogActivityTool(workspace),
    // Search & file utilities (Phase 5)
    new WorkspaceGrepTool(workspace),
    new WorkspaceGlobTool(workspace),
    new WorkspaceSearchAndReplaceTool(workspace),
    new WorkspaceFileStatsTool(workspace),
    // Scratchpad (Phase 6)
    new ScratchNoteTool(workspace),
    new ScratchTodoTool(workspace),
    new ScratchRememberTool(workspace),
    new ScratchFileTool(workspace),
    new PromoteToWorkspaceTool(workspace),
    // Keyword search (Phase 8)
    new WorkspaceKeywordSearchTool(workspace),
    // Identity (Phase 9)
    new WhoAmITool(workspace),
    new MyProgressTool(workspace),
    new MyToolsTool(workspace),
    new MyContextTool(workspace),
  ];

  // Code intelligence tools (Phase 10) — only for code-type agents
  if (options?.codeIntel) {
    tools.push(
      new GetRepoMapTool(workspace),
      new GetSymbolsTool(workspace),
      new FindSymbolTool(workspace),
      new GetDependenciesTool(workspace),
      new GetFileSummaryTool(workspace),
    );
  }

  return tools;
}
