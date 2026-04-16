/**
 * Worker Rules — Hard constraints for worker agents
 *
 * Data is loaded from rules.xml via PromptLoader.loadDefinitions().
 * This file provides the TypeScript interface and the loaded defaults.
 */

import { PromptLoader } from "../../../orchestrator/PromptLoader.js";

export interface RuleDef {
  name: string;
  description: string;
}

/** All default worker rules loaded from rules.xml */
export const DEFAULT_WORKER_RULES: RuleDef[] =
  PromptLoader.loadDefinitions<RuleDef>(
    "worker",
    "rules.xml",
    "rule",
    (attrs, content) => ({
      name: attrs.name || "",
      description: content,
    }),
  );
