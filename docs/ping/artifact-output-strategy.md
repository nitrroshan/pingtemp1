# Artifact Store & Output Strategy

**How agents create, version, and collaborate on outputs in Ping.**

---

## The Problem

Agents produce different types of outputs:
- **Code** → Needs Git, PRs, code review
- **Documents** → Needs versioning, diffs, collaborative editing
- **Data files** → Needs storage, metadata
- **Binary files** → Git doesn't diff well (images, PDFs, models)

**Core Challenge:** Binary files break Git's diff model.

---

## Solution: Hybrid Storage Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ARTIFACT STORE                            │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────┐│
│  │   Git Storage     │  │  Object Storage   │  │ Metadata   ││
│  │   (Text/Code)     │  │   (Binary Files)  │  │   Store    ││
│  ├──────────────────┤  ├──────────────────┤  ├────────────┤│
│  │ • Branches        │  │ • S3/Blob         │  │ • Versions ││
│  │ • Commits         │  │ • Immutable       │  │ • Lineage  ││
│  │ • Diffs           │  │ • Content hash    │  │ • Metadata ││
│  │ • Pull Requests   │  │ • LFS-style refs  │  │ • Approvals││
│  └──────────────────┘  └──────────────────┘  └────────────┘│
└─────────────────────────────────────────────────────────────┘
```

---

## Team Workspace with Branching

### Concept

**Each team gets a Git-like workspace:**

```
Team: Product Launch
├── main (protected)
│   ├── code/
│   ├── docs/
│   └── configs/
├── agent/content-writer (branch)
│   └── docs/blog-post.md
├── agent/code-generator (branch)
│   └── code/feature.ts
└── agent/designer (branch)
    └── assets/mockup.png → object-storage://abc123
```

**Key Points:**
- Each agent works in its own branch
- Main branch is protected (requires approval)
- Text files → Git branches
- Binary files → Object storage with Git LFS-style references

---

## Output Type Strategies

### 1. Code Outputs

**Strategy:** Git branches + Pull Requests

**Agent Workflow:**
1. Agent assigned task: "Implement login API"
2. Artifact Store creates branch: `agent/backend-dev/login-api`
3. Agent writes code via file operations
4. Agent commits: `git commit -m "feat: implement login API"`
5. Agent creates PR: `agent/backend-dev/login-api → main`
6. Approval System queues PR for human review
7. Human approves → auto-merge or manual merge

**Example:**
```typescript
// Agent output
const artifact = await artifactStore.createCodeArtifact({
  teamId: 'product-team',
  agentId: 'backend-dev',
  taskId: 'task-123',
  type: 'code',
  files: [
    { path: 'src/api/login.ts', content: '...' },
    { path: 'tests/login.test.ts', content: '...' }
  ],
  commitMessage: 'feat: implement login API',
  targetBranch: 'main'
})

// Creates PR automatically
// Returns: { prId: 'pr-456', branchName: 'agent/backend-dev/login-api' }
```

---

### 2. Document Outputs

**Strategy:** Git branches + Markdown/Text diffs

**Agent Workflow:**
1. Agent assigned task: "Write product requirements doc"
2. Artifact Store creates branch: `agent/product-manager/requirements`
3. Agent writes Markdown document
4. Agent commits incrementally (checkpoint commits)
5. Agent creates PR when done
6. Human reviews diff → approve/reject/request changes

**Real-Time Collaborative Editing:**

**Primary Strategy: Operational Transforms (OT) / CRDTs**

Multiple agents can work on the **same document simultaneously** without branches:

- **No merge conflicts** - OT automatically resolves concurrent edits
- **Live updates** - Each agent sees other agents' changes in real-time
- **Versioned snapshots** - Save to Git as checkpoints, not per-edit
- **Conflict-free** - Mathematical guarantees (CRDT properties)

**How it works:**
1. Document lives in shared memory (Redis/Memory Store)
2. Each agent connects via WebSocket
3. Agents send operations (insert, delete, format)
4. OT engine transforms operations to ensure consistency
5. All agents converge to same document state
6. Periodic snapshots committed to Git

**Example: Two agents editing same doc:**
```
Agent A (Product Manager):  "Add user authentication section"
Agent B (Tech Writer):      "Fix grammar in introduction"

→ Both edits apply cleanly, no conflicts
→ Document converges automatically
```

**Fallback (Simple Documents):**
- Single agent edits → Direct Git commits
- No collaboration needed → Skip OT overhead

**Example:**
```typescript
// Real-time collaborative document
const artifact = await artifactStore.createDocumentArtifact({
  teamId: 'product-team',
  agentId: 'product-manager',
  taskId: 'task-456',
  type: 'document',
  format: 'markdown',
  content: '# Product Requirements\n\n...',
  collaborativeMode: 'realtime' // OT/CRDT for multi-agent editing
})

