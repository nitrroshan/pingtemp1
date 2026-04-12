---
name: collab-guide
description: >
  How to use the collab tool for team collaboration. Covers CRDT documents,
  plans, output manifests, and the BlockNote rich text editor. ALWAYS follow
  this when sharing work with teammates — it prevents common mistakes like
  writing before reading and missing shared context.
---

# Collaboration Guide

You share a **real-time collaboration space** with your teammates via the `collab` tool. This space has three categories of shared state:

- **CRDT docs** — structured JSON documents (key-value data). Writable by agents.
- **Plans** — the orchestrator's task plan. Read-only for agents.
- **Outputs** — published output manifests from completed tasks. Read-only for agents.

All changes are instantly visible to all agents and humans connected to the team.

**The collab tool is your team's shared memory.** Read it before working. Write to it when you have results worth sharing.

---

## Decision Tree: When to Use Collab

```
Do I need to share information with my team?
    ├─ Yes → What kind of information?
    │   ├─ Structured data (JSON, config, schema) → collab write
    │   ├─ Rich text (report, findings, analysis) → collab write-block
    │   └─ I want to check what exists first → collab discover
    │
    └─ No → Do I need context from teammates?
        ├─ Yes → collab discover → collab read / read-block
        └─ No → Use workspace tools instead (private to your branch)
```

---

## Workflow: Progressive Discovery

The collab tool uses **progressive discovery** — start broad, drill down. Never guess document names.

### Step 1: Discover What Exists

```
collab({ action: "discover" })
```
Returns the three categories: `crdt`, `plans`, `outputs`.

Then drill into a category:
```
collab({ action: "discover", docName: "crdt" })
```
Returns list of shared CRDT documents (e.g., `agent-statuses`, `research-notes`, `api-spec`).

```
collab({ action: "discover", docName: "plans" })
```
Returns the current plan with task breakdown.

```
collab({ action: "discover", docName: "outputs" })
```
Returns completed task output manifests.

> **Checkpoint**: You know what shared docs exist. Move on.

### Step 2: Read Before Writing

Always read shared state before creating new content:
```
collab({ action: "list", docName: "research-notes" })
```
Lists all keys in a CRDT document.

```
collab({ action: "read", docName: "research-notes", key: "findings" })
```
Reads a specific key's value as JSON.

```
collab({ action: "read-block", docName: "research-notes" })
```
Reads the rich text content from the BlockNote editor (what humans and agents wrote).

**Common Mistake — DO NOT DO THIS:**
```
collab({ action: "write", docName: "findings", key: "analysis", value: "..." })
```
Writing without reading first — you may overwrite a teammate's work or duplicate existing content.

**Do this instead:**
```
collab({ action: "read", docName: "findings" })
# Check what exists, then write your addition
collab({ action: "write", docName: "findings", key: "security-analysis", value: "..." })
```

> **Checkpoint**: You know what your teammates have shared. Move on.

### Step 3: Write Your Contributions

Choose the right write action:

| I want to... | Action | Example |
|---|---|---|
| Store structured data (JSON) | `write` | `collab({ action: "write", docName: "api-spec", key: "endpoints", value: "{...}" })` |
| Publish human-readable text | `write-block` | `collab({ action: "write-block", docName: "report", key: "Security Analysis", value: "## Findings\n- No critical issues..." })` |
| Report my progress | `write` | `collab({ action: "write", docName: "agent-statuses", key: "backend", value: "Completed auth module" })` |

**write vs write-block:**
- `write` — stores **structured JSON data** in the CRDT map. For configs, schemas, structured results.
- `write-block` — inserts **rich text blocks** into the BlockNote editor. For reports, analysis, documentation visible to humans. Supports markdown: `# headings`, `- bullets`, plain text.

### Step 4: Check Plans and Outputs

- `plans` — read-only. Shows the orchestrator's plan with task assignments and dependencies.
- `outputs` — read-only. Shows completed task deliverables from other agents.

```
collab({ action: "read", docName: "plans" })
collab({ action: "list", docName: "outputs" })
collab({ action: "read", docName: "outputs", key: "task-1" })
```

---

## Anti-Patterns

| Anti-pattern | What happens | Fix |
|---|---|---|
| Writing before reading | Overwrites teammate's work | Always `read` or `discover` first |
| Guessing document names | Error or wrong document | Use `discover` to find names |
| Using `write` for reports | Humans can't see it in editor | Use `write-block` for readable content |
| Using `write-block` for data | Hard to parse programmatically | Use `write` for structured JSON |
| Ignoring plans/outputs | Miss task dependencies and context | Check `plans` and `outputs` at start |

---

## Quick Reference

| Action | Purpose | Writable? |
|---|---|---|
| `discover` | Browse categories or items in a category | — |
| `list` | Show keys in a CRDT doc or items in plans/outputs | — |
| `read` | Get a specific key/item as JSON | — |
| `read-block` | Read rich text from the collaborative editor | — |
| `write` | Set a key/value in a CRDT doc (structured JSON) | CRDT only |
| `write-block` | Insert rich text blocks into the editor (markdown) | CRDT only |

**Plans and outputs are read-only.** Only CRDT docs are writable.
