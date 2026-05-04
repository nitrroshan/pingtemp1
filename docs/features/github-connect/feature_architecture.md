# GitHub Connect — Feature Architecture

**Status:** Planning  
**Date:** April 26, 2026  
**Priority:** HIGH — prerequisite for Parallel Plans v2.0 (workspace isolation)  
**Related:** [parallel-plans v2.0](../parallel-plans/v2.0/feature_implementation_planning.md), [auth-security](../auth-security/feature_architecture.md)

---

## Problem Statement

Parallel Plans v2.0 requires agents to **clone and push to Git repos**. Without GitHub integration:
- Agents can only clone public repos
- Push-to-remote fails for private repos (no auth token)
- Users must manually provide repo URLs (no browsing)
- No way to automatically link user's GitHub identity to git operations

## What Already Exists

| Component | Status | Details |
|-----------|--------|---------|
| better-auth with email/password | ✅ | Session management, 7-day expiry |
| better-auth `account` table | ✅ | Auto-stores `accessToken`, `refreshToken`, `scope` for OAuth |
| `signIn.social()` in frontend auth client | ✅ | One-line call for GitHub login |
| Git push endpoint with token injection | ✅ | `https://oauth2:TOKEN@github.com/...` pattern |
| GitHub OAuth support in better-auth | ✅ | Just needs 5-line config |

## What This Feature Delivers

1. **"Sign in with GitHub" button** on login page
2. **GitHub repo browser** — user selects from their repos when creating a goal
3. **Auto-token injection** — clone/push operations use stored GitHub token automatically
4. **GitHub profile sync** — avatar, username displayed in UI

---

## Architecture

```
User clicks "Sign in with GitHub"
  → better-auth redirects to GitHub OAuth
  → GitHub returns authorization code
  → better-auth exchanges code for access_token
  → Stores in `account` table: { providerId: "github", accessToken, scope }
  → User logged in with GitHub identity

User creates goal → selects repo from GitHub
  → Frontend: GET /api/v2/github/repos (uses stored token)
  → GitHub API returns user's repos
  → User picks one → repoUrl set on goal

Agent clones repo
  → WorkspacePlugin reads user's GitHub token from account table
  → Injects into clone URL: https://oauth2:TOKEN@github.com/org/repo.git
  → Clone succeeds (even for private repos)

Agent pushes to remote
  → Same token injection for push
  → Push succeeds
```

---

## Implementation Steps

### Step 1: Backend — Add GitHub OAuth provider (0.5 day)

**Files:**
- `packages/backend/auth/index.ts` — add `github` to `socialProviders`
- `packages/backend/.env.example` — add `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`

```typescript
// auth/index.ts — add to betterAuth config
socialProviders: {
  github: {
    clientId: process.env.GITHUB_CLIENT_ID!,
    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    scope: ["repo", "read:user", "user:email"],
  },
},
```

**Scopes needed:**
- `repo` — clone/push private repos
- `read:user` — fetch GitHub profile (avatar, name)
- `user:email` — get verified email

**Exit:** GitHub OAuth login works end-to-end. Token stored in `account` table.

### Step 2: Backend — GitHub API endpoints (0.5 day)

**Files:**
- `packages/backend/api/HttpServer.ts` — new routes
- `packages/backend/services/GitHubService.ts` — new service (thin wrapper around GitHub REST API)

**Endpoints:**

```
GET /api/v2/github/repos
  → Fetches user's repos from GitHub API (using stored accessToken)
  → Returns: [{ name, fullName, private, defaultBranch, url, description }]
  → Pagination: ?page=1&per_page=30
  → Filter: ?type=owner (default) | all | member

GET /api/v2/github/repos/:owner/:repo/branches
  → Fetches branches for a specific repo
  → Returns: [{ name, protected }]

GET /api/v2/github/user
  → Fetches GitHub user profile
  → Returns: { login, avatarUrl, name, email }
```

**GitHubService:**

```typescript
class GitHubService {
  constructor(private getAccessToken: (userId: string) => Promise<string | null>) {}

  async listRepos(userId: string, opts?: { page?: number; type?: string }): Promise<GitHubRepo[]> {
    const token = await this.getAccessToken(userId);
    if (!token) throw new Error("No GitHub account linked");
    const res = await fetch("https://api.github.com/user/repos?..." , {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.json();
  }
}
```

