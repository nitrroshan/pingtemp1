/**
 * RemoteCollabClient — Connect to a remote Hocuspocus server via WebSocket
 *
 * Use this when the CRDT server runs on a separate process/machine.
 * Agents connect as WebSocket clients instead of using in-process openDirectConnection.
 *
 * Usage:
 *   const client = new RemoteCollabClient("ws://collab-server:1234");
 *   const l2 = new L2CollaborationPlugin({ ..., collabProvider: client });
 */

import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { Logger } from "tslog";
import type { ICollabProvider } from "./types/collab-provider.types.js";

const logger = new Logger({ name: "RemoteCollabClient" });

export class RemoteCollabClient implements ICollabProvider {
  /** Active WebSocket providers by document name */
  private providers = new Map<string, HocuspocusProvider>();

  /** Known document names (discovered via server or manual tracking) */
  private knownDocs = new Set<string>();

  constructor(
    /** WebSocket URL of the remote Hocuspocus server (e.g., "ws://collab-server:1234") */
    private serverUrl: string,
    /** Authentication token (optional, passed to onAuthenticate on the server) */
    private token?: string,
  ) {
    logger.info(`RemoteCollabClient targeting: ${serverUrl}`);
  }

  /**
   * Open a Yjs document via WebSocket connection to the remote server.
   * Creates a HocuspocusProvider per document (lazy, cached).
   */
  async openDoc(docName: string): Promise<Y.Doc> {
    // Reuse existing provider if already connected
    const existing = this.providers.get(docName);
    if (existing) {
      return existing.document;
    }

    // Create a new WebSocket provider for this document
    const provider = new HocuspocusProvider({
      url: this.serverUrl,
      name: docName,
      token: this.token,
    });

    // Wait for the provider to sync with the server
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout connecting to doc: ${docName}`));
      }, 10000);

      if (provider.isSynced) {
        clearTimeout(timeout);
        resolve();
      } else {
        provider.on("synced", () => {
          clearTimeout(timeout);
          resolve();
        });
      }
    });

    this.providers.set(docName, provider);
    this.knownDocs.add(docName);
    logger.debug(`Connected to remote doc: ${docName}`);

    return provider.document;
  }

  /**
   * List known document names.
   * Note: Remote clients can only list docs they've opened or been told about.
   * For full discovery, the server should expose an API endpoint.
   */
  async getDocNames(): Promise<string[]> {
    return Array.from(this.knownDocs);
  }

  /**
   * Register document names for discovery (e.g., from a server API call).
   * Since WebSocket providers don't support listing, this allows external
   * seeding of the known docs set.
   */
  registerDocNames(names: string[]): void {
    for (const name of names) {
      this.knownDocs.add(name);
    }
  }

  /**
   * Disconnect a specific document's WebSocket provider.
   */
  disconnectDoc(docName: string): void {
    const provider = this.providers.get(docName);
    if (provider) {
      provider.destroy();
      this.providers.delete(docName);
      logger.debug(`Disconnected from remote doc: ${docName}`);
    }
  }

  /**
   * Disconnect all WebSocket providers (cleanup).
   */
  disconnectAll(): void {
    for (const [name, provider] of this.providers) {
      provider.destroy();
      logger.debug(`Disconnected from remote doc: ${name}`);
    }
    this.providers.clear();
  }
}
