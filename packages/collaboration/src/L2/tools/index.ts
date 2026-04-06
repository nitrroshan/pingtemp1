/**
 * Memory Tools — Tool factories for agent interaction with memory layers
 *
 * L1: Workspace tools are in memory/L1/workspace/tools/workspace-tools.ts
 * L2: Unified `collab` tool — progressive discovery over CRDT docs, plans, and output manifests
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import * as Y from "yjs";
import crypto from "crypto";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { IL2CollaborationPlugin } from "../../types/plugins.js";
import type { CollaborationSpace } from "../collaboration/CollaborationSpace.js";
import type { CollabDocument } from "../collaboration/CollabDocument.js";

// ═══════════════════════════════════════════════════════════════════════════════
// BlockNote Y.XmlFragment helpers — lets agents write rich text blocks
// ═══════════════════════════════════════════════════════════════════════════════

function generateBlockId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/**
 * Insert a paragraph block into a BlockNote Y.XmlFragment.
 * Creates the exact XML structure BlockNote expects.
 */
function insertParagraph(
  fragment: Y.XmlFragment,
  text: string,
  attrs?: { textColor?: string; backgroundColor?: string },
): void {
  // Find or create the root blockGroup
  let blockGroup: Y.XmlElement;
  if (fragment.length > 0) {
    blockGroup = fragment.get(0) as Y.XmlElement;
  } else {
    blockGroup = new Y.XmlElement("blockGroup");
    fragment.insert(0, [blockGroup]);
  }

  const blockContainer = new Y.XmlElement("blockContainer");
  blockContainer.setAttribute("id", generateBlockId());
  blockContainer.setAttribute("textColor", attrs?.textColor || "default");
  blockContainer.setAttribute(
    "backgroundColor",
    attrs?.backgroundColor || "default",
  );
  blockContainer.setAttribute("textAlignment", "left");

  const paragraph = new Y.XmlElement("paragraph");
  const xmlText = new Y.XmlText(text);
  paragraph.insert(0, [xmlText]);
  blockContainer.insert(0, [paragraph]);

  blockGroup.insert(blockGroup.length, [blockContainer]);
}

/**
 * Insert a heading block into a BlockNote Y.XmlFragment.
 */
function insertHeading(
  fragment: Y.XmlFragment,
  text: string,
  level: number = 2,
): void {
  let blockGroup: Y.XmlElement;
  if (fragment.length > 0) {
    blockGroup = fragment.get(0) as Y.XmlElement;
  } else {
    blockGroup = new Y.XmlElement("blockGroup");
    fragment.insert(0, [blockGroup]);
  }

  const blockContainer = new Y.XmlElement("blockContainer");
  blockContainer.setAttribute("id", generateBlockId());
  blockContainer.setAttribute("textColor", "default");
  blockContainer.setAttribute("backgroundColor", "default");
  blockContainer.setAttribute("textAlignment", "left");

  const heading = new Y.XmlElement("heading");
  heading.setAttribute("level", String(level));
  const xmlText = new Y.XmlText(text);
  heading.insert(0, [xmlText]);
  blockContainer.insert(0, [heading]);

  blockGroup.insert(blockGroup.length, [blockContainer]);
}

/**
 * Extract plain text from a BlockNote Y.XmlFragment.
 * Reads headings, paragraphs, and other block types back as readable text.
 */
function xmlFragmentToText(fragment: Y.XmlFragment): string {
  const lines: string[] = [];

  function extractText(node: any): string {
    if (node instanceof Y.XmlText) {
      return node.toString();
    }
    if (node instanceof Y.XmlElement || node instanceof Y.XmlFragment) {
      let text = "";
      for (let i = 0; i < node.length; i++) {
        text += extractText(node.get(i));
      }
      return text;
    }
    return "";
  }

  function walkBlocks(node: any): void {
    if (!(node instanceof Y.XmlElement) && !(node instanceof Y.XmlFragment))
      return;

    const nodeName = node instanceof Y.XmlElement ? node.nodeName : "";

    if (nodeName === "heading") {
      const level = parseInt(
        (node as Y.XmlElement).getAttribute("level") || "2",
      );
      const prefix = "#".repeat(level);
      lines.push(`${prefix} ${extractText(node)}`);
    } else if (nodeName === "paragraph") {
      const text = extractText(node);
      if (text) lines.push(text);
    } else if (nodeName === "bulletListItem") {
      lines.push(`- ${extractText(node)}`);
    } else if (nodeName === "numberedListItem") {
      lines.push(`1. ${extractText(node)}`);
    } else if (
      nodeName === "blockContainer" ||
      nodeName === "blockGroup" ||
      nodeName === ""
    ) {
      // Recurse into containers
      for (let i = 0; i < node.length; i++) {
        walkBlocks(node.get(i));
      }
    } else {
      // Unknown block type — extract raw text
      const text = extractText(node);
      if (text) lines.push(text);
    }
  }

  walkBlocks(fragment);
  return lines.join("\n");
}

