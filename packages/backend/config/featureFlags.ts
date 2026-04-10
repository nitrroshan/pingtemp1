/**
 * Typed feature flag system.
 *
 * All flags have dev and prod defaults. Individual flags can be overridden
 * via FF_* environment variables (e.g. FF_ENABLE_COST_TRACKING=true).
 *
 * FRONTEND_FLAG_KEYS lists which flags are safe to expose to the browser.
 */

export interface FeatureFlags {
  /** Enable orchestrator-based planning (vs direct agent chat) */
  useOrchestrator: boolean;
  /** Enable V2 API routes */
  useApiV2: boolean;
  /** Planner mode: "orchestrator" | "direct" */
  plannerMode: string;
  /** Enable cost tracking for LLM calls */
  enableCostTracking: boolean;
  /** Enable knowledge base features */
  enableKnowledgeBase: boolean;
  /** Enable collaborative editing UI */
  enableCollabEditor: boolean;
  /** Enable workspace git push */
  enableGitPush: boolean;
}

/** Default flags — used in development */
export const DEV_DEFAULTS: FeatureFlags = {
  useOrchestrator: true,
  useApiV2: true,
  plannerMode: "orchestrator",
  enableCostTracking: false,
  enableKnowledgeBase: true,
  enableCollabEditor: true,
  enableGitPush: false,
};

/** Production defaults — conservative, experimental features off */
export const PROD_DEFAULTS: FeatureFlags = {
  useOrchestrator: true,
  useApiV2: true,
  plannerMode: "orchestrator",
  enableCostTracking: false,
  enableKnowledgeBase: true,
  enableCollabEditor: false,
  enableGitPush: false,
};

/** Flags safe to expose to the frontend via API */
export const FRONTEND_FLAG_KEYS: (keyof FeatureFlags)[] = [
  "useOrchestrator",
  "plannerMode",
  "enableCostTracking",
  "enableKnowledgeBase",
  "enableCollabEditor",
  "enableGitPush",
];

/**
 * Env var mapping: FF_<UPPER_SNAKE> → FeatureFlags key.
 * Values: "true"/"false" for booleans, string for strings.
 */
export const FF_ENV_MAP: Record<string, keyof FeatureFlags> = {
  FF_USE_ORCHESTRATOR: "useOrchestrator",
  FF_USE_API_V2: "useApiV2",
  FF_PLANNER_MODE: "plannerMode",
  FF_ENABLE_COST_TRACKING: "enableCostTracking",
  FF_ENABLE_KNOWLEDGE_BASE: "enableKnowledgeBase",
  FF_ENABLE_COLLAB_EDITOR: "enableCollabEditor",
  FF_ENABLE_GIT_PUSH: "enableGitPush",
};