// Agent makes edits
await artifact.applyOperation({
  type: 'insert',
  position: 100,
  text: '## Authentication\n\nUsers must login...'
})

// Other agents see changes immediately
// No merge conflicts, automatic convergence

// Save snapshot to Git when ready
await artifact.createSnapshot('docs: complete requirements v1')
```

---

### 3. Binary File Outputs (Images, PDFs, Word Docs)

**Strategy:** Object Storage + Git LFS-style references

**Problem:** Git can't diff binary files (images, PDFs, .docx, models, etc.)

**Solution:**
1. Store binary content in object storage (S3/Azure Blob)
2. Store pointer file in Git
3. Track versions via content hashing

**Agent Workflow:**

**For Images/PDFs:**
1. Agent generates image: `mockup.png`
2. Artifact Store uploads to S3: `s3://ping-artifacts/team-123/mockup-v1.png`
3. Creates Git pointer file:
   ```
   version https://git-lfs.github.com/spec/v1
   oid sha256:abc123def456...
   size 1024768
   storage s3://ping-artifacts/team-123/mockup-v1.png
   ```
4. Commits pointer file to branch
5. Human reviews via download link

**For Word Documents (.docx):**

**Option A: Generate from Markdown** (Recommended)
1. Agents collaborate on Markdown (real-time OT/CRDT)
2. When ready, export to Word: `await doc.exportAs('docx')`
3. Store .docx in S3
4. Human downloads formatted Word document

**Option B: Structured Document** (Rich formatting)
1. Agents edit structured JSON (blocks: headings, tables, images)
2. Real-time collaboration on JSON structure
3. Export to Word/PDF/HTML on demand
4. Full formatting control (fonts, styles, tables)

**Option C: Binary Versioning** (No collaboration)
1. Agent generates complete .docx file
2. Upload to S3 with versioning
3. No real-time collaboration (sequential edits only)

**Example:**
```typescript
// Agent output
const artifact = await artifactStore.createBinaryArtifact({
  teamId: 'product-team',
  agentId: 'designer',
  taskId: 'task-789',
  type: 'image',
  binaryData: Buffer.from('...'),
  filename: 'mockup.png',
  mimeType: 'image/png'
})

// Returns: {
//   storageUrl: 's3://ping-artifacts/team-123/mockup-v1.png',
//   pointerPath: 'assets/mockup.png.lfs',
//   version: 'v1',
//   hash: 'sha256:abc123...'
// }
```

---

### 4. Data Files (CSV, JSON, etc.)

**Strategy:** Depends on size

**Small files (<10MB):** Git + diffs
**Large files (>10MB):** Object storage + metadata

**Agent Workflow (Small):**
1. Agent generates CSV
2. Commits to Git branch
3. Human reviews diff (GitHub shows CSV diffs nicely)

**Agent Workflow (Large):**
1. Agent generates large dataset
2. Upload to object storage
3. Store metadata in Git:
   ```json
   {
     "file": "data/sales-report.csv",
     "storage": "s3://ping-artifacts/team-123/sales-v1.csv",
     "rows": 1000000,
     "columns": 50,
     "hash": "sha256:def789..."
   }
   ```

---

## Branching Strategy

### Per-Agent Branches

**Pattern:** `agent/<agent-role>/<task-slug>`

**Examples:**
- `agent/backend-dev/login-api`
- `agent/content-writer/blog-post`
- `agent/data-analyst/sales-report`

**Lifecycle:**
1. Created when task starts
2. Agent commits incrementally
3. PR created when task completes
4. Branch deleted after merge

---

### Team Main Branch

**Protected branch:** `main`

**Rules:**
- No direct commits
- All changes via PRs
- Requires human approval
- Auto-tests must pass (if configured)

---

### Multi-Agent Collaboration

**Scenario:** Two agents working on same document/feature

**Option 1: Real-Time Collaboration** (Recommended)

**For Documents:**
1. Both agents connect to shared document (OT/CRDT)
2. Agents edit simultaneously
3. Changes propagate in real-time
4. **No merge conflicts** - automatic convergence
5. Snapshot committed when done

**For Code (more complex):**
1. Live coding session (experimental)
2. Agents coordinate via task dependencies
3. Or use sequential approach

