# GitHub Connect — Implementation Log

## Branch
- `user/nitrroshan/fixplans`

## Status: Complete (April 27, 2026)

## Key Changes

### Step 1: GitHub OAuth provider
- Added `github` to `socialProviders` in [auth/index.ts](../../../packages/backend/auth/index.ts) with scopes `repo`, `read:user`, `user:email`
- Added `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` to [.env.example](../../../packages/backend/.env.example)

### Step 2: GitHub API endpoints
- Created [GitHubService.ts](../../../packages/backend/services/GitHubService.ts) — `listRepos()`, `listBranches()`, `getUser()`, `getTokenForUser()`
- Added 3 routes to [HttpServer.ts](../../../packages/backend/api/HttpServer.ts): `GET /api/v2/github/repos`, `/repos/:owner/:repo/branches`, `/user`
- Token retrieval from better-auth `account` table via MongoDB query

### Step 3: Auto-token for clone/push
- Added `authToken` to `WorkspaceInitOptions` in [types/index.ts](../../../packages/workspace/src/types/index.ts)
- Token injection in [AgentWorkspace.ts](../../../packages/workspace/src/L1/workspace/AgentWorkspace.ts) `initializeFromRepo()`: `https://oauth2:TOKEN@github.com/...`
- Added `repoUrl`, `repoBranch`, `authToken` to `ToolContext` in [plugin/types.ts](../../../packages/agent-manager/src/plugin/types.ts)

### Step 4: Frontend GitHub login
- Added "Sign in with GitHub" button with SVG icon + divider to [LoginPage.tsx](../../../packages/frontend/components/Auth/LoginPage.tsx)
- Uses `signIn.social({ provider: "github", callbackURL: window.location.origin })`

### Step 5: RepoPicker component
- Created [RepoPicker.tsx](../../../packages/frontend/components/GoalScreen/RepoPicker.tsx) — searchable GitHub repo dropdown, falls back to manual URL input when GitHub not linked

### Step 6: GitHub profile hook
- Created [useGitHubProfile.ts](../../../packages/frontend/hooks/useGitHubProfile.ts) — fetches avatar + username from `/api/v2/github/user`

## Bug Fix During Implementation
- Import path fix: `GitHubService.ts` used `../logging.js` instead of `../logging/index.js` — caused runtime crash on backend start

## Known Issues
- SQLite mode token retrieval not implemented (only MongoDB query works for `account` table lookup)
- GitHub OAuth App credentials must be manually created at github.com/settings/developers
