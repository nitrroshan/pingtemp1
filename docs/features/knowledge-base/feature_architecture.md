# L3 Knowledge Base — Feature Architecture

**Status:** New  
**Date:** March 31, 2026  
**ID:** D1  
**Extracted from:** [Memory System (done)](../done/memory-system/feature_architecture.md) — L3  
**Source designs:** [v2.0 Implementation Plan](../done/memory-system/v2.0/feature_implementation_planning.md), [OKL Idea](../../product/ideas/organizational-knowledge-layer.md)  
**Packages:** `@ping/knowledge-base` (store), `@ping/page-index` (retrieval — v2)

---

## Overview

L3 is the **organizational memory** — persistent documents that teach agents how YOUR organization works. Skills, runbooks, project docs, decisions. Agents consume them at task start, update them when they learn, and the knowledge compounds across goals.

The core insight from the [OKL doc](../../product/ideas/organizational-knowledge-layer.md): **Documents teach, agents learn. The document IS the skill.**

```
Without L3: Agent uses generic LLM knowledge → misses YOUR procedures
With L3:    Agent loads "auth-service-deployment.md" → knows YOUR rollback steps
```

### What's Already Built

| Component | Status | File |
|---|---|---|
| `L3KnowledgePlugin` | ✅ Plugin shell | `packages/backend/memory/L3/L3KnowledgePlugin.ts` |
| `KnowledgeBase.ts` | 🚧 Stub (empty results) | `packages/backend/memory/L3/knowledge/KnowledgeBase.ts` |
| `KnowledgeStore` | ✅ MongoDB CRUD | `packages/backend/memory/L3/knowledge/KnowledgeStore.ts` |
| `KnowledgeRetrieval` | ✅ Basic text search | `packages/backend/memory/L3/knowledge/KnowledgeRetrieval.ts` |
| `KnowledgePromotion` | ✅ Proposal workflow | `packages/backend/memory/L3/knowledge/KnowledgePromotion.ts` |
| `knowledge.types.ts` | ✅ Type definitions | `packages/backend/memory/L3/knowledge/types/` |

### What's Missing (This Feature)

| Component | What | Priority |
|---|---|---|
| Document types with audience | skill / runbook / project / decision / onboarding | v1 |
| Git-backed markdown storage | Source of truth in Git, indexed in MongoDB | v1 |
| Worker integration | Auto-inject relevant docs into agent context at task start | v1 |
| Ingestion pipeline | Auto-promote from approved artifacts + planner decisions | v1 |
| Full-text search | MiniSearch or MongoDB text index over all docs | v1 |
| Frontend wiki browser | Folder tree + markdown viewer + edit | v1 |
| MCP server | `@ping/knowledge-base/mcp` for CLI + external agents | v1 |
| **Hierarchical retrieval (PageIndex)** | Multi-level vector traversal (separate package) | **v2** |
| **Learning loop** | Doc health tracking, success/failure, auto-fix | **v2** |
| **Semantic search** | Embedding-based "find by meaning" | **v2** |

---

## v1: The Knowledge Store + Worker Integration

### Document Types & Audiences

From the [OKL design](../../product/ideas/organizational-knowledge-layer.md):

| Type | Answers | Audience | Agent Can Write? |
|---|---|---|---|
| **Skills** | "How do I do X?" | 🤖 Agent | ✅ Yes — auto-approvable |
| **Runbooks** | "What steps for Y?" | 🤖+👤 Both | ✅ With review |
| **Projects** | "What is this system?" | 🤖+👤 Both | ✅ Agent drafts, human refines |
| **Decisions** | "Why did we choose Z?" | 👤 Human | ❌ Suggest only |
| **Onboarding** | "How do I get started?" | 👤 Human | ✅ Agent drafts, human refines |

### Storage: Git-Backed Markdown

Documents are markdown files with YAML frontmatter. Git is the source of truth. MongoDB indexes for fast search.

```
knowledge/                        ← Git repo (per org or per team)
├── skills/
│   ├── deploy-production.md
│   ├── api-design.md
│   └── write-marketing-copy.md
├── runbooks/
│   ├── incident-response.md
│   └── campaign-launch-checklist.md
├── projects/
│   ├── auth-service/
│   │   ├── overview.md
│   │   ├── how-it-works.md
│   │   └── working-on.md
│   └── q1-marketing-campaign/
│       ├── overview.md
│       └── working-on.md
├── decisions/
│   ├── why-postgresql.md
│   └── why-hubspot-over-marketo.md
└── onboarding/
    ├── engineering-setup.md
    └── marketing-tools.md
```

