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

/**
 * All system and agent docs now use Y.Map("meta") as the standard data map.
 * Custom agent docs also use "meta" — the "type" field inside distinguishes doc types.
 */
function getDocMap(doc: CollabDocument): Y.Map<any> {
  return doc.getMap("meta");
}

/**
 * Extract clean data from a CRDT doc for full reads.
 * Returns the "meta" map contents directly.
 */
function extractDocData(doc: CollabDocument): any {
  const meta = doc.getMap("meta").toJSON();
  if (meta && Object.keys(meta).length > 0) return meta;

  // Fallback for legacy docs that haven't been migrated yet
  const json = doc.toJSON();
  const { default: _default, ...rest } = json;
  const keys = Object.keys(rest);
  if (keys.length === 1 && keys[0]) return rest[keys[0]!];
  if (keys.length > 1) return rest;
  return json;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COLLAB TOOL — Unified L2 progressive-discovery tool
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Callbacks for collab tool events (wired by WorkerPool → OrchestratorService).
 */
export interface CollabToolCallbacks {
  /** Fired when discuss post mentions other roles — triggers priority worker spawn */
  onMentionedRoles?: (roles: string[], sourceTaskId: string, docName: string, sourceRole?: string, postContent?: string) => void;
}

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
  taskId?: string,
  callbacks?: CollabToolCallbacks,
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
        | "read-block"
        | "discuss";
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

          // Count task docs ({taskId}/task pattern)
          const taskDocs = crdtDocs.filter((d: string) => d.endsWith("/task") && d !== "goal" && d !== "plan");
          // Check if goal exists
          const hasGoal = crdtDocs.includes("goal");

          return [
            "Available L2 team state (use discover with docName to drill in):",
            "",
            `  crdt    — ${crdtDocs.length} real-time docs (${crdtDocs.join(", ") || "none yet"})`,
            `  tasks   — ${taskDocs.length} task documents (CRDT-backed, read-only)`,
            `  goal    — ${hasGoal ? "1 active goal" : "no goal yet"}`,
            `  plans   — ${plans.length} plan files`,
            `  outputs — ${manifests.length} task output manifests`,
            "",
            'Use: collab({ action: "discover", docName: "crdt" | "tasks" | "goal" | "plans" | "outputs" })',
          ].join("\n");
        }

        if (docName === "tasks") {
          const crdtDocs = await space.listDocs();
          const taskDocs = crdtDocs.filter((d: string) => d.endsWith("/task") && d !== "goal" && d !== "plan");
          if (!taskDocs.length) return "No tasks found. Plan has not been approved yet.";

          const summaries: string[] = [];
          for (const docPath of taskDocs) {
            try {
              const doc = await space.openDoc(docPath);
              const map = doc.getMap("task");
              const data = map.toJSON();
              const taskId = docPath.replace("/task", "");
              summaries.push(`  ${data.id || taskId} [${data.status || "?"}] — ${data.title || "untitled"} (${data.assignedRole || "?"})`);
            } catch {
              summaries.push(`  ${docPath} — (failed to read)`);
            }
          }
          return [
            "Tasks (read-only — managed by orchestrator):",
            ...summaries,
            "",
            'Read task details: collab({ action: "read", docName: "{taskId}/task" })',
            'List task docs: collab({ action: "list", docName: "{taskId}" }) — shows discussion, decisions, etc.',
          ].join("\n");
        }

        if (docName === "goal") {
          try {
            const doc = await space.openDoc("goal");
            const map = doc.getMap("goal");
            const data = map.toJSON();
            if (!data.id) return "No goal document found.";
            return [
              "Goal (read-only):",
              `  ${data.id} [${data.status}] — "${data.title}"`,
              `  Submitted by: ${data.submittedBy} · Created: ${data.createdAt}`,
              "",
              'Read full goal: collab({ action: "read", docName: "goal" })',
            ].join("\n");
          } catch {
            return "No goal document found.";
          }
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

        // List all tasks
        if (docName === "tasks") {
          const crdtDocs = await space.listDocs();
          const taskDocs = crdtDocs.filter((d: string) => d.endsWith("/task") && d !== "goal" && d !== "plan");
          if (!taskDocs.length) return "No tasks found.";
          const items: string[] = [];
          for (const docPath of taskDocs) {
            try {
              const doc = await space.openDoc(docPath);
              const data = doc.getMap("task").toJSON();
              items.push(`  - ${data.id} [${data.status}] — ${data.title} (${data.assignedRole})`);
            } catch {
              items.push(`  - ${docPath} (unreadable)`);
            }
          }
          return items.join("\n") || "No tasks.";
        }

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

        // R5-5 FIX: Auto-redirect bare task names to task data doc
        // e.g., "task-1" → "task-1/task" if "task-1/task" exists in CRDT
        if (!docName.includes("/") && /^task-/.test(docName)) {
          const taskDocName = `${docName}/task`;
          const allDocs = await space.listDocs();
          if (allDocs.includes(taskDocName)) {
            docName = taskDocName;
          }
        }

        // STEP 1a: Discussion docs → return discussion blocks, not config map
        if (docName.endsWith("/discussion")) {
          const doc = await space.openDoc(docName);
          const discussion = doc.getArray("discussion");
          const blocks = discussion.toJSON();
          if (!blocks.length) return `"${docName}" has no discussion blocks yet. Use discuss action to post.`;
          const config = doc.getMap("config").toJSON();
          const lines = blocks.map((b: any) =>
            `  - [${b.type || "message"}] **${b.role}** (${b.timestamp}): ${(b.content || "").slice(0, 120)}${b.mentions?.length ? ` @${b.mentions.join(", @")}` : ""}`
          );
          return [
            `Discussion "${docName}" — ${blocks.length} block(s), status: ${config.status || "active"}, tokens: ${config.totalTokensUsed || 0}/${config.maxTokens || 50000}`,
            ...lines,
            "",
            'Use collab({ action: "discuss", key: "read" }) for cursor-based reading.',
          ].join("\n");
        }

        // CRDT doc — list keys with value previews (filter out _meta)
        const doc = await space.openDoc(docName);
        const map = getDocMap(doc);
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

        // R5-5 FIX: Auto-redirect bare task names to task data doc
        if (!docName.includes("/") && /^task-/.test(docName)) {
          const taskDocName = `${docName}/task`;
          const allDocs = await space.listDocs();
          if (allDocs.includes(taskDocName)) {
            docName = taskDocName;
          }
        }

        // R9-5 FIX: Auto-redirect "plans" → "plan" (CRDT doc is singular)
        if (docName === "plans" && !key) {
          docName = "plan";
        }

        // STEP 1b: Discussion docs → return discussion blocks, not config map
        if (docName.endsWith("/discussion")) {
          const doc = await space.openDoc(docName);
          const discussion = doc.getArray("discussion");
          const blocks = discussion.toJSON();
          if (!blocks.length) {
            const config = doc.getMap("config").toJSON();
            return `Discussion "${docName}" — 0 blocks, status: ${config.status || "active"}. Use collab({ action: "discuss", key: "post", ... }) to start.`;
          }
          const decisions = doc.getMap("decisions").toJSON();
          const config = doc.getMap("config").toJSON();
          const formatted = blocks.map((b: any) =>
            `[${b.type || "message"}] ${b.role} (${b.timestamp}): ${b.content}${b.mentions?.length ? ` @${b.mentions.join(", @")}` : ""}`
          ).join("\n\n");
          const decisionCount = Object.keys(decisions).length;
          return [
            `Discussion "${docName}" — ${blocks.length} block(s), ${decisionCount} decision(s), status: ${config.status || "active"}`,
            "",
            formatted,
            decisionCount > 0 ? `\nDecisions: ${JSON.stringify(decisions, null, 2)}` : "",
          ].join("\n");
        }

        // CRDT doc
        const doc = await space.openDoc(docName);
        if (key) {
          if (key === "_meta") return JSON.stringify(doc.getMeta(), null, 2);
          const map = getDocMap(doc);
          // R7-1 FIX: If key is "meta" or matches old type names, return full data
          if (key === "meta" || key === "task" || key === "plan" || key === "goal") {
            return JSON.stringify(map.toJSON(), null, 2);
          }
          const val = map.get(key);
          return val != null
            ? JSON.stringify(val, null, 2)
            : `Key "${key}" not found in "${docName}".`;
        }
        // Full doc read
        const data = extractDocData(doc);
        return JSON.stringify(data, null, 2);
      }

      // === WRITE: CRDT only (plans and outputs are read-only) ===
      if (action === "write") {
        if (!docName || !key)
          return "Both docName and key required for writes.";
        // Fix #5: Comprehensive read-only protection for all system docs
        const isSystemDoc = ["plans", "outputs", "tasks", "goal", "plan", "_index"].includes(docName);
        const isTaskInternalDoc = /\/(task|discussion|decisions|config)$/.test(docName);
        if (isSystemDoc || isTaskInternalDoc) {
          return `"${docName}" is read-only. Use 'discuss' action for discussions, or write to custom CRDT docs.`;
        }

        const doc = await space.openDoc(docName);
        const parsed = typeof value === "string" ? JSON.parse(value) : value;
        const map = doc.getMap("meta");
        // Set type on first write if not already set
        if (!map.get("type")) {
          map.set("type", "custom");
        }
        map.set(key, parsed);

        // Auto-populate _meta on first write
        await ensureMeta(doc, agentRole, description);
        return `Written to "${docName}": ${key}. All team agents can now see this.`;
      }

      // === WRITE-BLOCK: Insert rich text blocks into a collaborative document ===
      // These appear directly in the BlockNote editor for humans + agents to co-edit
      if (action === "write-block") {
        if (!docName || !value)
          return "docName and value (text content) required for write-block.";

        // STEP 2: Block write-block on discussion docs — force agents to use discuss post
        if (docName.endsWith("/discussion")) {
          return `Cannot write-block to discussion docs. Use: collab({ action: "discuss", docName: "${docName}", key: "post", value: { content: "...", mentions: [...] } })`;
        }

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

      // === DISCUSS: Agent discussion protocol using Y.Array + cursor tracking ===
      if (action === "discuss") {
        if (!docName)
          return "Provide docName (e.g., 'task-5' or 'task-5/discussion') for discuss action.";

        // STEP 3: Auto-append /discussion suffix if missing
        if (!docName.endsWith("/discussion")) {
          docName = `${docName}/discussion`;
        }

        const doc = await space.openDoc(docName);

        // Auto-initialize discussion docs if not yet initialized
        // (handles case where discuss is called without prior initCollabDocs)
        const earlyConfigMap = doc.getMap("config");
        if (!earlyConfigMap.has("status")) {
          earlyConfigMap.set("maxRounds", 10);
          earlyConfigMap.set("maxTokens", 50000);
          earlyConfigMap.set("timeoutMinutes", 15);
          earlyConfigMap.set("totalTokensUsed", 0);
          earlyConfigMap.set("roundsPerAgent", {});
          earlyConfigMap.set("mode", "auto");
          earlyConfigMap.set("status", "active");
          earlyConfigMap.set("lastActivity", new Date().toISOString());
        }

        // Operation determined by key parameter:
        // key = "post" → push a new discussion block
        // key = "read" → read new blocks since cursor
        // key = "decide" → record a decision
        // key = undefined → read all blocks
        const op = key || "read";

        if (op === "post") {
          // Push a discussion block to Y.Array
          if (!value) return "Provide value with { content, type?, mentions? } for discuss post.";

          // Check guard rails
          const configMap = doc.getMap("config");
          const config = configMap.toJSON();

          if (config.status === "closed" || config.status === "escalated") {
            return `Discussion is ${config.status}. No new posts allowed.`;
          }

          // BUG-3 FIX: Check-on-access timeout enforcement
          const lastActivity = config.lastActivity ? new Date(config.lastActivity).getTime() : Date.now();
          const timeoutMs = (config.timeoutMinutes || 15) * 60 * 1000;
          if (Date.now() - lastActivity > timeoutMs && config.status === "active") {
            configMap.set("status", "escalated");
            return `Discussion timed out (no activity for ${config.timeoutMinutes || 15}min). Status: escalated. Use request_task to create a formal task instead.`;
          }

          const totalTokens = config.totalTokensUsed || 0;
          const maxTokens = config.maxTokens || 50000;
          if (totalTokens >= maxTokens) {
            // BUG-2 FIX: Actually set status to closed
            configMap.set("status", "closed");
            return `Token limit reached (${totalTokens}/${maxTokens}). Discussion closed.`;
          }

          const roundsPerAgent = config.roundsPerAgent || {};
          const myRounds = roundsPerAgent[agentRole] || 0;
          const maxRounds = config.maxRounds || 10;
          if (myRounds >= maxRounds) {
            return `You have reached the round limit (${myRounds}/${maxRounds}). Cannot post more.`;
          }

          const parsed = typeof value === "string" ? JSON.parse(value) : value;
          const block = {
            id: crypto.randomUUID(),
            role: agentRole,
            timestamp: new Date().toISOString(),
            content: parsed.content || "",
            mentions: parsed.mentions || [],
            replyTo: parsed.replyTo || undefined,
            type: parsed.type || "message",
            tokens: Math.ceil((parsed.content || "").length / 4), // rough estimate
          };

          // Push to discussion array
          const discussion = doc.getArray("discussion");
          discussion.push([block]);

          // Fire mention routing callback — spawns collab workers for mentioned roles
          if (block.mentions.length > 0 && callbacks?.onMentionedRoles && docName) {
            callbacks.onMentionedRoles(block.mentions, taskId || "unknown", docName, agentRole, block.content);
          }

          // Update guard rail counters
          configMap.set("totalTokensUsed", totalTokens + block.tokens);
          configMap.set("roundsPerAgent", {
            ...roundsPerAgent,
            [agentRole]: myRounds + 1,
          });
          configMap.set("lastActivity", block.timestamp);

          // Update cursor
          const cursors = doc.getMap("cursors");
          cursors.set(agentRole, block.timestamp);

          // Warn if approaching token limit
          const newTotal = totalTokens + block.tokens;
          let warning = newTotal > maxTokens * 0.8
            ? ` ⚠️ Token usage at ${Math.round(newTotal / maxTokens * 100)}% — wrap up soon.`
            : "";

          // Phase 4: Check if all participants have posted → transition to all_posted
          const participants = configMap.get("participants") as string[] || [];
          if (participants.length > 0) {
            const allBlocks = discussion.toJSON();
            const posters = new Set(allBlocks.map((b: any) => b.role));
            if (participants.every((p: string) => posters.has(p)) && configMap.get("status") === "active") {
              configMap.set("status", "all_posted");
              warning += " All participants have posted. Record a decision when ready.";
            }
          }

          // Fix 4: Non-blocking mentions — return immediately, agent reads response later
          if (parsed.waitForResponse && block.mentions.length > 0) {
            return [
              `Posted discussion block. ${block.mentions.join(", ")} notified.`,
              `Round ${myRounds + 1}/${maxRounds}, tokens ${newTotal}/${maxTokens}.${warning}`,
              ``,
              `Their response will appear in the discussion.`,
              `Read it with: collab({ action: "discuss", docName: "${docName}", key: "read" })`,
            ].join("\n");
          }

          return `Posted discussion block (${block.type}). Round ${myRounds + 1}/${maxRounds}, tokens ${newTotal}/${maxTokens}.${warning}`;
        }

        if (op === "read") {
          // Read new blocks since cursor
          const cursors = doc.getMap("cursors");
          const myLastRead = cursors.get(agentRole) as string ?? "1970-01-01T00:00:00Z";

          const discussion = doc.getArray("discussion");
          const allBlocks = discussion.toJSON();
          const newBlocks = allBlocks.filter((b: any) => b.timestamp > myLastRead);

          // Update cursor to now
          cursors.set(agentRole, new Date().toISOString());

          if (newBlocks.length === 0) {
            return "No new discussion blocks since your last read.";
          }

          const formatted = newBlocks.map((b: any) =>
            `[${b.type}] ${b.role} (${b.timestamp}): ${b.content}${b.mentions?.length ? ` @${b.mentions.join(", @")}` : ""}`
          ).join("\n\n");

          return `${newBlocks.length} new block(s):\n\n${formatted}`;
        }

        if (op === "decide") {
          // Record a decision with quorum verification
          if (!value) return "Provide value with { key, decision, agreedBy? } for discuss decide.";

          const parsed = typeof value === "string" ? JSON.parse(value) : value;

          // Phase 2: Quorum verification — only roles that posted can be in agreedBy
          const allBlocks = doc.getArray("discussion").toJSON();
          const posterRoles = new Set<string>(allBlocks.map((b: any) => b.role));
          const requested = parsed.agreedBy || [agentRole];
          const verified = requested.filter((r: string) => posterRoles.has(r));
          const missing = requested.filter((r: string) => !posterRoles.has(r));

          if (missing.length > 0) {
            return `Cannot include ${missing.join(", ")} in agreedBy — they haven't posted. ` +
              `Roles that posted: ${[...posterRoles].join(", ")}`;
          }

          const decisions = doc.getMap("decisions");
          decisions.set(parsed.key || "decision", {
            decision: parsed.decision,
            decidedBy: agentRole,
            agreedBy: verified,
            posterCount: posterRoles.size,
            timestamp: new Date().toISOString(),
          });

          // Phase 3: Auto-resolve matching agenda item
          const configMap = doc.getMap("config");
          const agenda = configMap.get("agenda") as any[];
          if (agenda) {
            const updated = agenda.map((item: any) =>
              (item.id === parsed.key || item.text?.toLowerCase().includes((parsed.key || "").toLowerCase()))
                ? { ...item, resolved: true }
                : item
            );
            configMap.set("agenda", updated);
          }

          // Phase 4: Auto-close discussion on decide
          configMap.set("status", "closed");

          return `Decision recorded: "${parsed.decision}" by ${agentRole}. Agreed by: ${verified.join(", ")}. Discussion closed.`;
        }

        return `Unknown discuss operation "${op}". Use key = "post" | "read" | "decide".`;
      }

      return `Unknown action "${action}". Use: discover, list, read, read-block, write, write-block, discuss.`;
    },
    {
      name: "collab",
      description: [
        "Access shared team state — CRDT docs, tasks, goals, plans, and output manifests.",
        "Progressive discovery: start with discover, then list, read, or write.",
        "",
        "Actions:",
        "  discover     — browse L2 categories (no docName) or items in a category (docName = crdt|tasks|goal|plans|outputs)",
        "  list         — show keys in a CRDT doc, tasks, or items in plans/outputs",
        "  read         — get a specific key/item as JSON (read {taskId}/task for task details, read goal for goal)",
        "  read-block   — read the rich text content from a collaborative document (what humans and agents wrote in the editor)",
        "  write        — set a key/value in a CRDT doc (structured JSON data) — tasks/goals/plans are read-only",
        "  write-block  — insert rich text into a collaborative document (visible in the shared editor)",
        "               Use markdown: # headings, ## subheadings, - bullets, plain paragraphs",
        '               Use "key" as a section title. Content appears in BlockNote editor for all users.',
        "  discuss      — discussion protocol with cursor tracking (key = post | read | decide)",
        '               post: push a message block { content, type?, mentions? }',
        '               read: get new blocks since your last read (cursor-based)',
        '               decide: record a decision { key, decision, agreedBy? }',
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
            "discuss",
          ])
          .describe(
            "discover | list | read | read-block | write | write-block | discuss",
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
