/**
 * BlobStorageProvider — Interface for binary blob storage.
 *
 * Used by HocuspocusBlobStorageAdapter to swap filesystem for cloud storage
 * (S3, Azure Blob, GCS) without changing the CRDT engine.
 *
 * For string-based storage (JSON), see StorageProvider in @ping/agent-manager.
 * This interface handles raw Buffers for Yjs binary state.
 */
export interface BlobStorageProvider {
  read(key: string): Promise<Buffer | null>;
  write(key: string, data: Buffer): Promise<void>;
  delete?(key: string): Promise<void>;
  list?(prefix: string): Promise<string[]>;
}
