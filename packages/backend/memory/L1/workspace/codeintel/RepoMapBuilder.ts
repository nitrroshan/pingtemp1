/**
 * RepoMapBuilder — Compressed codebase overview using tree-sitter
 *
 * Extracts symbols (classes, functions, interfaces, exports) from source files
 * using .scm tag query files (Aider-style). Builds a compressed repo map within
 * a token budget. High-reference symbols are prioritized using tree-sitter
 * @reference.* captures for accurate cross-file reference counting.
 *
 * Tag queries adapted from Aider's tree-sitter-language-pack (MIT/Apache-2.0).
 *
 * @see AGENT_WORKSPACE_RESEARCH.md §6 — Layer 3 Repo Map
 * @see AGENT_WORKSPACE_RESEARCH.md §13 — Continue.dev patterns
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

const logger = new Logger({ name: "RepoMapBuilder" });

// =============================================================================
// Types
// =============================================================================

/**
 * Extracted symbol from a source file
 */
export interface Symbol {
  /** Symbol name (e.g., "UserService", "handleLogin") */
  name: string;
  /** Symbol kind */
  kind: SymbolKind;
  /** File path (relative to workspace root) */
  file: string;
  /** Line number (0-based) */
  line: number;
  /** End line (0-based) */
  endLine: number;
  /** Symbol signature (first line or declaration) */
  signature: string;
  /** Language */
  language: LanguageName;
}

export type SymbolKind =
  | "class"
  | "function"
  | "method"
  | "interface"
  | "type"
  | "enum"
  | "variable"
  | "export";

/**
 * Symbol with reference count (for ranking)
 */
export interface RankedSymbol extends Symbol {
  /** Number of times this symbol is referenced in other files */
  referenceCount: number;
}

/**
 * Repo map output
 */
export interface RepoMap {
  /** The formatted map text */
  text: string;
  /** Approximate token count */
  tokenCount: number;
  /** Number of files included */
  fileCount: number;
  /** Number of symbols included */
  symbolCount: number;
}

/**
 * File summary
 */
export interface FileSummary {
  file: string;
  language: LanguageName;
  symbols: Symbol[];
  lineCount: number;
}

// =============================================================================
// Helpers
// =============================================================================

/** Rough token count estimation (~4 chars per token) */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Default ignore patterns
 */
const IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.scratch/**",
  "**/.ping/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/*.min.js",
  "**/*.bundle.js",
  "**/*.map",
  "**/*.lock",
  "**/package-lock.json",
];

/** Max file size for parsing (256KB) */
const MAX_PARSE_SIZE = 256 * 1024;

// =============================================================================
// RepoMapBuilder
// =============================================================================

export class RepoMapBuilder {
  private treeSitter: TreeSitterService;
  private rootDir: string;

  constructor(rootDir: string, treeSitter?: TreeSitterService) {
    this.rootDir = rootDir;
    this.treeSitter = treeSitter ?? new TreeSitterService();
  }

  /**
   * Extract symbols from a single source file using .scm tag queries.
   * Returns only definitions (not references).
   */
  async extractSymbols(source: string, filePath: string): Promise<Symbol[]> {
    const relPath = path.relative(this.rootDir, filePath).replace(/\\/g, "/");
    const tags = await this.treeSitter.extractTags(source, filePath);

    return tags
      .filter((t) => t.type === "definition")
      .map((t) => ({
        name: t.name,
        kind: this.normalizeKind(t.kind),
        file: relPath,
        line: t.line,
        endLine: t.endLine,
        signature: t.signature,
        language: t.language,
      }));
  }