**Option 2: Sequential** (Simple, for MVP code)
1. Agent A completes task → PR merged
2. Agent B starts from updated main → new branch

**Option 3: Parallel Branches** (Requires conflict resolution)
1. Agent A works in `agent/A/feature`
2. Agent B works in `agent/B/feature`
3. Both create PRs
4. Human resolves merge conflicts (if any)

---

## Approval Workflow

### Code/Document Changes

```
Agent Commits → Branch
       ↓
  Creates PR
       ↓
Approval Queue (Human)
       ↓
   Review Diff
       ↓
Approve / Reject / Request Changes
       ↓
  Auto-merge (if approved)
```

### Binary Files

```
Agent Uploads → Object Storage
       ↓
  Metadata committed
       ↓
Approval Queue (Human)
       ↓
  Download & Review
       ↓
Approve / Reject
       ↓
  Update status
```

---

## Data Model

### Artifact (Base)

```typescript
interface Artifact {
  id: string
  teamId: string
  agentId: string
  taskId: string
  type: 'code' | 'document' | 'binary' | 'data'
  version: number
  createdAt: Date
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected'
}
```

### Git Artifact

```typescript
interface GitArtifact extends Artifact {
  storage: 'git'
  branchName: string
  commitHash: string
  prId?: string
  files: {
    path: string
    content: string
    encoding: 'utf-8' | 'base64'
  }[]
}
```

### Object Storage Artifact

```typescript
interface ObjectStorageArtifact extends Artifact {
  storage: 'object'
  storageUrl: string // s3://... or azure://...
  contentHash: string // sha256
  size: number
  mimeType: string
  pointerPath?: string // Git LFS pointer
}
```

---

## Implementation Phases

### MVP (Phase 1)

**Supported:**
- ✅ Code files → Git branches + manual commits
- ✅ **Real-time collaborative documents** (OT/CRDT)
- ✅ Markdown docs with live multi-agent editing
- ✅ Small data files (<10MB) → Git
- ✅ Binary files → Object storage (S3)
- ✅ Manual PR creation for code
- ✅ Snapshot commits for collaborative docs
- ✅ Human approval required

**Not Supported:**
- ❌ Auto PR creation
- ❌ Real-time code collaboration (complex)
- ❌ Advanced merge conflict resolution for code

### Stable (Phase 2)

**Adds:**
- ✅ Auto PR creation by agents
- ✅ Incremental commits
- ✅ Diff viewer in UI
- ✅ Large file detection → auto object storage
- ✅ Real-time presence indicators (see which agents are editing)
- ✅ Operation replay & undo for collaborative docs

### Incremental 1 (Phase 3)

**Adds:**
- ✅ Real-time code collaboration (experimental)
- ✅ Semantic diffs (not just line diffs)
- ✅ Auto-merge for approved agents
- ✅ Conflict-free data structure synchronization

### Incremental 2 (Phase 4)

**Adds:**
- ✅ Git LFS integration
- ✅ Binary diff tools (image comparison)
- ✅ Multi-agent merge orchestration

---

## Alternative: No Git, Custom Versioning

**If Git is too complex:**

Build custom versioning:
- Store all artifacts in object storage
- Version via immutable append-only log
- Metadata in database tracks lineage
- Custom diff engine

**Pros:**
- Full control
- Works for all file types
- Simpler than Git

**Cons:**
- No ecosystem tools (GitHub UI, etc.)
- Must build diff viewer
- No existing workflows

---

## Recommendation

**Hybrid Approach (Proposed):**

1. **Text files (code, docs)** → Git branches + PRs
   - Leverage existing tools (GitHub, GitLab)
   - Standard PR review workflow
   - Native diff support

2. **Binary files** → Object storage + metadata in Git
   - S3/Azure Blob for storage
   - Git LFS-style pointers
   - Custom review UI for downloads

3. **Agent branching** → Per-agent branches
   - Isolated work
   - Easy rollback
   - Clear approval boundaries

**Why:**
- Best of both worlds
- Industry-standard for code
- Scalable for binaries
- Familiar workflow for developers

---

## Next Steps

1. **Define Artifact Store API** (create, commit, PR, approve)
2. **Choose object storage** (AWS S3, Azure Blob, MinIO)
3. **Build Git integration** (create branches, commits, PRs)
4. **Build approval UI** (diff viewer, approve/reject)

---

## Related Documentation

- [Ping Architecture](../ping/architecture.md) - Overall system design
- [Approval System](../ping/architecture.md#f-approval--governance) - Human control layer
- [Team Service](../ping/architecture.md#a-team-service-foundational) - Team scoping
