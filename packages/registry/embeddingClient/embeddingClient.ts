export abstract class EmbeddingsClient {
  public static getInstance(): EmbeddingsClient {
    // Implementation here
    throw new Error("Not implemented");
  }
  public async embedDocuments(texts: string[]): Promise<number[][]> {
    // Implementation of embedding logic here
    throw new Error("Method not implemented.");
  }
}
