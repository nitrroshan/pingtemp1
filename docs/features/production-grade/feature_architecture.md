# Production-Grade Infrastructure — Architecture

## Overview

Four cross-cutting concerns to make the platform production-ready:

1. **Unified Logging** — Single logger instance, structured output, environment-aware levels
2. **Frontend Log Control** — Strip/suppress console logs in production builds
3. **Feature Flags** — Centralized, typed flag system for both backend and frontend
4. **Production Storage & Deployment** — Docker volumes, graceful shutdown, data persistence

---

## 1. Unified Logging

### Current State
- **Backend**: `tslog v4.10.2` used across 6 packages. 40+ independent `new Logger({ name })` instances — no shared config, no global log level, no structured JSON output.
- **Frontend**: Raw `console.log/error/warn` (~18 calls) with `[ServiceName]` prefixes. No library.
- **CLI**: 25+ `console.log` calls for colored terminal output (intentional, should remain).

### Problem
- Each module creates its own logger — log level is hardcoded per instance.
- No way to change log verbosity at runtime or via env vars.
- No structured (JSON) output for log aggregation tools.
- Inconsistent formatting across packages.

### Architecture Options

#### Option A: Keep tslog — Centralized Factory

**Implementation:** Create a shared `createLogger(name)` factory that configures tslog with global settings (log level from env, structured JSON in production, pretty-print in development). All modules import from this factory instead of creating raw `new Logger()`.

**Pros:**
- Zero dependency change — tslog is already installed everywhere
- tslog v4 supports `minLevel`, JSON output, pretty-print, child loggers
- Minimal code changes — just swap `new Logger({ name })` → `createLogger("name")`
- tslog supports attaching context (request ID, team ID, etc.)

**Cons:**
- tslog has fewer community plugins than pino/winston for log shipping
- tslog performance is adequate but not best-in-class for high-throughput

**Effort:** Low — factory module + find-and-replace across packages

#### Option B: Migrate to Pino

**Implementation:** Replace tslog with pino across all packages. Create a shared `createLogger(name)` factory. Pino outputs JSON by default, has the best Node.js performance, and has a rich plugin ecosystem (pino-pretty for dev, transports for Datadog/ELK/etc.).

**Pros:**
- Best performance of all Node.js loggers (benchmarked fastest)
- JSON structured logging by default
- pino-pretty for human-readable dev output
- Huge ecosystem (transports, redaction, async logging)
- Used by Fastify, widely adopted in production Node.js

**Cons:**
- Migration effort — replace tslog in 6 packages
- New dependency to learn (though API is simple)
- pino-pretty is a separate dev dependency

**Effort:** Medium — install pino, create factory, replace 40+ logger instances

#### Option C: Migrate to Winston

**Implementation:** Replace tslog with winston. Create centralized logger with multiple transports (console for dev, JSON file/stream for production).

**Pros:**
- Most popular Node.js logger (12M+ weekly downloads)
- Multiple built-in transports (console, file, HTTP)
- Flexible formatting

**Cons:**
- Slower than pino and tslog
- Poor defaults — requires significant configuration
- Heavier dependency
- Overkill for this project's scale

**Effort:** Medium — similar to pino migration but more config boilerplate

### Decision: Option B — Migrate to Pino

Pino is the production-grade choice. Best performance, structured JSON by default, built-in redaction, async logging, and a massive transport ecosystem. Since we're overhauling every logger instance anyway (40+ sites), migration cost is incurred regardless of library choice.

### Chosen Logger Design

**Single root logger + child loggers.** One pino instance is created at startup. Modules receive child loggers via `.child()` — they inherit all config from the root.

```typescript
// packages/backend/logging/index.ts
import pino from "pino";

const isProd = process.env.NODE_ENV === "production";

// Single root logger — created once
export const rootLogger = pino({
  name: "Ping",
  level: process.env.LOG_LEVEL ?? "info",
  // JSON in production (default), pretty in development
  transport: isProd ? undefined : { target: "pino-pretty", options: { colorize: true } },
  // Redact sensitive fields in all environments
  redact: ["req.headers.authorization", "azureOpenAi.apiKey"],
});

export type AppLogger = pino.Logger;
```

**Usage pattern — pass the logger or derive child loggers:**
```typescript
// Option 1: Derive a child logger (inherits all root config)
import { rootLogger } from "@ping/backend/logging";
const logger = rootLogger.child({ module: "WorkerPool" });

// Option 2: Accept logger via constructor/function param (DI style)
class WorkerPool {
  private logger: pino.Logger;
  constructor(logger: pino.Logger) {
    this.logger = logger.child({ module: "WorkerPool" });
  }
}
```

**Why pino + single instance + child loggers:**
- Best performance (5-10x faster than tslog, async buffered writes)
- Change log level on root → all children reflect it
- Built-in `redact` — auto-strip API keys, tokens from logs
- JSON structured output by default (pipe to any log aggregator)
- `pino-pretty` for human-readable dev output
- Transport ecosystem for Datadog, ELK, CloudWatch, etc.
- Can pass logger down via DI for testability (mock the root in tests)

**Dependencies to add:**
```bash
bun add pino                    # all 6 packages (or shared)
bun add -D pino-pretty          # dev only — pretty console output
```

**Dependencies to remove:**
```bash
bun remove tslog                # from all 6 packages
```

**Env vars:**
```bash
LOG_LEVEL=debug    # trace | debug | info | warn | error | fatal
NODE_ENV=production  # switches to JSON output automatically
```

---

## 2. Frontend Log Control in Production

### Current State
- 18 `console.log/error/warn` calls in frontend code
- No build-time stripping, no runtime guards
- All logs visible to end users in browser DevTools

### Industry Standard Approaches

#### Option A: Vite Build-Time Drop (esbuild `drop`)

**Implementation:** Use Vite/esbuild's `drop` option to completely remove `console.log` and `console.debug` calls from production builds. Keep `console.warn` and `console.error` for real issues.

```typescript
// vite.config.ts
export default defineConfig(({ mode }) => ({
  esbuild: {
    drop: mode === 'production' ? ['console', 'debugger'] : [],
  },
}));
```

**Pros:**
- Zero runtime overhead — code is physically removed from bundle
- Zero code changes to existing console calls
- Industry standard (Next.js, Create React App recommend this)
- No new dependencies

**Cons:**
- Removes ALL console calls including errors (unless we use a wrapper)
- Can't selectively enable logging for debugging in production
- Slightly coarse-grained (all-or-nothing per console method)

**Effort:** Minimal — one config line

#### Option B: Lightweight Frontend Logger Wrapper

**Implementation:** Create a tiny `logger` module that checks `import.meta.env.MODE` and only outputs in development. In production, `logger.debug()` and `logger.info()` become no-ops. `logger.error()` and `logger.warn()` still output (important for debugging production issues).

```typescript
// packages/frontend/utils/logger.ts
const isDev = import.meta.env.DEV;

export const logger = {
  debug: isDev ? console.debug.bind(console) : () => {},
  info:  isDev ? console.log.bind(console)   : () => {},
  warn:  console.warn.bind(console),   // always show
  error: console.error.bind(console),  // always show
};
```

**Pros:**
- Selective control — errors/warnings still show in production
- Can be extended later (send errors to monitoring service)
- Simple, no dependencies
- Can add runtime toggle for support debugging

**Cons:**
- Requires updating 18 call sites to use `logger.xxx()` instead of `console.xxx()`
- Tiny runtime cost (function call overhead, even if no-op)

**Effort:** Low — create wrapper + update ~18 call sites

#### Option C: Combine Both (Build Drop + Logger Wrapper)

**Implementation:** Use the logger wrapper for selective control AND Vite's `pure` option to tree-shake the no-op calls in production builds:

```typescript
// vite.config.ts - mark logger.debug and logger.info as pure (side-effect free)
esbuild: {
  pure: mode === 'production' ? ['logger.debug', 'logger.info'] : [],
}
```

**Pros:** Best of both worlds — selective + zero runtime cost
**Cons:** Slightly more complex setup

**Effort:** Low-medium

### Decision: Option B — Lightweight Frontend Logger Wrapper

