/**
 * GitHubService — Thin wrapper around GitHub REST API.
 *
 * Uses the user's stored OAuth access token (from better-auth `account` table)
 * to call GitHub API on their behalf.
 */

import { rootLogger } from "../logging/index.js";

const logger = rootLogger.child({ module: "GitHubService" });
const GITHUB_API = "https://api.github.com";

export interface GitHubRepo {
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  url: string;
  cloneUrl: string;
  description: string | null;
  stargazersCount: number;
  updatedAt: string;
}

export interface GitHubBranch {
  name: string;
  protected: boolean;
}

export interface GitHubUser {
  login: string;
  avatarUrl: string;
  name: string | null;
  email: string | null;
}

export class GitHubService {
  constructor(
    private getAccessToken: (userId: string) => Promise<string | null>,
  ) {}

  /**
   * List repositories for the authenticated user.
   */
  async listRepos(
    userId: string,
    opts?: { page?: number; perPage?: number; type?: string; sort?: string },
  ): Promise<{ repos: GitHubRepo[]; hasMore: boolean }> {
    const token = await this.getAccessToken(userId);
    if (!token) throw new Error("No GitHub account linked. Sign in with GitHub first.");

    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 30;
    const type = opts?.type ?? "owner";
    const sort = opts?.sort ?? "updated";

    const url = `${GITHUB_API}/user/repos?type=${type}&sort=${sort}&per_page=${perPage}&page=${page}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Ping-Agent-Platform",
      },
    });

    if (!res.ok) {
      const body = await res.text();
      logger.error(`GitHub API error: ${res.status} ${body}`);
      throw new Error(`GitHub API error: ${res.status}`);
    }

    const data = await res.json() as any[];
    const repos: GitHubRepo[] = data.map((r) => ({
      name: r.name,
      fullName: r.full_name,
      private: r.private,
      defaultBranch: r.default_branch,
      url: r.html_url,
      cloneUrl: r.clone_url,
      description: r.description,
      stargazersCount: r.stargazers_count,
      updatedAt: r.updated_at,
    }));

    // GitHub returns Link header for pagination — check if there's a next page
    const linkHeader = res.headers.get("Link") || "";
    const hasMore = linkHeader.includes('rel="next"');

    return { repos, hasMore };
  }

  /**
   * List branches for a specific repository.
   */
  async listBranches(
    userId: string,
    owner: string,
    repo: string,
  ): Promise<GitHubBranch[]> {
    const token = await this.getAccessToken(userId);
    if (!token) throw new Error("No GitHub account linked.");

    const url = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Ping-Agent-Platform",
      },
    });

    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status}`);
    }

    const data = await res.json() as any[];
    return data.map((b) => ({
      name: b.name,
      protected: b.protected,
    }));
  }

  /**
   * Get the authenticated user's GitHub profile.
   */
  async getUser(userId: string): Promise<GitHubUser> {
    const token = await this.getAccessToken(userId);
    if (!token) throw new Error("No GitHub account linked.");

    const res = await fetch(`${GITHUB_API}/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Ping-Agent-Platform",
      },
    });

    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status}`);
    }

    const data = await res.json() as any;
    return {
      login: data.login,
      avatarUrl: data.avatar_url,
      name: data.name,
      email: data.email,
    };
  }

  /**
   * Get the access token for a user's GitHub account.
   * Exposed for use by WorkspacePlugin to inject into clone/push.
   */
  async getTokenForUser(userId: string): Promise<string | null> {
    return this.getAccessToken(userId);
  }
}
