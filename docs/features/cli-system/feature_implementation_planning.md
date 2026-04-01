# CLI System — Implementation Planning

> **Status**: v1.0 Complete  
> **Version**: v1.0 (Foundation + Worker CLI)  
> **Architecture**: [feature_architecture.md](./feature_architecture.md)  
> **Implementation**: [feature_implementation.md](./feature_implementation.md)

---

## What Was Built (v1.0)

Phase 1 (module restructure) and Phase 2 (worker CLI) were merged into a single pragmatic implementation. Instead of the full vision from the architecture doc, we shipped a simpler, flatter structure that covers the core needs: modular commands, per-worker context switching, and testability.

### Actual Structure

```
cli/
├── app.ts              # Main entry point (AgentManagerCLI class)
├── CommandRegistry.ts   # Register, resolve, dispatch, tab-complete
├── colors.ts           # ANSI color helpers
├── types.ts            # Command + CommandContext interfaces
├── index.ts            # Legacy 984-line CLI (preserved as fallback)
└── commands/
    ├── setup.ts        # /init, /status
    ├── planning.ts     # /plan, /showplan, /approve, /resetplan
    ├── tasks.ts        # /tasks, /task, /start, /chat, /complete, /discard, /modify, /stop
    ├── worker.ts       # /worker, /back, /workers, /workspace
    ├── config.ts       # /autoexec, /autoapprove
    ├── debug.ts        # /events, /memory, /memtasks, /say, /run
    └── system.ts       # /help, /clear, /exit
```

### Key Design Decisions

1. **Flat commands/** — No sub-folders per category. Commands are grouped by file (setup, planning, tasks, etc.) rather than nested directories. Categories are metadata on the Command interface, used for help grouping.

2. **No ReplEngine abstraction** — `app.ts` uses readline directly. The prompt logic, input routing, and tab completion live in `AgentManagerCLI` class methods. Simple and testable without extra indirection.

3. **No CLI flags / Commander** — Deferred. Team ID, roles, and config are set interactively via `/init` and `/autoexec` / `/autoapprove`. Non-interactive mode can be added later.

4. **Worker CLI is commands, not a class** — Instead of a `WorkerCLI` class, the `/worker` command switches context (sets `activeWorkerRole` and `activeTaskId`), and `app.ts` routes bare text to the worker's agent. `/back` clears the context.

5. **Backward compatibility** — Bare commands (without `/` prefix) still work. The dispatch flow: try `registry.dispatch()` → if unmatched, route to worker agent (if in worker mode) or orchestrator.

---

## Phase 1: Foundation — ✅ Complete

### Implemented

| Task | Status | Details |
|------|--------|---------|
| 1.1 Module structure | ✅ Done | Flat structure (see above), simpler than planned |
| 1.2 CommandRegistry | ✅ Done | `CommandRegistry.ts` — register, resolve, dispatch, completions, printHelp |
| 1.3 Extract commands | ✅ Done | 22 commands across 7 files, grouped by category |
| 1.4 Tab completion | ✅ Done | Wired via readline completer in `app.ts` |
| 1.5 Auto-generated help | ✅ Done | `/help` groups by category with descriptions and aliases |
| 1.6 Backward compat | ✅ Done | Bare commands without `/` still work |

### Deferred from Phase 1

| Task | Status | Reason |
|------|--------|--------|
| ReplEngine class | ⏭ Skipped | readline in app.ts is sufficient for now |
| CLI flags (Commander) | ⏭ Deferred | Interactive setup works; flags add complexity |
| JSON output formatter | ⏭ Deferred | Not needed for manual testing |
| Session save/resume | ⏭ Deferred | Future enhancement |

---

## Phase 2: Worker CLI — ✅ Complete

### Implemented

| Task | Status | Details |
|------|--------|---------|
| 2.1 /worker command | ✅ Done | `/worker <role>` — finds task, auto-starts if ready, switches context |
| 2.2 /back command | ✅ Done | Returns to orchestrator context, clears activeWorkerRole |
| 2.3 Worker-scoped prompt | ✅ Done | `role[task:id] »` format with branch info |
| 2.4 /workspace command | ✅ Done | Shows branch, uncommitted files, workspace activities |
| 2.5 /workers command | ✅ Done | Lists all active workers with task IDs and branch info |
| 2.6 Worker chat routing | ✅ Done | Bare text in worker mode routes to `continueTask()` |

### Deferred from Phase 2

| Task | Status | Reason |
|------|--------|--------|
| WorkerCLI class | ⏭ Skipped | Commands + context switching covers the need |
| /workspace diff | ⏭ Deferred | Can add as subcommand later |
| /workspace files | ⏭ Deferred | Can add as subcommand later |
| /workspace log | ⏭ Deferred | Can add as subcommand later |

---

## Phase 3: UX Polish (v1.1) — Not Started

Future enhancements for better developer experience.

| Task | Status | Notes |
|------|--------|-------|
| 3.1 Bash mode (`!` prefix) | ⬜ Not Started | Shell exec, add output to context |
| 3.2 File mentions (`@path`) | ⬜ Not Started | Resolve + inject file content |
| 3.3 Keyboard shortcuts | ⬜ Not Started | Ctrl+L, Ctrl+C, Ctrl+B |
| 3.4 Multiline input | ⬜ Not Started | |
| 3.5 Reverse search (Ctrl+R) | ⬜ Not Started | |
| 3.6 Spinners (ora) | ⬜ Not Started | During agent execution |
| 3.7 Syntax highlighting | ⬜ Not Started | Code blocks in responses |

---

## Phase 4: Session & Memory (v2.0) — Not Started

| Task | Status | Notes |
|------|--------|-------|
| 4.1 Full session persistence | ⬜ Not Started | Conversation history |
| 4.2 Continue/resume flags | ⬜ Not Started | `-c` / `-r` |
| 4.3 /rename command | ⬜ Not Started | |
| 4.4 /export command | ⬜ Not Started | |
| 4.5 Worker definition files | ⬜ Not Started | Markdown + YAML frontmatter |
| 4.6 Per-worker memory | ⬜ Not Started | MEMORY.md pattern |
| 4.7 ~/.ping/ config dir | ⬜ Not Started | |

---

## Verification Criteria

### Phase 1 + 2 (v1.0) — ✅ Verified

- [x] All existing commands work as `/command` slash commands
- [x] Tab completion works for command names
- [x] `/help` auto-generates from CommandRegistry, grouped by category
- [x] Bare commands without `/` still work (backward compat)
- [x] TypeScript compiles clean (0 errors)
- [x] 11/11 workspace E2E tests pass
- [x] No functionality regression from legacy CLI
- [x] `/worker <role>` switches to worker context
- [x] Chat in worker context routes to correct agent
- [x] `/workspace` shows git info (branch, uncommitted files)
- [x] `/back` returns to orchestrator
- [x] `/workers` shows all active workers

### Phase 3 Complete When:
- [ ] `!ls` runs shell command and shows output
- [ ] `@src/file.ts` injects file content into message
- [ ] Ctrl+L clears screen
- [ ] Spinner shows during agent execution

### Run Configuration
```
npm run cli          # New modular CLI (app.ts)
npm run cli:legacy   # Old monolithic CLI (index.ts)
```