Errors and warnings must remain visible in production (genuinely useful for diagnosing user-facing issues). The wrapper is ~10 lines and the 18 call-site updates are trivial. Can be extended later to send errors to a monitoring service (Sentry, etc.).

Do NOT use Option A's blanket `drop: ['console']` — losing error logs in production is worse than having a few info logs.

---

## 3. Feature Flags

### Current State
- 3 flags scattered across codebase: `USE_ORCHESTRATOR`, `USE_API_V2`, `PLANNER_MODE`
- No unified API — direct `process.env` reads mixed with config object reads
- No frontend feature flags at all
- No type safety, no validation, no defaults documented alongside flags

### Architecture Options

#### Option A: Typed Config-Based Feature Flags (No External Service)

**Implementation:** Extend the existing `AppConfig` system with a dedicated `featureFlags` section. All flags defined in one place with TypeScript types, defaults, and env var mappings. Frontend flags served via a simple API endpoint or injected at build time.

```typescript
// Backend: config/featureFlags.ts
export interface FeatureFlags {
  // Backend flags
  useOrchestrator: boolean;
  useApiV2: boolean;
  plannerMode: 'legacy' | 'orchestrator';
  enableCostTracking: boolean;
  enableWorkspaceSearch: boolean;

  // Shared flags (also sent to frontend)
  enableStreamingUI: boolean;
  enableSkillSelector: boolean;
  enableTeamManagement: boolean;
}

export const FLAG_DEFAULTS: FeatureFlags = {
  useOrchestrator: true,
  useApiV2: true,
  plannerMode: 'orchestrator',
  enableCostTracking: false,
  enableWorkspaceSearch: false,
  enableStreamingUI: true,
  enableSkillSelector: true,
  enableTeamManagement: true,
};
```

```typescript
// Frontend: via API endpoint GET /api/v2/feature-flags
// or injected via Vite define at build time
const flags = useFeatureFlags(); // React hook
if (flags.enableSkillSelector) { ... }
```

**Pros:**
- Type-safe — compiler catches flag name typos
- No external dependencies
- Fits existing config system perfectly
- All flags documented in one file with defaults
- Frontend can fetch flags from backend (SSR-friendly, dynamic)
- Easy to test — just override config

**Cons:**
- No admin UI for toggling (must redeploy or restart)
- No gradual rollout, A/B testing, or user-specific flags
- No audit trail of flag changes

**Effort:** Low — extend existing config + add endpoint + React hook

#### Option B: Unleash (Open-Source Feature Flag Service)

**Implementation:** Deploy Unleash server alongside the app. Use `@unleash/node` SDK for backend, `@unleash/react` SDK for frontend. Provides admin UI, gradual rollouts, per-user targeting.

**Pros:**
- Industry-standard feature flag service
- Admin UI for non-developers to toggle features
- Gradual rollouts, A/B testing, user targeting
- Audit trail
- Open-source, self-hosted

**Cons:**
- Significant operational overhead — another service to deploy and maintain
- Overkill for current scale (3 developers, ~10 flags)
- Additional infrastructure dependency (Unleash needs its own DB)
- Network calls for flag evaluation (though cached locally)

**Effort:** High — deploy Unleash, integrate SDKs, migrate existing flags

#### Option C: Environment-Only Flags (Minimal Approach)

**Implementation:** Standardize on env vars with a naming convention (`FF_*`) and a validation function. No UI, no API — just env vars.

```bash
FF_USE_ORCHESTRATOR=true
FF_ENABLE_COST_TRACKING=false
```

**Pros:**
- Simplest possible approach
- Works with any deployment (Docker, K8s, etc.)
- No code to maintain

**Cons:**
- No type safety
- No frontend support without API
- Easy to forget flags (no central registry)
- No defaults without additional code

**Effort:** Minimal

### Decision: Option A — Typed Config-Based Feature Flags with Dev/Prod Setup

Extend the existing config system with a typed `featureFlags` section. Different defaults per environment — dev enables experimental features, production keeps them off.

### Chosen Feature Flag Design

**Type definition (shared):**
```typescript
// packages/backend/config/featureFlags.ts
export interface FeatureFlags {
  // --- Backend-only flags ---
  useOrchestrator: boolean;
  useApiV2: boolean;
  plannerMode: 'legacy' | 'orchestrator';
  enableCostTracking: boolean;
  enableWorkspaceSearch: boolean;

  // --- Shared flags (sent to frontend via API) ---
  enableStreamingUI: boolean;
  enableSkillSelector: boolean;
  enableTeamManagement: boolean;
}

// Flags that are safe to expose to the frontend
export const FRONTEND_FLAG_KEYS: (keyof FeatureFlags)[] = [
  'enableStreamingUI',
  'enableSkillSelector',
  'enableTeamManagement',
];
```

**Dev defaults (everything on — move fast):**
```typescript
// config/development.ts
featureFlags: {
  useOrchestrator: true,
  useApiV2: true,
  plannerMode: 'orchestrator',
  enableCostTracking: true,       // on in dev for testing
  enableWorkspaceSearch: true,    // on in dev for testing
  enableStreamingUI: true,
  enableSkillSelector: true,
  enableTeamManagement: true,
}
```

**Production defaults (conservative — only stable features):**
```typescript
// config/production.ts
featureFlags: {
  useOrchestrator: true,
  useApiV2: true,
  plannerMode: 'orchestrator',
  enableCostTracking: false,      // off until stable
  enableWorkspaceSearch: false,   // off until stable
  enableStreamingUI: true,
  enableSkillSelector: true,
  enableTeamManagement: true,
}
```

**Env var overrides (highest priority):**
```bash
# .env — override any flag per-deployment
FF_USE_ORCHESTRATOR=true
FF_ENABLE_COST_TRACKING=false
FF_PLANNER_MODE=legacy
```

**Resolution order:**
```
default.ts → development.ts or production.ts → .env overrides (FF_* prefix)
```

**Backend usage:**
```typescript
import { getConfig } from "./config/index.js";

const flags = getConfig().featureFlags;
if (flags.enableCostTracking) { ... }
```

**Frontend — API endpoint:**
```typescript
// GET /api/v2/feature-flags → returns only FRONTEND_FLAG_KEYS
{
  "enableStreamingUI": true,
  "enableSkillSelector": true,
  "enableTeamManagement": true
}
```

**Frontend — React hook:**
```typescript
const flags = useFeatureFlags();
if (flags.enableSkillSelector) { ... }

// Or conditional rendering:
{flags.enableTeamManagement && <TeamPanel />}
```

**Why dev/prod split:**
- Dev: all flags on → developers test everything, catch issues early
- Prod: experimental flags off → users only see stable features
- Env vars override both → can enable a prod flag for a specific deployment without code change
- Adding a new flag: add to interface → set dev default (on) → set prod default (off) → done

---

## 4. Production Storage, Sessions & Deployment

### Core Problem: B2B Session Continuity

This is a B2B app. When a user closes their browser and comes back tomorrow, they must see:
- Their teams, goals, and task history
- Chat messages with agents
- Results/outputs from completed executions
- The ability to resume or review past work

**What's actually lost today when a user reconnects:**

| Data | Where It Lives Now | Survives Page Refresh? | Survives Server Restart? |
|------|--------------------|------------------------|--------------------------|
| Chat messages | `localStorage` only | ✅ (same browser) | ✅ (client-side) |
| Chat messages (different device) | Nowhere | ❌ **GONE** | ❌ **GONE** |
| User identity | Random ID per connect | ❌ New ID each time | ❌ |
| Teams / Agents / Skills | MongoDB | ✅ | ✅ |
| Current tasks | FileTaskStore (JSON) + in-memory | ✅ (file persists) | ✅ (if flushed) |
| Current plan | PlanStore (JSON files) | ✅ | ✅ |
| Past goals / execution history | Nowhere | ❌ **GONE** | ❌ **GONE** |
| Agent outputs / artifacts | `.ping/outputs/` files | ✅ (if Docker volume) | ✅ (if Docker volume) |
| Git workspaces | `data/workspaces/` | ✅ (if Docker volume) | ✅ (if Docker volume) |
| CRDT docs | `data/collab/yjs/` | ✅ (if Docker volume) | ✅ (if Docker volume) |

