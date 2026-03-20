# CLI System — Implementation Tracker

> **Status**: v1.0 Complete  
> **Current Phase**: Phase 1+2 done, Phase 3-4 future  
> **Last Updated**: 2026-02-15

---

## Phase 1: Foundation (v1.0) — ✅ Complete

| Task | Status | Notes |
|------|--------|-------|
| 1.1 Create module structure | ✅ Complete | Flat `cli/commands/` with 7 command files |
| 1.2 Implement CommandRegistry | ✅ Complete | `CommandRegistry.ts` — register, resolve, dispatch, completions |
| 1.3 Extract existing commands | ✅ Complete | 22 commands across setup, planning, tasks, worker, config, debug, system |
| 1.4 Tab completion | ✅ Complete | Wired via readline completer in `app.ts` |
| 1.5 Auto-generated help | ✅ Complete | `/help` groups by category with aliases |
| 1.6 Backward compatibility | ✅ Complete | Bare commands (no `/` prefix) still work |
| ReplEngine class | ⏭ Skipped | readline in app.ts is sufficient |
| CLI flags (Commander) | ⏭ Deferred | Not needed for testing |
| JSON output formatter | ⏭ Deferred | Not needed for testing |
| Session save/resume | ⏭ Deferred | Future enhancement |

## Phase 2: Worker CLI (v1.1) — ✅ Complete

| Task | Status | Notes |
|------|--------|-------|
| 2.1 /worker command | ✅ Complete | Auto-finds task for role, auto-starts if ready, switches context |
| 2.2 /back command | ✅ Complete | Returns to orchestrator context |
| 2.3 Worker-scoped prompt | ✅ Complete | `role[task:id] »` with branch info |
| 2.4 /workspace command | ✅ Complete | Shows branch, uncommitted files, activities |
| 2.5 /workers (multi-status) | ✅ Complete | Lists all active workers with task IDs + branches |
| 2.6 Worker chat routing | ✅ Complete | Bare text in worker mode routes to `continueTask()` |
| WorkerCLI class | ⏭ Skipped | Commands + context switching is enough |
| /workspace diff/files/log | ⏭ Deferred | Can add as subcommands later |

## Phase 3: UX Polish (v1.2) — Not Started

| Task | Status | Notes |
|------|--------|-------|
| 3.1 Bash mode (!) | ⬜ Not Started | Shell exec, add output to context |
| 3.2 File mentions (@) | ⬜ Not Started | Resolve + inject file content |
| 3.3 Keyboard shortcuts | ⬜ Not Started | Ctrl+L, Ctrl+C, Ctrl+B |
| 3.4 Multiline input | ⬜ Not Started | |
| 3.5 Reverse search (Ctrl+R) | ⬜ Not Started | |
| 3.6 Spinners (ora) | ⬜ Not Started | During agent execution |
| 3.7 Syntax highlighting | ⬜ Not Started | Code blocks in responses |

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

## Files

| File | Purpose |
|------|---------|
| `cli/app.ts` | Main entry — `AgentManagerCLI` class, readline, routing |
| `cli/CommandRegistry.ts` | Command registration, resolution, dispatch, help |
| `cli/types.ts` | `Command` + `CommandContext` interfaces |
| `cli/colors.ts` | ANSI color helpers |
| `cli/commands/setup.ts` | `/init`, `/status` |
| `cli/commands/planning.ts` | `/plan`, `/showplan`, `/approve`, `/resetplan` |
| `cli/commands/tasks.ts` | `/tasks`, `/task`, `/start`, `/chat`, `/complete`, `/discard`, `/modify`, `/stop` |
| `cli/commands/worker.ts` | `/worker`, `/back`, `/workers`, `/workspace` |
| `cli/commands/config.ts` | `/autoexec`, `/autoapprove` |
| `cli/commands/debug.ts` | `/events`, `/memory`, `/memtasks`, `/say`, `/run` |
| `cli/commands/system.ts` | `/help`, `/clear`, `/exit` |
| `cli/index.ts` | Legacy CLI (preserved, `npm run cli:legacy`) |
