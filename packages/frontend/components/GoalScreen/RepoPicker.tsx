/**
 * RepoPicker — GitHub repo browser dropdown.
 *
 * Fetches user's repos from /api/v2/github/repos and displays a searchable dropdown.
 * Sets repoUrl + repoBranch on selection.
 * Falls back to manual URL input if GitHub is not linked.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { API_BASE_URL } from "../../constants";

interface GitHubRepo {
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  cloneUrl: string;
  description: string | null;
  stargazersCount: number;
}

interface RepoPickerProps {
  value: string;            // Current repoUrl
  branch: string;           // Current branch
  onChange: (repoUrl: string, branch: string) => void;
  style?: React.CSSProperties;
}

export function RepoPicker({ value, branch, onChange, style }: RepoPickerProps) {
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [githubLinked, setGithubLinked] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Check if GitHub is linked (non-blocking — defaults to manual mode)
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/v2/github/user`, { credentials: "include" })
      .then(res => {
        if (!res.ok) return { linked: false };
        return res.json();
      })
      .then(data => {
        setGithubLinked(data.linked !== false && !!data.login);
      })
      .catch(() => setGithubLinked(false));
  }, []);

  // Fetch repos when dropdown opens
  const fetchRepos = useCallback(async () => {
    if (repos.length > 0) return; // Already loaded
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v2/github/repos?per_page=100&sort=updated`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setRepos(data.repos || []);
      }
    } catch {
      // Failed to fetch — user can switch to manual mode
    } finally {
      setLoading(false);
    }
  }, [repos.length]);

  // Close dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = repos.filter(r =>
    r.fullName.toLowerCase().includes(search.toLowerCase()),
  );

  const handleSelect = (repo: GitHubRepo) => {
    onChange(repo.cloneUrl, repo.defaultBranch);
    setIsOpen(false);
    setSearch("");
  };

  // Extract short display from URL
  const displayValue = value
    ? value.replace("https://github.com/", "").replace(".git", "")
    : "";

  // Manual URL input mode (no GitHub linked, or user prefers manual)
  if (!githubLinked || manualMode) {
    return (
      <div className="flex items-center gap-2" style={style}>
        <input
          type="url"
          placeholder="https://github.com/org/repo.git"
          value={value}
          onChange={(e) => onChange(e.target.value, branch || "main")}
          className="flex-1 px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <input
          type="text"
          placeholder="main"
          value={branch}
          onChange={(e) => onChange(value, e.target.value)}
          onBlur={(e) => { if (!e.target.value.trim()) onChange(value, "main"); }}
          className="w-20 px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        {githubLinked && (
          <button
            type="button"
            onClick={() => setManualMode(false)}
            className="text-xs text-primary hover:text-primary/80 cursor-pointer"
          >
            Browse
          </button>
        )}
      </div>
    );
  }

  // GitHub repo browser mode
  return (
    <div ref={dropdownRef} style={{ position: "relative", ...style }}>
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) fetchRepos();
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "8px 12px",
          borderRadius: 8,
          border: "1px solid #475569",
          background: "#0f172a",
          color: value ? "#e2e8f0" : "#64748b",
          fontSize: 13,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ fontSize: 14 }}>📦</span>
        <span style={{ flex: 1 }}>
          {displayValue || "Select repository..."}
        </span>
        {branch && value && (
          <span style={{ fontSize: 11, color: "#94a3b8", background: "#1e293b", padding: "2px 8px", borderRadius: 4 }}>
            🌿 {branch}
          </span>
        )}
        <span style={{ fontSize: 10, color: "#64748b" }}>▾</span>
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 4,
            background: "#1e293b",
            border: "1px solid #475569",
            borderRadius: 8,
            maxHeight: 300,
            overflow: "auto",
            zIndex: 50,
          }}
        >
          <div style={{ padding: 8, borderBottom: "1px solid #334155" }}>
            <input
              type="text"
              placeholder="Search repos..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              style={{
                width: "100%",
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid #475569",
                background: "#0f172a",
                color: "#e2e8f0",
                fontSize: 13,
                outline: "none",
              }}
            />
          </div>

          {loading && (
            <div style={{ padding: "12px 16px", color: "#94a3b8", fontSize: 13 }}>
              Loading repos...
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div style={{ padding: "12px 16px", color: "#94a3b8", fontSize: 13 }}>
              No repos found
            </div>
          )}

          {filtered.map((repo) => (
            <button
              key={repo.fullName}
              type="button"
              onClick={() => handleSelect(repo)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "8px 16px",
                border: "none",
                background: value.includes(repo.fullName) ? "#334155" : "transparent",
                color: "#e2e8f0",
                fontSize: 13,
                cursor: "pointer",
                textAlign: "left",
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.background = "#334155"; }}
              onMouseLeave={(e) => {
                (e.target as HTMLElement).style.background = value.includes(repo.fullName) ? "#334155" : "transparent";
              }}
            >
              <span style={{ fontSize: 12 }}>{repo.private ? "🔒" : "🌐"}</span>
              <span style={{ flex: 1 }}>{repo.fullName}</span>
              <span style={{ fontSize: 11, color: "#64748b" }}>{repo.defaultBranch}</span>
              {repo.stargazersCount > 0 && (
                <span style={{ fontSize: 11, color: "#64748b" }}>★ {repo.stargazersCount}</span>
              )}
            </button>
          ))}

          <div style={{ padding: 8, borderTop: "1px solid #334155" }}>
            <button
              type="button"
              onClick={() => { setManualMode(true); setIsOpen(false); }}
              style={{
                width: "100%",
                padding: "6px",
                border: "none",
                background: "transparent",
                color: "#60a5fa",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Enter URL manually
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