/**
 * Convert markdown-like text to BlockNote blocks.
 * Supports: # headings, ## subheadings, plain paragraphs, --- dividers, - bullets
 */
function markdownToBlocks(fragment: Y.XmlFragment, text: string): number {
  const lines = text.split("\n").filter((l) => l.trim());
  let count = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("### ")) {
      insertHeading(fragment, trimmed.slice(4), 3);
    } else if (trimmed.startsWith("## ")) {
      insertHeading(fragment, trimmed.slice(3), 2);
    } else if (trimmed.startsWith("# ")) {
      insertHeading(fragment, trimmed.slice(2), 1);
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      insertParagraph(fragment, "• " + trimmed.slice(2));
    } else if (trimmed === "---" || trimmed === "***") {
      // Skip dividers
    } else {
      insertParagraph(fragment, trimmed);
    }
    count++;
  }
  return count;
}

// ═══════════════════════════════════════════════════════════════════════════════
// WELL-KNOWN CRDT DOCS — fallback descriptions when _meta hasn't been written
// ═══════════════════════════════════════════════════════════════════════════════

const KNOWN_CRDT_DOCS: Record<string, string> = {
  "agent-statuses":
    "Real-time status of all team agents — who is working, blocked, idle. Each key is a role name.",
  "chat-outcomes":
    "Decisions from group chat sessions between agents. Append-only history.",
  binaries: "Shared binary files and metadata (diagrams, exports, data files).",
};

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER: Read _meta from a doc (with fallback for well-known docs)
// ═══════════════════════════════════════════════════════════════════════════════

async function readMeta(
  space: CollaborationSpace,
  docName: string,
): Promise<{
  description: string;
  createdBy?: string;
  createdAt?: string;
} | null> {
  try {
    const doc = await space.openDoc(docName);
    const meta = doc.getMeta();
    if (meta?.description) return meta as any;
  } catch {
    /* doc doesn't exist yet */
  }
  // Fallback for well-known docs
  if (KNOWN_CRDT_DOCS[docName])
    return { description: KNOWN_CRDT_DOCS[docName] };
  return null;
}

