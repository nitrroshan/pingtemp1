import { OAIEmbeddingClient } from "./embeddingClient/oaiembedding";
import { rootLogger } from "./logging.js";
import { EmbeddingsClient } from "./embeddingClient/embeddingClient";
import mongoose from "mongoose";
const embeddingsClient: EmbeddingsClient = OAIEmbeddingClient.getInstance();
const logger = rootLogger.child({ module: "agentRegistry/util" });
/**
 * Generates embeddings for a given text string
 * @param text The text to generate embeddings for
 * @returns Promise<number[]> The embedding vector
 */
export const TryGenerateEmbedding = async (
  text: string
): Promise<{ result: boolean; value: number[] }> => {
  try {
    const [embedding] = await embeddingsClient.embedDocuments([text]);
    if (!embedding || embedding.length === 0) {
      throw new Error("Empty embedding returned");
    }
    return { result: true, value: embedding };
  } catch (error) {
    logger.error({ err: error }, "Error generating embedding");
    return { result: false, value: [] };
  }
};

/**
 * Generates embeddings for multiple texts in one call
 * @param texts Array of texts to generate embeddings for
 * @returns Promise<number[][]> Array of embedding vectors
 */
export const TryGenerateBatchEmbeddings = async (
  texts: string[]
): Promise<{ result: boolean; value: number[][] }> => {
  try {
    const embeddings = await embeddingsClient.embedDocuments(texts);
    if (!embeddings || embeddings.length === 0) {
      throw new Error("Empty embeddings returned");
    }
    return { result: true, value: embeddings };
  } catch (error) {
    logger.error({ err: error }, "Error generating batch embeddings");
    return { result: false, value: [] };
  }
};

const searchAgentsByEmbedding = async (embedding: number[], topK: number) => {
  // Implementation for searching agents by embedding
  // This is a placeholder function and should be implemented as per the database and search requirements
};
