/**
 * TreeSitterService — WASM-based tree-sitter parser management
 *
 * Initializes and caches web-tree-sitter parsers per language.
 * Uses `tree-sitter-wasms` for pre-compiled WASM grammars (19+ languages).
 * Uses `.scm` tag query files (Aider-style) for symbol extraction.
 *
 * Pattern inspired by Continue.dev's `treeSitter.ts` (Apache 2.0).
 * Tag queries adapted from Aider's tree-sitter-language-pack (MIT/Apache-2.0).
 *
 * @see AGENT_WORKSPACE_RESEARCH.md §13 — Phase 10
 */

import fs from "fs";
import path from "path";
import { Logger } from "tslog";

const logger = new Logger({ name: "TreeSitterService" });

// =============================================================================
// Types
// =============================================================================

/**
 * Supported language names (subset of tree-sitter-wasms available languages)
 */
export type LanguageName =
  | "typescript"
  | "tsx"
  | "javascript"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "c"
  | "cpp"
  | "csharp"
  | "ruby"
  | "php"
  | "swift"
  | "kotlin"
  | "scala"
  | "lua"
  | "bash"
  | "json"
  | "yaml"
  | "toml"
  | "html"
  | "css"
  | "markdown";

/**
 * Map file extensions to language names
 */
const EXTENSION_MAP: Record<string, LanguageName> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hxx": "cpp",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".scala": "scala",
  ".sc": "scala",
  ".lua": "lua",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".json": "json",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".md": "markdown",
  ".mdx": "markdown",
};

/**
 * WASM file name for each language in tree-sitter-wasms package
 */
const WASM_FILE_MAP: Record<LanguageName, string> = {
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  javascript: "tree-sitter-javascript.wasm",
  python: "tree-sitter-python.wasm",
  go: "tree-sitter-go.wasm",
  rust: "tree-sitter-rust.wasm",
  java: "tree-sitter-java.wasm",
  c: "tree-sitter-c.wasm",
  cpp: "tree-sitter-cpp.wasm",
  csharp: "tree-sitter-c_sharp.wasm",
  ruby: "tree-sitter-ruby.wasm",
  php: "tree-sitter-php.wasm",
  swift: "tree-sitter-swift.wasm",
  kotlin: "tree-sitter-kotlin.wasm",
  scala: "tree-sitter-scala.wasm",
  lua: "tree-sitter-lua.wasm",
  bash: "tree-sitter-bash.wasm",
  json: "tree-sitter-json.wasm",
  yaml: "tree-sitter-yaml.wasm",
  toml: "tree-sitter-toml.wasm",
  html: "tree-sitter-html.wasm",
  css: "tree-sitter-css.wasm",
  markdown: "tree-sitter-markdown.wasm",
};

/**
 * Map language → .scm tag query file name (in queries/ directory).
 * Languages without .scm files (json, yaml, toml, html, css, markdown)
 * don't have meaningful symbols to extract.
 */
const QUERY_FILE_MAP: Partial<Record<LanguageName, string>> = {
  typescript: "typescript-tags.scm",
  tsx: "tsx-tags.scm",
  javascript: "javascript-tags.scm",
  python: "python-tags.scm",
  go: "go-tags.scm",
  rust: "rust-tags.scm",
  java: "java-tags.scm",
  c: "c-tags.scm",
  cpp: "cpp-tags.scm",
  csharp: "csharp-tags.scm",
  ruby: "ruby-tags.scm",
  php: "php-tags.scm",
  swift: "swift-tags.scm",
  kotlin: "kotlin-tags.scm",
  scala: "scala-tags.scm",
  lua: "lua-tags.scm",
  bash: "bash-tags.scm",
};

/**
 * A captured tag from a .scm query — either a definition or reference
 */
export interface TagCapture {
  /** Symbol name (from @name.definition.X or @name.reference.X) */
  name: string;
  /** Whether this is a definition or reference */
  type: "definition" | "reference";
  /** Symbol kind: function, method, class, interface, type, enum, module, variable, constant, macro, call, implementation */
  kind: string;
  /** Line number (0-based) */
  line: number;
  /** End line (0-based) */
  endLine: number;
  /** First line of the captured node (signature) */
  signature: string;
  /** Language */
  language: LanguageName;
}

// =============================================================================
// TreeSitterService
// =============================================================================

export class TreeSitterService {
  /** Cached Language objects per language name */
  private languageCache = new Map<LanguageName, any>();

  /** Cached compiled Query objects per language */
  private queryCache = new Map<LanguageName, any>();

  /** Cached .scm query source strings */
  private querySourceCache = new Map<LanguageName, string>();

  /** Whether Parser.init() has been called */
  private initialized = false;

  /** Parser module (dynamically imported) */
  private Parser: any = null;

  /**
   * Initialize the WASM runtime (must be called once before parsing)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Dynamic import to avoid issues with CommonJS/ESM interop
      const mod = await import("web-tree-sitter");
      this.Parser = mod.default ?? mod;
      await this.Parser.init();
      this.initialized = true;
      logger.info("Tree-sitter WASM runtime initialized");
    } catch (error: any) {
      logger.error(`Failed to initialize tree-sitter: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get the language name for a file path
   */
  getLanguageForFile(filePath: string): LanguageName | null {
    const ext = path.extname(filePath).toLowerCase();
    return EXTENSION_MAP[ext] ?? null;
  }

  /**
   * Check if a file is parseable
   */
  isSupported(filePath: string): boolean {
    return this.getLanguageForFile(filePath) !== null;
  }

