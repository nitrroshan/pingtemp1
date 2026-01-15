# Structured Document Model - North Star Architecture

**Ping's primary approach for rich, collaborative documents.**

---

## Vision

**Documents in Ping are structured, collaborative, and exportable.**

- **Structured** - JSON blocks, not binary blobs
- **Collaborative** - Real-time multi-agent editing via OT/CRDT
- **Exportable** - Generate Word, PDF, HTML, Markdown from same source

---

## Why Structured Documents?

### The Problem with Traditional Approaches

**Binary Word Files:**
- ❌ Can't collaborate in real-time
- ❌ Can't diff in Git
- ❌ Can't track who wrote what
- ❌ Merge conflicts require manual resolution

**Plain Markdown:**
- ❌ Limited formatting (no tables, images, styles)
- ❌ Not suitable for business documents
- ❌ Can't export to professional Word templates

### The Structured Document Solution

**Like Notion, ProseMirror, Google Docs (but agent-native):**
- ✅ Real-time collaboration (OT/CRDT on JSON structure)
- ✅ Rich formatting (tables, images, fonts, colors)
- ✅ Block-level editing (agents work on different sections)
- ✅ Version control (Git-friendly JSON)
- ✅ Export to Word/PDF/HTML
- ✅ Template support (company branding)

---

## Core Concepts

### 1. Everything is a Block

Documents are composed of typed blocks:

```typescript
{
  "blocks": [
    { "type": "heading", "level": 1, "text": "Requirements" },
    { "type": "paragraph", "text": "This document..." },
    { "type": "table", "headers": [...], "rows": [...] },
    { "type": "image", "url": "s3://...", "alt": "Mockup" },
    { "type": "list", "items": [...] },
    { "type": "code", "language": "typescript", "code": "..." }
  ]
}
```

**Benefits:**
- Each block is independently editable
- Multiple agents can edit different blocks simultaneously
- No merge conflicts (OT handles ordering)
- Easy to version (Git diff on JSON)

### 2. Collaborative Editing on Structure

**Agents don't edit a text file - they manipulate blocks:**

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
    headers: ['Feature', 'Priority', 'Status'],
    rows: [['Login', 'High', 'In Progress']]
  }
})

// Agent C edits a paragraph (simultaneously)
await doc.updateBlock('block-123', {
  content: { text: 'Updated description...' }
})
```

**OT/CRDT ensures:**
- All agents see same final state
- No conflicts
- Deterministic ordering

### 3. Export to Any Format

**One source, multiple outputs:**

```typescript
const doc = await artifactStore.getDocument('requirements-doc-id')

// Export to Word with company template
const wordFile = await doc.exportAs('docx', {
  template: 'corporate-template.docx',
  includeTableOfContents: true
})

// Export to PDF
const pdfFile = await doc.exportAs('pdf', {
  quality: 'high',
  embedFonts: true
})

// Export to HTML
const htmlFile = await doc.exportAs('html', {
  embedStyles: true,
  responsive: true
})

