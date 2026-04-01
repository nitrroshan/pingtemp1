/**
 * SymbolIndex — Cross-file symbol registry built from tree-sitter .scm tag queries
 *
 * Maintains a searchable index of all symbols across the workspace.
 * Supports exact, prefix, and fuzzy matching for symbol lookup.
 * Auto-reindexes on file changes (debounced).
 *
 * Uses TreeSitterService.extractTags() directly for symbol extraction,
 * bypassing RepoMapBuilder for a cleaner dependency graph.
 *
 * @see AGENT_WORKSPACE_RESEARCH.md §6 — Layer 3 Repo Map
 */

import fs from "fs";
import path from "path";
import fg from "fast-glob";
import { Logger } from "tslog";
import {
  TreeSitterService,
  type LanguageName,
  type TagCapture,
} from "./TreeSitterService.js";
import { type SymbolKind } from "./RepoMapBuilder.js";

const logger = new Logger({ name: "SymbolIndex" });

// =============================================================================
// Types
// =============================================================================

/**
 * Symbol location (for find operations)
 */
export interface SymbolLocation {
  /** Symbol name */
  name: string;
  /** Symbol kind */
  kind: SymbolKind;
  /** Relative file path */
  file: string;
  /** Line number (0-based) */
  line: number;
  /** End line (0-based) */
  endLine: number;
  /** Symbol signature (first line) */
  signature: string;
  /** Language */
  language: LanguageName;
}

/**
 * Symbol search options
 */
export interface SymbolSearchOptions {
  /** Match mode: exact, prefix, or fuzzy (default: exact) */
  mode?: "exact" | "prefix" | "fuzzy";
  /** Filter by kind */
  kind?: SymbolKind;
  /** Filter by file pattern (glob) */
  filePattern?: string;
  /** Maximum results (default: 20) */
  limit?: number;
}

/**
 * Reference info (where a symbol is used)
 */
export interface SymbolReference {
  /** File where the symbol is referenced */
  file: string;
  /** Lines where the reference appears (0-based) */
  lines: number[];
}

// =============================================================================
// Constants
// =============================================================================

const IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.scratch/**",
  "**/.ping/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/*.min.js",
  "**/*.lock",
];

/** Max file size for indexing (256KB) */
const MAX_INDEX_SIZE = 256 * 1024;

/** Debounce delay for auto-reindex */
const REINDEX_DEBOUNCE_MS = 1000;

// =============================================================================
// SymbolIndex
// =============================================================================

export class SymbolIndex {
  /** All symbols indexed by name → locations */
  private symbols = new Map<string, SymbolLocation[]>();

  /** Symbols indexed by file → symbols (for incremental updates) */
  private fileSymbols = new Map<string, SymbolLocation[]>();

  /** TreeSitter service */
  private treeSitter: TreeSitterService;

  /** Root directory */
  private rootDir: string;

  /** Whether the index has been built */
  private indexed = false;

  /** Debounce timer for auto-reindex */
  private reindexTimer: ReturnType<typeof setTimeout> | null = null;

  /** Set of files pending reindex */
  private pendingReindex = new Set<string>();

  constructor(rootDir: string, treeSitter?: TreeSitterService) {
    this.rootDir = rootDir;
    this.treeSitter = treeSitter ?? new TreeSitterService();
  }

  // ===========================================================================
  // Full Index Build
  // ===========================================================================

  /**
   * Index all symbols in the workspace
   */
  async indexAllSymbols(patterns?: string[]): Promise<number> {
    const extensions = this.treeSitter.getSupportedExtensions();
    const filePatterns = patterns ?? extensions.map((ext) => `**/*${ext}`);

    const files = await fg(filePatterns, {
      cwd: this.rootDir,
      ignore: IGNORE_PATTERNS,
      absolute: false,
    });

    // Clear existing index
    this.symbols.clear();
    this.fileSymbols.clear();

    let totalSymbols = 0;

    for (const file of files) {
      try {
        const count = await this.indexFile(file);
        totalSymbols += count;
      } catch {
        // Skip files that fail
      }
    }

    this.indexed = true;
    logger.info(`Indexed ${totalSymbols} symbols from ${files.length} files`);
    return totalSymbols;
  }

