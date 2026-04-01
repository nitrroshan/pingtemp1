# Idea: Organizational Knowledge Layer (OKL)

> **Status**: Idea Stage  
> **Author**: [Team]  
> **Created**: 2026-01-31  
> **Tags**: #architecture #memory-manager #knowledge-management #crdt

---

## Naming: Is "OKL" The Right Term?

"Organizational Knowledge Layer" is industry-standard but **undersells** what we're building. We're not just adding a knowledge layer — we're creating an **Agentic Knowledge Ecosystem**.

### Alternative Names Considered

| Name | Pros | Cons |
|------|------|------|
| **Organizational Knowledge Layer** | Industry-standard, understood | Sounds like a static database |
| **Agentic Knowledge Graph** | Captures the reasoning aspect | Implies graph DB (may be overkill initially) |
| **Collective Intelligence Layer** | Emphasizes "agents learn together" | Sounds like sci-fi marketing |
| **Living Knowledge System** | Documents evolve, not static | Too generic |

**Recommendation**: Start with OKL for familiarity, evolve terminology as the system matures.

---

## Industry Context: Where This Fits

```
┌────────────────────────────────────────────────────────────────────────┐
│                    KNOWLEDGE SYSTEM EVOLUTION                          │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  Level 1: Wiki/Docs          "Write it down, hope someone reads it"   │
│  ├─ Notion, Confluence                                                 │
│  └─ 💀 Dies when people stop updating                                 │
│                                                                        │
│  Level 2: Enterprise Search  "Find the file, read it yourself"        │
│  ├─ Glean, Elastic                                                     │
│  └─ 📁 Tells you WHERE, not WHAT                                      │
│                                                                        │
│  Level 3: OKL (Current)      "Contextualized, AI-ready knowledge"     │
│  ├─ Knowledge Graphs, RAG                                              │
│  └─ 🧠 Understands relationships, answers questions                   │
│                                                                        │
│  Level 4: Agentic Systems    "Reasons, acts, learns" ← WE ARE HERE    │
│  ├─ Multi-agent orchestration                                          │
│  ├─ Agents consume AND produce knowledge                               │
│  └─ 🤖 Self-improving institutional memory                            │
│                                                                        │
│  Level 5: Self-Healing       "Detects conflicts, fixes itself"        │
│  ├─ LLM-mediated semantic merge                                        │
│  └─ 🔮 The aspirational goal                                          │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### The Key Differentiator: Reasoning Loops

**Standard OKL (Level 3)**: User Query → Search → Answer

**Agentic System (Level 4)**: 
```
Analyze Goal → Plan → Act → Observe → Pivot → Finalize
     ↑                                           │
     └───────────── Reasoning Loop ──────────────┘
```

Our workers already do this! The innovation is making **knowledge documents** part of the loop.

---

## The Insight

MemoryManager currently stores **task state**. But what if it evolved to store **organizational knowledge**—living documents that agents both consume and produce?

This transforms agents from "task executors" into **knowledge workers** with institutional memory.

---

## Core Concept

### Document Types & Audiences

| Type | Answers | Primary Audience | Update Frequency |
|------|---------|------------------|------------------|
| **Skills** | "How do I do X?" | 🤖 Agent | Improves as techniques evolve |
| **Runbooks** | "What steps for Y?" | 🤖 Agent + 👤 Human | Changes with process |
| **Decisions** | "Why did we choose Z?" | 👤 Human (agents read-only) | Rarely (historical) |

**Audience meanings:**
- **Agent**: Optimized for LLM consumption. Technical, precise, no fluff.
- **Human**: Written for people. Context, rationale, readable prose.
- **Both**: Structured for agents, annotated for humans.

```
┌─────────────────────────────────────────────────────────────────┐
│                 ORGANIZATIONAL KNOWLEDGE LAYER                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐       │
│   │  Skills     │    │  Runbooks   │    │  Decisions  │       │
│   │  Documents  │◄──►│  & Guides   │◄──►│  Log        │       │
│   │  🤖 Agent   │    │ 🤖+👤 Both  │    │  👤 Human   │       │
│   └──────┬──────┘    └──────┬──────┘    └──────┬──────┘       │
│          │                  │                   │              │
│          └──────────────────┼───────────────────┘              │
│                             │                                   │
│                    ┌────────▼────────┐                         │
│                    │  Knowledge Graph │                         │
│                    │  (Relationships) │                         │
│                    └────────┬────────┘                         │
│                             │                                   │
├─────────────────────────────┼───────────────────────────────────┤
│                             │                                   │
│    ┌────────────────────────┼────────────────────────┐         │
│    │                        ▼                        │         │
│    │  ┌─────────┐    ┌─────────────┐    ┌─────────┐ │         │
│    │  │ Worker  │◄──►│   CRDT      │◄──►│ Worker  │ │         │
│    │  │   A     │    │   Sync      │    │   B     │ │         │
│    │  └─────────┘    └─────────────┘    └─────────┘ │         │
│    │                  Concurrent Editing             │         │
│    └─────────────────────────────────────────────────┘         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Audience-Based Permissions

