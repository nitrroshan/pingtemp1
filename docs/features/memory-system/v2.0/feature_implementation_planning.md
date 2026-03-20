# v2.0 Feature: Knowledge Base (L3 Org Memory)

> **Goal:** Permanent organizational knowledge with retrieval, versioning, and approval workflow  
> **Duration:** 2 weeks  
> **Priority:** 🟡 Enhancement — Defer until L1+L2 stable. Agents can operate without it; improves response quality.  
> **Dependencies:** v1.1 (CollaborationSpace for promotion source)

---

## Technology Decisions (Locked)

| Component | Technology | Rationale |
|-----------|------------|----------|
| **Retrieval Model** | Hierarchical Index (CPU page table) | Multi-level vector search on summaries (team → project → doc → section), fetch content from Git on demand. Cheaper, faster, more accurate than flat RAG |
| **Index Storage** | MongoDB Atlas Vector Search | Reuse existing vector search infra from agent registry, 1536-dim embeddings, filter by teamId/projectId/level. Content stays in Git |
| **Retrieval Engine** | [LlamaIndex.TS](https://github.com/run-llama/LlamaIndexTS) | TypeScript, MIT, `RouterQueryEngine` for multi-level traversal, `DocumentSummaryIndex` for summary embeddings |
| **Content Storage** | Git (Markdown) | Human-editable, versioned, searchable. Source of truth for full document content |

---

## 1. Problem Statement

### Current State
- Knowledge exists but partially implemented
- `KnowledgeStore.ts` has MongoDB schemas ✅
- `KnowledgeRetrieval.ts` has search basics ✅
- Missing: retrieval integration, full promotion workflow, knowledge injection

### Target State
- Agents automatically receive relevant knowledge for tasks
- Artifacts can be promoted from L2 → L3 with approval
- Knowledge versioned with history tracking
- Human approval workflow for sensitive changes

---

## 2. Current Implementation Status

### Already Implemented ✅

| Component | File | Status |
|-----------|------|--------|
| `KnowledgeBase` | `knowledge/KnowledgeBase.ts` | ✅ Wrapper class |
| `KnowledgeStore` | `knowledge/KnowledgeStore.ts` | ✅ MongoDB CRUD |
| `KnowledgeRetrieval` | `knowledge/KnowledgeRetrieval.ts` | ✅ Basic search |
| `KnowledgePromotion` | `knowledge/KnowledgePromotion.ts` | ✅ Proposal workflow |
| Types | `types/knowledge.types.ts` | ✅ Full type definitions |

### Gaps to Fill

| Gap | Current | Needed |
|-----|---------|--------|
| **Context injection** | Not integrated | Workers receive knowledge automatically |
| **Smart retrieval** | Text search only | Semantic + role-based + task-type filtering |
| **Promotion UI events** | Events exist | Wire to frontend for approval UI |
| **Project documentation** | Basic `project` type | Full ProjectDocumentation schema |
| **Learning loop** | Not implemented | Extract patterns from successful tasks |

---

## 3. Knowledge Document Types

### Type Definitions

```typescript
type KnowledgeType = 
  | 'skill'       // 🤖 Agent: "How do I deploy?" - executable procedures
  | 'runbook'     // 🤖+👤 Both: "Incident response steps" - operational guides
  | 'project'     // 👤 Human: "What is auth-service?" - project context
  | 'decision'    // 👤 Human: "Why PostgreSQL over MongoDB?" - ADRs
  | 'onboarding'; // 👤 Human: "New engineer setup" - getting started

type KnowledgeAudience = 
  | 'agent'       // Only shown to agents
  | 'human'       // Only shown to humans (via UI)
  | 'both';       // Both can access
```

### Use Case Matrix

| Type | Audience | When Retrieved | Example |
|------|----------|----------------|---------|
| `skill` | agent | Task matches skill keywords | "API design patterns" |
| `runbook` | both | Incident triggered OR maintenance task | "Deploy to production" |
| `project` | human | Human opens project page | "Auth service overview" |
| `decision` | both | Architect reviews OR agent queries context | "ADR: Choose PostgreSQL" |
| `onboarding` | human | New team member onboards | "Local dev setup" |

---

## 4. Enhanced Knowledge Schema

### KnowledgeDocument (Enhanced)

```typescript
interface KnowledgeDocument {
  // Identity
  id: string;
  type: KnowledgeType;
  audience: KnowledgeAudience;
  
  // Content
  title: string;
  path: string;                    // Hierarchical: "skills/api/design"
  content: string;                 // Markdown
  summary?: string;                // Short summary for quick display
  tags: string[];
  
  // Access Control
  roles: string[];                 // Which roles can access
  visibility: KnowledgeVisibility; // 'public' | 'team' | 'role' | 'private'
  teamId?: string;                 // For team-scoped docs
  projectId?: string;              // For project-scoped docs
  
  // Retrieval Hints (for smart search)
  usefulWhen: string[];            // Trigger phrases: "when deploying", "for API design"
  relatedTo: string[];             // Links to other doc IDs
  learnedFrom?: string[];          // Task IDs that contributed
  taskTypes?: string[];            // Task types this applies to: 'bug_fix', 'feature'
  
  // Versioning
  version: string;                 // Semantic: "1.2.0"
  history: DocumentVersion[];      // Change history
  
  // Approval Workflow
  status: ApprovalStatus;          // 'draft' | 'pending_review' | 'approved' | 'rejected'
  reviewers?: string[];            // Who should approve
  approvedBy?: string;
  approvedAt?: Date;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  lastUpdatedBy: string;
}

interface DocumentVersion {
  version: string;
  content: string;
  summary?: string;
  updatedBy: string;
  updatedAt: Date;
  changeReason?: string;
}
```

---

## 5. Smart Retrieval System

> ⚠️ **Updated:** Using Hierarchical Index (CPU page table model) instead of flat multi-stage pipeline.

### Retrieval Model: CPU Page Table

Like a CPU's multi-level page table, we embed **summaries** at each level (not full content). The query traverses levels until it finds the right content — short-circuiting when context is known.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                HIERARCHICAL KNOWLEDGE INDEX (CPU Page Table)            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Query: "How do I deploy auth-service to production?"                   │
│       │                                                                 │
│  L0: TEAM DIRECTORY (Page Directory)           ← If teamId unknown      │
│       │   Vector search on team summaries                               │
│       │   "Platform team manages infrastructure..."                     │
│       │   "Auth team owns auth-service..."         ← MATCH              │
│       │                                                                 │
│       ▼                                                                 │
│  L1: PROJECT INDEX (Page Table)                ← If projectId unknown   │
│       │   Vector search on project summaries                            │
│       │   "auth-service: OAuth/OIDC provider..."   ← MATCH              │
│       │                                                                 │
│       ▼                                                                 │
│  L2: DOCUMENT INDEX (Page Middle Directory)                             │
│       │   Vector search on doc summaries                                │
│       │   "deployment.md: Production deploy steps" ← MATCH              │
│       │   "architecture.md: System design..."                           │
│       │                                                                 │
│       ▼                                                                 │
│  L3: SECTION INDEX (Page Table Entry)                                   │
│       │   Vector search on section summaries                            │
│       │   "## Production Deploy: kubectl steps"    ← MATCH              │
│       │                                                                 │
│       ▼                                                                 │
│  CONTENT FETCH (Physical Memory = Git)                                  │
│       └── Fetch lines 45-89 from deployment.md @ commit abc123          │
│                                                                         │
│  SHORT-CIRCUIT (TLB Hit):                                               │
│  If task.projectId = "auth-service" → Skip L0+L1, start at L2           │
│  If task.docPath known → Skip to L3                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Why This Beats Flat RAG

| Aspect | Flat RAG | Hierarchical Index |
|--------|----------|-------------------|
| **Embeddings** | Embed all chunks (10K+) | Embed summaries (~100 per level) |
| **Search cost** | O(N) all chunks | O(log N) levels × small sets |
| **Context** | Chunks lack hierarchy | Each level adds context |
| **Accuracy** | Semantic drift in large sets | Guided traversal |
| **Latency** | Slower (more comparisons) | Faster (short-circuit) |

### Index Storage Schema (MongoDB Atlas)

```typescript
interface KnowledgeIndexEntry {
  _id: ObjectId;
  level: 0 | 1 | 2 | 3;          // L0-L3
  
  // Content
  summary: string;                // LLM-generated summary
  embedding: number[];            // 1536-dim (Azure OpenAI ada-002)
  
  // Hierarchy
  parentId?: ObjectId;            // Parent entry (L0 has none)
  children?: ObjectId[];          // Child entries
  
  // Scope
  teamId: string;                 // Always present
  projectId?: string;             // L1+ only
  docPath?: string;               // L2+ only
  sectionHeading?: string;        // L3 only
  
  // Content reference (for L3 → Git fetch)
  contentRef?: {
    repo: string;
    path: string;
    lineRange: [number, number];
    commitHash: string;
  };
  
  // Metadata
  updatedAt: Date;
  indexedAt: Date;
}

// MongoDB Atlas Vector Search Index
const knowledgeSearchIndex = {
  name: "knowledgeIndex",
  type: "vectorSearch",
  definition: {
    fields: [
      { type: "vector", path: "embedding", numDimensions: 1536, similarity: "cosine" },
      { type: "filter", path: "level" },
      { type: "filter", path: "teamId" },
      { type: "filter", path: "projectId" },
      { type: "filter", path: "parentId" },
    ]
  }
};
```

### LlamaIndex.TS Implementation

```typescript
import { RouterQueryEngine, VectorStoreIndex, DocumentSummaryIndex } from 'llamaindex';

// Stack RouterQueryEngines for each level
class HierarchicalRetrieval {
  private l0Router: RouterQueryEngine;  // Team level
  private l1Routers: Map<string, RouterQueryEngine>;  // Per-team project routers
  private l2Routers: Map<string, RouterQueryEngine>;  // Per-project doc routers
  private l3Indices: Map<string, VectorStoreIndex>;   // Per-doc section indices
  
  async query(query: string, context: TaskContext): Promise<RetrievalResult> {
    // Short-circuit: If projectId known, skip L0+L1
    if (context.projectId) {
      return this.queryFromL2(query, context.teamId, context.projectId);
    }
    
    // Full traversal: L0 → L1 → L2 → L3 → Git
    const teamResult = await this.l0Router.query(query);
    const teamId = teamResult.metadata.teamId;
    
    const projectResult = await this.l1Routers.get(teamId)?.query(query);
    const projectId = projectResult?.metadata.projectId;
    
    const docResult = await this.l2Routers.get(projectId)?.query(query);
    const docPath = docResult?.metadata.docPath;
    
    const sectionResult = await this.l3Indices.get(docPath)?.query(query);
    
    // Fetch content from Git
    const content = await this.fetchFromGit(sectionResult.metadata.contentRef);
    
    return { content, metadata: sectionResult.metadata, path: [teamId, projectId, docPath] };
  }
}
```

### Retrieval Interface

```typescript
interface KnowledgeRetrieval {
  // Primary retrieval (for tasks)
  getForTask(context: TaskKnowledgeContext): Promise<RetrievalResult>;
  
  // Secondary retrieval
  getForRole(role: string, options?: RetrievalOptions): Promise<KnowledgeDocument[]>;
  getForProject(projectId: string): Promise<ProjectKnowledge>;
  
  // Search
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  searchSemantic(embedding: number[], options?: SemanticOptions): Promise<SearchResult[]>;
  
  // Specific retrieval
  getRelated(docId: string): Promise<KnowledgeDocument[]>;
  getRecent(options?: RecentOptions): Promise<KnowledgeDocument[]>;
}

interface TaskKnowledgeContext {
  taskDescription: string;
  role: string;
  taskType?: string;           // 'bug_fix' | 'feature' | 'refactor' | etc.
  projectId?: string;
  teamId?: string;
  previousTasks?: string[];    // For continuity
}

interface RetrievalResult {
  documents: RankedDocument[];
  projectContext?: ProjectKnowledge;
  roleSkills?: KnowledgeDocument[];
  relevantRunbooks?: KnowledgeDocument[];
  searchMatches?: KnowledgeDocument[];
  totalFound: number;
  retrievedAt: Date;
}

interface RankedDocument {
  document: KnowledgeDocument;
  score: number;               // 0-1 relevance
  matchReasons: string[];      // Why this was returned
}
```

---

## 6. Project Documentation

### ProjectDocumentation Schema

```typescript
interface ProjectDocumentation extends KnowledgeDocument {
  type: 'project';
  
  // Extended project-specific fields
  project: {
    // 🤖 AGENT needs this — to understand the system
    howItWorks: {
      overview: string;          // One-paragraph summary
      components: ComponentInfo[];
      dataFlow: string;          // How data moves through system
      dependencies: string[];    // External dependencies
    };
    
    // 👤 HUMAN needs this — for context
    context: {
      businessPurpose: string;
      keyStakeholders: string[];
      successMetrics: string[];
    };
    
    // 🤖 AGENT needs this — to write good code
    workingOn: {
      conventions: ConventionInfo[];
      qualityChecks: string[];
      commonMistakes: string[];
      testingStrategy: string;
    };
    
    // 👤 HUMAN needs this — organizational
    ownership: {
      team: string;
      maintainers: string[];
      contactChannels: string[];
      escalationPath: string;
    };
    
    // 👤 HUMAN needs this — for new contributors
    gettingStarted: {
      setupSteps: string[];
      tools: string[];
      openWork: string[];        // Good first contributions
    };
  };
}

interface ComponentInfo {
  name: string;
  description: string;
  path: string;                 // File/folder path
  responsibilities: string[];
  interfaces?: string[];        // API endpoints, methods
}

interface ConventionInfo {
  area: string;                 // "naming", "testing", "error-handling"
  rules: string[];
  examples?: string[];
}
```

---

## 7. Promotion Workflow

### L2 → L3 Promotion Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     KNOWLEDGE PROMOTION FLOW                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  1. OUTPUT PUBLISHED (L2)                                                │
│     workspace.publish() → output manifest merged to main                │
│     └── Output contains valuable pattern/knowledge                     │
│                         │                                                 │
│  2. PROMOTION PROPOSED                                                   │
│     KnowledgePromotion.proposeNew({                                      │
│       source: { type: 'artifact', id: artifactId },                      │
│       targetType: 'skill',                                               │
│       proposedBy: 'orchestrator' // or agent                             │
│     })                                                                    │
│                         │                                                 │
│  3. PROPOSAL CREATED                                                     │
│     └── Status: 'pending'                                                │
│     └── Emit: 'proposal:new' event                                       │
│                         │                                                 │
│  4. HUMAN REVIEW                                                         │
│     ├── UI shows pending proposals                                       │
│     ├── Human reviews content                                            │
│     │                                                                     │
│     ├── APPROVE                                                          │
│     │     └── KnowledgePromotion.approve(proposalId)                     │
│     │     └── Creates KnowledgeDocument                                  │
│     │     └── Emit: 'proposal:approved'                                  │
│     │                                                                     │
│     └── REJECT                                                           │
│           └── KnowledgePromotion.reject(proposalId, reason)              │
│           └── Emit: 'proposal:rejected'                                  │
│                                                                           │
│  5. KNOWLEDGE AVAILABLE                                                  │
│     └── Future tasks can retrieve this knowledge                         │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

### Proposal Types

```typescript
interface KnowledgeProposal {
  id: string;
  status: ProposalStatus;        // 'pending' | 'approved' | 'rejected'
  
  // Source of the knowledge
  source: PromotionSource;
  
  // Proposed document
  proposedDocument: Partial<KnowledgeDocument>;
  
  // Workflow
  proposedBy: string;            // Agent or system ID
  proposedAt: Date;
  
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewComment?: string;
  
  // If approved
  resultDocId?: string;
  
  // If rejected
  rejectionReason?: string;
}

type PromotionSource = 
  | { type: 'artifact'; artifactId: string; spaceId: string }
  | { type: 'task_output'; taskId: string; extractedPattern: string }
  | { type: 'group_chat'; outcomeId: string; decisionId: string }
  | { type: 'manual'; content: string };
```

### Auto-Promotion Triggers

```typescript
// System can auto-propose promotions
interface AutoPromotionConfig {
  // Artifact patterns worth promoting
  artifactPatterns: {
    enabled: boolean;
    types: ArtifactType[];       // e.g., 'document', 'config'
    minSize: number;             // Ignore tiny files
    pathPatterns: string[];      // e.g., '**/docs/**', '**/runbooks/**'
  };
  
  // Task success patterns
  taskPatterns: {
    enabled: boolean;
    minSuccessRate: number;      // 0.8 = 80% success
    minOccurrences: number;      // At least N similar tasks
  };
  
  // Decision patterns from group chats
  decisionPatterns: {
    enabled: boolean;
    importanceThreshold: string; // 'high', 'medium'
  };
  
  // Auto-approve from trusted sources
  autoApprove: {
    trustedProposers: string[];  // ['system', 'orchestrator']
    trustedSources: string[];    // ['manual']
  };
}
```

---

## 8. Worker Integration

### Knowledge Injection Flow

```typescript
// In WorkerPool.runTask()
async runTask(taskId: string, role: string, input: string): Promise<TaskResult> {
  const worker = this.getOrCreateWorker(role);
  const task = this.memoryCoordinator.tasks.getTask(taskId);
  
  // Get relevant knowledge
  const knowledge = await this.memoryCoordinator.knowledge?.getForTask({
    taskDescription: task.description,
    role: role,
    taskType: task.type,
    projectId: task.projectId,
    teamId: this.teamId,
  });
  
  // Build execution context
  const context: WorkerExecutionContext = {
    taskId,
    taskDescription: task.description,
    dependencyOutputs: this.getDependencyOutputs(task),
    
    // Knowledge injection
    knowledgeContext: knowledge?.documents.map(d => d.document),
    projectContext: knowledge?.projectContext,
  };
  
  // Execute with context
  return worker.execute(input, context);
}
```

### Agent System Prompt Enhancement

```typescript
// InternalAgent.buildSystemPrompt()
private buildSystemPrompt(base: string, context: WorkerExecutionContext): string {
  if (!context.knowledgeContext?.length) return base;
  
  let enhanced = base;
  
  // Add project context first (most specific)
  if (context.projectContext) {
    enhanced += `\n\n## Project Context: ${context.projectContext.title}\n`;
    enhanced += context.projectContext.project.howItWorks.overview;
    enhanced += '\n\n### Conventions\n';
    for (const conv of context.projectContext.project.workingOn.conventions) {
      enhanced += `- **${conv.area}**: ${conv.rules.join(', ')}\n`;
    }
  }
  
  // Add relevant skills
  const skills = context.knowledgeContext.filter(d => d.type === 'skill');
  if (skills.length > 0) {
    enhanced += '\n\n## Relevant Skills\n';
    for (const skill of skills.slice(0, 3)) {  // Limit to top 3
      enhanced += `\n### ${skill.title}\n${skill.summary || skill.content.slice(0, 500)}\n`;
    }
  }
  
  // Add runbooks
  const runbooks = context.knowledgeContext.filter(d => d.type === 'runbook');
  if (runbooks.length > 0) {
    enhanced += '\n\n## Applicable Runbooks\n';
    for (const rb of runbooks.slice(0, 2)) {
      enhanced += `\n### ${rb.title}\n${rb.summary || rb.content.slice(0, 300)}\n`;
    }
  }
  
  return enhanced;
}
```

---

## 9. Learning Loop (Future)

### Pattern Extraction

```typescript
// After task success, extract learnable patterns
interface LearningService {
  // Analyze successful task for patterns
  analyzeTask(task: CompletedTask): Promise<LearnablePattern[]>;
  