// Export to Markdown (if needed)
const markdown = await doc.exportAs('markdown')
```

---

## Block Types

### Text Blocks

**Heading**
```typescript
interface HeadingBlock {
  id: string
  type: 'heading'
  position: number
  content: {
    level: 1 | 2 | 3 | 4 | 5 | 6
    text: string
  }
  formatting?: {
    color?: string
    alignment?: 'left' | 'center' | 'right'
  }
}
```

**Paragraph**
```typescript
interface ParagraphBlock {
  id: string
  type: 'paragraph'
  position: number
  content: {
    text: string
    spans?: Array<{
      start: number
      end: number
      format: 'bold' | 'italic' | 'underline' | 'code'
    }>
  }
  formatting?: {
    alignment?: 'left' | 'center' | 'right' | 'justify'
    indentation?: number
  }
}
```

### Structural Blocks

**Table**
```typescript
interface TableBlock {
  id: string
  type: 'table'
  position: number
  content: {
    headers: string[]
    rows: string[][]
    columnWidths?: number[]
    headerStyles?: {
      backgroundColor?: string
      fontWeight?: 'bold' | 'normal'
    }
  }
}
```

**List**
```typescript
interface ListBlock {
  id: string
  type: 'list'
  position: number
  content: {
    style: 'bullet' | 'numbered'
    items: Array<{
      text: string
      indent: number
      sublist?: ListBlock
    }>
  }
}
```

### Media Blocks

**Image**
```typescript
interface ImageBlock {
  id: string
  type: 'image'
  position: number
  content: {
    url: string // S3 URL
    alt: string
    width?: number
    height?: number
    caption?: string
    alignment?: 'left' | 'center' | 'right'
  }
}
```

**Code**
```typescript
interface CodeBlock {
  id: string
  type: 'code'
  position: number
  content: {
    language: string
    code: string
    showLineNumbers?: boolean
    highlightLines?: number[]
  }
}
```

### Special Blocks

**Quote**
```typescript
interface QuoteBlock {
  id: string
  type: 'quote'
  position: number
  content: {
    text: string
    author?: string
    source?: string
  }
}
```

**Divider**
```typescript
interface DividerBlock {
  id: string
  type: 'divider'
  position: number
  content: {
    style: 'solid' | 'dashed' | 'dotted'
  }
}
```

---

## Document Structure

### Complete Document Model

```typescript
interface StructuredDocument {
  id: string
  teamId: string
  type: 'structured'
  
  // Metadata
  metadata: {
    title: string
    authors: string[] // Agent IDs
    createdAt: Date
    lastModified: Date
    version: string
    tags: string[]
  }
  
  // Document structure
  blocks: DocumentBlock[]
  
  // Styling
  styles: {
    theme: 'light' | 'dark' | 'custom'
    font: {
      family: 'Arial' | 'Helvetica' | 'Times New Roman' | 'Calibri'
      size: number
    }
    headings: {
      h1: { fontSize: number, color: string, fontWeight: string }
      h2: { fontSize: number, color: string, fontWeight: string }
      h3: { fontSize: number, color: string, fontWeight: string }
    }
    page: {
      size: 'A4' | 'Letter' | 'Legal'
      margins: { top: number, bottom: number, left: number, right: number }
      orientation: 'portrait' | 'landscape'
    }
  }
  
  // OT/CRDT state
  crdt: {
    sharedbId: string
    version: number
    activeAgents: Array<{
      agentId: string
      cursor: { blockId: string, offset: number }
      selection?: { start: string, end: string }
    }>
  }
  
  // Export history
  exports: Array<{
    format: 'docx' | 'pdf' | 'html' | 'markdown'
    url: string
    generatedAt: Date
    metadata: Record<string, any>
  }>
}
```

---

## Real-Time Collaboration

### Block Operations

**Insert Block:**
```typescript
await doc.insertBlock({
  type: 'paragraph',
  position: 5,
  content: { text: 'New paragraph' }
})
```

**Update Block:**
```typescript
await doc.updateBlock('block-123', {
  content: { text: 'Updated text' }
})
```

**Delete Block:**
```typescript
await doc.deleteBlock('block-123')
```

**Move Block:**
```typescript
await doc.moveBlock('block-123', { toPosition: 10 })
```

### OT/CRDT Guarantees

**Scenario: Two agents editing simultaneously**

```
Agent A: Inserts table at position 5
Agent B: Inserts image at position 5

→ OT transforms: Agent B's insert moves to position 6
→ Final: Table at 5, Image at 6
→ No conflict!
```

**Scenario: Editing same block**

```
Agent A: Updates paragraph block "Hello"
Agent B: Updates same paragraph block "World"

