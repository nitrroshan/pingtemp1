/**
 * CollaborativeEditor — BlockNote rich text editor with real-time CRDT collaboration
 *
 * Uses Hocuspocus WebSocket provider to sync Y.XmlFragment('content')
 * with the backend CollabServer. Multiple users (human + agents) can
 * co-edit the same document simultaneously.
 *
 * Convention: Documents prefixed with "doc-" are BlockNote collaborative editors.
 *
 * @see feature_implementation_planning.md Phase 3
 */

import { useEffect, useState, useRef } from "react";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface CollaborativeEditorProps {
  /** Full document ID, e.g., "team-1/goal-1/doc-requirements" */
  docId: string;
  /** Display name for this user/agent */
  userName: string;
  /** Cursor/highlight color (CSS color string) */
  userColor?: string;
  /** Hocuspocus server URL (default: ws://localhost:1234) */
  serverUrl?: string;
  /** Auth token (optional, passed to onAuthenticate) */
  token?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRESENCE BAR
// ═══════════════════════════════════════════════════════════════════════════════

interface AwarenessUser {
  name: string;
  color: string;
}

function PresenceBar({ provider }: { provider: HocuspocusProvider }) {
  const [users, setUsers] = useState<AwarenessUser[]>([]);

  useEffect(() => {
    const update = () => {
      const states = provider.awareness?.getStates();
      if (states) {
        const userList: AwarenessUser[] = [];
        states.forEach((state) => {
          if (state.user?.name) {
            userList.push({
              name: state.user.name,
              color: state.user.color || "#888",
            });
          }
        });
        setUsers(userList);
      }
    };

    provider.awareness?.on("change", update);
    update(); // initial

    return () => {
      provider.awareness?.off("change", update);
    };
  }, [provider]);

  if (users.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        padding: "4px 8px",
        fontSize: "12px",
        color: "#666",
        borderBottom: "1px solid #eee",
      }}
    >
      <span>Editing:</span>
      {users.map((u, i) => (
        <span
          key={i}
          style={{
            color: u.color,
            fontWeight: 500,
          }}
        >
          {u.name}
        </span>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// COLLABORATIVE EDITOR
// ═══════════════════════════════════════════════════════════════════════════════

export function CollaborativeEditor({
  docId,
  userName,
  userColor = "#3b82f6",
  serverUrl = "ws://localhost:1234",
  token,
}: CollaborativeEditorProps) {
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const providerRef = useRef<HocuspocusProvider | null>(null);

  // Create provider once, destroy on unmount/docId change
  useEffect(() => {
    setStatus("connecting");

    const p = new HocuspocusProvider({
      url: serverUrl,
      name: docId,
      token: token || undefined,
      onStatus: ({ status: s }) => {
        if (s === "connected") {
          setStatus("connected");
        }
      },
    });

    providerRef.current = p;
    setProvider(p);

    // Timeout
    const timeout = setTimeout(() => {
      setStatus((prev) =>
        prev === "connecting" ? "error" : prev,
      );
    }, 8000);

    return () => {
      clearTimeout(timeout);
      p.destroy();
      providerRef.current = null;
    };
  }, [docId, serverUrl, token]);

  if (status === "error") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "12px", color: "#64748b", padding: "40px" }}>
        <div style={{ fontSize: "48px" }}>🔌</div>
        <div style={{ fontSize: "16px", fontWeight: 600, color: "#ef4444" }}>Cannot connect to CRDT server</div>
        <div style={{ fontSize: "13px", textAlign: "center", maxWidth: "400px", lineHeight: 1.6 }}>
          Connection timeout. Ensure backend is running with COLLAB_PORT=1234
        </div>
        <div style={{ fontSize: "12px", background: "#1e293b", padding: "12px 16px", borderRadius: "6px", fontFamily: "monospace", color: "#94a3b8" }}>
          1. Add <strong>COLLAB_PORT=1234</strong> to your .env<br />
          2. Restart the backend: <strong>yarn start:api</strong><br />
          3. Reload this page
        </div>
      </div>
    );
  }

  if (!provider || status === "connecting") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#64748b" }}>
        Connecting to {serverUrl}...
      </div>
    );
  }

  return <ConnectedEditor provider={provider} userName={userName} userColor={userColor} docName={docId} />;
}

function ConnectedEditor({ provider, userName, userColor, docName }: { provider: HocuspocusProvider; userName: string; userColor: string; docName: string }) {
  const [mapData, setMapData] = useState<Record<string, any>>({});

  const editor = useCreateBlockNote({
    collaboration: {
      provider,
      fragment: provider.document.getXmlFragment("content"),
      user: { name: userName, color: userColor },
    },
  });

  // Watch Y.Map data written by agents via the collab tool
  useEffect(() => {
    const doc = provider.document;
    // The agent writes to Y.Map(shortDocName) where shortDocName is "agent-statuses", "crdt", etc.
    // We need to explicitly getMap() to make Yjs aware of it — doc.share only has types that were accessed
    const shortName = docName.split("/").pop() || docName;

    const updateMapData = () => {
      const data: Record<string, any> = {};

      // Explicitly access the Y.Map the agent wrote to
      const agentMap = doc.getMap(shortName);
      if (agentMap.size > 0) {
        const mapJson = agentMap.toJSON();
        // Filter out internal keys
        const { _meta, ...rest } = mapJson;
        if (Object.keys(rest).length > 0) {
          data[shortName] = rest;
        }
        if (_meta) {
          data["_meta"] = _meta;
        }
      }

      // Also check any other shared types
      doc.share.forEach((type, key) => {
        if (key === "content" || key === shortName) return;
        try {
          const json = type.toJSON();
          if (json && Object.keys(json).length > 0) {
            data[key] = json;
          }
        } catch {}
      });

      setMapData(data);
    };

    // Listen for Yjs updates (real-time changes)
    doc.on("update", updateMapData);
    // Listen for initial sync completion from Hocuspocus
    provider.on("synced", updateMapData);
    // Poll periodically in case events are missed
    const poll = setInterval(updateMapData, 2000);
    // Initial check
    updateMapData();

    return () => {
      doc.off("update", updateMapData);
      provider.off("synced", updateMapData);
      clearInterval(poll);
    };
  }, [provider]);

  const hasMapData = Object.keys(mapData).length > 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <PresenceBar provider={provider} />
      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        <BlockNoteView editor={editor} />
      </div>
      <div style={{
        borderTop: "1px solid #e5e7eb",
        padding: "8px 12px",
        background: "#f8fafc",
        maxHeight: "200px",
        overflow: "auto",
        fontSize: "11px",
        fontFamily: "monospace",
        flexShrink: 0,
        }}>
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 600, color: "#475569", fontSize: "11px" }}>
              Agent Data (Y.Map) {hasMapData ? `— ${Object.keys(mapData).length} keys` : ""}
            </summary>
            <pre style={{ margin: "4px 0 0", whiteSpace: "pre-wrap", color: "#334155" }}>
              {hasMapData ? JSON.stringify(mapData, null, 2) : "(no structured data)"}
            </pre>
          </details>
        </div>
    </div>
  );
}

export default CollaborativeEditor;
