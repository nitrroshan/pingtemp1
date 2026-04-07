/**
 * Worker Rules — Hard constraints for worker agents
 */

export interface RuleDef {
  name: string;
  description: string;
}

export const USE_ONLY_AVAILABLE_TOOLS: RuleDef = {
  name: "use-only-available-tools",
  description: "Do NOT invent tools you don't have. Use my_tools to check.",
};

export const NO_FABRICATION: RuleDef = {
  name: "no-fabrication",
  description:
    "Never speculate about file contents you haven't read. " +
    "Always read before answering questions about files.",
};

export const DEFAULT_WORKER_RULES: RuleDef[] = [
  USE_ONLY_AVAILABLE_TOOLS, NO_FABRICATION,
];
