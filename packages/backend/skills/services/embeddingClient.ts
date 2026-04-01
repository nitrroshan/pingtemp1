/**
 * Embedding Client
 *
 * Self-contained Azure OpenAI embedding client for the worker module.
 * Singleton pattern ensures only one instance is created.
 */

import { AzureOpenAIEmbeddings } from "@langchain/openai";
import dotenv from "dotenv";

dotenv.config();

/**
 * Abstract base class for embedding clients
 */
export abstract class EmbeddingsClient {
  public static getInstance(): EmbeddingsClient {
    throw new Error("Not implemented");
  }

  public abstract embedDocuments(texts: string[]): Promise<number[][]>;
  public abstract embedQuery(text: string): Promise<number[]>;
}

/**
 * Azure OpenAI Embedding Client
 *
 * Uses text-embedding-3-small model (1536 dimensions).
 *
 * Required environment variables:
 * - AZURE_OPENAI_EMBEDDINGS_ENDPOINT_URL
 * - AZURE_OPENAI_EMBEDDINGS_API_KEY
 * - AZURE_OPENAI_EMBEDDINGS_INSTANCE_NAME
 */
export class OAIEmbeddingClient implements EmbeddingsClient {
  private static _instance: OAIEmbeddingClient;
  private embeddings: AzureOpenAIEmbeddings;

  private constructor() {
    this.embeddings = new AzureOpenAIEmbeddings({
      azureOpenAIEndpoint: process.env.AZURE_OPENAI_EMBEDDINGS_ENDPOINT_URL!,
      azureOpenAIApiKey: process.env.AZURE_OPENAI_EMBEDDINGS_API_KEY!,
      azureOpenAIApiInstanceName:
        process.env.AZURE_OPENAI_EMBEDDINGS_INSTANCE_NAME!,
      azureOpenAIApiDeploymentName: "text-embedding-3-small",
      azureOpenAIApiVersion: "2024-02-01",
    });
  }

  /**
   * Get singleton instance (returns the underlying AzureOpenAIEmbeddings)
   */
  public static getInstance(): AzureOpenAIEmbeddings {
    if (!OAIEmbeddingClient._instance) {
      OAIEmbeddingClient._instance = new OAIEmbeddingClient();
    }
    return OAIEmbeddingClient._instance.embeddings;
  }

  /**
   * Embed multiple documents
   */
  public async embedDocuments(texts: string[]): Promise<number[][]> {
    return this.embeddings.embedDocuments(texts);
  }

  /**
   * Embed a single query
   */
  public async embedQuery(text: string): Promise<number[]> {
    return this.embeddings.embedQuery(text);
  }
}
