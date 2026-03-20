/**
 * Embedding Service
 * 
 * Generates vector embeddings using existing OAIEmbeddingClient.
 * Uses Azure OpenAI text-embedding-3-small.
 */

import { OAIEmbeddingClient } from "./embeddingClient.js";
import { Logger } from "tslog";

const logger = new Logger({ name: "EmbeddingService" });

/**
 * Get embeddings instance (singleton)
 */
function getEmbeddings() {
  return OAIEmbeddingClient.getInstance();
}

/**
 * Generate embedding for a single text
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const embeddings = getEmbeddings();
    const embedding = await embeddings.embedQuery(text);
    return embedding;
  } catch (error) {
    logger.error("Failed to generate embedding:", error);
    throw new Error(`Embedding generation failed: ${error}`);
  }
}

/**
 * Generate embeddings for multiple texts (batch)
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  try {
    const embeddings = getEmbeddings();
    const results = await embeddings.embedDocuments(texts);
    return results;
  } catch (error) {
    logger.error("Failed to generate batch embeddings:", error);
    throw new Error(`Batch embedding generation failed: ${error}`);
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have same length");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const aVal = a[i]!;
    const bVal = b[i]!;
    dotProduct += aVal * bVal;
    normA += aVal * aVal;
    normB += bVal * bVal;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
