/**
 * AzureBlobStorageProvider — Azure Blob Storage implementation of AppStateStorage.
 *
 * Stores files as blobs in an Azure Blob container.
 * Configure via AZURE_STORAGE_CONNECTION_STRING + AZURE_STORAGE_CONTAINER env vars.
 */

import {
  BlobServiceClient,
  ContainerClient,
} from "@azure/storage-blob";
import type { AppStateStorage } from "./AppStateStorage.js";

export class AzureBlobStorageProvider implements AppStateStorage {
  private container: ContainerClient;

  constructor(connectionString: string, containerName: string) {
    const blobService = BlobServiceClient.fromConnectionString(connectionString);
    this.container = blobService.getContainerClient(containerName);
  }

  /** Ensure the container exists (call once at startup) */
  async init(): Promise<void> {
    await this.container.createIfNotExists();
  }

  async read(filePath: string): Promise<string | null> {
    try {
      const blob = this.container.getBlockBlobClient(filePath);
      const response = await blob.download(0);
      const body = response.readableStreamBody;
      if (!body) return null;
      const chunks: Buffer[] = [];
      for await (const chunk of body) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks).toString("utf8");
    } catch (err: any) {
      if (err.statusCode === 404) return null;
      throw err;
    }
  }

  async write(filePath: string, data: string): Promise<void> {
    const blob = this.container.getBlockBlobClient(filePath);
    await blob.upload(data, Buffer.byteLength(data), {
      blobHTTPHeaders: { blobContentType: "application/json" },
    });
  }

  async delete(filePath: string): Promise<void> {
    try {
      const blob = this.container.getBlockBlobClient(filePath);
      await blob.deleteIfExists();
    } catch {
      // No-op
    }
  }

  async list(prefix: string): Promise<string[]> {
    const results: string[] = [];
    const iter = this.container.listBlobsFlat({ prefix });
    for await (const blob of iter) {
      results.push(blob.name);
    }
    return results;
  }

  async exists(filePath: string): Promise<boolean> {
    const blob = this.container.getBlockBlobClient(filePath);
    return blob.exists();
  }
}
