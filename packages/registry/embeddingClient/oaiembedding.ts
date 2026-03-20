import { EmbeddingsClient } from "./embeddingClient";
import { AzureOpenAIEmbeddings } from "@langchain/openai";
import dotenv from "dotenv";
dotenv.config();
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

  public static getInstance(): AzureOpenAIEmbeddings {
    if (!OAIEmbeddingClient._instance) {
      OAIEmbeddingClient._instance = new OAIEmbeddingClient();
    }
    return OAIEmbeddingClient._instance.embeddings;
  }

  public async embedDocuments(texts: string[]): Promise<number[][]> {
    if (!this.embeddings) {
      throw new Error("Embeddings instance not initialized");
    }
    return this.embeddings.embedDocuments(texts);
  }
}
