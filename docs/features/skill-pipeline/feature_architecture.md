# Skill Pipeline — Architecture

> **Status:** Implemented — Option B (Team-Scoped Skills via Registry)
> **Decision:** Remove DB-based skill system, use file-based registry only
> **Pattern:** Same as Claude Code — skills are SKILL.md files bundled with team plugins

## How It Works

Skills are SKILL.md files in the registry, scoped per team:

```
packages/registry/plugins/
  engineering-team/skills/
    security-review/SKILL.md
    api-design/SKILL.md
    lint-check/SKILL.md
    ...
  research-team/skills/
    research-methodology/SKILL.md
  product-team/skills/
    user-stories/SKILL.md
```

### Data Flow

```
Team created with pluginName="engineering-team"
  → AgentManagerRegistry.loadTeam(teamId)
  → Reads agent .md files → extracts config.skills per role
  → Builds roleSkillMap: { backend: [api-design, security-review], qa: [test-automation], frontend: [react-patterns] }
  → new SkillPlugin({ pluginsDir, teams: ["engineering-team"], roleSkillMap })
  → SkillPlugin.initialize() scans engineering-team/skills/
  → Loads 8 SKILL.md files, wires roleSkillMap into SkillMcpServer
  → SkillMcpServer.getTools(context) filters by context.role
  → backend agent gets api-design + security-review tools only
  → qa agent gets test-automation tool only
  → UI shows tool cards when agent uses a skill
```

### Key Components

| Component | Location | Role |
|-----------|----------|------|
| **SkillPlugin** | `packages/backend/agentManager/plugins/SkillPlugin.ts` | `IPlugin` that reads SKILL.md files, exposes as tools |
| **SkillMcpServer** | (inside SkillPlugin.ts) | `IMcpServer` that returns skill tools per context |
| **FileBackedSkill** | (inside SkillPlugin.ts) | `ISkill` with on-demand loading |
| **Registry plugins** | `packages/registry/plugins/*/skills/*/SKILL.md` | Source of truth for skill content |
| **AgentManagerRegistry** | `packages/backend/agentManager/AgentManagerRegistry.ts` | Wires team's `pluginName` → SkillPlugin scope |

### SKILL.md Format

```markdown
---
name: security-review
description: Security review checklist for code changes.
tags: [security, review, owasp]
---

## Security Review Checklist

### Authentication & Authorization
- Verify all endpoints require authentication
- Check authorization boundaries
...
```

## What Was Removed (DB-Based System)

The entire MongoDB-based skill pipeline was removed as dead code:

| Deleted | What it did |
|---------|-------------|
| `skills/services/SkillRegistryService.ts` | DB CRUD for skills |
| `skills/services/EmbeddingService.ts` | Vector embedding generation |
| `skills/services/embeddingClient.ts` | OpenAI embedding client |
| `skills/scripts/seedOfficialSkills.ts` | Seeded skills to MongoDB |
| `skills/api/skillsRouter.ts` | REST endpoints for skill CRUD |
| `skills/SkillResolver.ts` | Resolved skill IDs from DB |
| `skills/SkillIntegration.ts` | Agent skill enhancement helpers |
| `skills/tools/SkillTools.ts` | Agent-callable skill tools (DB-backed) |
| `services/mongo/schemas/SkillSchema.ts` | Mongoose skill model |
| `services/mongo/schemas/AgentSkillSchema.ts` | Mongoose agent-skill join model |

**Why removed:** These read from MongoDB + `~/.ping/skills/` (paths that never existed). The SkillSelector UI saved assignments to DB but they were never loaded at runtime. Two parallel systems created confusion.

## Remaining Work

### Frontend SkillSelector
The `SkillSelector` component in frontend still calls `/api/skills` endpoints that no longer exist. Options:
1. **Remove it** — simplest, skills are managed via SKILL.md files
2. **Repurpose** — show read-only list of team's skills from registry (no DB)

### Adding New Skills
To add a skill to a team:
1. Create `packages/registry/plugins/<team>/skills/<skill-id>/SKILL.md`
2. Use standard frontmatter format (name, description, tags)
3. Restart backend — SkillPlugin auto-discovers on init
