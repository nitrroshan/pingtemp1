---
name: workspace-guide
description: >
  How to use your git-based workspace effectively. Covers the full workflow from
  orientation to publishing. ALWAYS follow this when working inside a workspace —
  it prevents common mistakes like redundant file listing, overwriting files instead
  of editing, and forgetting to commit or publish.
---

# Workspace Guide

You work in a **git-isolated workspace** — a branch created for your task. Other agents cannot see your changes until you publish. Every file operation happens relative to the workspace root.

**The deliverable is published work** — not plans, not notes. Use scratch for thinking, workspace files for deliverables. Publish when your task output is complete.

---

## Decision Tree: What to Do First

```
Starting a task → Do I know what's already in the workspace?
    ├─ No → Run whoami, then workspace_status
    │       └─ Is the workspace empty?
    │           ├─ Yes → Skip to WRITE & EDIT
    │           └─ No → SEARCH for relevant files before writing
    │
    └─ Yes → Do I need to find something specific?
        ├─ Yes, I know the filename → workspace_glob("**/filename*")
        ├─ Yes, I know content/code → workspace_grep("pattern")
        ├─ Yes, but vague terms → keyword_search("concept")
        └─ No → Start writing/editing
```

---

## Workflow

Follow this workflow for every task. Do not skip steps.

### Step 1: Orient

Run these ONCE at the start:
- `whoami` — your role, name, goal, skills, team
- `workspace_status` — uncommitted changes, branch, last commit
- `workspace_list_files` — files at workspace root (ONE call, not repeated)

> **Checkpoint**: You know your task, your branch, and what files exist. Move on.

### Step 2: Search Before Writing

**CRITICAL: Always search before creating or modifying files.** This prevents duplicating existing work and overwriting others' output.

Choose the right search tool:

| I need to... | Tool | Example |
|---|---|---|
| Find files by name pattern | `workspace_glob` | `workspace_glob("**/*.ts")` |
| Find content inside files | `workspace_grep` | `workspace_grep("handleAuth")` |
| Find concept I can't name exactly | `keyword_search` | `keyword_search("authentication flow")` |
| Check if specific file exists | `workspace_file_exists` | `workspace_file_exists("src/auth.ts")` |
| Get context from other agents | `collab read` | Read upstream task outputs and shared docs |

**Common Mistake — DO NOT DO THIS:**
```
workspace_list_files(".")
workspace_list_files("src")
workspace_list_files("src/components")
workspace_list_files("src/components/auth")
workspace_list_files("src/components/auth/hooks")
```
This wastes 5 tool calls exploring directories one at a time.

**Do this instead:**
```
workspace_glob("src/**/*.ts")
```
One call. Gets every TypeScript file in the tree.

> **Checkpoint**: You know what exists. You won't duplicate work. Move on.

### Step 3: Read & Understand

- `workspace_read_file` — read specific files you found in Step 2
- `workspace_file_stats` — check file size/line count before reading large files

> **Checkpoint**: You understand the existing code/content. Move on to editing.

### Step 4: Write & Edit

Choose the right write tool:

| Situation | Tool | Why |
|---|---|---|
| Creating a new file | `workspace_create_file` | Check `workspace_file_exists` first |
| Writing brand new content | `workspace_write_file` | Full file replacement |
| Modifying existing file | `workspace_search_and_replace` | Surgical edit — preserves surrounding code |
| Removing a file | `workspace_delete_file` | Check it exists first |

**Common Mistake — DO NOT DO THIS:**
```
workspace_read_file("config.ts")
# see the content, want to change line 5
workspace_write_file("config.ts", "...entire 200-line file with one line changed...")
```
This rewrites the whole file when only one line changed.

**Do this instead:**
```
workspace_search_and_replace("config.ts", "oldValue", "newValue")
```
One surgical edit. No risk of losing other changes.

### Step 5: Track Your Work

Use scratch for thinking. Use workspace for deliverables.

- `scratch_todo` — track sub-tasks ("✓ wrote schema", "□ add validation")
- `scratch_note` — save findings, decisions, design notes
- `scratch_remember` — store key facts to reference later (API URLs, schema shapes)
- `report_status` — tell the orchestrator what you're doing ("Implementing auth middleware")

> **Checkpoint**: Your progress is tracked. Others can see your status.

### Step 6: Commit & Publish

**Commit after each logical unit of work**, not after every file change:
```
# WRONG: commit per file
workspace_create_file("src/auth.ts", "...")
workspace_commit("add auth file")
workspace_create_file("src/auth.test.ts", "...")
workspace_commit("add auth test")

# RIGHT: commit per logical change
workspace_create_file("src/auth.ts", "...")
workspace_create_file("src/auth.test.ts", "...")
workspace_commit("feat: add authentication module with tests")
```

When your task deliverable is **complete**:
1. `workspace_commit` — final commit with descriptive message
2. `workspace_publish` — makes your branch visible to other agents
3. `complete_task` — signals the orchestrator you're done

**Do NOT call complete_task before publishing.**

---

## Anti-Patterns

| Anti-pattern | What happens | Fix |
|---|---|---|
| Repeated `workspace_list_files` | Wastes 5-10 tool calls exploring dirs | Use `workspace_glob` once |
| `write_file` for small edits | Overwrites entire file, loses concurrent changes | Use `search_and_replace` |
| Creating without checking existence | May overwrite existing work | Call `file_exists` first |
| Committing every file separately | Noisy git history, slow | Commit per logical change |
| Publishing before task is done | Incomplete work visible to team | Publish only when complete |
| Skipping context check | Miss prerequisites from other agents | Check deliverables section in your prompt |

---

## Quick Reference

| Category | Tools |
|---|---|
| **Orient** | `whoami`, `workspace_status`, `workspace_info`, `workspace_list_files` |
| **Search** | `workspace_grep`, `workspace_glob`, `keyword_search`, `workspace_file_exists` |
| **Read** | `workspace_read_file`, `workspace_file_stats`, `workspace_progress` |
| **Write** | `workspace_create_file`, `workspace_write_file`, `workspace_search_and_replace`, `workspace_delete_file` |
| **Scratch** | `scratch_todo`, `scratch_note`, `scratch_remember`, `scratch_file`, `promote_to_workspace` |
| **Git** | `workspace_commit`, `workspace_publish`, `workspace_get_history`, `workspace_discard`, `workspace_reactivate` |
| **Lifecycle** | `report_status`, `complete_task`, `workspace_log_activity` |