### Document Format

```markdown
---
id: deploy-production
type: skill
audience: agent
roles: [devops, backend]
version: 2.3
usefulWhen: [deploying, CI/CD issues, rollback needed]
lastValidated: 2026-03-15
---

# Production Deployment

## Procedure
1. Verify all tests pass in CI
2. Check staging health: `curl https://staging.example.com/health`
3. Run deployment: `npm run deploy:prod`
4. Monitor error rates for 15 minutes
5. If error rate > 1%, trigger rollback

## Rollback
See: [[rollback-procedure]]

## Learned From
- Incident #123: Added 15-minute monitoring window
- Task #456: Updated health check endpoint
```

### Worker Integration: Auto-Inject at Task Start

When a worker gets a task, the system searches L3 for relevant docs and injects them into the agent's system prompt:

```typescript
// In WorkerPool.runTask() — already designed in v2.0 plan
async runTask(taskId: string, role: string, input: string): Promise<TaskResult> {
  const task = this.memoryCoordinator.tasks.getTask(taskId);
  
  // Search L3 for relevant knowledge
  const knowledge = await this.memoryCoordinator.L3.getForTask({
    taskDescription: task.description,
    role: role,
    taskType: task.type,
    projectId: task.projectId,
  });
  
  // Build enhanced prompt with knowledge context
  const enhancedPrompt = buildPromptWithKnowledge(input, knowledge);
  
  return worker.execute(enhancedPrompt);
}
```

The agent doesn't manually search L3 — the system does it automatically. Agent just receives relevant knowledge as context.

### Ingestion: How Docs Get In

```
1. MANUAL: Human creates/edits markdown in Git (PR workflow)
   → Git commit triggers re-index in MongoDB

2. AUTO (artifacts): Approved workspace artifacts promoted to L3
   → Goal completes → approved artifacts → KnowledgePromotion.proposeNew()
   → Human approves → Doc created in Git + indexed

3. AUTO (decisions): Planner decisions captured from L2
   → Planner writes decision rationale to L2 during execution
   → On goal completion → key decisions proposed to L3
   → Human approves → Decision doc created

4. AUTO (learnings): Task failure/success patterns
   → Agent discovers something: "API has rate limit of 100/min"
   → System proposes new skill doc → human approves
```

### Project Documentation Schema

Works for ANY project type — software, marketing, legal, research:

```typescript
interface ProjectDocumentation {
  overview: {
    purpose: string;             // "Auth service handles user identity"
    businessContext: string;
    status: 'active' | 'maintenance' | 'deprecated';
  };
  
  howItWorks: {                  // Agent reads this to understand the project
    components: ComponentDoc[];  // Key pieces (modules, stages, deliverables)
    workflow: string;            // How work flows through
    dependencies: string[];
    keyResources: Record<string, string>;  // "auth" → "src/auth/"
  };
  
  workingOn: {                   // Agent reads this to follow standards
    conventions: string[];       // Team standards (naming, formats)
    qualityChecks: string;       // How to verify work
    commonMistakes: string[];    // Pitfalls to avoid
  };
  
  ownership: {                   // Human reads this
    team: string;
    maintainers: string[];
    escalationPath: string;
  };
}
```

| Project Type | `howItWorks.components` | `workingOn.conventions` |
|---|---|---|
| **Software** | Modules, services, APIs | Code style, test patterns |
| **Marketing** | Channels, audiences, assets | Brand voice, approval flow |
| **Legal** | Sections, clauses, parties | Legal terminology, review process |

### Role-Based Document Routing

Agents only see knowledge relevant to their role:

| Document | Roles | Researcher Sees? | Writer Sees? |
|---|---|---|---|
| `api-design.md` | `[backend, architect]` | ❌ | ❌ |
| `brand-guidelines.md` | `[marketing, writer]` | ❌ | ✅ |
| `research-methods.md` | `[researcher]` | ✅ | ❌ |
| `company-values.md` | `[]` (all roles) | ✅ | ✅ |

---

## Package: `@ping/knowledge-base`

```
packages/
  knowledge-base/                 ← @ping/knowledge-base
    src/
      KnowledgeBase.ts              CRUD + search + role-based retrieval
      KnowledgeStore.ts             MongoDB index (mirrors Git content)  
      KnowledgePromotion.ts         L2 → L3 proposal workflow
      KnowledgeRetrieval.ts         Search: full-text (v1), hierarchical (v2)
      GitSync.ts                    Git ↔ MongoDB sync on commit
      types.ts                      KnowledgeDocument, ProjectDoc, etc.
      mcp/
        server.ts                   MCP server for CLI + external agents
    package.json
