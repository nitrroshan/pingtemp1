/**
 * Frontend feature flags.
 * Controlled via Vite env vars (VITE_* prefix).
 * Backend feature flags are separate (FF_* in packages/backend/.env).
 */

export const FEATURES = {
  /** Route sub-agent messages through persistent ChatAgent instead of transient worker */
  chatAgentChat: import.meta.env.VITE_ENABLE_CHAT_AGENT_CHAT === 'true',
} as const;