| Audience | Agent Can Read | Agent Can Write | Human Review Required |
|----------|----------------|-----------------|----------------------|
| 🤖 Agent | ✅ Yes | ✅ Yes | No |
| 🤖+👤 Both | ✅ Yes | ✅ Yes | On significant changes |
| 👤 Human | ✅ Yes | ❌ No (suggest only) | Always |

---

## Why This Matters

### Current State (Task-Centric)
- Workers receive task → execute → forget
- Knowledge dies with task completion
- Each new task starts from zero context

### Proposed State (Knowledge-Centric)
- Workers receive task **+ relevant knowledge documents**
- Workers **update documents** as they learn
- Knowledge compounds across tasks

---

## Document Types as "Skills"

### The Core Insight: Documents Teach, Agents Learn

Traditional skills are **code** — rigid, executable, programmed behavior:
```typescript
// Code skill: does exactly what's programmed
const deploySkill = {
  execute: async () => { await runCommand('npm run deploy'); }
};
```

OKL skills are **documents** — adaptive, interpretable, teachable knowledge:
```typescript
// Document skill: teaches the agent HOW to think about deployment
const deploySkill = {
  content: `
    Deployment Checklist:
    1. Verify all tests pass
    2. Check staging environment health
    3. Use blue-green deployment for zero downtime
    4. Monitor error rates for 15 minutes post-deploy
    5. If errors spike >1%, trigger rollback
  `
};
```

**Why documents beat code:**

| Property | Code Skills | Document Skills |
|----------|-------------|-----------------|
| **Callable** | Function invocation | Load as context → agent now "knows" it |
| **Composable** | Import/compose functions | Combine docs: "deployment" + "rollback" + "monitoring" |
| **Versionable** | Git commits | Docs evolve: v1 → v2 with better procedures |
| **Adaptive** | Does exactly what's coded | LLM interprets, applies judgment, handles edge cases |

**Example in action:**
```
Task: "Deploy auth service"

Without OKL:
  Worker → uses generic LLM knowledge → misses your team's procedures

With OKL:
  Worker → loads "auth-service-deployment.md" → knows YOUR blue-green 
  deployment, YOUR health checks, YOUR rollback procedures
```

The document *teaches*. The agent *learns*. The skill is the knowledge transfer.

---

Each document is a **skill unit** with explicit purpose:

```typescript
interface KnowledgeDocument {
  id: string;
  
  // AUDIENCE - Who is this document for?
  audience: {
    primary: 'agent' | 'human' | 'both';
    description: string;           // "For agents executing deployments"
    roles?: string[];              // ["devops", "infrastructure", "backend"]
                                   // Empty = all roles can use
  };
  
  // PURPOSE - Why does this document exist?
  purpose: {
    description: string;           // "How to deploy to production"
    usefulWhen: string[];          // ["deploying", "CI/CD issues", "rollback needed"]
    notUsefulWhen: string[];       // ["local development", "testing"]
  };
  
  // CONTENT - The actual knowledge (see Document Format below)
  content: CRDTDocument;
  
  // METADATA
  lastUsedBy: TaskReference[];     // Which tasks used this?
  confidenceScore: number;         // How reliable is this knowledge?
  lastValidated: Date;             // When was this verified accurate?
  
  // RELATIONSHIPS
  dependsOn: DocumentId[];         // Required reading first
  supersedes: DocumentId[];        // Obsoletes older docs
  relatedTo: DocumentId[];         // See also
}

interface CRDTDocument {
  format: 'markdown' | 'json' | 'blocks';
  raw: Y.Text | Automerge.Text;    // CRDT-backed text for concurrent edits
  parsed?: {
    frontmatter: Record<string, any>;  // YAML metadata
    body: string;                       // Markdown content
    sections: Section[];                // Parsed headings
  };
}
```

