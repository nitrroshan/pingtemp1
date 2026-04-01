# Company/Team Templates — Feature Architecture

**Status:** Architecture Draft  
**Date:** April 1, 2026  
**ID:** A11  
**Depends on:** Config Revision (A9), Team Stacking  
**Feeds into:** Marketplace (future)

---

## Overview

Export a team's full configuration as a reusable template. Import it to create a new team with the same agents, skills, settings, and structure — without secrets or team-specific data. Enables sharing proven team setups across organizations and eventually a template marketplace.

### Current State
- Teams created manually via `TeamService.createTeam()` + `addAgent()` per agent
- Agent definitions are YAML files — copyable but not bundled with team config
- No export/import mechanism
- No way to share a "this team setup works well for X" pattern

### Target State
- One API call exports a team → JSON/YAML template (no secrets, no IDs)
- One API call imports a template → creates a fully configured team
- Templates include: team settings, agent definitions, skill assignments, planner config
- Templates exclude: secrets, API keys, user IDs, runtime state, task history
- Template versioning (optional — v2.0)

---

## What a Template Contains

```yaml
# team-template.yaml
templateVersion: "1.0"
name: "Full-Stack Development Team"
description: "4-agent team for web app development"
category: "engineering"
tags: ["fullstack", "web", "react", "node"]

team:
  settings:
    executionMode: "hybrid"
    maxConcurrency: 3

agents:
  - role: "planner"
    type: "planner"
    name: "Tech Lead"
    definitionYaml: |
      id: tech-lead
      name: Tech Lead
      role: planner
      type: internal
      goal: "Plan and coordinate web application development"
      systemPrompt: |
        You are a senior tech lead...
    skills: ["code-review", "architecture"]

  - role: "backend-dev"
    type: "worker"
    name: "Backend Developer"
    definitionYaml: |
      ...
    skills: ["node", "postgres", "api-design"]

  - role: "frontend-dev"
    type: "worker"
    name: "Frontend Developer"
    definitionYaml: |
      ...
    skills: ["react", "css", "accessibility"]

  - role: "qa"
    type: "worker"
    name: "QA Engineer"
    definitionYaml: |
      ...
    skills: ["testing", "e2e", "security-scan"]

# What gets scrubbed on export:
# - All ObjectIds (_id, teamId, agentId)
# - All secrets (API keys, tokens, env vars)
# - All user references (ownerId, delegatedTo, changedBy)
# - All runtime state (status, lastStartedAt, errorMessage)
# - All task/plan/goal history
```

---

## Architecture Options

### Option A: JSON/YAML File Export

**Implementation:** `TeamService.exportTemplate(teamId)` serializes team + agents + skills into a JSON/YAML file. `TeamService.importTemplate(template, ownerId)` creates a new team from it. Templates are just files — stored locally, shared via copy/paste, git, or file upload.

```
Export: GET /api/v2/teams/:teamId/export → returns YAML
Import: POST /api/v2/teams/import { template: "...", ownerId: "..." } → creates team
```

**Pros:**
- Simplest possible implementation — serialize/deserialize
- Templates are portable files — share anywhere
- No new storage infrastructure
- Works offline

**Cons:**
- No discovery — users can't browse available templates
- No versioning (unless stored in git)
- No validation beyond schema check

**Effort:** Low — two service methods + two API endpoints

### Option B: Template Registry (MongoDB)

**Implementation:** Templates stored in a `templates` MongoDB collection with metadata (author, category, tags, usage count). Browse/search via API. Import from registry by template ID.

```
Publish: POST /api/v2/templates { teamId, name, description, tags }
Browse:  GET /api/v2/templates?category=engineering&tags=react
Import:  POST /api/v2/teams/from-template/:templateId { ownerId }
```

**Pros:**
- Discoverable — browse and search templates
- Usage tracking — know which templates are popular
- Versioning — templates can be updated, old versions preserved
- Foundation for marketplace

**Cons:**
- More infrastructure — new collection, new API surface
- Overkill for single-org use

**Effort:** Medium — new model, new endpoints, search/filter logic

### Option C: Git-Based Templates

**Implementation:** Templates are YAML files in a git repo (local or remote). A `templates/` directory in the workspace holds them. Import reads from the repo. Sharing = push to a shared git remote.

**Pros:**
- Native versioning (git history)
- Easy sharing via git remotes
- No database needed
- Diffable — see exactly what changed between template versions

**Cons:**
- Requires git setup
- No search/browse without building an index
- Less accessible to non-developers

**Effort:** Low — but limited discoverability

## Recommendation

**Option A (JSON/YAML File Export)** for v1.0 — simplest, immediately useful, no new infrastructure. Add Option B (Template Registry) in v2.0 when there are enough teams to make discovery valuable. The v1 export format is the same data that v2 stores in MongoDB, so migration is trivial.

**Decision Required:** Please choose Option A, B, or C.

---

## Scrubbing Rules

What gets stripped on export to prevent secret/data leakage:

| Category | Fields Removed | Replaced With |
|---|---|---|
| IDs | `_id`, `teamId`, `agentId` | Auto-generated on import |
| Secrets | API keys, tokens, env vars | `"[CONFIGURE_AFTER_IMPORT]"` placeholder |
| Users | `ownerId`, `delegatedTo`, `changedBy` | Import parameter or blank |
| Runtime | `status`, `lastStartedAt`, `errorMessage` | Default values |
| History | Tasks, plans, goals, revisions | Not included |
| Timestamps | `createdAt`, `updatedAt` | Reset on import |

## Incremental Delivery

| Version | What | Independently Useful? |
|---|---|---|
| **v1.0** | `exportTemplate()` + `importTemplate()` → YAML files | Yes — copy team setups |
| **v1.1** | Built-in starter templates (engineering, content, research) | Yes — quick start for new users |
| **v2.0** | Template registry with search/browse (Option B) | Yes — discover and share templates |