```

### Public API

```typescript
import { KnowledgeBase } from '@ping/knowledge-base';

const kb = new KnowledgeBase({ mongodb, gitRepoPath });

// Search (agent or human)
const docs = await kb.search('rate limiting', { role: 'backend', limit: 5 });

// Get for task (auto-injection)
const context = await kb.getForTask({ description, role, projectId });

// Create (human or system)
await kb.create({ type: 'skill', title: 'Rate Limiting', content: '...', roles: ['backend'] });

// Promote from L2
await kb.propose({ source: { artifactId: 'art-001' }, type: 'skill', content: '...' });
await kb.approve(proposalId);

// Read project docs
const projectDocs = await kb.getProjectDocs('auth-service');
```

### MCP Server

```typescript
// MCP tools: search_knowledge, read_doc, create_doc, list_docs, get_project
// Run: npx @ping/knowledge-base --port 3012

// CLI: ping knowledge search "auth deployment"
// CLI: ping knowledge read deploy-production
// CLI: ping knowledge create --type skill --file ./new-skill.md
```

---

## v2: Hierarchical Retrieval (`@ping/page-index`)

The PageIndex is a **separate reusable package** — a multi-level vector retrieval engine. It doesn't know or care about knowledge documents specifically. It takes any hierarchical content and finds the right section.

```
Query: "How do I handle JWT token expiry?"
  │
  L0: Team directory    → match: Auth team
  L1: Project index     → match: auth-service
  L2: Document index    → match: how-it-works.md
  L3: Section index     → match: "## Token Expiry Handling"
  │
  Content fetch from Git: lines 145-210
```

This is a **separate feature** — see [workspace-search](../workspace-search/feature_architecture.md) for the L1 equivalent. PageIndex serves both.

---

## v2: Learning Loop (from OKL)

The [OKL doc's](../../product/ideas/organizational-knowledge-layer.md) most valuable insight: **documents ARE the Q&A cache**.

```
Worker: "How to handle rate limiting?"
  → L3 search: no doc found
  → Worker asks, LLM answers, answer becomes a doc
  → Next worker with similar question finds the doc
  → Success? +1. Failure? Fix doc. -1.
  → Doc health < 50%? Flag for review.
```

Track success/failure per document:

```typescript
interface DocHealth {
  docId: string;
  successCount: number;
  failureCount: number;
  health: number;          // successCount / total — 0.0 to 1.0
  lastUsedAt: Date;
  flaggedForReview: boolean;
}
```

This is a **behavioral pattern** on top of the knowledge store, not a separate system. It's v2 because it needs meaningful data volume (hundreds of doc usages) to be valuable.

---

## Implementation Checklist (v1)

| Component | Status | Action |
|---|---|---|
| `KnowledgeStore` (MongoDB) | ✅ Exists | Add document types, audience, roles fields |
| `KnowledgePromotion` | ✅ Exists | Wire into goal completion flow |
| `KnowledgeRetrieval` | ✅ Exists (basic) | Add role-based filtering, full-text search |
| `knowledge.types.ts` | ✅ Exists | Add `KnowledgeType`, `audience`, `ProjectDocumentation` |
| Git-backed storage | ❌ Missing | Markdown files in Git repo, synced to MongoDB |
| `GitSync` | ❌ Missing | Sync Git commits → MongoDB index |
| Worker integration | ❌ Missing | `getForTask()` in WorkerPool.runTask() |
| System prompt enhancement | ❌ Missing | Inject knowledge into agent prompt |
| Ingestion (artifact promotion) | ❌ Missing | Hook into goal completion → propose artifacts |
| Ingestion (decision capture) | ❌ Missing | Hook into planner L2 writes → propose decisions |
| MCP server | ❌ Missing | `fastmcp` wrapper over KnowledgeBase |
| Frontend wiki browser | ❌ Missing | Folder tree + markdown viewer |
| CLI commands | ❌ Missing | `ping knowledge search/read/create` |

**Effort:** Medium (2-3 weeks for v1)