### Role-Based Document Routing

When a task is assigned to a role, the system filters relevant documents:

```typescript
// Task assignment with role context
const task = {
  id: "deploy-auth-service",
  assigned_role: "devops",
  // System auto-attaches docs where audience.roles includes "devops"
  knowledgeRefs: await getDocsForRole("devops", task.description)
};
```

| Document | Intended Roles | Devops Agent Sees? | Marketing Agent Sees? |
|----------|----------------|--------------------|-----------------------|
| `deploy-production.md` | `["devops", "backend"]` | ✅ Yes | ❌ No |
| `incident-response.md` | `["devops", "support"]` | ✅ Yes | ❌ No |
| `brand-guidelines.md` | `["marketing", "design"]` | ❌ No | ✅ Yes |
| `company-values.md` | `[]` (all roles) | ✅ Yes | ✅ Yes |
```

---

## Document Format & Storage

### Recommended Format: Structured Markdown

Documents are **Markdown files with YAML frontmatter**. This gives us:
- Human-readable and editable
- Machine-parseable metadata
- Git-friendly versioning
- CRDT-compatible text

### Example Document

```markdown
---
id: deploy-production
audience: agent
roles:
  - devops
  - backend
  - infrastructure
type: skill
version: 2.3
lastUpdated: 2026-01-31
usefulWhen:
  - deploying to production
  - CI/CD issues
  - rollback needed
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

### Storage Options

| Option | How It Works | Best For |
|--------|--------------|----------|
| **Git-backed (Phase 1)** | Markdown files in repo, CRDT layer on top | Starting simple, human-editable |
| **Database + CRDT** | Yjs binary state in DB, rendered text cached | Production scale, fast sync |
| **File System** | `/knowledge/skills/`, `/knowledge/runbooks/` | Local development |

### Recommended: Git-backed (Phase 1)

```
/knowledge/
├── skills/
│   ├── deploy-production.md
│   ├── query-optimization.md
│   └── api-design.md
├── runbooks/
│   ├── incident-response.md
│   └── database-failover.md
└── decisions/
    ├── why-postgresql.md
    └── why-typescript.md
```

**Why Git?**
- Native versioning (who changed what, when)
- Human-editable (engineers can update directly)
- PR workflow for human-audience docs
- CRDT layer adds real-time agent sync on top
```

---

## Conflict Resolution Strategy

### Level 1: Structural Conflicts (CRDT)
Use CRDT (Yjs, Automerge) for basic text/structure conflicts.

```
Worker A: Adds paragraph at line 50
Worker B: Adds paragraph at line 50
CRDT Result: Both paragraphs preserved in deterministic order
```

### Level 2: Semantic Conflicts (LLM-Mediated)
When content *meaning* conflicts, use LLM to resolve:

```
Worker A: "Timeout should be 30 seconds"
Worker B: "Timeout should be 60 seconds"

LLM Mediator:
- Detects semantic conflict
- Reviews task context for both workers
- Produces: "Timeout: 30s for dev, 60s for production (see context docs)"
```

### Level 3: Intent Tracking
Track *why* changes were made, not just *what* changed:

```typescript
interface DocumentChange {
  what: CRDTOperation;
  why: string;              // "Learned from production incident #123"
  confidence: number;       // How certain is this change?
  taskContext: TaskId;      // What task triggered this?
}
```

---

## Context Injection Patterns

### Pattern 1: Eager (Current Thinking)
Pass all relevant docs as context upfront.

**Problem**: Context bloat. 10 docs × 5KB = 50KB wasted tokens.

### Pattern 2: Lazy + RAG (Recommended)
Worker receives doc *references*. Pulls content on-demand via retrieval.

```typescript
// Task assignment
const task = {
  id: "fix-auth-bug",
  knowledgeRefs: [
    { docId: "auth-architecture", relevanceScore: 0.95 },
    { docId: "jwt-implementation", relevanceScore: 0.87 },
  ]
};

