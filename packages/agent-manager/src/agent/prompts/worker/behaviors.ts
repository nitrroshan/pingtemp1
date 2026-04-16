/**
 * Worker Behaviors — Reusable behavior sections for worker agents
 *
 * Data is loaded from behaviors.xml via PromptLoader.loadDefinitions().
 * This file provides the TypeScript interface and the loaded defaults.
 */

import { PromptLoader } from "../../../orchestrator/PromptLoader.js";

export interface BehaviorDef {
  name: string;
  description: string;
}

/** All default worker behaviors loaded from behaviors.xml */
export const DEFAULT_WORKER_BEHAVIORS: BehaviorDef[] =
  PromptLoader.loadDefinitions<BehaviorDef>(
    "worker",
    "behaviors.xml",
    "behavior",
    (attrs, content) => ({
      name: attrs.name || "",
      description: content,
    }),
  );
