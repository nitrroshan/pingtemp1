# Real-Time Collaboration for Multi-Agent Editing

**How multiple agents collaborate on the same document simultaneously without merge conflicts.**

---

## Why Real-Time Collaboration?

**Traditional Git workflow:**
- Agent A creates branch, edits, creates PR
- Agent B creates branch, edits, creates PR
- **Merge conflict!** Human must resolve

**With real-time collaboration:**
- Agent A and B both connect to same document
- Both edit simultaneously
- **No conflicts** - automatic convergence
- **Faster** - no waiting for PRs

---

## Technology: Operational Transforms (OT) & CRDTs

### What is OT?

**Operational Transform** is the algorithm behind Google Docs, Figma, and other real-time collaborative tools.

**How it works:**
1. User (or agent) makes edit: "Insert 'hello' at position 5"
2. Operation sent to server
3. Server transforms operation against concurrent operations
4. All clients receive transformed operation
5. All clients converge to same state

**Example:**

```
Initial document: "ABC"

Agent A: Insert "X" at position 1 → "AXBC"
Agent B: Insert "Y" at position 1 → "AYBC"

Without OT:
- Both agents see position 1
- Race condition, lost updates

With OT:
- Server transforms Agent B's operation
- Agent B's insert moves to position 2
- Final state: "AXYBC" (both agents agree)
```

### What is CRDT?

**Conflict-Free Replicated Data Type** is a mathematical structure that guarantees convergence.