// Worker pulls what it needs
const context = await worker.retrieveRelevantSections(
  task.knowledgeRefs,
  task.description
);
```

### Pattern 3: Proactive Suggestions
System suggests documents worker *should* update after task:

```
Task: "Fixed JWT expiry bug"
System: "Consider updating 'jwt-implementation' doc with your fix"
```

---

## Implementation Phases

### Difficulty Assessment (Based on Current Architecture)

We already have **70% of the infrastructure**: AgentManager, Workers, MemoryManager, event system.

| Phase | Difficulty | Time | What Exists | What's New |
|-------|------------|------|-------------|------------|
| **Phase 1: Doc Store** | 🟢 Easy | 1-2 weeks | MemoryManager | Add `documents` table, basic CRUD |
| **Phase 2: CRDT Sync** | 🟡 Medium | 3-4 weeks | Worker event system | Yjs integration, sync protocol |
| **Phase 3: Knowledge Graph** | 🟡 Medium | 4-6 weeks | Task relationships | Doc relationships, relevance scoring |
| **Phase 4: LLM Mediation** | 🔴 Hard | Ongoing | AgentBuilder | Semantic conflict detection, governance |

### Phase 1: Document Store
- Add document storage to MemoryManager
- Basic CRUD operations
- Document-task linking
- **Validation**: Can store and retrieve docs? ✓

### Phase 2: CRDT Integration
- Integrate Yjs or Automerge
- Real-time sync between workers
- Basic structural conflict resolution
- **Validation**: Two workers edit same doc without data loss? ✓

### Phase 3: Knowledge Graph
- Document relationships (dependsOn, supersedes, relatedTo)
- Relevance scoring based on task success rates
- Usage tracking (which docs helped which tasks)
- **Validation**: System suggests relevant docs for new tasks? ✓

### Phase 4: LLM-Mediated Intelligence
- Semantic conflict resolution (meaning, not just text)
- Auto-document generation from task outcomes
- Knowledge decay detection (stale docs flagged)
- Hallucination governance (citations required)
- **Validation**: System catches and resolves contradictory knowledge? ✓

---

## Multi-Agent Knowledge Workflow (Example)

How this would work in practice for a support escalation:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  TASK: "Customer reports auth bug"                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Phase 1: TRIAGE                                                        │
│  ┌──────────────────┐                                                   │
│  │  Receptionist    │ → Checks CRM for customer priority                │
│  │  Agent           │ → Searches OKL: "Has this been reported before?"  │
│  └────────┬─────────┘                                                   │
│           │ Finding: "VIP customer. Similar Slack thread from yesterday"│
│           ▼                                                             │
│  Phase 2: INVESTIGATION                                                 │
│  ┌──────────────────┐                                                   │
│  │  Researcher      │ → Pulls relevant knowledge docs                   │
│  │  Agent           │ → Checks GitHub/Jira for related changes          │
│  └────────┬─────────┘                                                   │
│           │ Finding: "PR merged 4 hours ago broke auth module"          │
│           │ ACTION: Updates "auth-known-issues.md" with new bug         │
│           ▼                                                             │
│  Phase 3: RESOLUTION                                                    │
│  ┌──────────────────┐                                                   │
│  │  Validator       │ → Checks policy: "Can we disclose to VIPs?"       │
│  │  Agent           │ → Drafts response using knowledge docs            │
│  └────────┬─────────┘                                                   │
│           │ Output: "Policy-approved draft with workaround"             │
│           ▼                                                             │
│  ┌──────────────────┐                                                   │
│  │  HUMAN REVIEW    │ → Approve / Edit / Reject                         │
│  └──────────────────┘                                                   │
│                                                                         │
│  KNOWLEDGE FEEDBACK LOOP:                                               │
│  └─► System: "Researcher updated 'auth-known-issues.md' — review?"     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Time Comparison

| Step | Manual (OKL Search) | Agentic (Multi-Agent) |
|------|---------------------|----------------------|
| Discovery | Human searches 4 tools | Agent A finds link instantly |
| Analysis | Human asks Dev "Is this broken?" | Agent B reads code directly |
| Resolution | Human drafts email | Agent C provides policy-cleared draft |
| Knowledge Update | Human forgets to update docs | Agent auto-updates, flags for review |
| **Total** | **45-90 minutes** | **30-60 seconds** |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Document sprawl | Auto-archival based on usage metrics |
| Stale knowledge | Confidence decay over time, validation prompts |
| CRDT complexity | Start with simple append-only log, graduate to full CRDT |
| Context window limits | Chunking + RAG, not full doc injection |
| Workers polluting knowledge | Review gate before permanent merge |
| **Hallucination (Critical)** | Grounding: agents must cite sources. No citation = "I don't know" |
| **Semantic conflicts** | LLM mediator reviews context, produces reconciled truth |
| **Runaway agents** | Human-in-the-loop for high-risk actions (delete, send, merge) |

### Hallucination Governance (The Hard Problem)

Three-layer defense:

1. **Grounding (RAG 2.0)**: Agent must cite a document for every claim. No citation = refused.
   
2. **Semantic Guardrails**: Agent can only reason within its defined "topic." Legal agent can't give medical advice.
   
3. **Human-in-the-Loop Triggers**: High-risk actions present "Confirm/Edit/Reject" to human.

```typescript
interface AgentAction {
  type: 'read' | 'write' | 'execute';
  riskLevel: 'low' | 'medium' | 'high';
  requiresHumanApproval: boolean;  // true if riskLevel === 'high'
  citations: DocumentId[];         // Required for write actions
}