  /**
   * Map .scm tag kind string to SymbolKind.
   * Tag queries produce kinds like: function, method, class, interface,
   * type, enum, module, variable, constant, macro, call, implementation.
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
   * Build a compressed repo map of the workspace
   *
   * @param budgetTokens - Maximum number of tokens for the output (~4 chars/token)
   * @param focusFiles - Optional list of files to prioritize
   */
  async buildRepoMap(
    budgetTokens = 4096,
    focusFiles?: string[],
  ): Promise<RepoMap> {
    // 1. Discover all parseable files
    const extensions = this.treeSitter.getSupportedExtensions();
    const patterns = extensions.map((ext) => `**/*${ext}`);

    const files = await fg(patterns, {
      cwd: this.rootDir,
      ignore: IGNORE_PATTERNS,
      absolute: false,
    });

    if (files.length === 0) {
      return {
        text: "(no parseable files found)",
        tokenCount: 0,
        fileCount: 0,
        symbolCount: 0,
      };
    }

    // 2. Extract tags (definitions + references) from all files in a single pass
    const allSymbols: Symbol[] = [];
    const fileSymbolMap = new Map<string, Symbol[]>();
    const fileReferences = new Map<string, TagCapture[]>();

    for (const file of files) {
      try {
        const absPath = path.join(this.rootDir, file);
        const stat = await fs.promises.stat(absPath);
        if (stat.size > MAX_PARSE_SIZE) continue;

        const source = await fs.promises.readFile(absPath, "utf-8");
        const tags = await this.treeSitter.extractTags(source, absPath);

        // Separate definitions and references from the single parse
        const symbols: Symbol[] = [];
        const refs: TagCapture[] = [];

        for (const tag of tags) {
          if (tag.type === "definition") {
            symbols.push({
              name: tag.name,
              kind: this.normalizeKind(tag.kind),
              file,
              line: tag.line,
              endLine: tag.endLine,
              signature: tag.signature,
              language: tag.language,
            });
          } else {
            refs.push(tag);
          }
        }

        if (symbols.length > 0) {
          allSymbols.push(...symbols);
          fileSymbolMap.set(file, symbols);
        }
        if (refs.length > 0) {
          fileReferences.set(file, refs);
        }
      } catch {
        // Skip files that can't be read/parsed
      }
    }

    // 3. Count cross-file references using tree-sitter captures
    const ranked = this.countReferences(allSymbols, fileReferences);

    // 4. Format with budget
    return this.formatMap(ranked, fileSymbolMap, budgetTokens, focusFiles);
  }

  /**
   * Count cross-file references using tree-sitter @reference.* captures.
   * Much more accurate than string.includes() — no false positives from
   * comments, strings, or partial identifier matches.
   *
   * @param symbols - All extracted definition symbols
   * @param fileReferences - Pre-extracted reference captures per file (from buildRepoMap)
   */
  private countReferences(
    symbols: Symbol[],
    fileReferences: Map<string, TagCapture[]>,
  ): RankedSymbol[] {
    // Build set of known symbol names for quick lookup
    const symbolNames = new Set(symbols.map((s) => s.name));

    // Initialize ref counts
    const refCounts = new Map<string, number>();
    for (const name of symbolNames) {
      refCounts.set(name, 0);
    }

    // Count references from tree-sitter captures
    for (const [file, refs] of fileReferences) {
      for (const ref of refs) {
        if (!symbolNames.has(ref.name)) continue;

        // Only count if this file doesn't define the symbol
        const definingFiles = symbols
          .filter((s) => s.name === ref.name)
          .map((s) => s.file);
        if (!definingFiles.includes(file)) {
          refCounts.set(ref.name, (refCounts.get(ref.name) ?? 0) + 1);
        }
      }
    }

    return symbols.map((s) => ({
      ...s,
      referenceCount: refCounts.get(s.name) ?? 0,
    }));
  }

