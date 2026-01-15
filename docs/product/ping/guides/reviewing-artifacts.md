# Reviewing Artifacts in Ping

**Artifacts are the outputs of agent work.** This guide covers the approval workflow, version control, and quality assurance.

---

## What is an Artifact?

An **artifact** is any output produced by agents:

**Types:**
- **Documents** - Requirements, specs, reports (Markdown, structured docs, Word)
- **Code** - Source files, pull requests, commits
- **Data** - JSON, CSV, analysis results, datasets
- **Binary** - Images, PDFs, videos, compiled files

**Every artifact:**
- Has a creator (agent)
- Is versioned (Git or object storage)
- Requires approval (unless auto-approval enabled)
- Belongs to a team workspace

---

## Artifact Lifecycle

```
1. Created → Agent produces output
2. Pending → Awaiting review
3. Approved → Human accepts
4. Merged → Integrated into team workspace
5. Published → Available for use
```

**Optional states:**
- **Rejected** - Human requests changes
- **Superseded** - Newer version exists

---

## Accessing Artifacts

### Via Ping UI

1. Click **"Artifacts"** in team workspace sidebar
2. View artifact tree:

```
team-workspace/
├── 📄 requirements.md (v3, approved)
├── 📁 code/
│   ├── 📄 auth.ts (v1, pending review)
│   └── 📄 database.ts (v2, approved)
├── 📁 designs/
│   └── 🖼️ wireframe.png (v1, approved)
└── 📁 data/
    └── 📊 analysis.json (v1, pending review)
```

3. Click artifact to review

### Via API

```typescript
import { PingClient } from '@ping/client'

const ping = new PingClient()

// List all artifacts for team
const artifacts = await ping.artifacts.list(teamId, {
  status: 'pending', // Only pending review
  type: 'document'   // Only documents
})

artifacts.forEach(artifact => {
  console.log(`${artifact.name} by ${artifact.createdBy}`)
})
```

---

## Review Workflow

### Step 1: View Artifact

**Open artifact for review:**

1. Click artifact in tree
2. View content in preview pane
3. See metadata:
   - Creator agent
   - Creation date
   - File size
   - Version number

**Example:**

```
┌─────────────────────────────────────────────────┐
│ requirements.md (v3)                             │
├─────────────────────────────────────────────────┤
│ Created by: Product Manager                     │
│ Date: 2026-01-15 10:30 AM                       │
│ Size: 42 KB                                      │
│ Status: Pending Review                           │
├─────────────────────────────────────────────────┤
│ [Preview]  [Diff]  [History]  [Download]       │
└─────────────────────────────────────────────────┘
```

### Step 2: Compare Versions

**See what changed:**

1. Click **"Diff"** tab
2. View changes (if previous version exists)

**Git-style diff:**

```diff
# Product Requirements

## Overview
-This document outlines requirements for the mobile app.
+This document outlines comprehensive requirements for 
+the fitness tracking mobile app, including user stories,
+technical specifications, and acceptance criteria.

## Features

+### Core Features
 - User authentication
 - Activity tracking
+- Social sharing
+- Goal setting

+### Nice-to-Have
+- Third-party integrations
+- Premium subscriptions
```

**Visual diff (for binary files):**
- Side-by-side image comparison
- Highlight changed regions

### Step 3: Add Comments

**Leave feedback:**

1. Select text in artifact
2. Click **"Comment"**
3. Enter feedback:

```
💬 Product Manager, line 45:

"The authentication flow needs more detail. 
Should we support OAuth providers (Google, Apple)?
Please add requirements for social login."
```

**Agent can respond:**
- View comments
- Address concerns
- Update artifact

### Step 4: Make Decision

**Approve or request changes:**

**Option 1: Approve**
```typescript
await ping.artifacts.approve(artifactId, {
  comment: 'Looks good! Clear requirements and well-structured.',
  mergeStrategy: 'auto' // Auto-merge to main
})
```

