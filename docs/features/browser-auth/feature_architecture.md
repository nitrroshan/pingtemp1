# Browser-Based Auth for Local Mode — Architecture

**Status:** Planned
**Date:** April 12, 2026
**Related:** [Local-First Desktop](../local-first-desktop/feature_architecture.md), [Production Grade Auth](../production-grade/feature_architecture.md)

---

## Problem

Currently local mode has two bad options:
1. **Skip auth entirely** (`isDesktop` flag) — no identity, no audit trail
2. **Run local SQLite auth** — requires seeding admin user, managing passwords locally, disconnected from cloud identity

What users expect (like Claude Code, GitHub CLI, Vercel CLI):
- Run `ping login` or click "Sign in" in the local UI
- Browser opens → authenticate with cloud account (Google, GitHub, email)
- Token stored locally → local app is authenticated
- No local password management, no SQLite auth DB needed

---

## Design

### How It Works

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Local Ping App  │     │    Browser        │     │  Cloud Auth     │
│  (localhost:3002)│     │                   │     │  (ping.dev)     │
│                  │     │                   │     │                 │
│  1. Start login ─┼────▶│  2. Opens auth    │     │                 │
│                  │     │     page          │────▶│  3. User logs   │
│                  │     │                   │     │     in (OAuth)  │
│                  │     │  4. Redirect with │◀────│                 │
│                  │     │     auth code     │     │  5. Exchange    │
│  6. Receive     ◀┼─────│                   │     │     for token   │
│     token        │     │                   │     │                 │
│  7. Store in     │     │                   │     │                 │
│     ~/.ping/     │     │                   │     │                 │
│     credentials  │     │                   │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### Two Auth Flows

| Flow | When | How |
|------|------|-----|
| **Device Code** | CLI (`ping login`) | Show URL + code in terminal. User visits URL, enters code. Server polls for token. |
| **Localhost Redirect** | Browser UI (desktop app, `localhost:3002`) | Open browser tab to cloud auth. Redirect back to `localhost:3002/auth/callback` with token. |

### Token Storage

```
~/.ping/
├── credentials.json      # { token, refreshToken, expiresAt, user }
└── config.json            # { cloudUrl: "https://ping.dev" }
```

- Token refreshed automatically before expiry
- `ping logout` clears credentials
- Token never sent to local SQLite — it goes directly to cloud API

### PING_MODE Behavior

| Mode | Auth | Storage |
|------|------|---------|
| `local` | Browser-based login → cloud auth → local token | Files (lowdb + plugins) |
| `cloud` | Standard login page (email/password, OAuth) | MongoDB for chat, files for rest |

### What Changes

| Component | Current | After |
|-----------|---------|-------|
| **Local auth** | SQLite `data/auth.db` + seeded admin user | Browser redirect → cloud token stored in `~/.ping/credentials.json` |
| **Frontend auth guard** | `useSession()` from better-auth | Check local token file OR `useSession()` based on mode |
| **Backend auth middleware** | better-auth `toNodeHandler()` | Local: verify token from `~/.ping/credentials.json`. Cloud: better-auth as-is |
| **`ping login` CLI** | Doesn't exist | Opens browser, receives token via localhost callback |
| **Admin seed** | `bun run seed:admin` | Not needed — user logs in via cloud account |

---

## Implementation Steps

### Step 1: Cloud Auth Endpoint
**Server:** Cloud deployment only (not local)

Add OAuth provider support to better-auth config:
- Google OAuth
- GitHub OAuth
- Email magic link (passwordless)

These run on the cloud deployment (`ping.dev`) and issue JWT tokens.

### Step 2: Device Code Flow (CLI)
**Files:** `packages/backend/auth/deviceCode.ts`, `packages/desktop/cli/login.ts`

```typescript
// CLI:
// 1. POST /api/auth/device/code → { deviceCode, userCode, verificationUrl }
// 2. Display: "Visit https://ping.dev/device and enter code: ABCD-1234"
// 3. Poll: POST /api/auth/device/token { deviceCode } until token received
// 4. Save token to ~/.ping/credentials.json
```

### Step 3: Localhost Redirect Flow (Desktop/Browser)
**Files:** `packages/backend/auth/localRedirect.ts`

```typescript
// 1. GET /auth/login → redirect to https://ping.dev/auth?redirect=http://localhost:3002/auth/callback
// 2. User authenticates on cloud
// 3. Cloud redirects to http://localhost:3002/auth/callback?token=...
// 4. Backend receives token, stores in ~/.ping/credentials.json
// 5. Frontend detects auth, loads app
```

### Step 4: Token Verification Middleware
**Files:** `packages/backend/auth/localAuth.ts`

In local mode, replace better-auth handler with simple token verification:
```typescript
// Read ~/.ping/credentials.json
// Verify token is not expired
// If expired, use refreshToken to get new token from cloud
// Inject user info into request
```

### Step 5: Frontend Auth Mode Detection
**Files:** `packages/frontend/App.tsx`, `packages/frontend/lib/auth-client.ts`

```typescript
// GET /api/v2/auth-mode → { mode: "local" | "cloud" }
// local: check if token exists → if not, show "Sign in with Browser" button
// cloud: use existing useSession() + LoginPage
```

### Step 6: Token Refresh + Logout
**Files:** `packages/backend/auth/tokenManager.ts`

- Auto-refresh before expiry
- `ping logout` / Sign Out button clears `~/.ping/credentials.json`
- Revoke token on cloud side

---

## Dependencies

- Cloud deployment with OAuth providers configured
- `open` package (to open browser from Node.js)
- Cloud-side `/api/auth/device/code` and `/api/auth/device/token` endpoints

## Feature Flag

```env
# In cloud deployment:
AUTH_MODE=cloud       # Standard better-auth login page

# In local deployment:
AUTH_MODE=browser     # Browser-based redirect to cloud auth
```

## Security

- Localhost redirect only accepts `127.0.0.1` and `localhost` origins
- Device codes expire after 5 minutes
- Tokens stored with user-only file permissions (0600)
- Refresh tokens are single-use (rotated on each refresh)
- No secrets stored in the local app — only short-lived tokens
