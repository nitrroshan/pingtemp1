# CLI System — Feature Architecture

> **Status**: Research & Vision  
> **Created**: 2025-07-14  
> **Scope**: Overhaul current CLI into a production-grade, per-worker interactive terminal — inspired by Claude Code CLI

---

## 1. Executive Summary

Our current CLI (`src/worker/cli/index.ts`) is a single-file, 984-line readline REPL used for testing the orchestration system. It works, but it's monolithic, tightly coupled to `AgentManagerV2`, and lacks the UX polish needed for daily use.

**Goal**: Transform it into a modular, extensible CLI system where:
- The **orchestrator CLI** manages planning, approval, and task dispatch
- Each **worker gets its own CLI context** with role-scoped commands, isolated conversations, and workspace awareness
- The experience mirrors Claude Code CLI patterns: slash commands, session persistence, structured output, subagent delegation, keyboard shortcuts, and background task management

---

## 2. Claude Code CLI — Key Patterns to Adopt

### 2.1 Modes of Operation

| Mode | Claude Code | Our Equivalent |
|------|-------------|----------------|
| Interactive REPL | `claude` | `ping` (orchestrator) / `ping worker <role>` |
| One-shot print | `claude -p "query"` | `ping -p "build the login page"` |
| Continue session | `claude -c` | `ping -c` (resume last session) |
| Resume by ID | `claude -r <id>` | `ping -r <session-id>` |
| Pipe input | `cat file \| claude -p` | `cat spec.md \| ping -p "implement this"` |

### 2.2 Subagent Architecture → Per-Worker CLI

Claude Code's subagent model maps directly to our workers:

| Claude Code Concept | Our Mapping |
|---------------------|-------------|
| Built-in subagents (Explore, Plan) | Built-in workers (orchestrator, planner) |
| Custom subagents (markdown files) | Role-defined workers (backend, frontend, qa) |
| `--agents` JSON flag | Runtime worker config via `--workers` flag |
| Subagent scopes (user/project/plugin) | Worker scopes (team-level, project-level) |
| `Task()` tool for delegation | `dispatch()` for worker task assignment |
| `--teammate-mode` (auto/in-process/tmux) | Worker display mode (inline/split/tmux) |

### 2.3 Interactive Features to Implement

