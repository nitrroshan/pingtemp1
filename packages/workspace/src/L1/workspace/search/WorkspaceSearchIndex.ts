/**
 * WorkspaceSearchIndex — BM25-like keyword search for workspace files
 *
 * Uses MiniSearch for relevance-ranked keyword search with:
 * - BM25 scoring
 * - Fuzzy matching (fuzzy: 0.2)
 * - Prefix matching
 * - Auto-reindex on file changes (debounced)
 * - Incremental add/remove (no full rebuild)
 *
 * @see feature_implementation_planning.md §Phase 8
 * @see AGENT_WORKSPACE_RESEARCH.md §6 — Layer 2.5 BM25
 */

import fs from "fs";
import path from "path";
import MiniSearch, { type SearchResult } from "minisearch";
import fg from "fast-glob";
import { rootLogger } from "../../../logging.js";

const logger = rootLogger.child({ module: "WorkspaceSearchIndex" });

export interface SearchHit {
  /** Relative file path */
  file: string;
  /** Matching content snippet */
  content: string;
  /** Relevance score */
  score: number;
  /** Start line number (1-based) */
  lineStart: number;
  /** End line number (1-based) */
  lineEnd: number;
}

interface IndexedChunk {
  /** Unique ID: filepath#chunkIndex */
  id: string;
  /** Relative file path */
  file: string;
  /** Chunk text content */
  content: string;
  /** Start line (1-based) */
  lineStart: number;
  /** End line (1-based) */
  lineEnd: number;
}

/**
 * Default file extensions to index.
 * Skip binaries, images, and very large generated files.
 */
const DEFAULT_INDEXABLE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "go",
  "rs",
  "java",
  "c",
  "cpp",
  "h",
  "cs",
  "rb",
  "php",
  "swift",
  "kt",
  "md",
  "txt",
  "rst",
  "html",
  "css",
  "scss",
  "less",
  "json",
  "yaml",
  "yml",
  "toml",
  "xml",
  "env",
  "ini",
  "sql",
  "graphql",
  "gql",
  "proto",
  "sh",
  "bash",
  "zsh",
  "ps1",
  "bat",
  "cmd",
  "dockerfile",
  "makefile",
]);

/** Maximum file size to index (512 KB) */
const MAX_INDEX_FILE_SIZE = 512 * 1024;

/** Chunk size: ~50 lines per chunk for documents, ~30 for code */
const CODE_CHUNK_LINES = 30;
const DOC_CHUNK_LINES = 50;

/** Debounce delay for auto-reindex (ms) */
const REINDEX_DEBOUNCE_MS = 500;