  /**
   * Index a single file (incremental) using .scm tag queries.
   */
  async indexFile(relPath: string): Promise<number> {
    const absPath = path.join(this.rootDir, relPath);

    // Remove old symbols for this file
    this.removeFileFromIndex(relPath);

    try {
      const stat = await fs.promises.stat(absPath);
      if (stat.size > MAX_INDEX_SIZE) return 0;

      const source = await fs.promises.readFile(absPath, "utf-8");
      const tags = await this.treeSitter.extractTags(source, absPath);

      // Filter to definitions only, map TagCapture → SymbolLocation
      const normalizedPath = path
        .relative(this.rootDir, absPath)
        .replace(/\\/g, "/");

      const locations: SymbolLocation[] = tags
        .filter((t) => t.type === "definition")
        .map((t) => ({
          name: t.name,
          kind: this.normalizeKind(t.kind),
          file: normalizedPath,
          line: t.line,
          endLine: t.endLine,
          signature: t.signature,
          language: t.language,
        }));

      // Store by file
      this.fileSymbols.set(relPath, locations);

      // Store by name
      for (const loc of locations) {
        const existing = this.symbols.get(loc.name) ?? [];
        existing.push(loc);
        this.symbols.set(loc.name, existing);
      }

      return locations.length;
    } catch {
      return 0;
    }
  }

  /**
   * Remove a file's symbols from the index
   */
  removeFile(relPath: string): void {
    this.removeFileFromIndex(relPath);
  }

  private removeFileFromIndex(relPath: string): void {
    const oldSymbols = this.fileSymbols.get(relPath);
    if (!oldSymbols) return;

    for (const sym of oldSymbols) {
      const locs = this.symbols.get(sym.name);
      if (locs) {
        const filtered = locs.filter((l) => l.file !== relPath);
        if (filtered.length === 0) {
          this.symbols.delete(sym.name);
        } else {
          this.symbols.set(sym.name, filtered);
        }
      }
    }

    this.fileSymbols.delete(relPath);
  }

  // ===========================================================================
  // Search Operations
  // ===========================================================================

  /**
   * Find a symbol by name
   */
  findSymbol(name: string, options?: SymbolSearchOptions): SymbolLocation[] {
    const mode = options?.mode ?? "exact";
    const limit = options?.limit ?? 20;
    let results: SymbolLocation[] = [];

    switch (mode) {
      case "exact":
        results = this.symbols.get(name) ?? [];
        break;

      case "prefix": {
        const lowerName = name.toLowerCase();
        for (const [key, locs] of this.symbols) {
          if (key.toLowerCase().startsWith(lowerName)) {
            results.push(...locs);
          }
        }
        break;
      }

      case "fuzzy": {
        const lowerName = name.toLowerCase();
        for (const [key, locs] of this.symbols) {
          if (this.fuzzyMatch(lowerName, key.toLowerCase())) {
            results.push(...locs);
          }
        }
        break;
      }
    }

    // Apply filters
    if (options?.kind) {
      results = results.filter((r) => r.kind === options.kind);
    }
    if (options?.filePattern) {
      const globPattern = options.filePattern;
      results = results.filter((r) =>
        this.simpleGlobMatch(r.file, globPattern),
      );
    }

    return results.slice(0, limit);
  }

  /**
   * Find where a symbol is defined
   */
  findDefinition(name: string): SymbolLocation | null {
    const locs = this.symbols.get(name);
    if (!locs || locs.length === 0) return null;

    // Prefer class/interface/type definitions over function/method
    const priority: SymbolKind[] = [
      "class",
      "interface",
      "type",
      "enum",
      "function",
      "variable",
      "method",
      "export",
    ];
    const sorted = [...locs].sort((a, b) => {
      return priority.indexOf(a.kind) - priority.indexOf(b.kind);
    });

    return sorted[0] ?? null;
  }

  /**
   * Find all files that reference a symbol (simple text search)
   */
  async findReferences(name: string): Promise<SymbolReference[]> {
    const refs: SymbolReference[] = [];

    // Get defining files (to exclude self-references)
    const defLocs = this.symbols.get(name) ?? [];
    const defFiles = new Set(defLocs.map((l) => l.file));

    // Search all indexed files
    for (const [file] of this.fileSymbols) {
      if (defFiles.has(file)) continue;

      try {
        const absPath = path.join(this.rootDir, file);
        const content = await fs.promises.readFile(absPath, "utf-8");

        if (!content.includes(name)) continue;

        // Find line numbers
        const lines: number[] = [];
        const contentLines = content.split("\n");
        for (let i = 0; i < contentLines.length; i++) {
          if (contentLines[i]!.includes(name)) {
            lines.push(i);
          }
        }

        if (lines.length > 0) {
          refs.push({ file, lines });
        }
      } catch {
        // Skip unreadable files
      }
    }

    return refs;
  }

  // ===========================================================================
  // Auto-reindex
  // ===========================================================================

  /**
   * Schedule a file for reindex (debounced)
   */
  scheduleReindex(relPath: string, removed = false): void {
    if (removed) {
      this.removeFile(relPath);
      this.pendingReindex.delete(relPath);
      return;
    }

    this.pendingReindex.add(relPath);

    if (this.reindexTimer) {
      clearTimeout(this.reindexTimer);
    }

    this.reindexTimer = setTimeout(async () => {
      const files = [...this.pendingReindex];
      this.pendingReindex.clear();

      for (const file of files) {
        try {
          await this.indexFile(file);
        } catch {
          // Skip failures
        }
      }
    }, REINDEX_DEBOUNCE_MS);
  }