**Option 2: Request Changes**
```typescript
await ping.artifacts.requestChanges(artifactId, {
  comments: [
    { line: 45, text: 'Add OAuth requirements' },
    { line: 78, text: 'Clarify performance metrics' }
  ],
  assignTo: 'product-manager' // Reassign to agent
})
```

**Option 3: Reject**
```typescript
await ping.artifacts.reject(artifactId, {
  reason: 'Duplicate of existing document. Use requirements-v2.md instead.'
})
```

---

## Approval Workflow Types

### Pull Request (PR) Workflow

**For code and collaborative documents:**

**Flow:**
```
1. Agent creates branch: agent/product-manager/requirements
2. Agent commits artifact to branch
3. Agent creates pull request (PR)
4. Human reviews PR
5. Human approves/requests changes
6. If approved, merge to main
```

**PR Review UI:**

```
┌─────────────────────────────────────────────────┐
│ Pull Request #42                                 │
│ Add product requirements document                │
├─────────────────────────────────────────────────┤
│ From: agent/product-manager/requirements        │
│ To: main                                         │
│ Files changed: 1                                 │
│ Commits: 3                                       │
├─────────────────────────────────────────────────┤
│ [Files Changed]  [Commits]  [Conversation]      │
│                                                  │
│ ✓ requirements.md (+450 lines)                  │
│                                                  │
│ [View Diff]  [Comment]                          │
├─────────────────────────────────────────────────┤
│ [Approve & Merge]  [Request Changes]  [Close]  │
└─────────────────────────────────────────────────┘
```

**Best for:**
- Code
- Text documents
- Collaborative editing

### Snapshot Approval

**For real-time collaborative documents:**

**Flow:**
```
1. Agents collaborate in real-time (OT/CRDT)
2. Ping auto-saves snapshots every 5 minutes
3. On milestone/completion, create snapshot
4. Human reviews snapshot
5. Approve to "freeze" version
```

**Snapshot Review:**

```
┌─────────────────────────────────────────────────┐
│ Snapshot: requirements.md                        │
│ Created: 2026-01-15 14:30                       │
├─────────────────────────────────────────────────┤
│ Contributors: Product Manager, Tech Writer       │
│ Changes since last snapshot: 127 edits           │
│ Auto-saved: 3 minutes ago                       │
├─────────────────────────────────────────────────┤
│ [View Document]  [Compare to Previous]          │
│                                                  │
│ [Approve Snapshot]  [Continue Editing]          │
└─────────────────────────────────────────────────┘
```

**Best for:**
- Real-time collaborative docs
- Brainstorming sessions
- Iterative content

### Binary Approval

**For images, PDFs, videos:**

**Flow:**
```
1. Agent uploads binary to S3/Azure Blob
2. Agent creates Git pointer (LFS-style)
3. Human reviews (download or preview)
4. Approve to add pointer to Git
```

**Binary Review:**

```
┌─────────────────────────────────────────────────┐
│ wireframe.png                                    │
│ Size: 2.4 MB                                     │
│ Format: PNG                                      │
│ Dimensions: 1920x1080                           │
├─────────────────────────────────────────────────┤
│ [Image Preview]                                 │
│ ┌───────────────────────────────────┐          │
│ │                                   │          │
│ │   [Wireframe preview loads here]  │          │
│ │                                   │          │
│ └───────────────────────────────────┘          │
├─────────────────────────────────────────────────┤
│ [Approve]  [Request Changes]  [Download]       │
└─────────────────────────────────────────────────┘
```

**Best for:**
- Design assets
- Reports (PDF)
- Media files

---

## Version Control

### Git Integration

**All artifacts are versioned:**

**View history:**
```typescript
const history = await ping.artifacts.getHistory(artifactId)

history.forEach(version => {
  console.log(`v${version.number} - ${version.date}`)
  console.log(`  By: ${version.author}`)
  console.log(`  Message: ${version.commitMessage}`)
})
```

**Example output:**
```
v3 - 2026-01-15 14:30
  By: Product Manager
  Message: Add OAuth requirements and performance metrics

v2 - 2026-01-15 10:15
  By: Technical Writer
  Message: Restructure document with clear sections

v1 - 2026-01-14 16:45
  By: Product Manager
  Message: Initial draft of requirements
```