  // Aggregate patterns across similar tasks
  aggregatePatterns(patterns: LearnablePattern[]): Promise<AggregatedPattern>;
  
  // Propose as knowledge
  proposeAsKnowledge(pattern: AggregatedPattern): Promise<string>;
}

interface LearnablePattern {
  type: 'approach' | 'tool_usage' | 'error_handling' | 'optimization';
  description: string;
  confidence: number;
  examples: string[];
}
```

---

## 10. Events

```typescript
interface KnowledgeEvents {
  // Document lifecycle
  'knowledge:created': { document: KnowledgeDocument };
  'knowledge:updated': { documentId: string; changes: any; updatedBy: string };
  'knowledge:deleted': { documentId: string; deletedBy: string };
  
  // Proposals
  'proposal:new': { proposal: KnowledgeProposal };
  'proposal:approved': { proposalId: string; documentId: string };
  'proposal:rejected': { proposalId: string; reason: string };
  
  // Retrieval
  'knowledge:retrieved': { taskId: string; documentCount: number };
  
  // Learning
  'pattern:detected': { pattern: LearnablePattern; taskId: string };
  'pattern:proposed': { proposalId: string; patternType: string };
}
```

---

## 11. API Endpoints

```typescript
// Knowledge API routes
router.get('/api/knowledge', authenticate, async (req, res) => {
  const { type, role, projectId, search, limit } = req.query;
  const docs = await knowledgeBase.query({ type, role, projectId, search, limit });
  res.json({ documents: docs });
});

