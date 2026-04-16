/**
 * Worker Capabilities — Reusable prompt sections for worker agents
 *
 * Data is loaded from capabilities.xml via PromptLoader.loadDefinitions().
 * This file provides the TypeScript interface and the loaded defaults.
 */

import { PromptLoader } from "../../../orchestrator/PromptLoader.js";

export interface CapabilityDef {
  name: string;
  description: string;
  tools: string[];
}

/** All default worker capabilities loaded from capabilities.xml */
export const DEFAULT_WORKER_CAPABILITIES: CapabilityDef[] =
  PromptLoader.loadDefinitions<CapabilityDef>(
    "worker",
    "capabilities.xml",
    "capability",
    (attrs, content) => ({
      name: attrs.name || "",
      description: content,
      tools: (attrs.tools || "").split(",").map((t) => t.trim()).filter(Boolean),
    }),
  );