### Rollback

**Revert to previous version:**

```typescript
await ping.artifacts.rollback(artifactId, {
  toVersion: 2,
  reason: 'v3 introduced errors, reverting to stable v2'
})
```

**Rollback creates new version:**
```
v1 → v2 → v3 (bad) → v4 (rollback to v2)
```

### Branching

**Create experimental versions:**

```typescript
// Create feature branch
await ping.artifacts.createBranch(artifactId, {
  branchName: 'feature/add-security-section',
  fromVersion: 3
})

// Work on branch
// ...

// Merge back to main
await ping.artifacts.mergeBranch({
  from: 'feature/add-security-section',
  to: 'main',
  strategy: 'auto' // or 'manual' for conflicts
})
```

---

## Quality Checks

### Automated Checks

**Ping runs checks before review:**

**For documents:**
- ✓ Spell check
- ✓ Grammar check
- ✓ Broken link detection
- ✓ Formatting validation

**For code:**
- ✓ Linting (ESLint, Pylint)
- ✓ Type checking (TypeScript)
- ✓ Unit tests
- ✓ Security scan

**For data:**
- ✓ Schema validation
- ✓ Data quality checks
- ✓ Duplicate detection

**View check results:**

```
┌─────────────────────────────────────────────────┐
│ Automated Checks: requirements.md                │
├─────────────────────────────────────────────────┤
│ ✓ Spell check (0 errors)                       │
│ ✓ Grammar (0 issues)                           │
│ ⚠ Broken links (1 warning)                     │
│   → Line 89: https://example.com/404           │
│ ✓ Formatting (valid Markdown)                  │
└─────────────────────────────────────────────────┘
```

### Agent Self-Review

**Agents can review their own work:**

**Configure:**
```typescript
const workflow = await ping.workflows.create({
  goal: 'Create API documentation',
  selfReview: {
    enabled: true,
    reviewAgent: 'qa-engineer', // Use different agent
    criteria: [
      'Accuracy',
      'Completeness',
      'Clarity',
      'Code examples work'
    ]
  }
})
```

**Flow:**
```
1. Technical Writer creates docs
2. QA Engineer reviews (automatically)
3. If issues found, Technical Writer revises
4. Repeat until QA approves
5. Then human reviews
```

---

## Approval Policies

### Team-Level Policies

**Configure approval requirements:**

```typescript
await ping.teams.update(teamId, {
  approvalPolicy: {
    documents: {
      requireApproval: true,
      approvers: ['team-lead', 'product-owner'],
      minApprovals: 1
    },
    code: {
      requireApproval: true,
      requireTests: true, // Must have tests
      minApprovals: 2,    // 2 approvals needed
      blockedPatterns: ['TODO', 'FIXME'] // Block if contains
    },
    data: {
      requireApproval: true,
      schemaValidation: true
    },
    binary: {
      requireApproval: false, // Auto-approve
      maxSize: 10485760 // 10 MB limit
    }
  }
})
```

### Artifact-Specific Rules

**Set rules per artifact type:**

**Example: API Documentation**
```yaml
Artifact Type: API Documentation
Rules:
  - Must include request/response examples
  - Must document all endpoints
  - Must have error codes section
  - Minimum 80% coverage

Approval:
  - Requires: Technical Lead approval
  - Auto-approve if: All checks pass + self-review approved
```

---

## Bulk Review

**Review multiple artifacts at once:**

### Queue View

```
┌─────────────────────────────────────────────────┐
│ Pending Reviews (8)                              │
├─────────────────────────────────────────────────┤
│ □ requirements.md (v3) - Product Manager        │
│ □ auth.ts (v1) - Backend Developer              │
│ □ wireframe.png (v1) - UX Designer              │
│ □ test-report.md (v2) - QA Engineer             │
│ □ analysis.json (v1) - Data Analyst             │
│ □ api-spec.yaml (v4) - API Developer            │
│ □ design-doc.md (v2) - System Architect         │
│ □ README.md (v1) - Technical Writer             │
├─────────────────────────────────────────────────┤
│ [Select All]  [Approve Selected]  [Review One] │
└─────────────────────────────────────────────────┘
```