router.get('/api/knowledge/:id', authenticate, async (req, res) => {
  const doc = await knowledgeBase.get(req.params.id);
  res.json({ document: doc });
});

router.post('/api/knowledge', authenticate, authorize('knowledge:write'), async (req, res) => {
  const doc = await knowledgeBase.create(req.body);
  res.json({ document: doc });
});

// Proposals
router.get('/api/knowledge/proposals', authenticate, async (req, res) => {
  const { status } = req.query;
  const proposals = await knowledgeBase.getProposals({ status });
  res.json({ proposals });
});

router.post('/api/knowledge/proposals/:id/approve', authenticate, authorize('knowledge:approve'), async (req, res) => {
  const result = await knowledgeBase.approve(req.params.id, req.user.id);
  res.json(result);
});

router.post('/api/knowledge/proposals/:id/reject', authenticate, authorize('knowledge:approve'), async (req, res) => {
  const result = await knowledgeBase.reject(req.params.id, req.body.reason, req.user.id);
  res.json(result);
});
```

---

## 12. Implementation Phases

### Phase 1: Retrieval Enhancement (3 days)
- [ ] Implement multi-stage retrieval pipeline
- [ ] Add role-based filtering
- [ ] Add task-type matching
- [ ] Add project context retrieval

### Phase 2: Worker Integration (2 days)
- [ ] Add `getForTask()` call in WorkerPool
- [ ] Implement system prompt enhancement
- [ ] Test knowledge injection

### Phase 3: Project Documentation (2 days)
- [ ] Create ProjectDocumentation schema
- [ ] Add project CRUD operations
- [ ] Add UI for project docs (human audience)

### Phase 4: Promotion Polish (2 days)
- [ ] Wire proposal events to frontend
- [ ] Add approval UI workflow
- [ ] Test L2 → L3 promotion

### Phase 5: API & Frontend (3 days)
- [ ] Implement REST endpoints
- [ ] Add Socket.IO events
- [ ] Build knowledge browser UI
- [ ] Build proposal review UI

### Phase 6: Workspace Semantic & Hybrid Search (2-3 days)

**Goal:** Add embedding-based semantic search (Layer 4) to agent workspaces, and combine it with BM25 (v1.0 Phase 8) for hybrid search.

**Deferred from:** [v1.0 Phase 14 — Future table](../v1.0/feature_implementation_planning.md)

**Research ref:** [AGENT_WORKSPACE_RESEARCH.md §6 — Layer 4 Semantic Search](../AGENT_WORKSPACE_RESEARCH.md)

**Why here, not v1.0:** Requires embedding model config + vector store — same infra as L3 knowledge retrieval. Build once, use for both knowledge docs and workspace files.

**Files to create/modify:**
- [ ] `memory/workspace/search/WorkspaceVectorIndex.ts` — New class
  - Embeds workspace file chunks using same embedding model as L3 (Azure OpenAI `text-embedding-3-small`)
  - `semanticSearch(query, topK?)` → find by meaning ("how does auth work?" matches `validateToken()`)
  - `findRelated(filePath, topK?)` → find conceptually similar files
  - Chunking: functions for code (tree-sitter, if available), paragraphs for markdown, fixed-size fallback
  - Auto-index on file create/update (debounced, shares trigger with BM25)
- [ ] `memory/workspace/search/WorkspaceSearchIndex.ts` — Add hybrid mode
  - `hybridSearch(query, options?)` → combined BM25 + vector with configurable weighting
  - `options: { vectorWeight: 0-1, topK, filter }` — weight=0 = pure BM25, weight=1 = pure semantic
  - Score normalization: min-max normalize both BM25 and vector scores before combining
- [ ] `memory/workspace/tools/workspace-tools.ts` — Add search tools
  - `semantic_search(query, topK?)` — find workspace files by meaning
  - `hybrid_search(query, options?)` — combined keyword + semantic
  - `find_related(filePath)` — conceptually similar files

**Shared infra with L3:**
- Same embedding model (`text-embedding-3-small`)
- Same vector store (MongoDB Atlas Vector Search) — separate collection: `workspace_embeddings`
- Same embedding utility function

**Prerequisites:** v1.0 Phase 8 (BM25) must be complete for hybrid mode. L3 Phase 1 (embedding infra) should be done first to share config.

**Success criteria:**
- [ ] `semantic_search("authentication handler")` finds relevant files even without exact keyword match
- [ ] `hybrid_search` combines BM25 + vector scores with configurable weighting
- [ ] `find_related("src/auth/handler.ts")` returns auth-related files
- [ ] Uses same embedding model/config as L3 knowledge base (no duplicate setup)
- [ ] Re-indexes incrementally on file changes

---

## 13. Success Criteria

- [ ] Agents automatically receive relevant knowledge for tasks
- [ ] Project docs follow standard schema (works for any project type)
- [ ] Artifacts can be promoted from L2 → L3
- [ ] Human approval workflow works end-to-end
- [ ] Knowledge documents versioned with history
- [ ] Search finds relevant docs by text and metadata
- [ ] UI shows pending proposals and enables approval
- [ ] Workspace semantic search finds files by meaning (Layer 4)
- [ ] Hybrid search combines BM25 + vector with configurable weighting
