# Local L2 — Implementation Planning

**Architecture:** [feature_architecture.md](feature_architecture.md)

---

## Version 1.0 — Electron Desktop App with Local-First + Auth

### Branch
`feature/desktop-app-v1.0`

### Scope
Ship a downloadable Electron desktop app (Ping Desktop) that:
- Works fully local (filesystem, no MongoDB required)
- Requires login (better-auth, trial + subscription)
- Supports opt-in cloud sync (blob storage, MongoDB)
- Auto-updates via GitHub Releases

### Implementation Steps

#### Phase 1: lowdb Service Layer (make MongoDB optional)

- [ ] **Step 1: Define service interfaces**
  - Create `packages/backend/services/interfaces/` folder
  - `ITeamService.ts`, `IAgentService.ts`, `ISkillService.ts`, `IChatService.ts`, `IGoalService.ts`
  - Extract method signatures from existing Mongoose service code
  - Files: `packages/backend/services/interfaces/*.ts`

- [ ] **Step 2: Extract current Mongoose services into MongoXxxService**
  - Rename/wrap existing service code as `MongoTeamService`, `MongoAgentService`, etc.
  - Each implements the corresponding interface from Step 1
  - Files: `packages/backend/services/mongo/*.ts`

- [ ] **Step 3: Implement lowdb file-based services**
  - Install `lowdb` in `packages/backend`
  - `FileTeamService`, `FileAgentService`, `FileSkillService`, `FileChatService`, `FileGoalService`
  - Data stored in `data/` dir as JSON files
  - Files: `packages/backend/services/file/*.ts`
  - ~270 lines total

- [ ] **Step 4: Service factory + startup bypass**
  - Create `packages/backend/services/factory.ts`
  - If `MONGODB_URI` present → MongoXxxService + `connectDB()`
  - If absent → FileXxxService (skip MongoDB entirely)
  - Update `packages/backend/server.ts` startup to use factory
  - Update `packages/backend/config/index.ts` to make `MONGODB_URI` optional
  - Files: `packages/backend/services/factory.ts`, `packages/backend/server.ts`, `packages/backend/config/index.ts`

- [ ] **Step 5: Seed data for local mode**
  - Create `packages/backend/scripts/seeds/local.seed.ts`
  - Pre-populates `data/teams.json`, `data/agents.json`, `data/skills.json` with starter data
  - Run via `bun run seed:local`

#### Phase 2: Hocuspocus StorageProvider Adapter

- [ ] **Step 6: HocuspocusBlobStorageAdapter**
  - Create adapter bridging `StorageProvider` (string) ↔ Database extension (Buffer)
  - File: `packages/collaboration/src/L2/collaboration/HocuspocusBlobStorageAdapter.ts`
  - ~15 lines

- [ ] **Step 7: Wire StorageProvider into HocuspocusServer**
  - Update `CollabServer` constructor to accept optional `StorageProvider`
  - If provided, use adapter for fetch/store instead of raw fs
  - File: `packages/collaboration/src/L2/collaboration/HocuspocusServer.ts`
  - ~10 lines changed

- [ ] **Step 8: L2_STORAGE_TYPE env config**
  - Add factory: `fs` (default) | `azure` | `s3`
  - Wire into `L2CollaborationPlugin` initialization
  - Files: `packages/backend/config/index.ts`, `packages/backend/agentManager/AgentManagerRegistry.ts`

#### Phase 3: Auth + Subscription (Server-Side Trial, No Local Bypass)

**Packages evaluated:**
- **Keygen.sh** — Full licensing API (trials, subscriptions, device lock, offline ed25519). Free self-hosted CE edition. Overkill for now, migrate later if needed.
- **better-auth** (already installed) — Auth + sessions. Extend with subscription field. **Use this.**
- **Stripe** — Payments + recurring billing. **Use this.**

**Key security decision:** Trial requires account registration. No anonymous trial. Trial expiry lives on the server, not in local files. User cannot tamper with trial without hacking the server.

