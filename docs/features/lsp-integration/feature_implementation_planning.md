# LSP Integration for Agents — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** Parked (v2) — tree-sitter covers 80% of LSP value  
**ID:** D4

---

## Branch
- `feature/lsp-integration` (when unparked)

## Scope
Language server management + agent tools for go-to-definition, find-references, type errors, hover type info. For coding roles only.

## When to Unpark
- Agents doing **iterative code editing** (write → check errors → fix → repeat)
- Agents on **strongly typed codebases** (TypeScript, Rust)
- Long-running agents that justify 5-30s startup cost

## Implementation Steps (If Built)

### Step 1: Create LanguageServerManager
**Files to create:**
- `packages/backend/services/lsp/LanguageServerManager.ts` — Start/stop language servers per language. Detect project language from config files (package.json → TypeScript, pyproject.toml → Python). Pool servers across tasks for same project.

**Supported servers:**
- TypeScript: `typescript-language-server --stdio`
- Python: `pyright-langserver --stdio`

### Step 2: Create LSP Tools
**Files to create:**
- `packages/backend/services/lsp/tools.ts` — AI SDK `tool()` definitions:
  - `go_to_definition(file, line, col)` — Jump to symbol definition
  - `find_references(file, line, col)` — Find all usages
  - `get_diagnostics(file)` — Type errors and warnings (**killer feature**)
  - `get_type_info(file, line, col)` — Hover type information

### Step 3: Wire into Worker Lifecycle
- Task assigned to coding role → detect project language → start LSP → provide tools
- Non-coding roles (researcher, writer) → skip LSP, use tree-sitter only
- Task completes → shutdown LSP (or pool for reuse)

### Step 4: Handle Challenges
- 5-30s startup: pool across tasks for same project
- 200-500MB memory per server: only start for coding roles
- Sandbox compatibility: LSP runs on host or inside Docker

## Complexity
Medium — 1-2 weeks if unparked.