| Feature | Claude Code | Priority |
|---------|-------------|----------|
| Slash commands (`/plan`, `/tasks`, `/status`) | `/` prefix | P0 |
| Bash mode (`!git status`) | `!` prefix | P1 |
| File mentions (`@src/api.ts`) | `@` prefix | P1 |
| Keyboard shortcuts (Ctrl+C, Ctrl+L, etc.) | Full set | P0 |
| Vim mode | `/vim` toggle | P2 |
| Multiline input (Shift+Enter, `\` + Enter) | Multiple methods | P1 |
| Command history + reverse search (Ctrl+R) | readline history | P1 |
| Background tasks (Ctrl+B) | Backgrounding | P1 |
| Task list toggle (Ctrl+T) | Status area | P1 |
| Prompt suggestions | Tab to accept | P2 |
| Compact mode (`/compact`) | Context compaction | P2 |
| Session export (`/export`) | `/export` | P2 |
| PR review status in footer | Git integration | P3 |
| Syntax highlighting | Chalk/ink | P2 |

### 2.4 CLI Flags to Implement

| Flag | Purpose | Priority |
|------|---------|----------|
| `--model <alias>` | Select model per session | P1 |
| `--tools <list>` | Restrict available tools | P1 |
| `--output-format text\|json\|stream-json` | Scripting support | P0 |
| `--max-turns <n>` | Limit agent turns | P1 |
| `--system-prompt <text>` | Custom system prompt | P1 |
| `--verbose` | Debug logging | P0 |
| `--workers <json>` | Inline worker config | P1 |
| `--mcp-config <path>` | MCP server config | P2 |
| `--workspace-dir <path>` | Override workspace dir | P0 |
| `--plan-dir <path>` | Override plan storage | P1 |
| `--team <id>` | Select team context | P0 |
| `--roles <list>` | Override default roles | P0 |
| `--permission-mode` | Permission handling | P2 |

### 2.5 Session Persistence

| Feature | Description |
|---------|-------------|
| Session ID | Each CLI session gets a unique ID |
| Auto-save | Conversation history saved to `~/.ping/sessions/` |
| `-c` continue | Resume most recent session |
| `-r <id>` resume | Resume specific session |
| `/rename <name>` | Name sessions for easy recall |
| Cross-session memory | Workers remember across sessions via CLAUDE.md pattern |

---

## 3. Current State Audit

### 3.1 What We Have

```
src/worker/cli/index.ts (984 lines, single file)
├── AgentManagerCLI class
├── readline-based REPL
├── 25+ commands (init, plan, approve, tasks, start, chat, complete, etc.)
├── ANSI color helpers
├── Event log (last 50 events)
├── E2E test runner
└── Active task tracking (single activeTaskId)
```

### 3.2 Strengths
- Complete orchestration workflow coverage
- Event-driven output (plan:proposed, task:update, worker:event)
- Partial ID matching for tasks
- Auto-approve/auto-execute toggles
- E2E test with workspace verification

### 3.3 Weaknesses

| Issue | Impact |
|-------|--------|
| **Single file** | Hard to extend, test, or maintain |
| **No session persistence** | Lose context on exit |
| **Single active task** | Can't work on multiple tasks or view parallel workers |
| **No structured output** | Can't pipe to other tools |
| **No slash commands** | Commands are bare words, no discoverability |
| **No file/workspace awareness** | Can't reference files or see workspace state |
| **No background task display** | No visibility into running workers |
| **No keyboard shortcuts** | Basic readline only |
| **Tightly coupled** | CLI class directly owns AgentManager lifecycle |
| **No worker-level CLI** | Can only interact through orchestrator |
| **No command validation** | Silently fails on wrong args |
| **No tab completion** | No discoverability |

---

## 4. Target Architecture

### 4.1 Module Structure

```
src/worker/cli/
├── index.ts                    # Entry point, arg parsing (commander/yargs)
├── app.ts                      # CLIApp class — lifecycle, mode routing
├── repl/
│   ├── ReplEngine.ts           # readline wrapper, prompt rendering, input handling
│   ├── InputParser.ts          # Parse slash commands, ! bash, @ mentions
│   ├── History.ts              # Command history + reverse search
│   └── Renderer.ts             # Output formatting, syntax highlighting, spinners
├── commands/
│   ├── CommandRegistry.ts      # Register + dispatch commands
│   ├── orchestrator/           # /plan, /approve, /status, /tasks
│   │   ├── plan.ts
│   │   ├── approve.ts
│   │   ├── status.ts
│   │   └── tasks.ts
│   ├── worker/                 # /start, /chat, /complete, /workspace
│   │   ├── start.ts
│   │   ├── chat.ts
│   │   ├── complete.ts
│   │   └── workspace.ts
│   ├── system/                 # /help, /clear, /exit, /config, /export
│   │   ├── help.ts
│   │   ├── config.ts
│   │   └── export.ts
│   └── debug/                  # /events, /memory, /run
│       ├── events.ts
│       └── run.ts
├── session/
│   ├── SessionManager.ts       # Save/load/list sessions
│   └── SessionStore.ts         # File-backed session storage
├── worker-cli/
│   ├── WorkerCLI.ts            # Per-worker REPL context
│   ├── WorkerRouter.ts         # Route input to correct worker
│   └── WorkerDisplay.ts        # Multi-worker status display
├── output/
│   ├── Formatter.ts            # JSON / text / stream-json output
│   ├── Theme.ts                # Color themes
│   └── StatusBar.ts            # Footer status line (tasks, PR, model)
├── config/
│   ├── CLIConfig.ts            # Config loader (.pingrc, env, flags)
│   └── defaults.ts             # Default settings
└── types/
    └── index.ts                # CLI-specific types
```

### 4.2 Per-Worker CLI Concept

Each worker gets its own CLI context — like Claude Code's subagents but interactive:

```
┌──────────────────────────────────────────────────────────┐
│  PING CLI — Orchestrator Mode                            │
│                                                          │
│  /plan "Build user auth system"                          │
│  📋 Plan proposed: 3 tasks                               │
│    • [backend] Create auth endpoints                     │
│    • [frontend] Build login page                         │
│    • [qa] Write auth tests                               │
│  /approve                                                │
│  ✓ Plan approved: 3 tasks queued                         │
│                                                          │
│  /worker backend      ← Switch to worker context         │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  PING CLI — Worker: backend [task:a1b2c3d4]              │
│                                                          │
│  You are now chatting with the backend worker.            │
│  Workspace: feature/task-a1b2c3d4 (clean)                │
│                                                          │
│  > Create the /api/auth/login endpoint                   │
│  Agent: I'll create the login endpoint...                │
│  [writes src/api/auth/login.ts]                          │
│  [commits: "feat: add login endpoint"]                   │
│                                                          │
│  > /workspace status                                     │
│  Branch: feature/task-a1b2c3d4                           │
│  Files: 2 added, 0 modified                              │
│                                                          │
│  > /back                ← Return to orchestrator         │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

#### Worker CLI Capabilities

| Feature | Description |
|---------|-------------|
| **Scoped conversation** | Chat goes directly to that worker's agent |
| **Workspace awareness** | Shows branch, uncommitted files, git status |
| **Role-specific tools** | Only tools assigned to that role |
| **Isolated context** | Separate message history per worker |
| **Task focus** | Automatically scoped to the worker's current task |
| **`/back`** | Return to orchestrator context |
| **`/workspace`** | Show/manage workspace (files, branches, diff) |
| **`/artifacts`** | List artifacts created by this worker |
| **`/complete`** | Complete current task and merge workspace |

#### Worker Display Modes

Inspired by Claude Code's `--teammate-mode`:

| Mode | Behavior |
|------|----------|
| **inline** (default) | Workers display output in main terminal, prefixed with role |
| **split** | Terminal splits to show orchestrator + active worker side by side |
| **tmux** | Each worker gets its own tmux pane (power users) |
| **headless** | Workers run silently, results collected by orchestrator |

### 4.3 Command Resolution Flow

```
User Input
    │
    ├── starts with "/" → Slash Command → CommandRegistry.dispatch()
    │                                         │
    │                                         ├── /plan, /approve, /tasks → OrchestratorCommands
    │                                         ├── /worker, /start, /chat  → WorkerCommands
    │                                         ├── /help, /clear, /exit    → SystemCommands
    │                                         └── /events, /memory, /run  → DebugCommands
    │
    ├── starts with "!" → Bash Mode → Execute shell command, add output to context
    │
    ├── starts with "@" → File Mention → Resolve path, inject content
    │
    └── plain text → Context-dependent routing
                         │
                         ├── Worker context active → Send to worker agent
                         └── Orchestrator context  → Send to orchestrator
```

---

## 5. Key Design Decisions

### 5.1 Entry Point & CLI Framework

**Decision**: Use `commander` for arg parsing, custom REPL for interactive mode.

- `commander` handles `--model`, `--output-format`, `--team`, `-p`, `-c`, `-r` flags
- Custom REPL engine wraps readline with slash command parsing, history, shortcuts
- No heavy TUI framework (no blessed/ink) — keep it terminal-native like Claude Code

### 5.2 Session Storage Format

```
~/.ping/
├── sessions/
│   ├── <session-id>.json         # Conversation history + metadata
│   └── <session-id>/
│       └── workers/
│           └── <role>.json       # Per-worker conversation state
├── config.json                   # User prefs (theme, model, etc.)
├── agents/                       # Custom worker definitions (.md)
└── agent-memory/                 # Per-worker persistent memory
    └── <role>/
        └── MEMORY.md
```

### 5.3 Output Format Contract

Three output modes (like Claude Code):

```typescript
// text (default) — human-readable ANSI output
// json — single JSON object per response
{ "type": "response", "role": "backend", "content": "...", "taskId": "..." }
// stream-json — newline-delimited JSON events  
{ "type": "start", "taskId": "abc123" }
{ "type": "delta", "content": "I'll create..." }
{ "type": "tool_use", "tool": "write_file", "input": { "path": "..." } }
{ "type": "end", "taskId": "abc123" }
```

### 5.4 Worker Definition Files

Inspired by Claude Code's subagent markdown files:

```markdown
---
name: backend
description: Backend API development specialist
tools: workspace, artifact, bash, complete_task
model: gpt-4o
maxTurns: 20
---

You are a backend developer specializing in Node.js and TypeScript APIs.

When assigned a task:
1. Read the task description and dependencies
2. Check workspace for existing code
3. Implement the solution
4. Write tests
5. Commit with conventional commit messages
```

Stored in `.ping/workers/` (project-level) or `~/.ping/workers/` (user-level).

---

## 6. Integration Points

### 6.1 With Existing Backend

| Component | CLI Integration |
|-----------|-----------------|
| `AgentManagerV2` | CLI creates and manages via composition (not inheritance) |
| `OrchestratorService` | Slash commands map to orchestrator methods |
| `WorkerPool` | Worker CLI contexts map to active workers |
| `MemoryManager` | `/memory` and `/memtasks` commands |
| `FilePlanStore` | Session persistence for plans |
| `AgentWorkspace` | `/workspace` commands show git status, files, diff |

### 6.2 With Frontend

The CLI and frontend are alternative interfaces to the same backend:

```
                    ┌─────────────┐
                    │ AgentManager │
                    │     V2       │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
         ┌────┴────┐  ┌───┴───┐  ┌────┴────┐
         │   CLI   │  │  HTTP │  │ Socket  │
         │  (REPL) │  │  API  │  │   IO    │
         └─────────┘  └───────┘  └─────────┘
```

The CLI is a direct consumer — no HTTP/WebSocket layer needed (in-process).

---

## 7. Phased Implementation Roadmap

### Phase 1: Foundation (v1.0) — Restructure
- [ ] Extract CLI into modular file structure
- [ ] Implement CommandRegistry with slash command pattern
- [ ] Add `commander` for CLI flags (`--team`, `--roles`, `--verbose`, `--output-format`)
- [ ] Convert existing commands to slash commands
- [ ] Add tab completion for commands
- [ ] Add `--output-format json` support
- [ ] Session auto-save (basic)

### Phase 2: Worker CLI (v1.1) — Per-Worker Context
- [ ] Implement `WorkerCLI` class with isolated conversation
- [ ] `/worker <role>` command to switch context
- [ ] `/back` to return to orchestrator
- [ ] Worker-scoped prompt showing role + task + branch
- [ ] `/workspace status` inside worker context
- [ ] Multi-worker status display (inline mode)

### Phase 3: UX Polish (v1.2) — Power User Features
- [ ] Bash mode (`!` prefix)
- [ ] File mentions (`@` prefix)
- [ ] Keyboard shortcuts (Ctrl+L clear, Ctrl+C cancel, Ctrl+B background)
- [ ] Multiline input (`\` + Enter)
- [ ] Command history with reverse search (Ctrl+R)
- [ ] Spinner/progress indicators during agent execution
- [ ] Syntax highlighting for code blocks in output

### Phase 4: Session & Memory (v2.0)
- [ ] Full session persistence (`-c` continue, `-r` resume)
- [ ] `/rename` for naming sessions
- [ ] `/export` conversation export
- [ ] Per-worker persistent memory (MEMORY.md pattern)
- [ ] Worker definition files (markdown with YAML frontmatter)
- [ ] `~/.ping/` config directory

### Phase 5: Advanced (v2.1+)
- [ ] Worker display modes (inline/split/tmux)
- [ ] Background task management (Ctrl+B, `/tasks`)
- [ ] Prompt suggestions (Tab to accept)
- [ ] Print mode (`-p` for non-interactive, pipe-compatible)
- [ ] `--json-schema` for structured output validation
- [ ] Plugin system for custom commands
- [ ] PR review status in footer
- [ ] `/compact` context compaction
- [ ] Vim mode

---

## 8. Comparison: Current vs Target

| Aspect | Current | Target |
|--------|---------|--------|
| **Files** | 1 file (984 lines) | ~20+ modules |
| **Commands** | Bare words (`plan`, `start`) | Slash commands (`/plan`, `/start`) |
| **Worker interaction** | Through orchestrator only | Direct per-worker CLI |
| **Session** | Lost on exit | Persistent, resumable |
| **Output** | ANSI text only | text / json / stream-json |
| **Input** | Single-line readline | Multiline, bash mode, file mentions |
| **Completion** | None | Tab completion for commands + files |
| **Config** | Hardcoded | `.pingrc`, env vars, CLI flags |
| **Testing** | In-process E2E test | Modular, unit-testable commands |
| **Extensibility** | Edit the class | Command registry + plugin system |
| **Scaffold** | `init` command only | `--team`, `--roles`, `--workers` flags |
| **Display** | Sequential output | Status bar, task list, multi-worker view |

---

## 9. Non-Goals (Explicitly Out of Scope)

- **Full TUI framework** (blessed, ink) — keep it terminal-native
- **Web-based terminal** — frontend handles web UI
- **Custom shell** — we wrap readline, not replace bash
- **Cross-machine sync** — sessions are local
- **Built-in editor** — delegate to `$EDITOR` for large edits

---

## 10. Open Questions

1. **Naming**: `ping` as the CLI command? Or something else?
2. **Config format**: JSON (`.pingrc`) vs YAML (`.ping.yml`) vs TOML?
3. **Worker definition format**: Markdown+YAML frontmatter (like Claude) vs pure JSON?
4. **Tmux integration**: Worth building for v2, or only inline/headless?
5. **Plugin API**: Should commands be loadable from npm packages?