**Two categories of gaps:**
1. **Infrastructure** — Docker volumes, shutdown flush (same fixes as before)
2. **Session data** — Chat history, user identity, goal history need MongoDB collections

### What Needs Fixing

#### Category A: Infrastructure (Same as Before)

| Fix | What | Effort |
|-----|------|--------|
| **A1. Docker volume** | `ping-backend-data:/app/data` | 1 line |
| **A2. Shutdown flush** | `FileTaskStore.flush()` on SIGTERM | ~5 lines |
| **A3. Health check** | MongoDB + data dir check in `/api/v2/health` | ~10 lines |

#### Category B: Session Persistence (New — Required for B2B)

| Fix | What | Effort |
|-----|------|--------|
| **B1. Auth via better-auth** | Production auth library with email/password, OAuth, session management | ~100 lines config |
| **B2. Chat history** | MongoDB `ChatMessage` collection, server-side storage | ~80 lines |
| **B3. Goal/execution history** | MongoDB `Goal` collection tracking all goals + outcomes | ~60 lines |
| **B4. Session recovery API** | Endpoints to restore full state on reconnect | ~50 lines |

---

### Fix B1: Production Auth with better-auth

**Problem:** Every reconnect generates a random `userId`. No auth, no sessions, no identity persistence.

**Solution: [better-auth](https://better-auth.com/)** — the most comprehensive open-source TypeScript auth library (27.7K stars, MIT, 100% TypeScript).

**Why better-auth:**
- **Library, not a service** — no extra Docker container, no Java runtime, no separate DB
- **MongoDB adapter** built-in — uses our existing MongoDB, creates its own collections (`user`, `session`, `account`, `verification`)
- **Express integration** via catch-all route handler
- Email/password + OAuth (Google, GitHub) + session management out of the box
- 2FA, organization/team support, rate limiting — all via plugins
- React client SDK (`better-auth/react`) with `useSession()` hook
- Auto-manages session tokens (cookies, secure, httpOnly)
- Built-in rate limiter for auth endpoints

**Backend setup:**
```typescript
// packages/backend/auth/index.ts
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { db } from "../db/config.js";  // existing mongoose connection

export const auth = betterAuth({
  database: mongodbAdapter(db),
  emailAndPassword: { enabled: true },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
    // Add Google, etc. when ready
  },
  user: {
    additionalFields: {
      displayName: { type: "string", required: false },
      preferences: { type: "string", required: false },  // JSON stringified
    },
  },
});
```

**Express mount (catch-all):**
```typescript
// packages/backend/api/HttpServer.ts
import { toNodeHandler } from "better-auth/node";
import { auth } from "../auth/index.js";

// Mount better-auth handler at /api/auth/*
app.all("/api/auth/*", toNodeHandler(auth));
```

**React client:**
```typescript
// packages/frontend/lib/auth-client.ts
import { createAuthClient } from "better-auth/react";

export const { signIn, signUp, signOut, useSession } = createAuthClient({
  baseURL: "http://localhost:3002",  // backend URL
});
```

**Frontend usage:**
```typescript
// In any component
const { data: session } = useSession();
if (!session) return <LoginPage />;

// Access user
session.user.id     // stable user ID
session.user.email  // email address
session.user.name   // display name
```

**What better-auth handles (we don't build):**
- User registration + email/password
- Session tokens (secure cookies, httpOnly, CSRF protection)
- Login/logout
- OAuth flow (redirect, callback, token exchange)
- Password hashing (bcrypt/argon2)
- Rate limiting on auth endpoints
- Session expiry + refresh

**What we still build ourselves:**
- Chat history (MongoDB `ChatMessage` — better-auth doesn't do chat)
- Goal tracking (MongoDB `Goal` — business-specific)
- Session restore API (combines auth session + application state)

**Dependencies:**
```bash
bun add better-auth                    # backend + frontend
```

**Env vars:**
```bash
BETTER_AUTH_SECRET=<generate-with-openssl-rand-base64-32>
BETTER_AUTH_URL=http://localhost:3002
# Optional: OAuth providers
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

**MongoDB collections created by better-auth (auto-managed):**
- `user` — id, name, email, emailVerified, image, createdAt, updatedAt
- `session` — id, userId, token, expiresAt, ipAddress, userAgent
- `account` — id, userId, providerId, accessToken, refreshToken
- `verification` — id, identifier, value, expiresAt

**Dev workflow:** Email/password login. No OAuth needed during dev unless you set up GitHub/Google credentials. better-auth serves a minimal login API — you build the login UI (or use their pre-built components).

### Fix B2: Server-Side Chat History

**Problem:** Chat messages only live in browser `localStorage`. Switch device → messages gone. Clear cache → messages gone. B2B users expect to see their conversation history.

```typescript
// packages/backend/db/models/ChatMessage.ts
const ChatMessageSchema = new Schema({
  teamId:     { type: String, required: true },
  userId:     String,
  role:       { type: String, enum: ['user', 'assistant', 'system'] },
  content:    String,
  agentId:    String,                     // which agent responded
  goalId:     String,                     // which goal this relates to
  metadata:   Schema.Types.Mixed,         // tool calls, stream parts, etc.
  createdAt:  { type: Date, default: Date.now },
});
ChatMessageSchema.index({ teamId: 1, createdAt: 1 });
ChatMessageSchema.index({ teamId: 1, goalId: 1 });
```

**Flow:**
1. User sends message → backend saves to MongoDB + forwards to orchestrator
2. Agent responds (stream) → on stream complete, save final message to MongoDB
3. User reconnects → `GET /api/v2/teams/:teamId/messages?limit=50` → restore chat
4. Frontend still uses localStorage as cache for fast load, but MongoDB is source of truth

**Dev impact:** Low. Messages auto-save. Chat loads from API on mount.

### Fix B3: Goal & Execution History

**Problem:** No record of what goals were submitted, what happened, what the outcomes were. When a user comes back, they can't see "last week I asked the team to build an API — what happened?"

```typescript
// packages/backend/db/models/Goal.ts
const GoalSchema = new Schema({
  goalId:      { type: String, required: true, unique: true },
  teamId:      { type: String, required: true },
  userId:      String,                    // who submitted it
  description: String,                    // the original goal text
  status:      { type: String, enum: ['planning', 'approved', 'executing', 'completed', 'failed', 'cancelled'] },
  planId:      String,
  taskCount:   Number,
  tasksCompleted: Number,
  tasksFailed:    Number,
  submittedAt: { type: Date, default: Date.now },
  completedAt: Date,
  durationMs:  Number,
  summary:     String,                    // LLM-generated completion summary
});
GoalSchema.index({ teamId: 1, submittedAt: -1 });
GoalSchema.index({ userId: 1, submittedAt: -1 });
```

**Flow:**
1. User submits goal → create `Goal` doc (status: `planning`)
2. Plan approved → update status to `approved`
3. Execution completes → update to `completed`, set summary + stats
4. User reconnects → `GET /api/v2/teams/:teamId/goals` → see full history

**Dev impact:** Low. Goals auto-tracked alongside existing orchestrator flow.

### Fix B4: Session Recovery API

**Problem:** When a user reconnects, the frontend cobbles state together from multiple sources. No single "give me everything" endpoint.

```typescript
// GET /api/v2/sessions/:teamId/restore
// Returns everything needed to rebuild the UI
{
  team:     { id, name, agents },                    // from MongoDB
  goals:    [{ goalId, description, status, ... }],  // recent goals
  messages: [{ role, content, createdAt, ... }],     // last 50 messages
  tasks:    [{ id, status, assignedRole, ... }],     // current tasks (if active goal)
  plan:     { planId, status, phases, ... },          // current plan (if active goal)
}
```

One API call → full UI restoration. Frontend calls this on mount instead of 4 separate fetches.

**Dev impact:** None. Replaces multiple scattered API calls with one clean endpoint.

---

### File Storage Strategy (Dev vs Prod)

Two categories of files, two different strategies:

#### Workspace Code (Git Repos) → Cloud Storage, Push to GitHub on User Request

Agent workspaces are full git repos stored locally. In production:
- **Persisted via StorageProvider** (same as app state — Azure Blob/S3) for durability
- **Pushed to user's GitHub/Azure DevOps only on user request** (not automatic)

Users decide when to push to their remote — e.g. after reviewing agent code, approving output, or completing a goal. This avoids polluting their repos with in-progress work.

**Flow:**
1. Agent works on task → code lives in local `data/workspaces/{teamId}/` (or cloud storage)
2. User reviews output in UI
3. User clicks "Push to GitHub" → backend pushes branch to configured remote
4. User creates PR from their GitHub repo

**Implementation:** Add `addRemote()` + `push()` to GitBranchManager (~10 lines). Add `POST /api/v2/workspaces/:teamId/push` endpoint. Configure per-team:

```bash
# Per-team config (stored in MongoDB Team document)
gitRemoteUrl: "https://github.com/org/workspace-repo.git"
gitRemoteToken: "ghp_xxx"   # PAT — encrypted at rest
```

**Dev:** No remote. Local `data/workspaces/` works fine.
**Prod:** Stored in cloud storage (same `StorageProvider`). Push to GitHub only when user requests.

#### Storage Architecture (Container-Aware)

Storage is split into **two separate concerns** because Phase 6 introduces containers (Microsandbox/Docker) for worker isolation. Containers need mountable workspace volumes — but orchestrator state must NOT enter containers.

```
┌──────────────────────────────────────────────────────────────┐
│                     Orchestrator (Node.js)                    │
│                                                              │
│  AppStateStorage (tasks, plans, CRDT)                        │
│  ├── Local: Docker volume ping-app-state:/app/data           │
│  └── Cloud: async sync → Azure Blob / S3                     │
│                                                              │
│  WorkspaceStorage (git repos — monorepo per team)            │
│  ├── Local: Docker volume ping-workspaces:/app/workspaces    │
│  └── Cloud: async sync → Azure Blob / S3                     │
│                                                              │
│  Workspace Ownership Flow:                                   │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ Orchestrator                                         │     │
│  │  ├── Owns: workspaces/{teamId}/ (monorepo)          │     │
│  │  └── Passes workspace ref to Chat Agent on task      │     │
│  │       │                                              │     │
│  │       ▼                                              │     │
│  │  Chat Agent (Layer 2, persistent per role)           │     │
│  │  ├── Receives workspace from orchestrator            │     │
│  │  ├── If workspace doesn't exist → creates it         │     │
│  │  └── Spawns Sub-Agent via execute_task               │     │
│  │       │ Passes: clone of workspace + task branch     │     │
│  │       ▼                                              │     │
│  │  ┌─── Container (Sub-Agent) ─────────────────┐      │     │
│  │  │  /workspace ← clone of team repo           │      │     │
│  │  │  branch: task-{taskId}                     │      │     │
│  │  │  Agent reads/writes files here             │      │     │
│  │  │  On complete → push branch back to repo    │      │     │
│  │  └────────────────────────────────────────────┘      │     │
│  │       │                                              │     │
│  │       ▼                                              │     │
│  │  Chat Agent decides: merge to main or wait           │     │
│  └─────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────┘
```

**Workspace ownership hierarchy:**

| Layer | Role | Workspace Responsibility |
|-------|------|-------------------------|
| **Orchestrator** | Owns the team's monorepo | Creates/loads `workspaces/{teamId}/`. Passes reference to Chat Agent when assigning role-task. |
| **Chat Agent (L2)** | Manages workspace for its role | Receives workspace from orchestrator. If workspace doesn't exist yet → creates it (`git init`). Clones repo for each sub-agent task. Decides whether to merge sub-agent's branch. |
| **Sub-Agent (L3)** | Works in a clone | Receives cloned workspace + task branch. Writes files, commits. Pushes branch back when done. Never touches main branch directly. |

**Two storage types, two volumes, two purposes:**

| Storage | What | Docker Volume | Who Accesses | Container Access |
|---------|------|---------------|-------------|------------------|
| **AppStateStorage** | Tasks, plans, CRDT `.bin`, goal metadata | `ping-app-state:/app/data` | Orchestrator only | ❌ Never — stays in orchestrator process |
| **WorkspaceStorage** | Git repos (team code) | `ping-workspaces:/app/workspaces` | Orchestrator + Chat Agents + containers | ✅ Clones bind-mounted into containers |

**Why separate volumes:**
- AppState is private to the orchestrator — containers must not read/modify task state, plans, or CRDT docs
- Workspaces must be cloneable/mountable into containers — sub-agents need read/write access to their task branch
- Different cloud sync strategies — app state syncs on every write; workspaces sync on task complete

#### Container Workspace Flow (Phase 6)

```
1. Orchestrator assigns task to Chat Agent, passes workspace ref
   Chat Agent checks: does workspaces/{teamId}/ exist? No → git init.

2. Chat Agent clones repo for the sub-agent:
   git clone workspaces/{teamId}/ workspaces/{teamId}-clones/task-{taskId}/
   cd workspaces/{teamId}-clones/task-{taskId}/
   git checkout -b task-{taskId}

3. Container launched with clone mounted:
   docker run -v workspaces/{teamId}-clones/task-{taskId}:/workspace ...

4. Sub-Agent inside container reads/writes /workspace (isolated clone)

5. Container exits → Sub-Agent has committed to task-{taskId} branch
   git push origin task-{taskId}   ← push branch back to main repo

6. Chat Agent in orchestrator:
   - Fetches the pushed branch
   - Reviews: merge to main? (or wait for user approval)
   - git merge task-{taskId} into main
   - Deletes clone directory: rm -rf workspaces/{teamId}-clones/task-{taskId}/
   - Syncs main repo to cloud storage
```

**Why clone-per-task (not worktrees):**
- Everyone understands clone/push/merge — worktrees are niche git
- Each clone is a fully independent directory — clean container isolation
- Cleanup is trivial — `rm -rf` the clone
- Works naturally with team stacking (child team branches in same repo)

**Chat Agent workspace creation:**
- First task ever for a team? Chat Agent calls `git init` + initial commit
- Subsequent tasks? Chat Agent clones from existing repo
- Chat Agent can also configure the workspace (`.gitignore`, base structure) before spawning sub-agents

#### Chat Agent as MCP Server (Session Owner)

The Chat Agent (Layer 2) is the **session owner** for its role. It exposes itself as an MCP server. Any agent — Ping's own AiSdkAgent, Claude Code, Cursor, another Ping team, or any MCP-compatible agent — connects to the Chat Agent to get work.

**The Chat Agent doesn't care WHO connects. It manages the session, validates capabilities, and provides tools.**

```
Chat Agent (Backend Dev) — MCP Server at /mcp/teams/{teamId}/roles/{roleId}
  │
  │ 1. Agent connects → Chat Agent identifies + validates
  │ 2. Agent requests task → Chat Agent creates session, provides context
  │ 3. Agent works → reports progress, asks questions via MCP tools
  │ 4. Agent completes → Chat Agent collects results, manages merge
  │
  ├── Connected: Ping AiSdkAgent (autonomous)
  ├── Connected: Claude Code (interactive, user's VS Code)  
  ├── Connected: Cursor Agent
  ├── Connected: Child Ping team (team stacking)
  └── Connected: Any MCP-compatible agent
```

**Agent Identification & Skill Validation (Connection Handshake):**

When an agent connects, the Chat Agent validates it can do the work:

```typescript
// MCP Server — connection handshake
server.addTool({
  name: 'connect',
  description: 'Register as a worker for this role. Chat Agent validates your capabilities.',
  parameters: z.object({
    agentId: z.string(),                    // unique agent identifier
    agentType: z.enum(['ping', 'claude-code', 'cursor', 'external-mcp', 'human']),
    capabilities: z.object({
      languages: z.array(z.string()),       // ["typescript", "python", ...]
      tools: z.array(z.string()),           // ["file_read", "file_write", "terminal", ...]
      skills: z.array(z.string()),          // ["react", "api-design", "testing", ...]
      canRunCode: z.boolean(),              // can execute code?
      canAccessNetwork: z.boolean(),        // can make HTTP requests?
      maxContextTokens: z.number().optional(), // context window size
    }),
    auth: z.object({
      token: z.string(),                    // session token from better-auth
      // OR
      apiKey: z.string().optional(),        // for external agents without user session
    }),
  }),
  execute: async ({ agentId, agentType, capabilities, auth }) => {
    // 1. Validate auth (better-auth session or API key)
    const user = await validateAuth(auth);
    
    // 2. Check capabilities against role requirements
    const role = await getRole(roleId);
    const missingSkills = role.requiredSkills.filter(
      s => !capabilities.skills.includes(s)
    );
    
    if (missingSkills.length > 0) {
      return {
        accepted: false,
        reason: `Missing required skills: ${missingSkills.join(', ')}`,
        requiredSkills: role.requiredSkills,
      };
    }
    
    // 3. Create session for this agent
    const session = await chatAgent.createWorkerSession({
      agentId, agentType, capabilities, userId: user.id,
    });
    
    return {
      accepted: true,
      sessionId: session.id,
      role: { name: role.name, description: role.description },
      activeTask: session.activeTask || null,  // task already assigned?
      workspace: session.workspacePath,         // where to find/create code
    };
  },
});
```

**Chat Agent validates:**
- ✅ Auth — is this a legitimate user/agent?
- ✅ Skills — does the agent have what the role needs? (e.g., Backend Dev role requires `typescript`, `api-design`)
- ✅ Capabilities — can it write files? run code? access network?
- ❌ Rejects agents that can't do the job — with clear reason + what's needed

**MCP Tools Provided to Connected Agents:**

Once connected, the agent gets these tools to interact with the Chat Agent:

```typescript
// === TASK TOOLS ===

'get_task'
// Returns: current task instructions, context, dependency outputs, workspace path
// Called: when agent starts working or resumes after pause
→ { taskId, instructions, context, dependencyOutputs, workspacePath, branchName }

'get_session_context'  
// Returns: full session history — past tasks, chat messages, role context
// Called: when agent needs background on what happened before
→ { roleDescription, pastTasks, recentMessages, planOverview }

// === PROGRESS TOOLS ===

'report_progress'
// Agent tells Chat Agent what it's doing (shown in Ping UI)
// Called: periodically during work
→ { message: "Created auth middleware, working on routes..." }

'report_status'
// Structured status update with metrics
→ { filesCreated: 3, filesModified: 1, testsAdded: 5, currentStep: "writing tests" }

// === COMMUNICATION TOOLS ===

'ask_question'
// Agent needs clarification — routes to user via Chat Agent
// Chat Agent may answer itself (from context) or forward to user
→ { question: "Should I use JWT or session tokens?" }
← { answer: "Use JWT, we need stateless auth" }

'ask_chat_agent'
// Agent asks the Chat Agent directly (not the user)
// For domain questions the Chat Agent can answer from its persistent memory
→ { question: "What database are we using?" }
← { answer: "MongoDB via Mongoose, see /src/db/config.ts" }

// === WORKSPACE TOOLS ===

'get_workspace_info'
// Returns workspace details — repo path, current branch, file tree
→ { repoPath, branch, fileCount, recentCommits }

'request_merge'
// Agent requests its branch be merged to main
// Chat Agent decides: auto-merge or wait for user approval
→ { branchName: "task-t001", summary: "Added auth API with 3 endpoints" }
← { merged: true } | { pending: "waiting for user approval" }

// === COMPLETION TOOLS ===

'complete_task'
// Signal task done with summary
// Chat Agent collects results, updates task state, triggers dependents
→ { summary: "Built auth API: login, register, refresh endpoints. 12 files, 95% test coverage.", 
    artifacts: ["src/auth/", "tests/auth/"] }

'hand_back'
// Agent can't or doesn't want to continue — hand back to Chat Agent
// Chat Agent can assign to different agent or pause
→ { reason: "Need human review before proceeding", workDoneSoFar: "..." }

// === SESSION TOOLS ===

'pause'
// Agent pausing (e.g., user stepping away from Claude Code)
// Chat Agent preserves session state
→ { reason: "user away" }

'resume'
// Agent resuming — get latest state (someone else may have worked on branch)
→ { taskId, latestCommit, updatedContext }
```

**Session Lifecycle:**

```
1. CONNECT    → Agent identifies itself, Chat Agent validates skills
2. GET_TASK   → Agent gets task + context + workspace
3. WORKING    → Agent reports progress, asks questions
4. SWITCH     → User switches to different agent (pause → new connect → resume)
5. COMPLETE   → Agent signals done → Chat Agent merges branch
6. DISCONNECT → Session closed, agent can reconnect later
```

```
Agent A (Ping autonomous) ──connect──→ Chat Agent
  │  get_task() → work → report_progress() → complete_task()
  │
  User: "Switch to Claude Code"
  │
  Agent A: pause() ──→ Chat Agent pauses session
  │
  Agent B (Claude Code) ──connect──→ Chat Agent validates skills
  │  get_task() → gets SAME task with Agent A's work-so-far
  │  resume() → picks up from latest commit
  │  work → report_progress() → complete_task()
  │
  Chat Agent: merge branch, assign next task
```

**What the Chat Agent tracks per session:**

```typescript
interface WorkerSession {
  sessionId: string;
  agentId: string;
  agentType: 'ping' | 'claude-code' | 'cursor' | 'external-mcp' | 'human';
  capabilities: AgentCapabilities;
  userId: string;
  
  // Task state
  activeTaskId: string | null;
  taskBranch: string | null;
  workspacePath: string | null;
  
  // Progress tracking
  progressMessages: { message: string; timestamp: Date }[];
  questionsAsked: { question: string; answer: string; timestamp: Date }[];
  
  // Lifecycle
  status: 'connected' | 'working' | 'paused' | 'completed' | 'disconnected';
  connectedAt: Date;
  lastActivityAt: Date;
}
```

**MCP endpoint per Chat Agent:**

```
/mcp/teams/{teamId}/roles/{roleId}
```

Each Chat Agent (one per role in a team) has its own MCP endpoint. Claude Code, Cursor, or any MCP client connects to the specific role's endpoint.

**VS Code / Claude Code configuration:**

```jsonc
// .vscode/mcp.json (or user settings)
{
  "servers": {
    "ping-backend-dev": {
      "url": "http://localhost:3002/mcp/teams/team-123/roles/backend-dev",
      "headers": { "Authorization": "Bearer <session-token>" }
    }
  }
}
```

Claude Code connects → calls `connect` tool → gets validated → calls `get_task()` → starts working. All progress visible in Ping UI. Seamless.

#### MCP Networking Model

**One MCP server per Ping backend.** Roles are routes, not separate processes.

```
Ping Backend (single process, port 3002)
  ├── Express HTTP API          → /api/v2/*
  ├── Socket.IO                 → ws://localhost:3002
  ├── better-auth               → /api/auth/*
  └── MCP Server (Streamable HTTP) → /mcp/*
        ├── /mcp/teams/{teamId}/roles/{roleId}   ← Chat Agent per role
        └── /mcp/teams/{teamId}/planner          ← Planner Agent
```

**Three connection scenarios:**

| Scenario | URL | Auth | Who Connects |
|----------|-----|------|-------------|
| **Local dev** | `http://localhost:3002/mcp/...` | better-auth session cookie | Claude Code, Cursor on your machine |
| **Same network** | `http://192.168.x.x:3002/mcp/...` | Bearer token | Team member's agent on LAN |
| **Remote** | `https://ping.company.com/mcp/...` | Bearer token + TLS | Another Ping instance, remote agent |

**Ping-to-Ping (team stacking across machines):**

```
Machine A (Parent Team)                  Machine B (Child Team)
┌────────────────────────┐              ┌─────────────────────────┐
│ Planner assigns task   │              │ MCP Server at           │
│ to child team →        │── HTTPS ──→  │ https://eng.co/mcp/     │
│                        │              │ teams/eng/planner       │
│ MCP client connects    │← SSE ←──────│ Streams progress back   │
└────────────────────────┘              └─────────────────────────┘
```

Child team configured in parent's Team settings (MongoDB):
```typescript
{ mcpEndpoint: "https://eng.co/mcp/teams/eng/planner", authToken: "encrypted-token" }
```

**The child Ping doesn't know the parent is also Ping.** It sees an MCP client = same as Claude Code connecting.

---

#### Future-Compatible Storage Design

Storage must work across all these scenarios from day one (even if we build incrementally):

| Phase | Scenario | Storage Need |
|-------|----------|-------------|
| **Now** | Single process, in-process agents | Local filesystem (`data/`) |
| **Phase 4** | Cloud deployment | Durable cloud sync (Azure Blob/S3) |
| **Phase 6** | Containerized workers | Clone-per-task, mountable volumes |
| **Future** | Agent switching (Ping ↔ Claude Code) | Workspace available on user's machine AND server |
| **Future** | Team stacking (Ping ↔ remote Ping) | Workspace accessible across machines via git remote |
| **Future** | Interactive mode | Same workspace editable by external agent |

**Key insight: Git is already the universal workspace sync mechanism.**

Git remotes solve ALL future scenarios:
- **Container needs workspace?** Clone from repo.
- **Claude Code needs workspace?** Clone from repo (or it's already local).
- **Remote Ping needs workspace?** Clone from git remote.
- **Merge work back?** Push branch, merge in main repo.
- **Sync to cloud?** Push to remote (GitHub, Azure DevOps, or bare git server).

**This means WorkspaceStorage should be git-remote-centric, not blob-storage-centric.**

#### Revised Storage Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         STORAGE LAYERS                               │
│                                                                     │
│  ┌─────────────── AppStateStorage ──────────────────────────┐       │
│  │  What: tasks, plans (JSON)                                │       │
│  │  Local: Docker volume ping-app-state:/app/data            │       │
│  │  Cloud: Azure Blob / S3 (async sync, backup)              │       │
│  │  Access: Orchestrator ONLY (never containers/agents)      │       │
│  └──────────────────────────────────────────────────────────┘       │
│                                                                     │
│  ┌─────────────── CollaborationService (CRDT) ──────────────┐       │
│  │  SEPARATE SERVICE in production (in-process for dev)       │       │
│  │  What: Yjs CRDT docs (plans, tasks, shared state, agent   │       │
│  │        status, chat outcomes, output manifests)            │       │
│  │  Runtime: Hocuspocus server (own Docker container in prod) │       │
│  │  Persistence: Docker volume ping-collab:/app/collab        │       │
│  │  Cloud: own sync (Hocuspocus provider or blob backup)      │       │
│  │  Access: Orchestrator + agents + users (real-time)         │       │
│  │                                                           │       │
│  │  Dev:  COLLAB_MODE=embedded  (runs inside backend process) │       │
│  │  Prod: COLLAB_MODE=external  (separate Docker container)   │       │
│  │        backend connects as client to ws://collab:1234      │       │
│  │                                                           │       │
│  │  Features (NOT just storage):                             │       │
│  │  ├── Real-time collab (WebSocket, concurrent edits)       │       │
│  │  ├── Document discovery (list/search docs by type)        │       │
│  │  ├── Text search & grep across all docs                   │       │
│  │  ├── Query (structured queries over Y.Map/Y.Array)        │       │
│  │  ├── Projection (CRDT → filesystem as JSON/MD/text)       │       │
│  │  ├── Conflict-free merge (Yjs CRDT, no git conflicts)    │       │
│  │  └── History (Yjs undo manager, snapshots)                │       │
│  │                                                           │       │
│  │  Access methods:                                          │       │
│  │  ├── `collab` tool (agents: discover, read, write, search)│       │
│  │  ├── WebSocket (users: BlockNote editor, real-time)       │       │
│  │  ├── MCP tool (external agents: search, read, write)      │       │
│  │  └── REST API (dashboard: queries, aggregates)             │       │
│  └──────────────────────────────────────────────────────────┘       │
│                                                                     │
│  ┌─────────────── WorkspaceStorage ─────────────────────────┐       │
│  │  What: git repos (team monorepos — code artifacts)        │       │
│  │  Local: Docker volume ping-workspaces:/app/workspaces     │       │
│  │  Remote: git remote (GitHub/Azure DevOps) — REQUIRED prod │       │
│  │  Access: Orchestrator + Chat Agents + containers + users  │       │
│  │                                                           │       │
│  │  The git remote URL is the UNIVERSAL workspace reference: │       │
│  │  ├── Ping agents: direct filesystem (or clone-per-task)   │       │
│  │  ├── Claude Code: receives { repoUrl, branch } from MCP  │       │
│  │  │   → clones itself, works, pushes branch back           │       │
│  │  ├── Remote Ping (team stacking): clones from same remote │       │
│  │  │   → works on prefixed branches → pushes back           │       │
│  │  └── User: pushes to GitHub on request                    │       │
│  └──────────────────────────────────────────────────────────┘       │
│                                                                     │
│  ┌─────────────── SessionStorage (MongoDB Atlas) ────────────┐      │
│  │  HOSTED MongoDB (Atlas free tier / Azure Cosmos DB)        │      │
│  │  NOT self-hosted in production — managed service           │      │
│  │  What: users, auth sessions, chat history, goal history    │      │
│  │  Also: teams, agents, skills, IndexSnapshots (existing)    │      │
│  │  Access: Orchestrator, API, Chat Agents                    │      │
│  │                                                           │      │
│  │  Dev:  Docker container (docker-compose.dev.yml)           │      │
│  │  Prod: MongoDB Atlas (free 512MB tier) or Azure Cosmos DB  │      │
│  │        Managed backups, scaling, monitoring — zero ops      │      │
│  └──────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────┘
```

**Four storage layers, four different sync mechanisms:**

| Layer | What | Dev | Prod | Sync | Who Accesses |
|-------|------|-----|------|------|-------------|
| **AppState** | Tasks, plans (JSON) | Local `data/` | Docker volume | Blob copy (async) → Azure Blob / S3 | Orchestrator only |
| **Collaboration** | CRDT docs (Yjs) | In-process Hocuspocus | **Separate Docker container** | Hocuspocus sync / blob backup | Orchestrator + agents + users |
| **Workspace** | Git repos (code) | Local `data/workspaces/` | Docker volume + **git remote (required)** | Git push/pull/clone | Orchestrator + agents + containers + external agents |
| **Session** | Users, chat, goals | Docker MongoDB | **MongoDB Atlas (hosted)** | DB replication (managed) | Orchestrator + API |

**Why CRDT is its own layer (not AppState):**

| AppState (tasks JSON) | CollaborationService (CRDT) |
|----------------------|---------------------------|
| Simple read/write by ID | Real-time concurrent edits by multiple agents + users |
| No search needed | Search, grep, query across all docs |
| Orchestrator access only | Agents access via `collab` tool, users via BlockNote, external agents via MCP |
| JSON files | Yjs binary (`.bin`) — completely different format |
| Blob copy to cloud works | Needs Yjs-aware sync (or snapshot-based backup) |
| No conflict resolution needed | CRDT = conflict-free by design |
| Phase 6: never enters containers | Phase 6: agents in containers access via WebSocket/MCP (not filesystem) |

**CRDT in containers (Phase 6):**

Containerized agents can't access CRDT docs on the filesystem — they're in isolated containers. Instead:
- Agent in container connects to Hocuspocus via **WebSocket** (same as users do)
- OR agent calls CRDT operations via **MCP tools** exposed by Chat Agent
- The CRDT server runs in the orchestrator process — containers are clients

```
Container (Sub-Agent)
  │ Can't access data/collab/yjs/ (no volume mount)
  │
  │ Instead connects via:
  ├── WebSocket → ws://orchestrator:1234 (Hocuspocus)
  └── MCP tools → collab_read, collab_write, collab_search (via Chat Agent)
```

This is already how the `collab` tool works — it doesn't do `fs.readFile()`, it talks to Hocuspocus.

#### CollaborationService Interface

```typescript
// packages/collaboration/src/CollaborationService.ts
export interface CollaborationService {
  // Document lifecycle
  openDoc(docName: string): Promise<YDoc>;
  closeDoc(docName: string): Promise<void>;

  // Discovery
  listDocs(prefix?: string): Promise<string[]>;         // list all docs by type
  
  // Search (across all docs)
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  grep(pattern: string, docFilter?: string): Promise<GrepResult[]>;
  
  // Structured query (over Y.Map fields)
  query(docName: string, filter: Record<string, any>): Promise<any[]>;
  
  // Read/Write (for programmatic access)
  read(docName: string, key?: string): Promise<any>;
  write(docName: string, key: string, value: any): Promise<void>;
  
  // Projection (CRDT → filesystem for read_file access)
  projectToFilesystem(docName: string, repoPath: string): Promise<void>;
  
  // Persistence
  getStoragePath(): string;                              // data/collab/yjs/
  flush(): Promise<void>;                                // force save all open docs
  
  // Server lifecycle
  getWebSocketUrl(): string;                             // ws://localhost:1234
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

**This already exists** — it's essentially what `HocuspocusServer` + `CollaborationSpace` do today. The interface just formalizes it as a **service**, not a file store.

#### AppStateStorage Interface

```typescript
export interface AppStateStorage {
  read(path: string): Promise<Buffer | null>;
  write(path: string, data: Buffer): Promise<void>;
  delete(path: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  sync(): Promise<void>;           // force sync to cloud
  pull(path: string): Promise<void>; // pull from cloud on cold start
}
```

Handles: `data/tasks/`, `data/plans/` — simple JSON files, orchestrator-only.

**Note:** As the data-persistence feature progresses, tasks and plans may migrate FROM AppState TO CollaborationService (CRDT docs become source of truth, per the [data-persistence architecture](../data-persistence/feature_architecture.md)). The AppStateStorage interface remains for any remaining non-CRDT files.

#### WorkspaceStorage Interface (Git-Centric)

```typescript
export interface WorkspaceStorage {
  // Repo lifecycle
  initRepo(teamId: string): Promise<string>;
  getRepoPath(teamId: string): string;
  repoExists(teamId: string): boolean;

  // Clone for workers (containers or in-process)
  cloneForTask(teamId: string, taskId: string, branch: string): Promise<string>;
  cleanupClone(teamId: string, taskId: string): Promise<void>;

  // Branch operations (on main repo)
  pushBranchToMain(teamId: string, taskId: string): Promise<void>;
  mergeBranch(teamId: string, branch: string): Promise<void>;

  // Remote sync (git push/pull to GitHub/Azure DevOps)
  addRemote(teamId: string, name: string, url: string): Promise<void>;
  pushToRemote(teamId: string, remote: string, branch?: string): Promise<void>;
  pullFromRemote(teamId: string, remote: string): Promise<void>;

  // Interactive mode (user/external agent works on workspace)
  getWorkspacePath(teamId: string, taskId?: string): string;
}
```

#### Where Data Lives — Complete Map

| Data | Storage Layer | Local Path | Cloud/Remote | Sync Trigger |
|------|--------------|------------|-------------|-------------|
| Tasks (state) | AppState | `data/tasks/{teamId}/` | Azure Blob / S3 | On every write (debounced 2s) |
| Plans (state) | AppState | `data/plans/{teamId}/` | Azure Blob / S3 | On plan change |
| CRDT docs | **Collaboration** | `data/collab/yjs/` | Hocuspocus cloud / blob backup | On every CRDT change |
| CRDT projections | **Collaboration** | `.ping/collaboration/` | Not synced (derived, rebuildable) | On CRDT onChange |
| Workspace code | Workspace | `workspaces/{teamId}/` | Git remote | On task complete + user request |
| Task clones | Workspace | `workspaces/{teamId}-clones/task-{id}/` | None (ephemeral) | Deleted after merge |
| Users, auth | Session/MongoDB | MongoDB | MongoDB Atlas | Real-time (DB replication) |
| Chat messages | Session/MongoDB | MongoDB | MongoDB Atlas | Real-time |
| Goal history | Session/MongoDB | MongoDB | MongoDB Atlas | Real-time |
| Team config | Session/MongoDB | MongoDB | MongoDB Atlas | Real-time |

#### Config (Revised)

```bash
# .env

# --- Storage ---
STORAGE_TYPE=fs                          # fs | cloud

# Cloud AppState sync (when STORAGE_TYPE=cloud)
CLOUD_STORAGE_PROVIDER=azure             # azure | s3
AZURE_STORAGE_CONNECTION_STRING=
AZURE_STORAGE_CONTAINER=ping-app-state

# --- Collaboration Service ---
COLLAB_MODE=embedded                     # embedded (dev) | external (prod)
COLLAB_URL=ws://collab:1234              # when COLLAB_MODE=external
COLLAB_PORT=1234                         # WebSocket port
COLLAB_STORAGE_DIR=./data/collab/yjs     # local persistence

# --- MongoDB ---
# Dev: local Docker
MONGODB_URI=mongodb://localhost:27017/ping
# Prod: hosted (uncomment)
# MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/ping?retryWrites=true

# --- Workspace Git Remote (REQUIRED for prod) ---
# Per-team overrides in MongoDB Team document
GIT_REMOTE_DEFAULT_URL=                  # e.g. https://github.com/org/workspace.git
GIT_REMOTE_DEFAULT_TOKEN=               # PAT for clone/push
```

#### Docker Compose (Production)

```yaml
services:
  collab:
    build:
      context: .
      dockerfile: packages/collaboration/Dockerfile
    container_name: ping-collab
    restart: unless-stopped
    ports: ["1234:1234"]
    volumes:
      - ping-collab:/app/collab
    environment:
      - MONGODB_URI=${MONGODB_URI}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:1234/health"]
      interval: 15s
      timeout: 5s
      retries: 3

  backend:
    build:
      context: .
      dockerfile: packages/backend/Dockerfile
    container_name: ping-backend
    restart: unless-stopped
    ports: ["3002:3002"]
    volumes:
      - ping-app-state:/app/data
      - ping-workspaces:/app/workspaces
    environment:
      - NODE_ENV=production
      - COLLAB_MODE=external
      - COLLAB_URL=ws://collab:1234
      - MONGODB_URI=${MONGODB_URI}
      - STORAGE_TYPE=cloud
    depends_on:
      collab: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3002/api/v2/health"]
      interval: 15s
      timeout: 5s
      retries: 3

  frontend:
    build:
      context: .
      dockerfile: packages/frontend/Dockerfile
    container_name: ping-frontend
    restart: unless-stopped
    ports: ["3000:80"]
    depends_on:
      backend: { condition: service_healthy }

volumes:
  ping-app-state:           # tasks, plans JSON (backend only)
  ping-collab:              # CRDT binary docs (collab service)
  ping-workspaces:          # git repos (cloneable into containers)
```

**Production topology:**
```
MongoDB Atlas (hosted) ←──→ Collab Service (container) ←──→ Backend (container) ←──→ Frontend (container)
                                    │                             │
                              ping-collab vol              ping-app-state vol
                                                          ping-workspaces vol
```

**No MongoDB container in prod** — Atlas handles backups, scaling, monitoring.
**Collab is its own container** — independent scaling, failure isolation.

#### Docker Compose (Dev)

```yaml
# docker-compose.dev.yml — MongoDB only
services:
  mongodb:
    image: mongo:7
    ports: ["27017:27017"]
    volumes: [ping-mongo-data:/data/db]
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
volumes:
  ping-mongo-data:
```

```bash
# Dev workflow — dead simple:
docker compose -f docker-compose.dev.yml up -d   # MongoDB only
bun run dev:backend                                # backend + embedded collab
bun run dev:frontend                               # frontend
```

#### Implementation Priority

| Phase | What to Build | Impact |
|-------|--------------|--------|
| **Phase 0 (Now)** | `FsAppStateStorage` + `FsWorkspaceStorage` interfaces | Wraps existing code. Three Docker volumes. |
| **Phase 0 (Now)** | MongoDB Atlas setup + session collections | ChatMessage, Goal, better-auth tables. Switch `MONGODB_URI` to Atlas. |
| **Phase 0 (Now)** | `CollaborationService` interface + `COLLAB_MODE` flag | Formalize existing Hocuspocus. Embedded for dev, external for prod. |
| **Phase 0 (Now)** | Collab Dockerfile | Packages `@ping/collaboration` as standalone container. |
| **Phase 0 (Now)** | Git remote config in Team model | `gitRemoteUrl` + `gitRemoteToken` fields. |
| **Phase 4** | Cloud sync for AppState | Azure Blob / S3 async sync. |
| **Phase 4** | Git remote push/pull | `pushToRemote()` + `pullFromRemote()` for workspace. |
| **Phase 4** | CRDT cloud backup | Blob backup of `.bin` files. |
| **Phase 5** | CRDT via MCP | Expose collab tools as MCP for external agents. |
| **Phase 5** | MCP server endpoints | `/mcp/teams/{teamId}/roles/{roleId}` — Chat Agent as MCP server. |
| **Phase 6** | Clone-per-task for containers | `cloneForTask()` + `cleanupClone()`. |
| **Phase 6** | Container collab access | Containers connect via `ws://collab:1234`. |

**What we build NOW vs what we defer:**

```
NOW (Phase 0):
  ✅ FsAppStateStorage (wraps existing fs calls)
  ✅ FsWorkspaceStorage (wraps existing GitBranchManager)
  ✅ CollaborationService interface + COLLAB_MODE flag
  ✅ Collab Dockerfile (standalone container for prod)
  ✅ MongoDB Atlas (switch MONGODB_URI, no self-hosted in prod)
  ✅ MongoDB: ChatMessage, Goal, better-auth collections
  ✅ Git remote fields in Team model
  ✅ Production docker-compose.yml (collab + backend + frontend)
  ✅ Shutdown flush (FileTaskStore.flush() + CollaborationService.flush())
  ✅ better-auth (real auth from day one)

DEFER (interfaces designed now):
  ⏳ Cloud sync (Azure Blob for AppState)
  ⏳ Git push/pull to remote (workspace)
  ⏳ CRDT cloud backup
  ⏳ MCP server (agent connections)
  ⏳ Clone-per-task (containers)
  ⏳ Container WebSocket to collab
```

The interfaces are designed so Phase 0 implementations wrap existing code, but support all future scenarios without breaking changes.

---

### Log Aggregation (Future — Not in This Phase)

Pino gives us structured JSON logs. But in production, logs need to **go somewhere** beyond stdout:

| Option | Platform | Integration |
|--------|----------|-------------|
| **Azure Monitor / App Insights** | Azure | pino → stdout → Azure Container logs (automatic) |
| **AWS CloudWatch** | AWS | `pino-cloudwatch` transport |
| **ELK Stack** | Self-hosted | `pino-elasticsearch` transport |
| **Datadog** | SaaS | `pino-datadog-transport` |
| **Better Stack (Logtail)** | SaaS | `@logtail/pino` transport |

**Not implementing now.** But our pino migration is designed for this — structured JSON output means any log aggregator can consume it. When we deploy to Azure, container logs automatically go to Azure Monitor. That may be enough initially.

**What to think about later:**
- Log retention policy (how long to keep)
- Error alerting (notify on error rate spikes)
- Request tracing (correlate logs across request lifecycle)
- Cost (cloud log storage can get expensive at scale)

---

### Dev vs Prod: Full Matrix

| Concern | Dev | Prod |
|---------|-----|------|
| MongoDB | Docker container (local) | **MongoDB Atlas (hosted)** — managed backups, zero ops |
| Collab (CRDT) | **Embedded** in backend process | **Separate container** (`ping-collab`) — failure isolation, independent scaling |
| Backend | `bun run dev:backend` (local) | Docker container |
| Frontend | `bun run dev:frontend` (Vite HMR) | Docker nginx |
| Auth | better-auth → email/password against local MongoDB | Same + OAuth (GitHub, Google) |
| Chat history | MongoDB (auto-saved) | Same (Atlas) |
| Goal history | MongoDB (auto-saved) | Same (Atlas) |
| Workspace code | Local `data/workspaces/` (no remote) | Docker volume + **git remote (required)** — external agents clone from here |
| App state files | Local `data/` filesystem | Docker volume `ping-app-state` + Azure Blob/S3 sync |
| Logs | pino-pretty → console | pino JSON → Azure Monitor / aggregator |
| Extra services | **None** — just MongoDB in Docker | Collab container + cloud storage credentials |

**Dev workflow — dead simple (unchanged):**
```bash
docker compose -f docker-compose.dev.yml up -d   # MongoDB only
bun run dev:backend                                # backend + embedded collab
bun run dev:frontend                               # frontend
```

**Prod deployment:**
```bash
# Set MONGODB_URI to Atlas connection string in .env
# Set GIT_REMOTE_DEFAULT_URL for workspace git remote
docker compose up -d --build                       # collab + backend + frontend
# MongoDB runs on Atlas (no container needed)
```

---

## Summary of Confirmed Decisions

| Concern | Decision | Key Details |
|---------|----------|-------------|
| Backend Logging | **Pino — single root + child loggers** | Replace tslog in 6 packages, `LOG_LEVEL` env var, JSON in prod, pino-pretty in dev |
| Frontend Logging | **Lightweight logger wrapper** | Suppress `debug`/`info` in prod, keep `warn`/`error`, update ~18 call sites |
| Feature Flags | **Typed config-based, dev/prod defaults** | `FeatureFlags` interface, dev=all on, prod=conservative, `FF_*` env overrides, `/api/v2/feature-flags` endpoint + React hook |
| AppState Storage | **Docker volume + cloud blob sync** | Tasks/plans JSON. `ping-app-state` volume. Azure Blob/S3 async sync. Orchestrator-only. |
| Collaboration (CRDT) | **Separate service (Hocuspocus container)** | `ping-collab` volume. Dev: embedded. Prod: own container at `ws://collab:1234`. Real-time sync, search, grep, query. |
| Workspace Storage | **Docker volume + git remote (required for prod)** | `ping-workspaces` volume. Git remote is the universal workspace reference — external agents (Claude Code) clone from it. |
| Workspace Git Remote | **Required for prod, per-team config** | External agents receive `{ repoUrl, branch }` from Chat Agent MCP → clone/push themselves. |
| MongoDB | **Hosted (Atlas) in prod, Docker in dev** | Zero ops in prod. Free tier 512MB. Managed backups + monitoring. |
| Auth | **better-auth (library)** | 27.7K stars, MIT, TypeScript. Email/password + OAuth. MongoDB adapter. No extra service. |
| Chat History | **MongoDB `ChatMessage`** | Server-side chat persistence, paginated API |
| Goal History | **MongoDB `Goal`** | Track all goals + outcomes, status lifecycle |
| Session Restore | **`/api/v2/sessions/:teamId/restore`** | One API call → full UI state |
| Agent Connection | **Chat Agent as MCP Server** | One MCP server per backend, per-role endpoints. Skill validation handshake. 12 tools for connected agents. |
| Agent Switching | **Seamless mid-task via git branch** | Pause agent A → agent B connects → same branch, same commits. Chat Agent manages handoff. |
| Ping-to-Ping | **MCP Streamable HTTP** | Parent connects to child's MCP endpoint. Same protocol as Claude Code. HTTPS + Bearer token for remote. |
| Log Aggregation | **Future** | Pino JSON → Azure Monitor / CloudWatch. Not in this phase. |

### Dev Workflow (Zero Headache)

```
MongoDB (Docker) ←→ Backend (local bun) ←→ Frontend (local Vite)
```
- One `docker compose -f docker-compose.dev.yml up -d` for MongoDB
- Everything else runs locally — fast restarts, no rebuild, data on disk
- Auth via email/password (better-auth) — real login, real sessions, from day one
- Chat + goal history auto-saved to same MongoDB — no extra setup
- File storage: local `data/` dirs — split AppState + Workspace + Collab in prod
- **No new services in dev** (just MongoDB in Docker). Prod adds: collab container + Atlas + cloud storage.