  /**
   * Load (and cache) a Language object for the given language name
   */
  async loadLanguage(langName: LanguageName): Promise<any> {
    const cached = this.languageCache.get(langName);
    if (cached) return cached;

    if (!this.initialized) await this.initialize();

    const wasmFile = WASM_FILE_MAP[langName];
    if (!wasmFile) {
      throw new Error(`No WASM grammar available for language: ${langName}`);
    }

    // Resolve WASM file path from tree-sitter-wasms package
    let wasmPath: string;
    try {
      // tree-sitter-wasms exports from out/ directory
      const wasmsDir = path.dirname(
        require.resolve("tree-sitter-wasms/package.json"),
      );
      wasmPath = path.join(wasmsDir, "out", wasmFile);
    } catch {
      // Fallback: try node_modules directly
      wasmPath = path.join(
        process.cwd(),
        "node_modules",
        "tree-sitter-wasms",
        "out",
        wasmFile,
      );
    }

    try {
      const language = await this.Parser.Language.load(wasmPath);
      this.languageCache.set(langName, language);
      logger.debug(`Loaded language: ${langName}`);
      return language;
    } catch (error: any) {
      logger.warn(
        `Failed to load language ${langName} from ${wasmPath}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Create a configured parser for a file
   */
  async getParserForFile(
    filePath: string,
  ): Promise<{ parser: any; language: LanguageName } | null> {
    const langName = this.getLanguageForFile(filePath);
    if (!langName) return null;

    if (!this.initialized) await this.initialize();

    try {
      const language = await this.loadLanguage(langName);
      const parser = new this.Parser();
      parser.setLanguage(language);
      return { parser, language: langName };
    } catch {
      return null;
    }
  }

  /**
   * Parse source code and return the tree
   */
  async parse(
    source: string,
    filePath: string,
  ): Promise<{ tree: any; language: LanguageName } | null> {
    const result = await this.getParserForFile(filePath);
    if (!result) return null;

    const tree = result.parser.parse(source);
    return { tree, language: result.language };
  }

  /**
   * Get all supported file extensions
   */
  getSupportedExtensions(): string[] {
    return Object.keys(EXTENSION_MAP);
  }

  /**
   * Check if a language has a .scm tag query file
   */
  hasTagQuery(langName: LanguageName): boolean {
    return langName in QUERY_FILE_MAP;
  }

  /**
   * Load the .scm query source for a language
   */
  private loadQuerySource(langName: LanguageName): string | null {
    const cached = this.querySourceCache.get(langName);
    if (cached) return cached;

    const queryFile = QUERY_FILE_MAP[langName];
    if (!queryFile) return null;

    const queryPath = path.join(__dirname, "queries", queryFile);
    try {
      const source = fs.readFileSync(queryPath, "utf-8");
      this.querySourceCache.set(langName, source);
      return source;
    } catch (error: any) {
      logger.warn(`Failed to load query file ${queryFile}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get (or compile and cache) the tag Query object for a language.
   * Requires the Language to be loaded first.
   */
  async getTagQuery(langName: LanguageName): Promise<any | null> {
    const cached = this.queryCache.get(langName);
    if (cached) return cached;

    const source = this.loadQuerySource(langName);
    if (!source) return null;

    const language = await this.loadLanguage(langName);
    try {
      const query = language.query(source);
      this.queryCache.set(langName, query);
      return query;
    } catch (error: any) {
      logger.warn(`Failed to compile query for ${langName}: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract tags (definitions + references) from source code using .scm queries.
   *
   * Returns both definitions and references as TagCapture objects,
   * distinguished by `type: 'definition' | 'reference'`.
   */
  async extractTags(source: string, filePath: string): Promise<TagCapture[]> {
    const parseResult = await this.parse(source, filePath);
    if (!parseResult) return [];

    const { tree, language: langName } = parseResult;
    const query = await this.getTagQuery(langName);
    if (!query) return [];

    const captures: TagCapture[] = [];
    const matches = query.matches(tree.rootNode);

    for (const match of matches) {
      // Each match has multiple captures. We need the @name.* capture
      // for the symbol name and the @definition.* or @reference.* capture
      // for the node span.
      let nameText: string | null = null;
      let type: "definition" | "reference" | null = null;
      let kind: string | null = null;
      let line = 0;
      let endLine = 0;
      let signature = "";

      for (const capture of match.captures) {
        const captureName: string = capture.name;
        const node = capture.node;

        if (captureName.startsWith("name.definition.")) {
          nameText = node.text;
          type = "definition";
          kind = captureName.replace("name.definition.", "");
        } else if (captureName.startsWith("name.reference.")) {
          nameText = node.text;
          type = "reference";
          kind = captureName.replace("name.reference.", "");
        } else if (
          captureName.startsWith("definition.") ||
          captureName.startsWith("reference.")
        ) {
          // The whole-node capture — use for line span + signature
          line = node.startPosition?.row ?? 0;
          endLine = node.endPosition?.row ?? 0;
          const lines = node.text?.split("\n") ?? [];
          signature = lines[0]?.trim() ?? "";
        }
      }

      if (nameText && type && kind) {
        captures.push({
          name: nameText,
          type,
          kind,
          line,
          endLine,
          signature,
          language: langName,
        });
      }
    }

    return captures;
  }

  /**
   * Free all cached languages and queries (cleanup)
   */
  dispose(): void {
    this.languageCache.clear();
    this.queryCache.clear();
    this.querySourceCache.clear();
    this.initialized = false;
    this.Parser = null;
  }
}