---

## Agent-to-Agent Knowledge Exchange

### The Core Insight

~~"StackOverflow for Agents" with voting, experts, synthesis~~ 

**Documents ARE the Q&A cache.** When a worker asks a question and gets an answer, that becomes a doc. Next worker with similar question finds the doc.

```
Worker 1: "How to handle rate limiting?"
    → No doc found
    → Ask thinking LLM
    → Create doc: rate-limiting.md
    
Worker 2: "What's the approach for API throttling?"
    → Semantic search finds rate-limiting.md (similar question)
    → Use doc
    → Success? Doc validated. Failure? Fix doc.
```

No separate Q&A system. No voting UI. No expert routing. **The doc store is the knowledge exchange.**

### Why This is Simpler

| "StackOverflow for Agents" (❌) | Docs as Q&A Cache (✅) |
|--------------------------------|------------------------|
| Q&A store + Doc store (2 systems) | Just docs (1 system) |
| Voting, upvotes, synthesis | Success/failure tracking |
| Expert routing | Just ask one thinking LLM |
| "Promote Q&A to doc" logic | Q&A IS a doc from the start |

### Architecture: Capability Tiers (Optional Enhancement)

For more complex deployments, agents can be tiered by capability:

```
┌─────────────────────────────────────────────────────────────────┐
│                    AGENT CAPABILITY TIERS                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Tier 1: WORKERS (Small, Fast, Cheap)                           │
│  ├─ GPT-4-mini, Claude Haiku, local LLMs                        │
│  ├─ Handle routine tasks                                         │
│  └─ ASK thinking LLM when uncertain                             │
│                                                                  │
│  Tier 2: THINKING LLM (Large, Slower, Smarter)                  │
│  ├─ Claude Opus, GPT-4, o1-preview                              │
│  ├─ Answers worker questions                                     │
│  └─ Creates/fixes docs                                           │
│                                                                  │
│  Tier 3: HUMAN (Final Authority)                                │
│  ├─ Reviews flagged docs                                         │
│  ├─ Resolves low-health docs                                     │
│  └─ Approves high-risk changes                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

Default flow: Worker → Thinking LLM → Doc created
Escalation:   Bad doc → Human review
```

**When to use multiple LLMs (tradeoffs):**

| Approach | Cost | Latency | When to Use |
|----------|------|---------|-------------|
| Single thinking LLM | Low | Fast | Default, most tasks |
| Multiple LLMs | High | Slower | High-risk, need consensus |
| Human escalation | Highest | Slowest | Conflicts, policy decisions |

### The Complete Flow