**Token retrieval from better-auth `account` table:**

```typescript
// Query account table for GitHub provider
const account = await db.collection("account").findOne({
  userId,
  providerId: "github",
});
return account?.accessToken;
```

**Exit:** Frontend can fetch user's GitHub repos and branches via authenticated API.

### Step 3: Backend — Auto-token for clone/push (0.5 day)

**Files:**
- `packages/backend/agentManager/plugins/WorkspacePlugin.ts` — inject token
- `packages/workspace/src/L1/workspace/WorkspaceManager.ts` — accept auth token
- `packages/workspace/src/types/index.ts` — add `authToken` to `WorkspaceInitOptions`

**Change `WorkspaceInitOptions`:**

```typescript
interface WorkspaceInitOptions {
  repoUrl?: string;
  repoBranch?: string;
  sparse?: string[];
  authToken?: string;    // NEW — GitHub token for private repo access
}
```

**Change clone flow in `AgentWorkspace.initializeFromRepo()`:**

```typescript
if (initOptions.authToken && initOptions.repoUrl?.startsWith("https://")) {
  // Inject token into HTTPS URL for clone
  const authedUrl = initOptions.repoUrl.replace(
    "https://",
    `https://oauth2:${initOptions.authToken}@`,
  );
  await this.gitManager.clone(authedUrl, this.basePath, { ... });
} else {
  await this.gitManager.clone(initOptions.repoUrl!, this.basePath, { ... });
}
```

**Token flows from:** User session → `account` table → `WorkspacePlugin.prepareForTask()` → `createWorkspace({ authToken })` → clone/push.

**Exit:** Private repo clone/push works automatically using user's GitHub token.

### Step 4: Frontend — GitHub login button (0.5 day)

**Files:**
- `packages/frontend/components/Auth/LoginPage.tsx` — add GitHub button

**Change:**

```tsx
// Add above or below email/password form
<button onClick={() => authClient.signIn.social({ provider: "github" })}>
  <GitHubIcon /> Sign in with GitHub
</button>
```

**Exit:** Users can sign in with GitHub. First-time creates account, subsequent logins link to existing.

### Step 5: Frontend — Repo browser in GoalScreen (1 day)

**Files:**
- `packages/frontend/components/GoalScreen/RepoPicker.tsx` — NEW component
- `packages/frontend/components/GoalScreen/GoalScreen.tsx` — integrate RepoPicker

**RepoPicker** replaces the text input for `repoUrl` with a searchable dropdown that fetches from `GET /api/v2/github/repos`:

```
┌─────────────────────────────────────────────────┐
│ 📦 Select repository                         ▾  │
├─────────────────────────────────────────────────┤
│ 🔍 Search repos...                              │
├─────────────────────────────────────────────────┤
│ 🔒 org/private-api          main     ★ 12      │
│ 🌐 org/landing-page         main     ★ 3       │
│ 🔒 org/infra                main     ★ 0       │
│ 🌐 user/personal-site       main     ★ 45      │
│                                                  │
│          Load more...                            │
└─────────────────────────────────────────────────┘
```

Shows: lock icon (private/public), full name, default branch, stars.
Search: client-side filter on loaded repos.
Selection: sets `repoUrl` and `repoBranch` on goal.

**Exit:** User browses their GitHub repos and selects one when creating a goal.

### Step 6: Frontend — GitHub profile in header (0.5 day)

**Files:**
- `packages/frontend/components/Auth/UserMenu.tsx` — show GitHub avatar + username

**Exit:** User sees their GitHub identity in the UI. Confirms they're connected.

---

## Testing

- OAuth flow end-to-end (login, token stored, repos fetched)
- Private repo clone with stored token
- Push to remote with stored token
- Token expiry handling (better-auth auto-refreshes)
- User without GitHub linked → falls back to manual URL input
- Repo browser pagination and search

## Rollback

Remove `github` from `socialProviders` config. Email/password login continues working. Manual repo URL input available as fallback.

## Estimated Total: 3.5 days