**Key property:** Operations commute (order doesn't matter)

**Example (CRDT Set):**
```
Agent A: Add "feature-1"
Agent B: Add "feature-2"

→ Final set: {"feature-1", "feature-2"}
→ Same result regardless of network latency
```

---

## Architecture for Ping

### Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                  REAL-TIME COLLABORATION                     │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Agent A     │  │   Agent B     │  │   Agent C     │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │ WebSocket       │ WebSocket       │ WebSocket     │
│         └─────────────────┼─────────────────┘               │
│                           ↓                                  │
│                 ┌──────────────────┐                         │
│                 │  OT/CRDT Engine  │                         │
│                 │   (Coordination)  │                         │
│                 └──────────────────┘                         │
│                           ↓                                  │
│              ┌────────────────────────┐                      │
│              │  Shared Document Store │                      │
│              │    (Redis/Memory)      │                      │
│              └────────────────────────┘                      │
│                           ↓                                  │
│                 ┌──────────────────┐                         │
│                 │   Git Snapshots   │                         │
│                 │  (Periodic Saves) │                         │
│                 └──────────────────┘                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Options

### Option 1: ShareDB (Recommended for MVP)

**What is ShareDB?**
- Real-time database with OT built-in
- Powers many collaborative apps
- Mature, battle-tested
- Supports JSON documents

**Pros:**
- ✅ Ready to use (minimal custom code)
- ✅ OT algorithm implemented
- ✅ WebSocket support
- ✅ Presence awareness (see who's editing)
- ✅ Offline support & conflict resolution

**Cons:**
- ❌ Opinionated architecture
- ❌ Learning curve

**Example:**
```typescript
import ShareDB from 'sharedb'
import WebSocket from 'ws'

const backend = new ShareDB()
const connection = backend.connect()

// Agent connects to document
const doc = connection.get('team-123', 'requirements-doc')

doc.subscribe((err) => {
  if (err) throw err
  
  // Agent reads current state
  console.log(doc.data) // { content: "# Requirements\n..." }
  
  // Agent makes edit
  doc.submitOp([{ p: ['content', 5], si: 'New section\n' }])
  
  // Other agents receive update automatically
})
```

### Option 2: Yjs (Modern CRDT)

**What is Yjs?**
- CRDT library for shared editing
- Powers Notion, Linear, etc.
- Extremely fast
- Works offline-first

**Pros:**
- ✅ True CRDT (no central server for transforms)
- ✅ Peer-to-peer capable
- ✅ Rich data types (Text, Array, Map)
- ✅ Built-in undo/redo
- ✅ Excellent performance

**Cons:**
- ❌ More complex setup
- ❌ Requires understanding of CRDTs

**Example:**
```typescript
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const ydoc = new Y.Doc()
const provider = new WebsocketProvider(
  'ws://localhost:1234',
  'team-123-requirements',
  ydoc
)

const ytext = ydoc.getText('content')

// Agent makes edit
ytext.insert(0, '# Requirements\n')

// Automatically syncs to all connected agents
```

### Option 3: Automerge (Pure CRDT)

**What is Automerge?**
- CRDT library with focus on local-first
- No server needed (can work P2P)
- Immutable data structures

**Pros:**
- ✅ Simple API
- ✅ Git-like semantics
- ✅ Works offline
- ✅ Audit trail built-in

**Cons:**
- ❌ Performance issues with large documents
- ❌ Less mature ecosystem

---

## Handling Word Documents (.docx, .pdf, Rich Text)

### The Challenge

**Word documents are binary files:**
- Can't use OT/CRDT directly (needs plain text)
- Can't diff in Git (binary blob)
- Formatting is complex (fonts, images, tables)

### Ping's North Star: Structured Document Model

---

#### Structured Document Model (PRIMARY APPROACH)

**Approach:** Store document as structured JSON blocks, render to any format

**Why This is the North Star:**
- ✅ **Native multi-agent collaboration** - OT/CRDT on JSON structure
- ✅ **Rich formatting** - Full control (fonts, tables, images, styles)
- ✅ **Export anywhere** - Word, PDF, HTML, Markdown
- ✅ **Block-level editing** - Multiple agents work on different sections simultaneously
- ✅ **Version control** - Git-friendly JSON structure
- ✅ **Future-proof** - Like Notion, ProseMirror, modern document editors

**Data Model:**
```typescript
interface StructuredDocument {
  id: string
  teamId: string
  type: 'structured'
  
  // Document structure (OT/CRDT collaborative)
  blocks: DocumentBlock[]
  
  // Styling and formatting
  styles: {
    font: 'Arial' | 'Helvetica' | 'Times New Roman'
    fontSize: number
    headingColors: { h1: string, h2: string, h3: string }
    pageSize: 'A4' | 'Letter'
    margins: { top: number, bottom: number, left: number, right: number }
  }
  
  // Metadata
  metadata: {
    title: string
    authors: string[] // Agent IDs
    createdAt: Date
    lastModified: Date
    version: string
  }
}

interface DocumentBlock {
  id: string
  type: 'heading' | 'paragraph' | 'table' | 'image' | 'list' | 'code' | 'quote' | 'divider'
  position: number
  content: any // Type-specific content
  formatting?: {
    bold?: boolean
    italic?: boolean
    underline?: boolean
    color?: string
    alignment?: 'left' | 'center' | 'right' | 'justify'
  }
}

// Block type examples
interface HeadingBlock extends DocumentBlock {
  type: 'heading'
  content: {
    level: 1 | 2 | 3 | 4 | 5 | 6
    text: string
  }
}

interface TableBlock extends DocumentBlock {
  type: 'table'
  content: {
    headers: string[]
    rows: string[][]
    columnWidths?: number[]
  }
}

interface ImageBlock extends DocumentBlock {
  type: 'image'
  content: {
    url: string // S3 URL
    alt: string
    width?: number
    height?: number
    caption?: string
  }
}
```

**Real-Time Collaboration:**
```typescript
// Agent A adds a heading
await doc.insertBlock({
  type: 'heading',
  position: 0,
  content: { level: 1, text: 'Product Requirements' }
})

// Agent B adds a table (simultaneously)
await doc.insertBlock({
  type: 'table',
  position: 5,
  content: {
    headers: ['Feature', 'Priority', 'Status', 'Owner'],
    rows: [
      ['Login', 'High', 'In Progress', 'Agent A'],
      ['Dashboard', 'Medium', 'Not Started', 'Agent B']
    ]
  }
})

// Agent C adds an image
await doc.insertBlock({
  type: 'image',
  position: 10,
  content: {
    url: 's3://ping-artifacts/team-123/mockup.png',
    alt: 'Dashboard mockup',
    caption: 'Initial design concept'
  }
})

// All agents see changes in real-time, no conflicts
```

**Export to Word:**
```typescript
// Generate professional Word document
const wordFile = await doc.exportAs('docx', {
  template: 'templates/corporate.docx', // Company branding
  includeTableOfContents: true,
  includePageNumbers: true,
  headerFooter: {
    header: 'Product Requirements - Confidential',
    footer: 'Generated by Ping on ${date}'
  }
})

// Also export to PDF
const pdfFile = await doc.exportAs('pdf', {
  quality: 'high',
  embedFonts: true
})

// Or HTML for web
const htmlFile = await doc.exportAs('html', {
  embedStyles: true,
  responsive: true
})
```

**Libraries to Use:**
- **docx** (npm) - Generate Word documents from JSON
- **ProseMirror** - Rich text editor with block structure
- **Yjs** - CRDT for structured data
- **html-docx-js** - HTML to Word conversion
- **puppeteer** - PDF generation

**MVP Implementation:**
1. **Phase 1:** Support basic blocks (heading, paragraph, list, table)
2. **Phase 2:** Add images, code blocks, quotes
3. **Phase 3:** Advanced formatting (fonts, colors, styles)
4. **Phase 4:** Custom templates and themes

---

### Alternative Approaches (For Specific Use Cases)

#### Option 2: Markdown → Word Export (Simple Documents)

**Use When:** Documents don't need complex formatting

**Approach:** Agents work with Markdown (OT/CRDT), export to Word when needed

**Flow:**
```
Agent edits Markdown (OT/CRDT) → Human requests Word export → Generate .docx
```

**Pros:**
- ✅ Simpler than structured model
- ✅ Easy versioning with Git
- ✅ Export to Word when needed

**Cons:**
- ❌ Limited formatting (Markdown constraints)
- ❌ No tables, images inline
- ❌ Export step required

**Example:**
```typescript
// Simple documents only
const doc = await artifactStore.createDocument({
  type: 'markdown',
  collaborativeMode: 'realtime'
})

const wordFile = await doc.exportAs('docx')
```

#### Option 3: Use External Services (Office 365 / Google Docs)

**Approach:** Integrate with Microsoft Graph API or Google Docs API

**Flow:**
```
Ping creates Google Doc → Agents edit via API → Human reviews in Google Docs
```

**Pros:**
- ✅ Native Word/Docs experience
- ✅ Real-time collaboration built-in
- ✅ Familiar UI for humans

**Cons:**
- ❌ External dependency
- ❌ API rate limits
- ❌ Less control over versioning
- ❌ Requires OAuth/auth

**Example:**
```typescript
// Create Google Doc
const doc = await googleDocsAPI.create({
  title: 'Product Requirements',
  teamId: 'product-team'
})

// Agent makes edit via API
await googleDocsAPI.batchUpdate(doc.id, {
  requests: [
    {
      insertText: {
        location: { index: 1 },
        text: '# Requirements

'
      }
    }
  ]
})

// Store link in Ping
await artifactStore.saveReference({
  type: 'external-doc',
  url: doc.url,
  service: 'google-docs'
})
```

#### Option 4: Binary Versioning (No Real-Time Collaboration)

**Approach:** Treat Word docs like images - version as binary blobs

**Flow:**
```
Agent generates Word doc → Upload to S3 → Human downloads & reviews
```

**Pros:**
- ✅ Simple
- ✅ Works with any binary format

**Cons:**
- ❌ No real-time collaboration
- ❌ No automatic merging
- ❌ Can't diff versions easily

**Use Case:** Reports, presentations, PDFs (read-only outputs)

---

### Recommended Strategy for Ping

**PRIMARY: Structured Document Model**

**All collaborative documents use structured blocks:**

1. **Requirements & Specifications** → Structured documents
   - Rich formatting (tables, images, headings)
   - Multi-agent collaboration
   - Export to Word/PDF when needed

2. **Reports & Presentations** → Structured documents
   - Professional formatting
   - Export to branded Word templates
   - Generate PDFs for distribution

3. **User Stories & Documentation** → Structured documents
   - Block-level collaboration
   - Version control via Git (JSON)
   - Export to multiple formats

**FALLBACK: Markdown for Simple Docs**
- Quick notes
- Internal documentation
- When rich formatting isn't needed

**BINARY STORAGE: Attachments Only**
- Existing Word docs from humans
- PDFs from external sources
- No collaboration, just storage

**Implementation:**
```typescript
// DEFAULT: Structured document for all team documents
const requirementsDoc = await artifactStore.createDocument({
  teamId: 'product-team',
  type: 'structured', // PRIMARY APPROACH
  title: 'Product Requirements',
  template: 'requirements' // Pre-defined block structure
})

// Multiple agents collaborate on blocks
await requirementsDoc.connect(productManager)
await requirementsDoc.connect(techWriter)
await requirementsDoc.connect(designer)

// Agents work on different sections
productManager.insertBlock({ type: 'heading', content: { level: 2, text: 'Features' }})
techWriter.insertBlock({ type: 'paragraph', content: { text: 'Description...' }})
designer.insertBlock({ type: 'image', content: { url: 's3://...', alt: 'Mockup' }})

// When ready, export to Word with company branding
const wordFile = await requirementsDoc.exportAs('docx', {
  template: 'templates/product-requirements.docx',
  metadata: {
    authors: ['Product Manager', 'Tech Writer', 'Designer'],
    date: new Date(),
    version: '1.0',
    confidentiality: 'Internal'
  }
})

// Also generate PDF for distribution
const pdfFile = await requirementsDoc.exportAs('pdf', {
  quality: 'high',
  watermark: 'DRAFT' // Optional
})

// Save both to artifacts
await artifactStore.saveBinary({
  teamId: 'product-team',
  files: [
    { file: wordFile, filename: 'requirements-v1.docx', format: 'docx' },
    { file: pdfFile, filename: 'requirements-v1.pdf', format: 'pdf' }
  ],
  sourceDocId: requirementsDoc.id
})
```

---

## Recommended Stack for Ping

### MVP: ShareDB + Redis

**Why:**
- Fastest to implement
- Proven technology
- Centralized (easier debugging)
- Good documentation

**Architecture:**
```
Agents (WebSocket) → ShareDB Server → Redis → Git Snapshots
```

**Components:**
1. **ShareDB Server** - Handles OT transformations
2. **Redis** - Stores live document state
3. **Git** - Periodic snapshots (every 5 mins or on completion)
4. **WebSocket** - Real-time communication

---

## Document Operations

### Supported Operations

**Text Operations:**
- `insert(position, text)` - Insert text at position
- `delete(position, length)` - Delete text
- `replace(start, end, text)` - Replace range

**Formatting (Future):**
- `bold(start, end)` - Apply bold
- `link(start, end, url)` - Add link

**Structural:**
- `addSection(title, content)` - Add document section
- `moveSection(from, to)` - Reorder sections

### Operation Example

```typescript
// Agent A: Insert header
doc.submitOp([
  { p: ['content', 0], si: '# Product Requirements\n\n' }
])

// Agent B: Simultaneously add section
doc.submitOp([
  { p: ['content', 100], si: '## User Stories\n\n' }
])

// Both operations apply cleanly
// Final document has both changes
```

---

## Presence Awareness

**Show which agents are currently editing:**

```typescript
// Agent announces presence
const presence = doc.connection.getPresence('team-123')

presence.submit({
  agentId: 'product-manager',
  cursor: 150, // Current cursor position
  selection: [150, 200], // Selected text range
  status: 'editing'
})

// Other agents see presence
presence.on('receive', (id, value) => {
  console.log(`Agent ${value.agentId} is at position ${value.cursor}`)
})
```

**UI Visualization:**
- Show agent avatars at cursor positions
- Highlight selected text with agent color
- Display "Agent X is typing..." indicators

---

## Snapshot Strategy

### When to Save to Git?

**Option 1: Periodic (Recommended)**
- Every 5 minutes, auto-snapshot
- Creates commit: "chore: auto-snapshot 2026-01-14 10:35"

**Option 2: On Milestone**
- When task marked complete
- When human requests snapshot

**Option 3: On Significant Change**
- Detect major edits (e.g., >100 lines changed)
- Auto-snapshot

**Example:**
```typescript
// Periodic snapshot
setInterval(async () => {
  const snapshot = await doc.getData()
  await git.commit({
    message: `chore: auto-snapshot ${new Date().toISOString()}`,
    files: [{ path: 'docs/requirements.md', content: snapshot.content }]
  })
}, 5 * 60 * 1000) // Every 5 mins
```

---

## Conflict Resolution

### The Magic: No Manual Conflicts!

**Traditional Git:**
```
Agent A: "Implement feature X"
Agent B: "Implement feature Y"
→ CONFLICT! Human resolves
```

**With OT/CRDT:**
```
Agent A: Insert "Feature X" at position 100
Agent B: Insert "Feature Y" at position 100
→ OT transforms: Agent B's insert moves to position 109
→ Final: "Feature X\nFeature Y"
→ No human intervention needed
```

### Edge Cases

**Same Position Edits:**
- OT deterministically orders operations
- Uses agent ID or timestamp as tiebreaker
- All agents agree on final order

**Deletions:**
- If Agent A deletes text that Agent B is editing
- OT transforms B's operation to skip deleted range
- No errors, graceful handling

---

## Agent Coordination Patterns

### Pattern 1: Divide-and-Conquer

**Scenario:** Requirements document with 10 sections

**Approach:**
1. Agent A: Writes sections 1-5
2. Agent B: Writes sections 6-10
3. Both work simultaneously in same document
4. No conflicts (different positions)

### Pattern 2: Iterative Refinement

**Scenario:** One agent writes, another reviews

**Approach:**
1. Agent A (Writer): Writes draft
2. Agent B (Editor): Makes inline edits simultaneously
3. Both see each other's changes in real-time
4. Faster than sequential review

### Pattern 3: Parallel Research

**Scenario:** Multiple agents researching same topic

**Approach:**
1. All agents connected to shared research doc
2. Each agent adds findings as they discover them
3. Document grows collaboratively
4. No waiting for turns

---

## Data Model

### Collaborative Document

```typescript
interface CollaborativeDocument {
  id: string
  teamId: string
  type: 'document'
  format: 'markdown' | 'structured' | 'plain-text'
  title: string
  
  // OT/CRDT state
  sharedbId: string // ShareDB document ID
  version: number // OT version number
  
  // Connected agents
  activeAgents: {
    agentId: string
    connectedAt: Date
    cursor: number
    selection?: [number, number]
  }[]
  
  // Git snapshots
  snapshots: {
    commitHash: string
    timestamp: Date
    version: number
  }[]
  
  // Export capabilities
  exports: {
    format: 'docx' | 'pdf' | 'html'
    url: string
    generatedAt: Date
  }[]
  
  // Metadata
  createdAt: Date
  lastModified: Date
  approvalStatus: 'draft' | 'pending' | 'approved'
}

// Structured document (for rich formatting)
interface StructuredDocument extends CollaborativeDocument {
  format: 'structured'
  blocks: DocumentBlock[]
  styles: DocumentStyles
}

interface DocumentBlock {
  id: string
  type: 'heading' | 'paragraph' | 'table' | 'image' | 'list' | 'code'
  content: any
  position: number
}
```

---

## Next Steps

1. **Choose OT/CRDT library** (Recommend: ShareDB for MVP)
2. **Set up WebSocket server** for agent connections
3. **Integrate with Artifact Store** (hybrid: OT + Git)
4. **Build presence system** (show active agents)
5. **Implement snapshot strategy** (periodic Git commits)
6. **Add approval workflow** (snapshot → PR → review)

---

## Related Documentation

- [Artifact Output Strategy](./artifact-output-strategy.md) - Overall storage architecture
- [Ping Architecture](./architecture.md) - System design
- [Approval System](./architecture.md#f-approval--governance) - Human control
