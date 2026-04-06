# @ping/teams

**Team management service for the Ping platform.**

Provides `TeamService`, Mongoose models, TypeScript types, and error classes for multi-team orchestration. This is the single source of truth for all team, agent, member, and skill-assignment data.

## Installation

This is a [Bun workspace](https://bun.sh/docs/install/workspaces) package — it's installed automatically via the root `bun install`.

```bash
# From root of the monorepo
bun install
```

## Usage

```typescript
import { TeamService, type Team, type Agent } from "@ping/teams";

const teamService = new TeamService();

// Create a team
const team = await teamService.createTeam({
  name: "Product Team",
  ownerId: "user-123",
  description: "Frontend + Backend engineers",
});

// Add an agent
const agent = await teamService.addAgent(team._id.toHexString(), {
  name: "Backend Engineer",
  role: "backend-engineer",
  yaml: "...",
});

// Assign a skill
await teamService.assignSkillToAgent(agent._id.toHexString(), "code-analysis");
```

## Public API

| Export | Description |
|--------|-------------|
| `TeamService` | Main service — full CRUD for teams, agents, members, and skills |
| `TeamModel` | Mongoose model for `Team` documents |
| `AgentModel` | Mongoose model for `Agent` documents |
| `AgentSkillModel` | Mongoose model for `AgentSkill` junction documents |
| `TeamMemberModel` | Mongoose model for `TeamMember` documents |
| `connectTeamsDb()` | Optional standalone MongoDB connection helper |
| Error classes | `TeamNotFoundError`, `AgentNotFoundError`, etc. |

## Roadmap

| Phase | Status | Description |
|-------|--------|-------------|
| 3A | ✅ Done | TeamService + SkillService audit — services verified against product architecture |
| 3C Step 1 | ✅ Done | **This package** — extracted from `@ping/backend` to `packages/teams/` |
| 3C Step 2 | 🔜 Next | `@ping/agent-manager` source code extracted to `packages/agent-manager/` |

See [ROADMAP.md](../../docs/features/ROADMAP.md) for full Phase 3 details.