- [ ] **Step 9: Subscription model + trial on server**
  - Extend better-auth user metadata: `subscription: { plan: 'trial'|'solo'|'team', active: boolean, expiresAt: string, stripeCustomerId?: string }`
  - On `POST /api/auth/sign-up/email` → auto-create trial: `plan: 'trial', active: true, expiresAt: now + 14 days`
  - Add `GET /api/subscription/status` endpoint:
    - Validates session token
    - Checks `subscription.expiresAt` and `subscription.active`
    - Returns signed JWT with `{ plan, active, expiresAt }` (ed25519 — can verify offline)
  - Files: `packages/backend/auth/index.ts`, `packages/backend/api/HttpServer.ts`

- [ ] **Step 10: Stripe webhook (serverless)**
  - Create standalone webhook function: `packages/backend/api/webhooks/stripe.ts`
  - Handles:
    - `checkout.session.completed` → set `plan: 'solo'`, `active: true`, `stripeCustomerId`
    - `customer.subscription.deleted` → set `active: false`
    - `customer.subscription.updated` → update plan/expiry
    - `invoice.payment_failed` → set `active: false` after retries exhausted
  - Deployable to Vercel/Cloudflare Workers
  - ~50 lines

- [ ] **Step 11: Frontend auth screens**
  - `SignUpScreen.tsx` — email/password + "Start 14-day trial" button
  - `LoginScreen.tsx` — email/password for returning users
  - `TrialBanner.tsx` — persistent banner: "X days left. [Subscribe]"
  - `SubscriptionExpired.tsx` — full-screen lock: "[Renew] or [Log Out]"
  - `OfflineBanner.tsx` — "Offline mode (X days remaining)"
  - All screens shown BEFORE the main app — app is inaccessible without valid session
  - Files: `packages/frontend/components/auth/*.tsx`, `packages/frontend/App.tsx`

- [ ] **Step 12: Auth state hook**
  - Create `useAuth.ts` hook:
    - On mount: calls `GET /api/auth/get-session`
    - If session valid: calls `GET /api/subscription/status`
    - Returns: `{ status: 'unauthenticated' | 'trial' | 'active' | 'expired', user, daysLeft }`
    - Caches signed JWT in localStorage for offline verification
  - File: `packages/frontend/hooks/useAuth.ts`

**Auth flow in the app (no local bypass possible):**
```
App launch (Electron or web)
    ↓
useAuth() checks session
    ├── No session → show SignUpScreen or LoginScreen
    │   └── User must create account (trial starts server-side)
    │
    └── Has session → GET /api/subscription/status
        ├── { active: true, plan: 'trial' } → show app + TrialBanner
        ├── { active: true, plan: 'solo' } → show app (no banner)
        ├── { active: false } → show SubscriptionExpired (app locked)
        └── Offline → verify cached signed JWT
            ├── JWT valid + cached < 30 days → show app + OfflineBanner
            └── Otherwise → "Connect to internet"
```

#### Phase 4: Electron Desktop Shell

- [ ] **Step 13: Create `packages/desktop` package**
  - `package.json` (`@ping/desktop`, Electron + Electron Forge deps)
  - `forge.config.ts` (makers: squirrel, dmg, deb)
  - `tsconfig.json`
  - Resources: icons (icns, ico, png)

- [ ] **Step 14: Electron main process**
  - `src/main.ts`: app lifecycle, `startBackend()`, `createWindow()`, `createTray()`
  - Spawn backend as `utilityProcess.fork()`
  - Backend env: `PORT=3002`, `DATA_DIR=app.getPath('userData')`, no `MONGODB_URI`
  - Wait for backend "ready" message before showing window
  - File: `packages/desktop/src/main.ts`

- [ ] **Step 15: Backend entry for UtilityProcess**
  - `src/backend-entry.ts`: imports and starts `@ping/backend` server
  - Sends `process.parentPort.postMessage('ready')` when server is listening
  - File: `packages/desktop/src/backend-entry.ts`

- [ ] **Step 16: Preload script**
  - `src/preload.ts`: expose desktop APIs via `contextBridge`
  - `window.ping.isDesktop`, `window.ping.appVersion`, `window.ping.dataDir`
  - File: `packages/desktop/src/preload.ts`