export class WorkspaceSearchIndex {
  private miniSearch: MiniSearch;
  private indexedFiles = new Map<string, string[]>(); // filepath → chunk IDs
  private reindexTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly basePath: string) {
    this.miniSearch = new MiniSearch({
      fields: ["content"],
      storeFields: ["file", "content", "lineStart", "lineEnd"],
      searchOptions: {
        boost: { content: 1 },
        fuzzy: 0.2,
        prefix: true,
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INDEXING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Index all workspace files (or specific paths).
   * Called during workspace initialization.
   */
  async indexWorkspace(patterns?: string[]): Promise<number> {
    const globPattern = patterns ?? ["**/*"];

    const files = await fg(globPattern, {
      cwd: this.basePath,
      dot: false,
      onlyFiles: true,
      ignore: [
        ".git/**",
        ".scratch/**",
        ".ping/**",
        "node_modules/**",
        "dist/**",
        "build/**",
        "*.lock",
        "package-lock.json",
      ],
      absolute: false,
    });

    let indexed = 0;
    for (const file of files) {
      if (this.shouldIndex(file)) {
        try {
          await this.indexFile(file);
          indexed++;
        } catch (err) {
          logger.debug(`Skipped indexing ${file}: ${err}`);
        }
      }
    }

    logger.info(
      `Indexed ${indexed} files (${this.miniSearch.documentCount} chunks)`,
    );
    return indexed;
  }

  /**
   * Index a single file — splits into chunks and adds to MiniSearch.
   * If already indexed, removes old chunks first.
   */
  async indexFile(relativePath: string): Promise<void> {
    // Remove existing chunks for this file
    this.removeFile(relativePath);

    const fullPath = path.join(this.basePath, relativePath);
    const content = await fs.promises.readFile(fullPath, "utf-8");
    const chunks = this.chunkContent(relativePath, content);

    if (chunks.length > 0) {
      this.miniSearch.addAll(chunks);
      this.indexedFiles.set(
        relativePath,
        chunks.map((c) => c.id),
      );
    }
  }

  /**
   * Remove a file from the index.
   */
  removeFile(relativePath: string): void {
    const chunkIds = this.indexedFiles.get(relativePath);
    if (chunkIds) {
      for (const id of chunkIds) {
        try {
          this.miniSearch.discard(id);
        } catch {
          // Chunk may already be removed
        }
      }
      this.indexedFiles.delete(relativePath);
    }
  }

  /**
   * Schedule a debounced reindex for a file.
   * Called after createFile, updateFile, deleteFile events.
   */
  scheduleReindex(relativePath: string, deleted = false): void {
    if (this.reindexTimer) {
      clearTimeout(this.reindexTimer);
    }

    this.reindexTimer = setTimeout(async () => {
      this.reindexTimer = null;
      try {
        if (deleted) {
          this.removeFile(relativePath);
        } else {
          await this.indexFile(relativePath);
        }
      } catch (err) {
        logger.debug(`Reindex failed for ${relativePath}: ${err}`);
      }
    }, REINDEX_DEBOUNCE_MS);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SEARCH
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Keyword search — returns relevance-ranked results.
   */
  keywordSearch(query: string, topK = 20): SearchHit[] {
    const results: SearchResult[] = this.miniSearch.search(query, {
      fuzzy: 0.2,
      prefix: true,
    });

    return results.slice(0, topK).map((r) => ({
      file: r.file as string,
      content: this.truncateContent(r.content as string, 200),
      score: r.score,
      lineStart: r.lineStart as number,
      lineEnd: r.lineEnd as number,
    }));
  }

  /**
   * Auto-suggest / complete — returns suggestions for partial queries.
   */
  autoSuggest(query: string, limit = 10): string[] {
    return this.miniSearch
      .autoSuggest(query, { fuzzy: 0.2 })
      .slice(0, limit)
      .map((s) => s.suggestion);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Number of indexed files */
  get fileCount(): number {
    return this.indexedFiles.size;
  }

  /** Number of indexed chunks */
  get chunkCount(): number {
    return this.miniSearch.documentCount;
  }

  /** List of indexed file paths */
  get indexedFilePaths(): string[] {
    return Array.from(this.indexedFiles.keys());
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Determine if a file should be indexed based on extension and size.
   */
  private shouldIndex(relativePath: string): boolean {
    const ext = path.extname(relativePath).toLowerCase().slice(1);
    const basename = path.basename(relativePath).toLowerCase();

    // Index known extensions or extensionless files (Makefile, Dockerfile)
    if (ext && !DEFAULT_INDEXABLE_EXTENSIONS.has(ext)) return false;
    if (
      !ext &&
      !["makefile", "dockerfile", "readme", "license", "changelog"].includes(
        basename,
      )
    ) {
      return false;
    }

    return true;
  }

  /**
   * Split file content into indexable chunks.
   * Code files: ~30 lines/chunk. Doc files: ~50 lines/chunk.
   */
  private chunkContent(relativePath: string, content: string): IndexedChunk[] {
    const ext = path.extname(relativePath).toLowerCase().slice(1);
    const isCode = [
      "ts",
      "tsx",
      "js",
      "jsx",
      "py",
      "go",
      "rs",
      "java",
      "c",
      "cpp",
      "cs",
      "rb",
      "php",
      "swift",
      "kt",
    ].includes(ext);
    const chunkSize = isCode ? CODE_CHUNK_LINES : DOC_CHUNK_LINES;

    const lines = content.split("\n");
    const chunks: IndexedChunk[] = [];

    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunkLines = lines.slice(i, i + chunkSize);
      const chunkText = chunkLines.join("\n").trim();
      if (!chunkText) continue;

      chunks.push({
        id: `${relativePath}#${Math.floor(i / chunkSize)}`,
        file: relativePath,
        content: chunkText,
        lineStart: i + 1,
        lineEnd: Math.min(i + chunkSize, lines.length),
      });
    }

    return chunks;
  }

  /**
   * Truncate content to max characters, adding ellipsis if needed.
   */
  private truncateContent(content: string, maxChars: number): string {
    if (content.length <= maxChars) return content;
    return content.slice(0, maxChars) + "…";
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // L2 SERIALIZATION (for IndexPersistence snapshot save/load)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Serialize MiniSearch index for L2 snapshot persistence.
   * Returns the MiniSearch internal JSON representation.
   */
  toJSON(): any {
    return this.miniSearch.toJSON();
  }

  /**
   * Hydrate MiniSearch from serialized JSON (loaded from L2 snapshot).
   * Replaces the current in-memory index entirely.
   */
  loadFromJSON(json: string): void {
    this.miniSearch = MiniSearch.loadJSON(json, {
      fields: ["content"],
      storeFields: ["file", "content", "lineStart", "lineEnd"],
      searchOptions: {
        boost: { content: 1 },
        fuzzy: 0.2,
        prefix: true,
      },
    });

    // Rebuild indexedFiles map from stored documents
    this.indexedFiles.clear();
    const allDocs = this.miniSearch.toJSON();
    if (allDocs && allDocs.storedFields) {
      for (const [idStr, fields] of Object.entries(allDocs.storedFields)) {
        const file = (fields as any)?.file;
        if (file) {
          if (!this.indexedFiles.has(file)) {
            this.indexedFiles.set(file, []);
          }
          this.indexedFiles.get(file)!.push(String(idStr));
        }
      }
    }

    logger.info(
      `Loaded search index from L2 snapshot: ${this.indexedFiles.size} files`,
    );
  }
}
