/**
 * AzureBlobPluginStorage — Reads plugin files from Azure Blob Storage
 *
 * Expects plugins stored under a container + prefix like:
 *   https://myaccount.blob.core.windows.net/plugins/engineering-team/agents/backend-developer.md
 *
 * Requires @azure/storage-blob as a peer dependency.
 *
 * Usage:
 *   const storage = new AzureBlobPluginStorage({
 *     connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING!,
 *     containerName: "plugins",
 *   });
 *   const loader = new PluginLoader(storage);
 */

import type { IPluginStorage, DirEntry } from "./IPluginStorage.js";

export interface AzureBlobPluginStorageConfig {
  connectionString: string;
  containerName: string;
  prefix?: string;
}

export class AzureBlobPluginStorage implements IPluginStorage {
  private connectionString: string;
  private containerName: string;
  private prefix: string;
  private containerClient: any;

  constructor(config: AzureBlobPluginStorageConfig) {
    this.connectionString = config.connectionString;
    this.containerName = config.containerName;
    this.prefix = config.prefix ?? "";
    this.containerClient = null;
  }

  private async getContainerClient(): Promise<any> {
    if (!this.containerClient) {
      // @ts-ignore -- @azure/storage-blob is an optional peer dependency
      const { BlobServiceClient } = await import("@azure/storage-blob");
      const blobService = BlobServiceClient.fromConnectionString(this.connectionString);
      this.containerClient = blobService.getContainerClient(this.containerName);
    }
    return this.containerClient;
  }

  private fullPath(relativePath: string): string {
    return `${this.prefix}${relativePath}`.replace(/\/\//g, "/");
  }

  async exists(relativePath: string): Promise<boolean> {
    const container = await this.getContainerClient();
    const blob = container.getBlobClient(this.fullPath(relativePath));
    return await blob.exists();
  }

  async readFile(relativePath: string): Promise<string> {
    const container = await this.getContainerClient();
    const blob = container.getBlobClient(this.fullPath(relativePath));
    const buf = await blob.downloadToBuffer();
    return buf.toString("utf-8");
  }

  async listDir(relativePath: string): Promise<DirEntry[]> {
    const container = await this.getContainerClient();
    const prefix = this.fullPath(relativePath).replace(/\/?$/, "/");

    const entries: DirEntry[] = [];
    const seen = new Set<string>();

    for await (const item of container.listBlobsByHierarchy("/", { prefix })) {
      if (item.kind === "prefix") {
        // Virtual directory
        const name = item.name.slice(prefix.length).replace(/\/$/, "");
        if (name && !seen.has(name)) {
          seen.add(name);
          entries.push({ name, isDirectory: true });
        }
      } else {
        // Blob
        const name = item.name.slice(prefix.length);
        if (name && !name.includes("/") && !seen.has(name)) {
          seen.add(name);
          entries.push({ name, isDirectory: false });
        }
      }
    }

    return entries;
  }
}
