/**
 * Agent Converter — Converts parsed agent .md to AgentDefinition
 *
 * Maps YAML frontmatter fields + markdown body to the AgentDefinition
 * interface consumed by AgentFactory and WorkerPool.
 */

import type { ParsedDefinition } from "../parser/frontmatterParser.js";

// Re-declare the subset of types we need to avoid cross-package imports at the type level.
// These match packages/agent-manager/src/agent/types.ts exactly.

export type AgentType = "internal" | "external" | "agentic-ui";

export interface ModelConfig {
  provider:
    | "anthropic"
    | "openai"
    | "azure-openai"
    | "ollama"
    | "google"
    | "groq"
    | "mistral"
    | "deepseek"
    | "xai"
    | "openai-compatible";
  model?: string;
  deployment?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ToolConfig {
  name: string;
  type: "builtin" | "mcp" | "custom";
  config?: Record<string, any>;
}

export interface InternalConfig {
  model: ModelConfig;
  tools?: ToolConfig[];
  skills?: string[];
  memory?: { shortTerm?: boolean; checkpoint?: boolean; longTerm?: boolean };
  responseFormat?: string;
  maxSteps?: number;
  maxTotalTokens?: number;
  thinking?: { enabled: boolean; budgetTokens?: number; reasoningEffort?: "low" | "medium" | "high" };
}

export interface ExternalConfig {
  endpoint: string;
  healthEndpoint?: string;
  auth?: { type: "bearer" | "api-key" | "none"; token?: string; tokenEnvVar?: string };
  healthCheck?: { intervalMs: number; maxMissedChecks: number };
  retries?: number;
}

export interface AgentDefinition {
  id: string;
  name: string;
  role: string;
  description?: string;
  type: AgentType;
  goal: string;
  systemPrompt?: string;
  config: InternalConfig | ExternalConfig;
  settings?: { streaming?: boolean; timeout?: number; retries?: number };
}

// ── Model alias resolution ──

const MODEL_ALIASES: Record<string, ModelConfig> = {
  sonnet:  { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  opus:    { provider: "anthropic", model: "claude-opus-4-20250514" },
  haiku:   { provider: "anthropic", model: "claude-haiku-4-20250414" },
  "gpt-4o": { provider: "azure-openai", deployment: "gpt-4o-2" },
  o3:      { provider: "azure-openai", deployment: "o3" },
  inherit: { provider: "azure-openai" },
};

function resolveModelConfig(model: unknown): ModelConfig {
  if (typeof model === "string") {
    return MODEL_ALIASES[model] ?? { provider: "azure-openai" };
  }
  if (typeof model === "object" && model !== null) {
    const m = model as Record<string, any>;
    return {
      provider: m.provider ?? "azure-openai",
      model: m.model,
      deployment: m.deployment,
      baseUrl: m.baseUrl,
      temperature: m.temperature,
      maxTokens: m.maxTokens,
    };
  }
  return { provider: "azure-openai" };
}

// ── Config builders ──

function buildInternalConfig(fm: Record<string, any>): InternalConfig {
  const config: InternalConfig = {
    model: resolveModelConfig(fm.model),
    tools: (fm.tools ?? []).map((t: string | ToolConfig) =>
      typeof t === "string" ? { name: t, type: "builtin" as const } : t,
    ),
    skills: fm.defaultSkills ?? fm.skills ?? [],
    maxSteps: fm.maxTurns ?? fm.maxSteps ?? 0,
    maxTotalTokens: fm.maxTotalTokens ?? 500_000,
  };

  if (fm.memory) {
    config.memory = {
      shortTerm: true,
      checkpoint: fm.memory === "project" || fm.memory === "user",
      longTerm: fm.memory === "user",
    };
  }

  if (fm.thinking) {
    config.thinking = fm.thinking;
  } else if (fm.effort) {
    config.thinking = { enabled: true, reasoningEffort: fm.effort };
  }

  if (fm.responseFormat) {
    config.responseFormat = fm.responseFormat;
  }

  return config;
}

function buildExternalConfig(fm: Record<string, any>): ExternalConfig {
  return {
    endpoint: fm.endpoint ?? "",
    healthEndpoint: fm.healthEndpoint,
    auth: fm.auth
      ? {
          type: fm.auth.type ?? "bearer",
          token: fm.auth.token,
          tokenEnvVar: fm.auth.tokenEnvVar,
        }
      : undefined,
    healthCheck: {
      intervalMs: fm.healthCheckInterval ?? 30_000,
      maxMissedChecks: fm.maxMissedChecks ?? 3,
    },
    retries: fm.retries ?? 3,
  };
}

// ── Main converter ──

/**
 * Convert a parsed agent .md file into an AgentDefinition.
 *
 * Required XML tags in body: <agent-identity>, <domain-instructions>, <domain-constraints>
 */
export function agentMdToDefinition(parsed: ParsedDefinition): AgentDefinition {
  const fm = parsed.frontmatter;
  const body = parsed.body;

  // Validate required XML tags
  const requiredTags = ["agent-identity", "domain-instructions", "domain-constraints"];
  for (const tag of requiredTags) {
    if (!body.includes(`<${tag}>`) || !body.includes(`</${tag}>`)) {
      throw new Error(`Agent ${fm.name}: missing required <${tag}> tag in system prompt`);
    }
  }

  const agentType: AgentType = fm.type ?? "internal";

  const config =
    agentType === "external"
      ? buildExternalConfig(fm)
      : buildInternalConfig(fm);

  return {
    id: fm.name,
    name: fm.name,
    role: fm.role,
    description: fm.description,
    type: agentType,
    goal: fm.description ?? "",
    systemPrompt: body,
    config,
    settings: {
      streaming: true,
      timeout: fm.timeout ?? 300_000,
      retries: fm.retries ?? 3,
    },
  };
}