- [ ] **Step 17: Auth gate in Electron**
  - On app launch, Electron main process checks for cached session token in `electron-store`
  - If no token → window loads sign-up/login page (user MUST create account)
  - If token exists → backend validates via `/api/subscription/status` (online check)
  - Offline fallback: verify signed JWT (ed25519 public key baked into binary) + 30-day cache window
  - If expired → window shows "Renew Subscription" — backend does not start agent orchestration
  - **No anonymous trial, no local trial file, no bypass possible**
  - File: `packages/desktop/src/auth-gate.ts`

- [ ] **Step 18: Window loading strategy**
  - Dev mode: `mainWindow.loadURL('http://localhost:3000')` (Vite HMR)
  - Production: `mainWindow.loadFile(frontendBuildPath)` (Vite build output copied into desktop package)
  - File: `packages/desktop/src/main.ts`

#### Phase 5: Build & Distribution

- [ ] **Step 19: Build pipeline**
  - `bun run desktop:dev` → starts Electron in dev (Vite + backend hot reload)
  - `bun run desktop:build` → builds backend + frontend + Electron package
  - `bun run desktop:make` → creates platform installers (.exe, .dmg, .deb)
  - Add scripts to root `package.json`

- [ ] **Step 20: Auto-updater**
  - Install `update-electron-app`
  - Configure: S3 static storage or GitHub Releases
  - Check for updates on startup + every 30 minutes
  - Prompt user: "Update available. Restart?"
  - File: `packages/desktop/src/updater.ts`

- [ ] **Step 21: Monorepo integration**
  - Add `packages/desktop` to workspace in root `package.json`
  - Ensure `@ping/backend` and `@ping/frontend` build outputs are available to desktop
  - Add `.gitignore` for `packages/desktop/out/`
  - Test: clone repo → `bun install` → `bun run desktop:dev` works

---

### Dependencies Between Steps

```
Phase 1 (lowdb services):  Steps 1-5 (sequential)
Phase 2 (storage adapter): Steps 6-8 (sequential, can start parallel to Phase 1)
Phase 3 (auth + stripe):   Steps 9-12 (sequential, depends on Phase 1 Step 4)
Phase 4 (electron shell):  Steps 13-18 (sequential, depends on Phase 1 + 3)
Phase 5 (build + dist):    Steps 19-21 (depends on Phase 4)
```

```
Phase 1 ──────────────────────┐
Phase 2 ─────────┐            ├──▶ Phase 4 ──▶ Phase 5
Phase 3 ─────────┴────────────┘
```

Phase 1 and 2 can run in parallel. Phase 3 needs Step 4 (factory). Phase 4 needs all prior phases. Phase 5 is last.

---

### Testing Strategy

| Area | Test Type | What |
|---|---|---|
| File services (lowdb) | Unit | CRUD operations, data persistence, edge cases |
| Service factory | Integration | Correct service selected based on env |
| StorageProvider adapter | Unit | Buffer ↔ string conversion, fetch/store |
| Auth + subscription | Integration | Trial flow, login, expired state |
| Electron main process | E2E | App starts, backend spawns, window loads |
| Auto-updater | Manual | Publish test release, verify update prompt |

### Rollback Plan

- Phase 1-3: behind `MONGODB_URI` check — existing Mongo path untouched
- Phase 4: separate `packages/desktop` — doesn't affect web/server deployment
- Phase 5: auto-updater can be disabled via env flag

---

### Files Summary

**New files (~15):**
```
packages/backend/services/interfaces/     (5 interface files)
packages/backend/services/file/           (5 lowdb service files)
packages/backend/services/factory.ts
packages/collaboration/src/L2/collaboration/HocuspocusBlobStorageAdapter.ts
packages/backend/api/webhooks/stripe.ts
packages/frontend/components/auth/        (3 components)
packages/frontend/hooks/useAuth.ts
packages/desktop/                         (entire new package)
```

**Modified files (~5):**
```
packages/backend/server.ts                (startup: use factory)
packages/backend/config/index.ts          (MONGODB_URI optional)
packages/collaboration/.../HocuspocusServer.ts  (accept StorageProvider)
packages/backend/auth/index.ts            (subscription field)
packages/frontend/App.tsx                 (auth gate)
root package.json                         (desktop scripts, workspace)
```
