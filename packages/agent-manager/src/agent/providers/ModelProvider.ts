/**
 * ModelProvider — Unified model creation for AI SDK
 *
 * Creates AI SDK model instances from config.
 * Supports: azure-openai, anthropic, openai, ollama, google, groq,
 *           mistral, deepseek, xai, openai-compatible.
 *
 * Providers that expose an OpenAI-compatible API (ollama, groq, deepseek,
 * xai, openai-compatible) are handled via @ai-sdk/openai with a custom baseURL.
 * This avoids extra dependencies — only @ai-sdk/openai is needed.
 *
 * Usage:
 *   import { getModel } from './ModelProvider.js';
 *   const model = getModel({ provider: 'ollama', model: 'llama3.1' });
 */

import { createAzure } from "@ai-sdk/azure";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { ModelConfig } from "../types.js";

/** Default models per provider */
const PROVIDER_DEFAULTS = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
  "azure-openai": "gpt-4o-2",
  ollama: "llama3.1",
  google: "gemini-2.5-flash",
  groq: "llama-3.3-70b-versatile",
  mistral: "mistral-large-latest",
  deepseek: "deepseek-chat",
  xai: "grok-3",
} as const;

/**
 * Create an AI SDK model instance from a ModelConfig.
 */
export function getModel(config: ModelConfig): any {
  switch (config.provider) {
    case "azure-openai": {
      const endpoint = process.env.AZURE_OPENAI_ENDPOINT_URL;
      const apiKey = process.env.AZURE_OPENAI_API_KEY;
      const deployment =
        config.deployment ||
        process.env.AZURE_OPENAI_DEPLOYMENT ||
        process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME ||
        PROVIDER_DEFAULTS["azure-openai"];

      if (!endpoint) {
        throw new Error(
          "AZURE_OPENAI_ENDPOINT_URL environment variable is required",
        );
      }
      if (!apiKey) {
        throw new Error(
          "AZURE_OPENAI_API_KEY environment variable is required",
        );
      }

      const azure = createAzure({
        resourceName: extractResourceName(endpoint!),
        apiKey: apiKey!,
        apiVersion: "2025-01-01-preview",
        // Azure OpenAI requires deployment-based URLs:
        // /openai/deployments/{model}/chat/completions
        // Without this flag, the SDK uses /openai/v1/chat/completions which Azure rejects.
        useDeploymentBasedUrls: true,
      });

      // azure(deployment) defaults to Responses API (/responses) which Azure doesn't support.
      // azure.chat(deployment) explicitly uses Chat Completions (/chat/completions).
      return azure.chat(deployment);
    }

    case "anthropic": {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error("ANTHROPIC_API_KEY environment variable is required");
      }

      const anthropic = createAnthropic({ apiKey });
      return anthropic(config.model || PROVIDER_DEFAULTS.anthropic);
    }

    case "openai": {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error("OPENAI_API_KEY environment variable is required");
      }

      const openai = createOpenAI({ apiKey });
      return openai(config.model || PROVIDER_DEFAULTS.openai);
    }

    // ─── OpenAI-compatible providers ──────────────────────────────────
    // These all expose /v1/chat/completions. We use @ai-sdk/openai with
    // a custom baseURL — no extra SDK packages needed.

    case "ollama": {
      const baseUrl = config.baseUrl || process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
      // Ollama doesn't require an API key
      const ollama = createOpenAI({
        baseURL: baseUrl,
        apiKey: "ollama", // Ollama ignores this but the SDK requires it
      });
      return ollama(config.model || PROVIDER_DEFAULTS.ollama);
    }

    case "groq": {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        throw new Error("GROQ_API_KEY environment variable is required");
      }
      const groq = createOpenAI({
        baseURL: config.baseUrl || "https://api.groq.com/openai/v1",
        apiKey,
      });
      return groq(config.model || PROVIDER_DEFAULTS.groq);
    }

    case "deepseek": {
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) {
        throw new Error("DEEPSEEK_API_KEY environment variable is required");
      }
      const deepseek = createOpenAI({
        baseURL: config.baseUrl || "https://api.deepseek.com/v1",
        apiKey,
      });
      return deepseek(config.model || PROVIDER_DEFAULTS.deepseek);
    }

    case "xai": {
      const apiKey = process.env.XAI_API_KEY;
      if (!apiKey) {
        throw new Error("XAI_API_KEY environment variable is required");
      }
      const xai = createOpenAI({
        baseURL: config.baseUrl || "https://api.x.ai/v1",
        apiKey,
      });
      return xai(config.model || PROVIDER_DEFAULTS.xai);
    }

    case "mistral": {
      const apiKey = process.env.MISTRAL_API_KEY;
      if (!apiKey) {
        throw new Error("MISTRAL_API_KEY environment variable is required");
      }
      // Mistral also exposes an OpenAI-compatible endpoint
      const mistral = createOpenAI({
        baseURL: config.baseUrl || "https://api.mistral.ai/v1",
        apiKey,
      });
      return mistral(config.model || PROVIDER_DEFAULTS.mistral);
    }

    case "google": {
      // Google Gemini uses OpenAI-compatible endpoint via AI Studio
      const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      if (!apiKey) {
        throw new Error("GOOGLE_GENERATIVE_AI_API_KEY environment variable is required");
      }
      const google = createOpenAI({
        baseURL: config.baseUrl || "https://generativelanguage.googleapis.com/v1beta/openai",
        apiKey,
      });
      return google(config.model || PROVIDER_DEFAULTS.google);
    }

    case "openai-compatible": {
      // Generic OpenAI-compatible endpoint (LM Studio, vLLM, text-generation-inference, etc.)
      const baseUrl = config.baseUrl || process.env.OPENAI_COMPATIBLE_BASE_URL;
      if (!baseUrl) {
        throw new Error("baseUrl or OPENAI_COMPATIBLE_BASE_URL is required for openai-compatible provider");
      }
      const compatible = createOpenAI({
        baseURL: baseUrl,
        apiKey: process.env.OPENAI_COMPATIBLE_API_KEY || "none",
      });
      return compatible(config.model || "default");
    }

    default:
      throw new Error(`Unsupported model provider: ${config.provider}`);
  }
}

/**
 * Extract Azure resource name from endpoint URL.
 * e.g. "https://my-resource.openai.azure.com" → "my-resource"
 */
function extractResourceName(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    const hostname = url.hostname; // "my-resource.openai.azure.com"
    return hostname.split(".")[0] ?? hostname;
  } catch {
    // Fallback: strip protocol and take first segment
    return endpoint.replace(/^https?:\/\//, "").split(".")[0] ?? endpoint;
  }
}