  /**
   * Format the repo map within token budget
   *
   * Structure:
   * ```
   * src/services/UserService.ts
   *   class UserService [refs: 5]
   *     method login(email, password)
   *     method logout()
   *   function createUser(data)
   *
   * src/types/User.ts
   *   interface User [refs: 12]
   *   type UserRole [refs: 3]
   * ```
   */
  private formatMap(
    ranked: RankedSymbol[],
    fileSymbolMap: Map<string, Symbol[]>,
    budgetTokens: number,
    focusFiles?: string[],
  ): RepoMap {
    // Sort symbols: focus files first, then by reference count desc
    const focusSet = new Set(focusFiles ?? []);

    // Group by file, sort files by max reference count
    const fileScores = new Map<string, number>();
    for (const sym of ranked) {
      const current = fileScores.get(sym.file) ?? 0;
      const score = sym.referenceCount + (focusSet.has(sym.file) ? 1000 : 0);
      fileScores.set(sym.file, Math.max(current, score));
    }

    const sortedFiles = [...fileSymbolMap.keys()].sort((a, b) => {
      return (fileScores.get(b) ?? 0) - (fileScores.get(a) ?? 0);
    });

    // Build map text within budget
    const lines: string[] = [];
    let tokenCount = 0;
    let fileCount = 0;
    let symbolCount = 0;

    for (const file of sortedFiles) {
      const symbols = ranked.filter((s) => s.file === file);
      if (symbols.length === 0) continue;

      // Sort symbols within file: classes first, then by line
      symbols.sort((a, b) => {
        const kindOrder = {
          class: 0,
          interface: 1,
          type: 2,
          enum: 3,
          function: 4,
          method: 5,
          variable: 6,
          export: 7,
        };
        const ka = kindOrder[a.kind] ?? 99;
        const kb = kindOrder[b.kind] ?? 99;
        if (ka !== kb) return ka - kb;
        return a.line - b.line;
      });

      // Format file entry
      const fileLines: string[] = [file];
      for (const sym of symbols) {
        const refTag =
          sym.referenceCount > 0 ? ` [refs: ${sym.referenceCount}]` : "";
        const indent = sym.kind === "method" ? "    " : "  ";
        fileLines.push(`${indent}${sym.kind} ${sym.signature}${refTag}`);
      }
      fileLines.push(""); // blank line between files

      const entryText = fileLines.join("\n");
      const entryTokens = estimateTokens(entryText);

      if (tokenCount + entryTokens > budgetTokens) {
        // If we haven't added anything yet, add at least this one file
        if (fileCount === 0) {
          lines.push(entryText);
          tokenCount += entryTokens;
          fileCount++;
          symbolCount += symbols.length;
        }
        break;
      }

      lines.push(entryText);
      tokenCount += entryTokens;
      fileCount++;
      symbolCount += symbols.length;
    }

    return {
      text: lines.join("\n"),
      tokenCount,
      fileCount,
      symbolCount,
    };
  }

  /**
   * Get a summary of a single file's structure
   */
  async getFileSummary(filePath: string): Promise<FileSummary | null> {
    const langName = this.treeSitter.getLanguageForFile(filePath);
    if (!langName) return null;

    const absPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.rootDir, filePath);

    try {
      const source = await fs.promises.readFile(absPath, "utf-8");
      const symbols = await this.extractSymbols(source, absPath);
      const lineCount = source.split("\n").length;

      return {
        file: path.relative(this.rootDir, absPath).replace(/\\/g, "/"),
        language: langName,
        symbols,
        lineCount,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get dependencies (imports/exports) of a file
   */
  async getDependencies(
    filePath: string,
  ): Promise<{ imports: string[]; exports: string[] } | null> {
    const absPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.rootDir, filePath);

    try {
      const source = await fs.promises.readFile(absPath, "utf-8");
      const result = await this.treeSitter.parse(source, absPath);
      if (!result) return null;

      const imports: string[] = [];
      const exports: string[] = [];

      // Walk top-level nodes for import/export statements
      const root = result.tree.rootNode;
      for (const child of root.children ?? []) {
        if (
          child.type === "import_statement" ||
          child.type === "import_declaration"
        ) {
          imports.push(child.text?.split("\n")[0]?.trim() ?? "");
        } else if (
          child.type === "export_statement" ||
          child.type === "export_declaration"
        ) {
          exports.push(child.text?.split("\n")[0]?.trim() ?? "");
        }
      }

      return { imports, exports };
    } catch {
      return null;
    }
  }
}
