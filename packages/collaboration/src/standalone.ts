/**
 * Standalone Collaboration Server
 *
 * Entry point for running the Hocuspocus CRDT server as an independent
 * service in production (COLLAB_MODE=external). Listens on COLLAB_PORT
 * (default 1234) for WebSocket connections from backend and frontend.
 */

import { CollabServer } from "./L2/collaboration/HocuspocusServer.js";

const port = parseInt(process.env.COLLAB_PORT || "1234", 10);
const storageDir = process.env.COLLAB_STORAGE_DIR || "./data/collab";
const workspaceDir = process.env.WORKSPACE_BASE_DIR || "./data/workspaces";

const server = new CollabServer(storageDir, workspaceDir);

async function main() {
  await server.start(port);
  console.log(`Collaboration server running on port ${port}`);
}

// Graceful shutdown
function shutdown() {
  console.log("Shutting down collaboration server...");
  server.stop().then(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

main().catch((err) => {
  console.error("Failed to start collaboration server:", err);
  process.exit(1);
});