```typescript
class AgentWorker {
  async execute(task: Task) {
    // 1. Semantic search for relevant docs (past Q&As)
    const docs = await this.semanticSearch(task.description);
    
    if (docs.length > 0 && docs[0].similarity > 0.8) {
      // DOC EXISTS → Use it
      const result = await this.executeWithDocs(task, docs);
      
      if (result.success) {
        await this.recordSuccess(docs[0].id);  // +1
        return result;
      } else {
        // Doc didn't work → ask thinking LLM → update doc
        return this.askAndFix(task, docs[0], result.error);
      }
    }
    
    // NO RELEVANT DOC → ask thinking LLM → create doc
    return this.askAndCreate(task);
  }
  
  private async askAndCreate(task: Task) {
    const answer = await this.thinkingLLM.ask(task.description);
    
    // Answer becomes a doc immediately (cached for future workers)
    const newDoc = await this.createDoc({
      question: task.description,
      content: answer,
      type: 'skill',
      createdFrom: 'worker-question'
    });
    
    return this.executeWithDocs(task, [newDoc]);
  }
  
  private async askAndFix(task: Task, badDoc: Doc, error: string) {
    const answer = await this.thinkingLLM.ask({
      question: `This doc didn't work: ${badDoc.content}. Error: ${error}`,
      context: this.getContext()
    });
    
    await this.updateDoc(badDoc.id, {
      content: answer.correctedContent,
      updatedFrom: 'worker-failure'
    });
    
    await this.recordFailure(badDoc.id);  // -1
    return this.executeWithDocs(task, [{ ...badDoc, content: answer.correctedContent }]);
  }
}
```

**That's the whole system:**
1. Semantic search for similar past questions (which are docs)
2. Found? Use it. Track success/failure.
3. Not found? Ask thinking LLM. Create doc. Now it's cached.

---

### When Does a Worker Decide to Ask?

Workers should ask when they detect **uncertainty signals**:

```typescript
interface UncertaintySignals {
  // Quantitative triggers
  confidenceScore: number;        // < 0.7 = should ask
  contradictionDetected: boolean; // Two docs say different things
  knowledgeGap: boolean;          // Task requires info not in any doc
  
  // Qualitative triggers
  riskLevel: 'low' | 'medium' | 'high';  // High risk = always verify
  novelSituation: boolean;        // Never seen this pattern before
  ambiguousRequirement: boolean;  // Task description is unclear
}

// Decision function
function shouldAskForHelp(signals: UncertaintySignals): boolean {
  // ALWAYS ask if high risk
  if (signals.riskLevel === 'high') return true;
  
  // ALWAYS ask if contradictions found
  if (signals.contradictionDetected) return true;
  
  // ASK if low confidence
  if (signals.confidenceScore < 0.7) return true;
  
  // ASK if knowledge gap on non-trivial task
  if (signals.knowledgeGap && signals.riskLevel !== 'low') return true;
  
  // ASK if novel situation
  if (signals.novelSituation) return true;
  
  // Otherwise, proceed
  return false;
}
```

**Trigger Examples:**

| Situation | Signal | Action |
|-----------|--------|--------|
| "Deploy to prod" but agent is uncertain about rollback | `confidenceScore: 0.5` | 🔴 **ASK** |
| Doc A says "use JWT", Doc B says "use sessions" | `contradictionDetected: true` | 🔴 **ASK** |
| "Implement payment flow" (high risk) | `riskLevel: 'high'` | 🔴 **ASK** (always verify) |
| "Fix typo in README" | `riskLevel: 'low', confidence: 0.95` | 🟢 **PROCEED** |
| Never seen this API pattern before | `novelSituation: true` | 🟡 **ASK** |
| Task says "optimize" but doesn't specify what | `ambiguousRequirement: true` | 🟡 **ASK** for clarification |

**The Key Insight: Calibrated Uncertainty**

Workers should be **trained to know what they don't know**:

```typescript
// During task execution, worker self-monitors
class AgentWorker {
  async execute(task: Task) {
    // Before each major decision point
    const signals = await this.assessUncertainty(task);
    
    if (shouldAskForHelp(signals)) {
      const answer = await this.askKnowledgeExchange({
        question: this.formulateQuestion(signals),
        context: {
          whatITried: this.getAttemptedApproaches(),
          whyImStuck: signals.primaryConcern,
          relevantDocs: this.getLoadedDocs()
        }
      });
      
      // Incorporate answer and continue
      this.updateContext(answer);
    }
    
    // Proceed with task
    return this.executeWithContext(task);
  }
  