  // ===========================================================================
  // Stats
  // ===========================================================================

  /**
   * Get index statistics
   */
  getStats(): {
    totalSymbols: number;
    totalFiles: number;
    symbolsByKind: Record<string, number>;
  } {
    const symbolsByKind: Record<string, number> = {};
    let totalSymbols = 0;

    for (const locs of this.symbols.values()) {
      for (const loc of locs) {
        symbolsByKind[loc.kind] = (symbolsByKind[loc.kind] ?? 0) + 1;
        totalSymbols++;
      }
    }

    return {
      totalSymbols,
      totalFiles: this.fileSymbols.size,
      symbolsByKind,
    };
  }

  /**
   * Whether the index has been built
   */
  get isIndexed(): boolean {
    return this.indexed;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Map .scm tag kind string to SymbolKind
   */
  private normalizeKind(tagKind: string): SymbolKind {
    switch (tagKind) {
      case "class":
        return "class";
      case "function":
        return "function";
      case "method":
        return "method";
      case "interface":
        return "interface";
      case "type":
        return "type";
      case "enum":
        return "enum";
      case "module":
        return "export";
      case "variable":
      case "constant":
      default:
        return "variable";
    }
  }

  /**
   * Simple fuzzy match: all chars of needle appear in order in haystack
   */
  private fuzzyMatch(needle: string, haystack: string): boolean {
    let ni = 0;
    for (let hi = 0; hi < haystack.length && ni < needle.length; hi++) {
      if (haystack[hi] === needle[ni]) ni++;
    }
    return ni === needle.length;
  }

  /**
   * Simple glob match for file filtering (supports * and **)
   */
  private simpleGlobMatch(file: string, pattern: string): boolean {
    const regexStr = pattern
      .replace(/\./g, "\\.")
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*");
    try {
      return new RegExp(`^${regexStr}$`).test(file);
    } catch {
      return file.includes(pattern);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // L2 SERIALIZATION (for IndexPersistence snapshot save/load)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Serialize all symbols to a flat array for L2 snapshot persistence.
   */
  toEntries(): Array<{
    file: string;
    name: string;
    kind: string;
    line: number;
    endLine: number;
    signature: string;
    language: string;
  }> {
    const entries: Array<{
      file: string;
      name: string;
      kind: string;
      line: number;
      endLine: number;
      signature: string;
      language: string;
    }> = [];

    for (const [_name, locations] of this.symbols) {
      for (const sym of locations) {
        entries.push({
          file: sym.file,
          name: sym.name,
          kind: sym.kind,
          line: sym.line,
          endLine: sym.endLine,
          signature: sym.signature,
          language: sym.language,
        });
      }
    }
    return entries;
  }

  /**
   * Hydrate from a flat array (loaded from L2 snapshot).
   * Clears existing index and rebuilds both maps.
   */
  loadFromEntries(
    entries: Array<{
      file: string;
      name: string;
      kind: string;
      line: number;
      endLine: number;
      signature: string;
      language: string;
    }>,
  ): void {
    this.symbols.clear();
    this.fileSymbols.clear();

    for (const e of entries) {
      const loc: SymbolLocation = {
        name: e.name,
        kind: e.kind as SymbolKind,
        file: e.file,
        line: e.line,
        endLine: e.endLine,
        signature: e.signature,
        language: e.language as LanguageName,
      };

      // By name
      if (!this.symbols.has(e.name)) this.symbols.set(e.name, []);
      this.symbols.get(e.name)!.push(loc);

      // By file
      if (!this.fileSymbols.has(e.file)) this.fileSymbols.set(e.file, []);
      this.fileSymbols.get(e.file)!.push(loc);
    }

    this.indexed = true;
    logger.info(`Loaded ${entries.length} symbols from L2 snapshot`);
  }

  /**
   * Get the line count for a file from fileSymbols (approximated from max endLine).
   * Returns undefined if file not indexed.
   */
  getFileLineCount(file: string): number | undefined {
    const syms = this.fileSymbols.get(file);
    if (!syms || syms.length === 0) return undefined;
    return Math.max(...syms.map((s) => s.endLine));
  }

  /**
   * Get the primary language for a file from first symbol.
   * Returns undefined if file not indexed.
   */
  getFileLanguage(file: string): string | undefined {
    const syms = this.fileSymbols.get(file);
    if (!syms || syms.length === 0) return undefined;
    return syms[0]!.language;
  }

  /**
   * Dispose (clear timers and index)
   */
  dispose(): void {
    if (this.reindexTimer) clearTimeout(this.reindexTimer);
    this.symbols.clear();
    this.fileSymbols.clear();
    this.pendingReindex.clear();
  }
}
