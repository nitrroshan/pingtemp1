/**
 * ModelProvider — Unified model creation for AI SDK
 *
 * Creates AI SDK model instances from config.
 * Supports azure-openai, anthropic, and openai providers.
 *
 * Usage:
 *   import { getModel } from './ModelProvider.js';
 *   const model = getModel({ provider: 'azure-openai', deployment: 'gpt-4o-2' });
 */

import { createAzure } from "@ai-sdk/azure";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { ModelConfig } from "../types.js";

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
        "gpt-4o-2";

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
      });

      return azure(deployment);
    }

    case "anthropic": {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error("ANTHROPIC_API_KEY environment variable is required");
      }

      const anthropic = createAnthropic({ apiKey });
      return anthropic(config.model || "claude-sonnet-4-20250514");
    }

    case "openai": {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error("OPENAI_API_KEY environment variable is required");
      }

      const openai = createOpenAI({ apiKey });
      return openai(config.model || "gpt-4o");
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