→ OT merges: "Hello World" or "World Hello" (deterministic)
→ Both agents see same result
```

---

## Export Implementation

### Word Export

**Using `docx` library:**

```typescript
import { Document, Paragraph, HeadingLevel, Table, TableRow, TableCell } from 'docx'

async function exportToWord(structuredDoc: StructuredDocument): Promise<Buffer> {
  const children = []
  
  for (const block of structuredDoc.blocks) {
    switch (block.type) {
      case 'heading':
        children.push(
          new Paragraph({
            text: block.content.text,
            heading: HeadingLevel[`HEADING_${block.content.level}`]
          })
        )
        break
        
      case 'paragraph':
        children.push(
          new Paragraph({
            text: block.content.text
          })
        )
        break
        
      case 'table':
        children.push(
          new Table({
            rows: [
              new TableRow({
                children: block.content.headers.map(h => 
                  new TableCell({ children: [new Paragraph(h)] })
                )
              }),
              ...block.content.rows.map(row =>
                new TableRow({
                  children: row.map(cell =>
                    new TableCell({ children: [new Paragraph(cell)] })
                  )
                })
              )
            ]
          })
        )
        break
        
      // ... other block types
    }
  }
  
  const doc = new Document({
    sections: [{
      properties: {},
      children
    }]
  })
  
  return await Packer.toBuffer(doc)
}
```

### PDF Export

**Using Puppeteer:**

```typescript
import puppeteer from 'puppeteer'

async function exportToPDF(structuredDoc: StructuredDocument): Promise<Buffer> {
  // First convert to HTML
  const html = await exportToHTML(structuredDoc)
  
  const browser = await puppeteer.launch()
  const page = await browser.newPage()
  
  await page.setContent(html)
  
  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '1cm', bottom: '1cm', left: '1cm', right: '1cm' }
  })
  
  await browser.close()
  
  return pdf
}
```

---

## Templates

### Document Templates

**Pre-defined block structures for common document types:**

```typescript
const TEMPLATES = {
  'requirements': {
    name: 'Product Requirements',
    blocks: [
      { type: 'heading', content: { level: 1, text: 'Product Requirements' }},
      { type: 'heading', content: { level: 2, text: 'Overview' }},
      { type: 'paragraph', content: { text: '[Description]' }},
      { type: 'heading', content: { level: 2, text: 'User Stories' }},
      { type: 'table', content: { headers: ['Story', 'Priority', 'Status'], rows: [] }},
      { type: 'heading', content: { level: 2, text: 'Technical Requirements' }},
      { type: 'list', content: { style: 'bullet', items: [] }}
    ]
  },
  
  'report': {
    name: 'Quarterly Report',
    blocks: [
      { type: 'heading', content: { level: 1, text: 'Q1 2026 Report' }},
      { type: 'heading', content: { level: 2, text: 'Executive Summary' }},
      { type: 'paragraph', content: { text: '[Summary]' }},
      { type: 'heading', content: { level: 2, text: 'Key Metrics' }},
      { type: 'table', content: { headers: ['Metric', 'Q1', 'Q2', 'Change'], rows: [] }},
      { type: 'heading', content: { level: 2, text: 'Analysis' }},
      { type: 'paragraph', content: { text: '[Analysis]' }}
    ]
  }
}

// Use template
const doc = await artifactStore.createFromTemplate('requirements', {
  teamId: 'product-team',
  title: 'Product X Requirements'
})
```

---

## Next Steps

1. **Choose CRDT library** - Yjs recommended (rich data types, excellent performance)
2. **Define block schema** - TypeScript interfaces for all block types
3. **Build block editor** - ProseMirror or custom React components
4. **Implement export engine** - Word, PDF, HTML generators
5. **Create templates** - Pre-defined structures for common documents

---

## Related Documentation

- [Real-Time Collaboration](./realtime-collaboration.md) - OT/CRDT implementation details
- [Artifact Output Strategy](./artifact-output-strategy.md) - Overall storage architecture
- [Ping Architecture](./architecture.md) - System design
