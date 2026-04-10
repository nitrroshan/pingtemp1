/**
 * useFeatureFlags — fetches feature flags from backend on mount.
 */

import { useState, useEffect } from "react";

export interface FrontendFeatureFlags {
  useOrchestrator: boolean;
  plannerMode: string;
  enableCostTracking: boolean;
  enableKnowledgeBase: boolean;
  enableCollabEditor: boolean;
  enableGitPush: boolean;
}

const DEFAULT_FLAGS: FrontendFeatureFlags = {
  useOrchestrator: true,
  plannerMode: "orchestrator",
  enableCostTracking: false,
  enableKnowledgeBase: true,
  enableCollabEditor: true,
  enableGitPush: false,
};

import { API_BASE_URL } from "../constants";

const API_URL = API_BASE_URL;

export function useFeatureFlags(): { flags: FrontendFeatureFlags; loading: boolean } {
  const [flags, setFlags] = useState<FrontendFeatureFlags>(DEFAULT_FLAGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/api/v2/feature-flags`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setFlags({ ...DEFAULT_FLAGS, ...data }))
      .catch(() => {}) // Use defaults on error
      .finally(() => setLoading(false));
  }, []);

  return { flags, loading };
}
