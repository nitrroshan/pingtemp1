# GitHub Connect — Implementation Planning

> **Parent:** [feature_architecture.md](feature_architecture.md)  
> **Status:** Implemented — April 27, 2026  
> **Branch:** `user/nitrroshan/fixplans`  
> **Depends on:** better-auth ✅ (already configured with email/password)  
> **Blocks:** [Parallel Plans v2.0](../parallel-plans/v2.0/feature_implementation_planning.md) (workspace isolation needs auth tokens for clone/push)

## Branch
- `feature/github-connect`

## Scope

GitHub OAuth login + repo browser + auto-token injection for git clone/push. Enables v2.0 workspace isolation with private repos.

## Implementation Steps

- [x] **Step 1: Backend — GitHub OAuth provider config** (0.5 day)  
  Files: `packages/backend/auth/index.ts`, `packages/backend/.env.example`  
  Entry: Email/password only. No OAuth providers configured.  
  Exit: `POST /api/auth/signin/social` with `provider: "github"` works. Token stored in `account` table with `providerId: "github"`. Scopes: `repo`, `read:user`, `user:email`.

- [x] **Step 2: Backend — GitHub API endpoints** (0.5 day)  
  Files: `packages/backend/services/GitHubService.ts` (new), `packages/backend/api/HttpServer.ts`  
  Entry: No GitHub API integration.  
  Exit: `GET /api/v2/github/repos` returns user's repos. `GET /api/v2/github/repos/:owner/:repo/branches` returns branches. `GET /api/v2/github/user` returns profile. All authenticated via stored token from `account` table.

- [x] **Step 3: Backend — Auto-token injection for clone/push** (0.5 day)  
  Files: `packages/workspace/src/types/index.ts` (add `authToken`), `packages/workspace/src/L1/workspace/AgentWorkspace.ts` (inject into clone URL), `packages/backend/agentManager/plugins/WorkspacePlugin.ts` (look up token)  
  Entry: Clone/push only work for public repos.  
  Exit: When `authToken` provided in `WorkspaceInitOptions`, clone URL becomes `https://oauth2:TOKEN@github.com/...`. Private repos clone and push successfully.

- [x] **Step 4: Frontend — "Sign in with GitHub" button** (0.5 day)  
  Files: `packages/frontend/components/Auth/LoginPage.tsx`  
  Entry: Only email/password login form.  
  Exit: GitHub OAuth button triggers `signIn.social({ provider: "github" })`. First login creates account, subsequent logins link. Redirect back to app on success.

- [x] **Step 5: Frontend — RepoPicker component** (1 day)  
  Files: `packages/frontend/components/GoalScreen/RepoPicker.tsx` (new), `packages/frontend/components/GoalScreen/GoalScreen.tsx` (integrate)  
  Entry: No repo selection in UI.  
  Exit: Searchable dropdown fetches from `/api/v2/github/repos`. Shows private/public icon, repo name, default branch, stars. Selection sets `repoUrl` + `repoBranch` on goal. Fallback: manual URL input for non-GitHub repos.

- [x] **Step 6: Frontend — GitHub profile display** (0.5 day)  
  Files: `packages/frontend/components/Auth/UserMenu.tsx`  
  Entry: No GitHub identity in UI.  
  Exit: GitHub avatar + username shown in user menu when GitHub account linked.

## Testing

- OAuth redirect flow (login → GitHub → callback → token stored)
- Token retrieval from `account` table by userId + providerId
- `GET /api/v2/github/repos` returns user's repos (auth header from stored token)
- Private repo clone with injected token
- Push to remote with injected token
- RepoPicker search, pagination, selection
- Non-GitHub user → manual URL input fallback
- Token expiry → better-auth auto-refresh

## Rollback

Remove `github` from `socialProviders`. Email/password login unaffected. RepoPicker falls back to manual text input.

## Estimated Total: 3.5 days
