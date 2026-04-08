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

#### All File Storage (Workspaces + App State) → Docker Volume + Cloud Sync

Everything in `data/` — workspace git repos, tasks, CRDT docs, plans — uses a **two-layer** approach in production:

| Layer | Purpose | Speed | Durability |
|-------|---------|-------|------------|
| **Docker volume** (`ping-backend-data:/app/data`) | Local working directory | Fast (disk I/O) | Survives container restart, NOT server death |
| **Cloud storage** (Azure Blob / S3) | Durable backup, source of truth | Slower (network) | Survives everything — server crash, migration, scaling |

**How it works:**

```
Write: App → local data/ (Docker volume) → async sync → Cloud (Azure Blob / S3)
Read:  App → local data/ (Docker volume, fast)
Cold start: Cloud → pull to local data/ → then serve from local
```

1. **Normal operation:** All reads/writes hit local `data/` (Docker volume) for speed
2. **After write:** `StorageProvider` async-syncs changed files to cloud storage (debounced)
3. **Server crash/restart:** Container starts → `StorageProvider` pulls missing files from cloud → ready
4. **New server (scaling):** Same flow — pull from cloud on first access

| Mode | Local | Cloud | Behavior |
|------|-------|-------|----------|
| **Dev** | `data/` (bare disk) | None | Reads/writes to local filesystem only. Zero setup. |
| **Prod** | Docker volume `ping-backend-data:/app/data` | Azure Blob / S3 | Write-through: local + async cloud sync |

**Implementation approach — `StorageProvider` with local cache + cloud sync:**

```typescript
// packages/backend/storage/StorageProvider.ts
export interface StorageProvider {
  read(path: string): Promise<Buffer | null>;
  write(path: string, data: Buffer): Promise<void>;
  delete(path: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  sync(): Promise<void>;           // force sync pending changes to cloud
  pull(path: string): Promise<void>; // pull from cloud to local (cold start)
}

// Implementations:
// - FsStorageProvider (dev — local only, no cloud sync)
// - CloudSyncStorageProvider (prod — local disk + async sync to Azure/S3)
//     wraps: FsStorageProvider (local) + AzureBlobClient or S3Client (cloud)
```

**Config:**
```bash
# .env
STORAGE_TYPE=fs                          # fs | cloud
# Cloud backend (when STORAGE_TYPE=cloud)
CLOUD_STORAGE_PROVIDER=azure             # azure | s3
# Azure Blob
AZURE_STORAGE_CONNECTION_STRING=
AZURE_STORAGE_CONTAINER=ping-data
# AWS S3
AWS_S3_BUCKET=ping-data
AWS_REGION=us-east-1
```

**Priority for implementation:**
1. **Now:** `FsStorageProvider` (already how it works — just wrap in interface)
2. **Soon:** Azure Blob when deploying to Azure
3. **Later:** S3 if deploying to AWS

**What Dify does:** Same pattern — `STORAGE_TYPE` env var, default `OPENDAL_SCHEME=fs` (local), pluggable to S3/Azure/GCS.

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
| MongoDB | `docker compose -f docker-compose.dev.yml up -d` | MongoDB Atlas or Azure Cosmos DB |
| Backend | `bun run dev:backend` (local) | Docker container |
| Frontend | `bun run dev:frontend` (Vite HMR) | Docker nginx |
| Auth | better-auth → email/password against local MongoDB | Same + OAuth (GitHub, Google) |
| Chat history | MongoDB (auto-saved) | Same |
| Goal history | MongoDB (auto-saved) | Same |
| Workspace code | Local `data/workspaces/` (no remote) | Cloud storage (StorageProvider) + push to GitHub on user request |
| App state files | Local `data/` filesystem | Docker volume (fast) + async sync to Azure Blob/S3 (durable) |
| Logs | pino-pretty → console | pino JSON → Azure Monitor / aggregator |
| Extra services | **None** — just MongoDB | Same + cloud storage credentials |

**Dev workflow stays exactly the same:**
```bash
docker compose -f docker-compose.dev.yml up -d   # MongoDB
bun run dev:backend                                # backend
bun run dev:frontend                               # frontend
```

---

## Summary of Confirmed Decisions

| Concern | Decision | Key Details |
|---------|----------|-------------|
| Backend Logging | **Pino — single root + child loggers** | Replace tslog in 6 packages, `LOG_LEVEL` env var, JSON in prod, pino-pretty in dev |
| Frontend Logging | **Lightweight logger wrapper** | Suppress `debug`/`info` in prod, keep `warn`/`error`, update ~18 call sites |
| Feature Flags | **Typed config-based, dev/prod defaults** | `FeatureFlags` interface, dev=all on, prod=conservative, `FF_*` env overrides, `/api/v2/feature-flags` endpoint + React hook |
| Production Storage | **Docker volume (local speed) + cloud sync (durability)** | `STORAGE_TYPE=fs` (dev, local only) / `cloud` (prod, Docker volume + async sync to Azure Blob/S3) |
| Workspace Code | **Cloud storage + push to GitHub on user request** | Stored via `StorageProvider`. User clicks "Push to GitHub" → backend pushes to configured remote. |
| Auth | **better-auth (library)** | 27.7K stars, MIT, TypeScript. Email/password + OAuth. MongoDB adapter. No extra service. |
| Chat History | **MongoDB `ChatMessage`** | Server-side chat persistence, paginated API |
| Goal History | **MongoDB `Goal`** | Track all goals + outcomes, status lifecycle |
| Session Restore | **`/api/v2/sessions/:teamId/restore`** | One API call → full UI state (team + goals + messages + tasks + plan) |
| Log Aggregation | **Future** | Pino JSON → Azure Monitor / CloudWatch. Not in this phase. |

### Dev Workflow (Zero Headache)

```
MongoDB (Docker) ←→ Backend (local bun) ←→ Frontend (local Vite)
```
- One `docker compose -f docker-compose.dev.yml up -d` for MongoDB
- Everything else runs locally — fast restarts, no rebuild, data on disk
- Auth via email/password (better-auth) — real login, real sessions, from day one
- Chat + goal history auto-saved to same MongoDB — no extra setup
- File storage: local `data/` dir — Azure Blob in prod via `STORAGE_TYPE` env var
- **No new services in dev. Cloud storage + git remote only in prod.**
