/**
 * S3PluginStorage — Reads plugin files from an AWS S3 bucket
 *
 * Expects plugins stored under a prefix like:
 *   s3://my-bucket/plugins/engineering-team/.claude-plugin/plugin.json
 *   s3://my-bucket/plugins/engineering-team/agents/backend-developer.md
 *
 * Requires @aws-sdk/client-s3 as a peer dependency.
 *
 * Usage:
 *   const storage = new S3PluginStorage({
 *     bucket: "my-ping-plugins",
 *     prefix: "plugins/",
 *     region: "us-east-1",
 *   });
 *   const loader = new PluginLoader(storage);
 */

import type { IPluginStorage, DirEntry } from "./IPluginStorage.js";

export interface S3PluginStorageConfig {
  bucket: string;
  prefix?: string;
  region?: string;
}

export class S3PluginStorage implements IPluginStorage {
  private bucket: string;
  private prefix: string;
  private client: any;

  constructor(config: S3PluginStorageConfig) {
    this.bucket = config.bucket;
    this.prefix = config.prefix ?? "";
    // Lazy-load AWS SDK to avoid bundling it when not needed
    this.client = null;
  }

  private async getClient(): Promise<any> {
    if (!this.client) {
      // @ts-ignore -- @aws-sdk/client-s3 is an optional peer dependency
      const { S3Client } = await import("@aws-sdk/client-s3");
      this.client = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
    }
    return this.client;
  }

  private fullKey(relativePath: string): string {
    return `${this.prefix}${relativePath}`.replace(/\/\//g, "/");
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      const client = await this.getClient();
      // @ts-ignore -- @aws-sdk/client-s3 is an optional peer dependency
      const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
      await client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.fullKey(relativePath) }));
      return true;
    } catch {
      return false;
    }
  }

  async readFile(relativePath: string): Promise<string> {
    const client = await this.getClient();
    // @ts-ignore -- @aws-sdk/client-s3 is an optional peer dependency
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const response = await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.fullKey(relativePath) }));
    return await response.Body!.transformToString("utf-8");
  }

  async listDir(relativePath: string): Promise<DirEntry[]> {
    const client = await this.getClient();
    // @ts-ignore -- @aws-sdk/client-s3 is an optional peer dependency
    const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");

    const prefix = this.fullKey(relativePath).replace(/\/?$/, "/");
    const response = await client.send(new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix,
      Delimiter: "/",
    }));

    const entries: DirEntry[] = [];

    // Subdirectories (CommonPrefixes)
    for (const cp of response.CommonPrefixes ?? []) {
      const name = cp.Prefix!.slice(prefix.length).replace(/\/$/, "");
      if (name) entries.push({ name, isDirectory: true });
    }

    // Files (Contents, excluding the prefix itself)
    for (const obj of response.Contents ?? []) {
      const name = obj.Key!.slice(prefix.length);
      if (name && !name.includes("/")) {
        entries.push({ name, isDirectory: false });
      }
    }

    return entries;
  }
}
