/**
 * CollabServer — Embedded Hocuspocus CRDT server
 *
 * Provides real-time Yjs document collaboration with:
 * - **In-process access** via `openDoc()` (agents, backend code)
 * - **WebSocket access** (frontend BlockNote editor)
 * - **Database extension** for persistent storage to `data/collab/yjs/`
 * - **onChange projection** — CRDT → readable files in `.ping/collaboration/`
 *
 * @see feature_implementation_planning.md Phase 2a
 */

import { Hocuspocus, Server as HocuspocusHTTPServer } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import * as fs from "fs/promises";
import * as path from "path";
import * as Y from "yjs";
import crypto from "crypto";
import { rootLogger } from "../../logging.js";
import type { ICollabProvider } from "./types/collab-provider.types.js";
import type { BlobStorageProvider } from "./types/blob-storage.types.js";
import { FsBlobStorage, HocuspocusBlobStorageAdapter } from "./HocuspocusBlobStorageAdapter.js";

const logger = rootLogger.child({ module: "CollabServer" });

/**
 * Convert Yjs doc name (may contain slashes) to a safe filename
 */
function docNameToFilename(docName: string): string {
  return docName.replace(/\//g, "_");
}

/**
 * Convert safe filename back to doc name
 */
function filenameToDocName(filename: string): string {
  return filename.replace(/_/g, "/");
}

/**
 * Project CRDT state → readable filesystem files for orchestrator/planner.
 *
 * Convention-based: inspects Yjs shared types and writes to
 * `.ping/collaboration/` in the workspace repo.
 *
 * Special handling for task/plan/goal docs:
 *   - {teamId}/{goalId}/{taskId}/task → YAML frontmatter + markdown body (.md)
 *   - {teamId}/{goalId}/plan          → YAML frontmatter + markdown body (.md)
 *   - {teamId}/{goalId}/goal          → YAML frontmatter + markdown body (.md)
 *
 * A single Yjs doc may contain multiple shared types (e.g. a Y.Map named
 * after the doc for data, plus a "default" Y.Map for _meta). We merge all
 * Y.Map shared types into a single JSON file and concatenate all Y.Array
 * items so nothing is silently overwritten.
 */
async function projectToFilesystem(
  docName: string,
  doc: Y.Doc,
  repoPath?: string,
): Promise<void> {
  const parts = docName.split("/");
  if (parts.length < 3) return; // Need teamId/goalId/docType

  const [_teamId, _goalId, ...rest] = parts;
  const docType = rest.join("/");
  const base = repoPath || ".";
  const projDir = path.join(base, ".ping", "collaboration");
  await fs.mkdir(projDir, { recursive: true });

  // ─── Special handling: task/plan/goal docs → YAML frontmatter + markdown ───
  // Fix #6: Use regex patterns for more robust detection
  // Patterns:
  //   goal         → goal.md
  //   plan         → plan.md
  //   {taskId}/task → {taskId}/task.md  (regex: ^[^/]+\/task$)
  const isTaskDoc = /^[^/]+\/task$/.test(docType);
  const isPlanDoc = docType === "plan";
  const isGoalDoc = docType === "goal";

  if (isTaskDoc || isPlanDoc || isGoalDoc) {
    try {
      const mapName = isTaskDoc ? "task" : isGoalDoc ? "goal" : "plan";
      const sharedType = doc.share.get(mapName);
      if (sharedType && sharedType instanceof Y.Map) {
        const data = sharedType.toJSON();
        if (data && data.id) {
          const body = data.body || "";
          const { body: _body, ...frontmatter } = data;

          // Build YAML frontmatter
          const yamlLines = ["---"];
          for (const [key, val] of Object.entries(frontmatter)) {
            if (val == null) continue;
            if (Array.isArray(val)) {
              yamlLines.push(`${key}:`);
              for (const item of val) {
                if (typeof item === "object") {
                  yamlLines.push(`  - ${JSON.stringify(item)}`);
                } else {
                  yamlLines.push(`  - ${item}`);
                }
              }
            } else if (typeof val === "object") {
              yamlLines.push(`${key}: ${JSON.stringify(val)}`);
            } else {
              yamlLines.push(`${key}: ${JSON.stringify(val)}`);
            }
          }
          yamlLines.push("---");
          yamlLines.push("");
          yamlLines.push(body);

          const mdContent = yamlLines.join("\n");

          // Ensure parent directory exists for task docs (e.g., task-003/)
          const mdDir = path.join(projDir, path.dirname(docType));
          await fs.mkdir(mdDir, { recursive: true });

          await fs.writeFile(
            path.join(projDir, `${docType}.md`),
            mdContent,
          );
          return; // Done — skip generic projection
        }
      }
    } catch (err) {
      logger.warn(`Markdown projection failed for ${docName}: ${err}`);
      // Fall through to generic projection
    }
  }
  // ───────────────────────────────────────────────────────────────────────────

  // Collect all shared types, then write once per output type
  const mergedMap: Record<string, any> = {};
  const mergedArrayItems: any[] = [];
  const textParts: string[] = [];
  const xmlMarkdownParts: string[] = [];

  for (const [_key, sharedType] of doc.share.entries()) {
    try {
      if (sharedType instanceof Y.Map) {
        // Merge all Y.Map shared types into one object
        const json = sharedType.toJSON();
        Object.assign(mergedMap, json);
      } else if (sharedType instanceof Y.Array) {
        // Concatenate all Y.Array items
        mergedArrayItems.push(...sharedType.toJSON());
      } else if (sharedType instanceof Y.Text) {
        const text = sharedType.toString();
        if (text.length > 0) textParts.push(text);
      } else if (sharedType instanceof Y.XmlFragment) {
        // XmlFragment → markdown for planner readability
        const md = xmlFragmentToMarkdown(sharedType);
        if (md.length > 0) xmlMarkdownParts.push(md);
      }
    } catch (err) {
      logger.warn(`Projection failed for ${docName} (shared type): ${err}`);
    }
  }

  // Write merged Y.Map data
  if (Object.keys(mergedMap).length > 0) {
    try {
      await fs.writeFile(
        path.join(projDir, `${docType}.json`),
        JSON.stringify(mergedMap, null, 2),
      );
    } catch (err) {
      logger.warn(`Projection write failed for ${docName} (map): ${err}`);
    }
  }

  // Write merged Y.Array items
  if (mergedArrayItems.length > 0) {
    try {
      const arrDir = path.join(projDir, docType);
      await fs.mkdir(arrDir, { recursive: true });
      for (const item of mergedArrayItems) {
        const itemId =
          item.id ?? item.sessionId ?? item.taskId ?? crypto.randomUUID();
        await fs.writeFile(
          path.join(arrDir, `${itemId}.json`),
          JSON.stringify(item, null, 2),
        );
      }
    } catch (err) {
      logger.warn(`Projection write failed for ${docName} (array): ${err}`);
    }
  }

  // Write concatenated Y.Text
  if (textParts.length > 0) {
    try {
      await fs.writeFile(
        path.join(projDir, `${docType}.txt`),
        textParts.join("\n"),
      );
    } catch (err) {
      logger.warn(`Projection write failed for ${docName} (text): ${err}`);
    }
  }

  // Write XmlFragment as markdown
  if (xmlMarkdownParts.length > 0) {
    try {
      await fs.writeFile(
        path.join(projDir, `${docType}.md`),
        xmlMarkdownParts.join("\n\n"),
      );
    } catch (err) {
      logger.warn(`Projection write failed for ${docName} (xml→md): ${err}`);
    }
  }
}

/**
 * Convert a Y.XmlFragment to simple markdown.
 *
 * Handles common BlockNote block types (paragraph, heading, list-item,
 * code-block). Unknown elements are serialized as plain text.
 */
function xmlFragmentToMarkdown(fragment: Y.XmlFragment): string {
  const lines: string[] = [];

  for (const child of fragment.toArray()) {
    if (child instanceof Y.XmlElement) {
      const tag = child.nodeName;
      const text = xmlElementText(child);

      switch (tag) {
        case "heading": {
          const level = parseInt(child.getAttribute("level") || "1", 10);
          lines.push(`${"#".repeat(Math.min(level, 6))} ${text}`);
          break;
        }
        case "paragraph":
          lines.push(text);
          break;
        case "bulletListItem":
        case "list-item":
          lines.push(`- ${text}`);
          break;
        case "numberedListItem":
          lines.push(`1. ${text}`);
          break;
        case "codeBlock":
        case "code-block": {
          const lang = child.getAttribute("language") || "";
          lines.push(`\`\`\`${lang}`, text, "\`\`\`");
          break;
        }
        case "blockquote":
          lines.push(`> ${text}`);
          break;
        // Fix #17: Handle additional BlockNote block types
        case "image": {
          const src = child.getAttribute("url") || child.getAttribute("src") || "";
          const alt = child.getAttribute("caption") || child.getAttribute("alt") || "image";
          lines.push(`![${alt}](${src})`);
          break;
        }
        case "table":
          lines.push(`[Table content]`);
          break;
        case "checkListItem": {
          const checked = child.getAttribute("checked") === "true";
          lines.push(`- [${checked ? "x" : " "}] ${text}`);
          break;
        }
        default:
          // Unknown element — emit plain text
          if (text.length > 0) lines.push(text);
          break;
      }
    } else if (child instanceof Y.XmlText) {
      const str = child.toString();
      if (str.length > 0) lines.push(str);
    }
  }

  return lines.join("\n");
}

/**
 * Extract text content from a Y.XmlElement, recursing into children.
 */
function xmlElementText(el: Y.XmlElement): string {
  const parts: string[] = [];
  for (const child of el.toArray()) {
    if (child instanceof Y.XmlText) {
      parts.push(child.toString());
    } else if (child instanceof Y.XmlElement) {
      parts.push(xmlElementText(child));
    }
  }
  return parts.join("");
}

/**
 * CollabServer — Embedded Hocuspocus instance with pluggable blob storage
 *
 * Storage backends:
 * - Default (no blobStorage): filesystem via FsBlobStorage
 * - Azure: pass AzureBlobStorageProvider
 * - S3: pass S3BlobStorageProvider
 */
export class CollabServer implements ICollabProvider {
  /** The Server wraps Hocuspocus + HTTP/WebSocket. We use server.hocuspocus for everything. */
  private server: HocuspocusHTTPServer;
  private storageDir: string;
  private blobAdapter: HocuspocusBlobStorageAdapter;
  private repoPath?: string;
  private started = false;

  constructor(storageDir = "./data/collab", repoPath?: string, blobStorage?: BlobStorageProvider) {
    this.storageDir = storageDir;
    this.repoPath = repoPath;

    // Use provided blob storage or default to filesystem
    const storage = blobStorage ?? new FsBlobStorage(storageDir);
    this.blobAdapter = new HocuspocusBlobStorageAdapter(storage);

    // Create Server — it internally creates ONE Hocuspocus instance
    // We use server.hocuspocus for both WebSocket AND in-process access
    this.server = new HocuspocusHTTPServer({
      quiet: true,
      extensions: [
        new Database({
          fetch: (data) => this.blobAdapter.fetch(data),
          store: (data) => this.blobAdapter.store(data),
        }),
      ],

      async onChange({
        document,
        documentName,
      }: {
        document: Y.Doc;
        documentName: string;
      }) {
        await projectToFilesystem(documentName, document, repoPath);
      },

      async onAuthenticate({ token }: { token: string }) {
        return { user: token || "anonymous" };
      },
    });
  }

  /**
   * Start listening on a port (for WebSocket — frontend BlockNote).
   * The Server handles HTTP upgrade + Hocuspocus protocol handshake.
   */
  async start(port = 1234): Promise<void> {
    return new Promise<void>((resolve) => {
      // Access the underlying HTTP server to handle 'error' event before it crashes the process
      const httpServer = (this.server as any).httpServer || (this.server as any).server;
      if (httpServer && typeof httpServer.on === 'function') {
        httpServer.on('error', (err: any) => {
          const msg = err?.message || String(err);
          if (err?.code === 'EADDRINUSE' || msg.includes('port') || msg.includes('in use')) {
            logger.warn(`CollabServer port ${port} already in use — skipping`);
          } else {
            logger.error(`CollabServer error: ${msg}`);
          }
          resolve();
        });
      }

      this.server.listen(port).then(() => {
        this.started = true;
        logger.info(`CollabServer WebSocket listening on port ${port}`);
        resolve();
      }).catch((err: any) => {
        const msg = err?.message || String(err);
        if (err?.code === 'EADDRINUSE' || msg.includes('port') || msg.includes('in use')) {
          logger.warn(`CollabServer port ${port} already in use — skipping`);
        } else {
          logger.error(`CollabServer start failed: ${msg}`);
        }
        resolve();
      });
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    if (this.started) {
      await this.server.destroy();
      this.started = false;
    }
    logger.info("CollabServer stopped");
  }

  /**
   * Open a Yjs document via in-process direct connection.
   * Uses the SAME Hocuspocus instance that serves WebSocket clients.
   */
  async openDoc(docName: string): Promise<Y.Doc> {
    const connection =
      await this.server.hocuspocus.openDirectConnection(docName);
    if (!connection.document) {
      throw new Error(`Failed to open document: ${docName}`);
    }
    return connection.document;
  }

  /**
   * Get the raw Hocuspocus instance (for advanced use)
   */
  get instance(): Hocuspocus {
    return this.server.hocuspocus;
  }

  /**
   * List all document names — both in-memory (loaded) and persisted (on disk).
   * Merges both sets for progressive discovery.
   */
  async getDocNames(): Promise<string[]> {
    const loaded = Array.from(this.server.hocuspocus.documents.keys());
    const persisted: string[] = [];
    try {
      const dir = path.join(this.storageDir, "yjs");
      const files = await fs.readdir(dir);
      for (const f of files) {
        if (f.endsWith(".bin")) {
          persisted.push(filenameToDocName(f.slice(0, -4)));
        }
      }
    } catch {
      // No storage dir yet — first run
    }
    return [...new Set([...loaded, ...persisted])];
  }
}
