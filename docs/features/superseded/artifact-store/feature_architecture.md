# Artifact Store — Feature Architecture

**Status:** Superseded  
**Date:** March 30, 2026  
**ID:** D2  
**Reason:** Not needed as a separate system. OutputManifest (L2, already built) + Git (workspace branches) + approval status field covers this. Add `approvalStatus` to OutputManifest schema instead.

---

## Overview

Build the Artifact Store — the system that tracks, stores, versions, and serves artifacts produced by workers. Currently artifacts are mentioned in task outputs but there's no unified registry, no versioning, no approval-linked storage.

### Current State
- Workers commit files to workspace git branches
- Task outputs mention artifact IDs but there's no `ArtifactStore` service
- Artifact approval flow exists conceptually (in planner-as-agent and agentic-streaming docs) but no backing store
- No artifact metadata, no media type tracking, no preview generation

### Target State
- `ArtifactStore` service tracks all artifacts produced across a goal
- Each artifact has: ID, name, type, media type, source task, approval status, version
- Artifacts linked to git commits in workspace repo (A8)
- Artifact approval state drives downstream task unblocking
- Artifacts servable to frontend for preview (markdown, code, images)

---

## Artifact Lifecycle

```
Worker produces output
  │
  ├── Commits files to workspace branch (git)
  ├── Registers artifact in ArtifactStore:
  │     { id, name, mediaType, taskId, commitHash, status: 'pending' }
  │
  ├── Orchestrator presents via present_artifact tool
  │     → User sees preview in chat
  │
  ├── User approves / requests changes / rejects
  │     → ArtifactStore.updateStatus(id, 'approved')
  │     → Downstream tasks unblocked
  │
  └── On goal completion:
        All approved artifacts = goal deliverables
```

## Schema

```typescript
interface Artifact {
  id: string;
  goalId: string;
  taskId: string;
  name: string;
  mediaType: string;          // 'text/markdown', 'application/typescript', 'image/png'
  status: 'pending' | 'approved' | 'rejected' | 'changes-requested';
  version: number;
  commitHash: string;         // git commit in workspace repo
  branchName: string;         // task branch
  filePaths: string[];        // files in workspace
  feedback?: string;          // user feedback on rejection/changes
  createdAt: Date;
  reviewedAt?: Date;
}
```

**Effort:** Medium (1-2 weeks)