### Batch Actions

```typescript
// Approve multiple at once
await ping.artifacts.bulkApprove([
  'artifact-001',
  'artifact-002',
  'artifact-003'
], {
  comment: 'All look good, approving batch'
})

// Request changes for multiple
await ping.artifacts.bulkRequestChanges([
  'artifact-004',
  'artifact-005'
], {
  comment: 'Both need more detail in implementation section'
})
```

---

## Export & Download

### Export Artifacts

**Download for offline review:**

```typescript
// Download single artifact
const file = await ping.artifacts.download(artifactId, {
  version: 3,
  format: 'original' // or 'pdf', 'docx' for documents
})

// Download all team artifacts
const archive = await ping.artifacts.downloadAll(teamId, {
  format: 'zip',
  includeHistory: true // Include all versions
})
```

### Export to External Systems

**Integrate with other tools:**

```typescript
// Export to GitHub
await ping.artifacts.export(artifactId, {
  destination: 'github',
  repository: 'org/repo',
  branch: 'main',
  path: 'docs/requirements.md'
})

// Export to Confluence
await ping.artifacts.export(artifactId, {
  destination: 'confluence',
  space: 'PROD',
  title: 'Product Requirements'
})

// Export to Google Drive
await ping.artifacts.export(artifactId, {
  destination: 'google-drive',
  folderId: 'abc123',
  format: 'docx'
})
```

---

## Best Practices

### 1. Timely Reviews

**Review within:**
- Documents: 24 hours
- Code: 48 hours
- Data: 1 week

**Set reminders:**
```typescript
await ping.teams.update(teamId, {
  reviewReminders: {
    enabled: true,
    intervals: [24, 72, 168] // hours
  }
})
```

### 2. Constructive Feedback

**Good feedback:**
```
✅ "The authentication section is clear, but please add 
   error handling examples for 401/403 responses."

✅ "Great start! Consider adding a sequence diagram 
   to visualize the OAuth flow."
```

**Poor feedback:**
```
❌ "This is wrong."
❌ "Redo this."
```

### 3. Use Templates

**Review checklists:**

```markdown
## Documentation Review Checklist

- [ ] Clear and concise
- [ ] No spelling/grammar errors
- [ ] All links work
- [ ] Code examples tested
- [ ] Audience-appropriate
- [ ] Follows style guide
```

### 4. Delegate When Appropriate

**Assign expert reviewers:**

```typescript
await ping.artifacts.assignReviewer(artifactId, {
  reviewerId: 'security-expert',
  reason: 'This document requires security review'
})
```

### 5. Archive Old Versions

**Keep workspace clean:**

```typescript
// Auto-archive versions older than 90 days
await ping.teams.update(teamId, {
  artifactRetention: {
    keepVersions: 10, // Keep last 10 versions
    archiveAfterDays: 90
  }
})
```

---

## Troubleshooting

### Issue: Can't see artifact

**Check:**
1. Artifact belongs to your team
2. You have permissions
3. Artifact not deleted

```typescript
const artifact = await ping.artifacts.get(artifactId)
console.log(artifact.teamId, artifact.status)
```

### Issue: Diff not showing

**Cause:** Binary file or no previous version

**Fix:** Use preview or download for manual comparison

### Issue: Approval blocked

**Check approval policy:**
```typescript
const policy = await ping.teams.getApprovalPolicy(teamId)
console.log(policy.documents.requireApproval)
console.log(policy.documents.minApprovals)
```

---

## Next Steps

- **[Managing Planners](./managing-planners.md)** - Coordinate agent work
- **[API Reference](../api/artifact-api.md)** - Programmatic artifact management
- **[Artifact API](../api/artifact-api.md)** - Programmatic artifact access

---

**Reviewing artifacts is your control point.** Use it to ensure quality, provide guidance, and maintain oversight of agent work! ✅
