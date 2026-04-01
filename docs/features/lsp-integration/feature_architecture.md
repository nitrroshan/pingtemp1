# LSP Integration for Agents — Feature Architecture

**Status:** Parked (v2)  
**Date:** April 1, 2026  
**ID:** D4  
**Source:** [AGENT_WORKSPACE_RESEARCH.md](../done/memory-system/AGENT_WORKSPACE_RESEARCH.md) — Layer 5 navigation

---

## Overview

Give coding agents access to Language Server Protocol capabilities — go-to-definition, find-references, type errors after edits, hover type info. This is the **highest-fidelity code understanding** available, used by Cursor, VS Code Copilot, and recently Claude Code.

### Parked Because

- Ping already has tree-sitter (`SymbolIndex`, `RepoMapBuilder`) — covers 80% of LSP value
- LSP requires running a language server process (5-30s startup per project)
- Ping agents are task-scoped — startup cost per task is significant
- Claude Code and Aider work well without LSP

### When To Build

- Agents doing **iterative code editing** (write → check errors → fix → repeat)
- Agents on **strongly typed codebases** (TypeScript, Rust) where type errors prevent bugs
- Long-running agents that justify startup cost

---

## What LSP Provides (That Tree-Sitter Doesn't)

| Capability | Tree-Sitter (built) | LSP (this feature) |
|---|---|---|
| Find symbol definitions | ✅ Text-based cross-file search | ✅ **Precise** — knows the exact definition |
| Find all references | ⚠️ Naive text search (finds strings, not semantic refs) | ✅ **Semantic** — only real references, not comments/strings |
| Type information | ❌ | ✅ Hover: "What type is `user.roles`?" → `Role[]` |
| **Type errors after edit** | ❌ | ✅ **Key value** — "Property 'tokn' does not exist on type 'User'" |
| Call hierarchy | ❌ | ✅ What calls this function → what this function calls |
| Auto-complete | ❌ | ✅ What methods does `tokenService.` have? |
| Rename symbol | ❌ | ✅ Rename across all files safely |

**The killer feature is type errors after edits.** When an agent modifies code, LSP immediately reports what broke — no need to run the full build. This is why Claude Code added it.

---

## How It Would Work

```typescript
// Start language server for the workspace
const lsp = new LanguageServerManager({
  typescript: { command: 'typescript-language-server', args: ['--stdio'] },
  python: { command: 'pyright-langserver', args: ['--stdio'] },
});

// Agent tools
const lspTools = {
  go_to_definition: tool({
    description: 'Jump to where a symbol is defined',
    parameters: z.object({ file: z.string(), line: z.number(), col: z.number() }),
    execute: async ({ file, line, col }) => lsp.definition(file, line, col),
  }),
  
  find_references: tool({
    description: 'Find all usages of a symbol',
    parameters: z.object({ file: z.string(), line: z.number(), col: z.number() }),
    execute: async ({ file, line, col }) => lsp.references(file, line, col),
  }),
  
  get_diagnostics: tool({
    description: 'Get type errors and warnings in a file',
    parameters: z.object({ file: z.string() }),
    execute: async ({ file }) => lsp.diagnostics(file),
  }),
  
  get_type_info: tool({
    description: 'Get type information at a position',
    parameters: z.object({ file: z.string(), line: z.number(), col: z.number() }),
    execute: async ({ file, line, col }) => lsp.hover(file, line, col),
  }),
};
```

### Language Server Lifecycle

```
Task assigned to coding agent (developer, qa roles ONLY):
  │
  ├── Is role a coding role? NO → skip LSP, use tree-sitter only
  │                          YES ↓
  ├── Detect project language (package.json → TypeScript, pyproject.toml → Python)
  ├── Start appropriate language server (tsserver, pyright, etc.)
  ├── Wait for initialization (5-30s depending on project size)
  ├── LSP tools available to agent
  │
  ├── Agent works: edit → get_diagnostics → fix → edit → ...
  │
  └── Task completes → shutdown language server
```

**Non-coding roles** (researcher, writer, designer, planner) never get LSP tools — tree-sitter and grep are sufficient.

### Challenges

| Challenge | Mitigation |
|---|---|
| 5-30s startup per task | Pool language servers across tasks for the same project |
| Heavy memory (200-500MB per server) | Only start for coding roles, not researcher/writer |
| Multiple languages per project | Start one server per language detected |
| Sandbox compatibility | Language server runs on host or inside Docker (needs access to project files) |

**Effort if built:** 1-2 weeks (language server management + 4-5 agent tools)