async function ensureMeta(
  doc: CollabDocument,
  role: string,
  description?: string,
): Promise<void> {
  if (doc.getMeta()) return; // already has metadata
  doc.setMeta({
    description:
      description ?? KNOWN_CRDT_DOCS[doc.name] ?? `Created by ${role}`,
    createdBy: role,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// COLLAB TOOL — Unified L2 progressive-discovery tool
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create the unified `collab` tool for agent L2 access.
 *
 * Provides discover/list/read/write over CRDT docs, plans, and output manifests.
 */
export function createCollabTool(
  space: CollaborationSpace,
  agentRole: string,
  l2: IL2CollaborationPlugin,
  repoPath: string,
): StructuredToolInterface {
  return tool(
    async ({
      action,
      docName,
      key,
      value,
      description,
    }: {
      action:
        | "discover"
        | "list"
        | "read"
        | "write"
        | "write-block"
        | "read-block";
      docName?: string;
      key?: string;
      value?: any;
      description?: string;
    }) => {
      // === DISCOVER: progressive drill-down into L2 categories ===
      if (action === "discover") {
        if (!docName) {
          // Top-level: show all L2 categories with counts
          const crdtDocs = await space.listDocs();
          const plans = await l2.planStore.listAllPlans();
          const manifests = await l2.getAllManifests(repoPath);
          return [
            "Available L2 team state (use discover with docName to drill in):",
            "",
            `  crdt    — ${crdtDocs.length} real-time docs (${crdtDocs.join(", ") || "none yet"})`,
            `  plans   — ${plans.length} plan files`,
            `  outputs — ${manifests.length} task output manifests`,
            "",
            'Use: collab({ action: "discover", docName: "crdt" | "plans" | "outputs" })',
          ].join("\n");
        }

        if (docName === "crdt") {
          const liveDocs = await space.listDocs();
          const metas = await Promise.all(
            liveDocs.map(async (d: string) => ({
              name: d,
              meta: await readMeta(space, d),
            })),
          );
          return [
            "CRDT documents (real-time, read+write):",
            ...metas.map(({ name, meta }: { name: string; meta: any }) => {
              const desc =
                meta?.description ??
                'no description (add via "description" param on write)';
              const by =
                meta?.createdBy && !KNOWN_CRDT_DOCS[name]
                  ? ` [by ${meta.createdBy}]`
                  : "";
              return `  "${name}"${by} — ${desc}`;
            }),
            "",
            'Any "doc-*" documents are BlockNote collaborative editors (rich text).',
            "You can create new docs by writing to any name — auto-created on first write.",
            'Tip: include a "description" field on first write — stored as _meta in the doc.',
          ].join("\n");
        }

        if (docName === "plans") {
          const plans = await l2.planStore.listAllPlans();
          if (!plans.length) return "No plans found for this team.";
          return [
            "Plans (read-only):",
            ...plans.map(
              (p: any) =>
                `  ${p.planId} [${p.status}] — "${p.goal}" (v${p.version})`,
            ),
          ].join("\n");
        }

        if (docName === "outputs") {
          const manifests = await l2.getAllManifests(repoPath);
          if (!manifests.length) return "No output manifests found.";
          return [
            "Output manifests (read-only):",
            ...manifests.map(
              (m: any) =>
                `  ${m.taskId} (${m.role}) — ${m.outputs.length} files, completed ${m.publishedAt}`,
            ),
          ].join("\n");
        }

        return `Unknown category "${docName}". Use: crdt, plans, outputs.`;
      }

      // === LIST: show keys/items in a specific doc or category ===
      if (action === "list") {
        if (!docName)
          return "Provide docName. Use discover to see available categories.";

        if (docName === "plans") {
          const plans = await l2.planStore.listAllPlans();
          return (
            plans
              .map((p: any) => `  - ${p.planId} [${p.status}] — ${p.goal}`)
              .join("\n") || "No plans."
          );
        }
        if (docName === "outputs") {
          const manifests = await l2.getAllManifests(repoPath);
          return (
            manifests
              .map(
                (m: any) =>
                  `  - ${m.taskId} (${m.role}) — ${m.outputs.length} files`,
              )
              .join("\n") || "No outputs."
          );
        }

        // CRDT doc — list keys with value previews (filter out _meta)
        const doc = await space.openDoc(docName);
        const map = doc.getMap(docName);
        const keys = Array.from(map.keys()).filter(
          (k: string) => k !== "_meta",
        );
        if (!keys.length) return `"${docName}" exists but has no entries yet.`;
        return [
          `Keys in "${docName}" (${keys.length}):`,
          ...keys.map((k: string) => {
            const val = map.get(k);
            const preview =
              typeof val === "object"
                ? JSON.stringify(val).slice(0, 80) + "..."
                : String(val);
            return `  - ${k}: ${preview}`;
          }),
        ].join("\n");
      }

      // === READ: get a specific item ===
      if (action === "read") {
        if (!docName)
          return "Provide docName. Use discover to see available categories.";

        if (docName === "plans" && key) {
          const plans = await l2.planStore.listAllPlans();
          const meta = plans.find((p: any) => p.planId === key);
          if (!meta) return `Plan "${key}" not found.`;
          const stored = await l2.planStore.loadPlan(meta.planId, meta.goalId);
          return stored
            ? JSON.stringify(stored, null, 2)
            : `Plan "${key}" not found.`;
        }
        if (docName === "outputs" && key) {
          const manifest = await l2.getOutputManifest(repoPath, key);
          return manifest
            ? JSON.stringify(manifest, null, 2)
            : `Output manifest "${key}" not found.`;
        }

        // CRDT doc
        const doc = await space.openDoc(docName);
        if (key) {
          if (key === "_meta") return JSON.stringify(doc.getMeta(), null, 2);
          const val = doc.getMap(docName).get(key);
          return val != null
            ? JSON.stringify(val, null, 2)
            : `Key "${key}" not found in "${docName}".`;
        }
        // Full doc read — strip _meta from output
        const json = doc.toJSON();
        const data = json[docName] ?? json;
        if (data && typeof data === "object" && "_meta" in data) {
          const { _meta, ...rest } = data;
          return JSON.stringify(rest, null, 2);
        }
        return JSON.stringify(data, null, 2);
      }

      // === WRITE: CRDT only (plans and outputs are read-only) ===
      if (action === "write") {
        if (!docName || !key)
          return "Both docName and key required for writes.";
        if (docName === "plans" || docName === "outputs")
          return `"${docName}" is read-only. Only CRDT docs are writable.`;

        const doc = await space.openDoc(docName);
        const parsed = typeof value === "string" ? JSON.parse(value) : value;
        doc.getMap(docName).set(key, parsed);

        // Auto-populate _meta on first write
        await ensureMeta(doc, agentRole, description);
        return `Written to "${docName}": ${key}. All team agents can now see this.`;
      }

      // === WRITE-BLOCK: Insert rich text blocks into a collaborative document ===
      // These appear directly in the BlockNote editor for humans + agents to co-edit
      if (action === "write-block") {
        if (!docName || !value)
          return "docName and value (text content) required for write-block.";

        const doc = await space.openDoc(docName);
        const fragment = doc.getXmlFragment("content");
        const text =
          typeof value === "string" ? value : JSON.stringify(value, null, 2);

        // If key is provided, add it as a heading first
        if (key) {
          insertHeading(fragment, `${key} (by ${agentRole})`, 2);
        }

        // Convert text to BlockNote blocks
        const blockCount = markdownToBlocks(fragment, text);

        // Auto-populate _meta
        await ensureMeta(doc, agentRole, description);
        return `Inserted ${blockCount} blocks into "${docName}" editor. Visible to all connected users in real-time.`;
      }

      // === READ-BLOCK: Read the rich text content from the collaborative editor ===
      if (action === "read-block") {
        if (!docName) return "Provide docName to read from.";

        const doc = await space.openDoc(docName);
        const fragment = doc.getXmlFragment("content");
        const text = xmlFragmentToText(fragment);

        if (!text.trim()) {
          return `Document "${docName}" editor is empty — no rich text content yet.`;
        }

        return text;
      }

      return `Unknown action "${action}". Use: discover, list, read, read-block, write, write-block.`;
    },
    {
      name: "collab",
      description: [
        "Access shared team state — CRDT docs, plans, and output manifests.",
        "Progressive discovery: start with discover, then list, read, or write.",
        "",
        "Actions:",
        "  discover     — browse L2 categories (no docName) or items in a category (docName = crdt|plans|outputs)",
        "  list         — show keys in a CRDT doc, or items in plans/outputs",
        "  read         — get a specific key/item as JSON",
        "  read-block   — read the rich text content from a collaborative document (what humans and agents wrote in the editor)",
        "  write        — set a key/value in a CRDT doc (structured JSON data)",
        "  write-block  — insert rich text into a collaborative document (visible in the shared editor)",
        "               Use markdown: # headings, ## subheadings, - bullets, plain paragraphs",
        '               Use "key" as a section title. Content appears in BlockNote editor for all users.',
      ].join("\n"),
      schema: z.object({
        action: z
          .enum([
            "discover",
            "list",
            "read",
            "read-block",
            "write",
            "write-block",
          ])
          .describe(
            "discover | list | read | read-block | write | write-block",
          ),
        docName: z
          .string()
          .optional()
          .describe(
            "Category (crdt|plans|outputs) for discover, or doc/category name for list/read/write",
          ),
        key: z
          .string()
          .optional()
          .describe("Key (optional for read-all, required for write)"),
        value: z
          .any()
          .optional()
          .describe("Value to write (only for write action)"),
        description: z
          .string()
          .optional()
          .describe(
            "Description of a new custom doc (only for first write to a new doc — helps other agents discover it)",
          ),
      }),
    },
  );
}