  private async assessUncertainty(task: Task): Promise<UncertaintySignals> {
    // Ask the LLM to self-assess
    const assessment = await this.llm.invoke(`
      Given this task: ${task.description}
      And this context: ${this.context}
      
      Rate your confidence (0-1) and identify:
      - Any contradictions in the knowledge
      - Any gaps in required information
      - Whether this is a novel situation
      - The risk level of getting this wrong
      
      Be honest about uncertainty. It's better to ask than to guess wrong.
    `);
    
    return parseUncertaintySignals(assessment);
  }
}
```

**Anti-Pattern: "Confident but Wrong"**

The worst case is an agent that proceeds confidently with bad information:

```
❌ BAD: Agent is 90% confident but based on outdated doc
❌ BAD: Agent doesn't recognize it's in a novel situation
❌ BAD: Agent ignores contradictions and picks randomly

✅ GOOD: Agent notices doc is from 2023, asks if still valid
✅ GOOD: Agent says "I haven't seen this pattern, let me verify"
✅ GOOD: Agent surfaces contradiction: "Doc A vs Doc B - which applies?"
```

**Step 1: Voting is Just Success/Failure**

No complex weighted system. Just track what works:

```typescript
interface DocVote {
  docId: string;
  taskId: string;
  outcome: 'success' | 'failure';
  timestamp: Date;
}

// Doc health = simple ratio
function getDocHealth(docId: string): number {
  const votes = await getVotes(docId);
  const successes = votes.filter(v => v.outcome === 'success').length;
  return successes / votes.length;  // 0.0 to 1.0
}

// Bad docs get flagged for review
if (getDocHealth(docId) < 0.5) {
  await flagForReview(docId, 'High failure rate');
}
```

### The Voting System (Simplified)

~~Complex weighted voting~~ → **Just track success/failure**

| Event | What Happens |
|-------|--------------|
| Task succeeded using doc | `+1 success` |
| Task failed using doc | `-1 failure` |
| Doc health < 50% | Flag for review |
| Doc health < 20% | Auto-deprecate |

```typescript
// That's it. No weights, no upvote buttons, no complexity.
const docHealth = successCount / totalUses;
```

### Integration with OKL (Simplified)

Documents emerge naturally from work:

```
Worker needs to do X
       │
       ▼
  Doc exists? ──NO──→ Ask Thinking LLM → Create Doc
       │
      YES
       │
       ▼
  Use doc → Worked? ──YES──→ +1 success
                │
               NO
                │
                ▼
       Ask Thinking LLM → Fix Doc → -1 failure
```

**No synthesis needed. No expert routing. Just:**
1. Try to find a doc
2. If no doc, ask and create
3. If doc fails, ask and fix
4. Track what works

**Example:**
1. Worker asks: "How do we handle rate limiting?"
2. No doc exists → Ask thinking LLM
3. Thinking LLM: "Use Redis sliding window..."
4. → Creates: `rate-limiting.md`
5. Next worker uses it → succeeds → doc validated

---

## Open Questions

1. **Who validates knowledge?** Human review? Trusted senior agents? Consensus?
2. **Document lifecycle?** When does a document get archived or deleted?
3. **Access control?** Can all workers read/write all documents?
4. **Versioning UX?** How do humans review agent-generated doc changes?

---

## Relationship to Existing Concepts

- **RAG**: OKL is the *writable* side of RAG—agents don't just read, they contribute
- **MemoryManager**: Evolves from task store → knowledge store with task references
- **Skills**: Documents ARE skills—callable, composable, versionable knowledge units

---

## Next Steps

If this idea resonates:
1. Prototype: Add simple document storage to MemoryManager
2. Validate: Run 2 workers updating same doc, observe conflicts
3. Decide: CRDT library selection (Yjs vs Automerge vs custom)
4. Expand: Build knowledge graph relationships

---

## References

- [CRDTs: The Hard Parts](https://martin.kleppmann.com/2020/07/06/crdt-hard-parts-hydra.html) - Martin Kleppmann
- [Organizational Memory in AI Systems](https://en.wikipedia.org/wiki/Organizational_memory) - Enterprise patterns
- [Yjs Documentation](https://docs.yjs.dev/) - CRDT implementation
- [Automerge](https://automerge.org/) - Alternative CRDT library
