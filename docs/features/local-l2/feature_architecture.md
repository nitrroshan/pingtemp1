# Local L2 — Hocuspocus with Pluggable Storage — Feature Architecture

**Status:** Decided (Option A)  
**Date:** April 8, 2026  
**Decision:** Keep embedded Hocuspocus for both local and production. Swap filesystem → cloud blob storage (S3/Azure/GCS) via StorageProvider adapter. MongoDB sync is opt-in for dashboards/aggregate queries.

---

## Product Vision: Local-First, Cloud-Optional

Like VS Code's local vs. remote index — the app works fully offline out of the box. Users opt in to cloud sync when they need it.

```
┌────────────────────────────────────────────────────────────────┐
│                    PING Agent Manager                          │
│                                                                │
│  Default (zero config):                                        │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐ │
│  │ Agents + User │───▶│  Hocuspocus  │───▶│  Local Filesystem│ │
│  │  (CRDT sync)  │    │  (embedded)  │    │  data/collab/    │ │
│  └──────────────┘    └──────────────┘    └──────────────────┘ │
│                                                                │
│  Opt-in cloud sync (add credentials to .env):                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐ │
│  │ Agents + User │───▶│  Hocuspocus  │───▶│  Azure Blob / S3 │ │
│  │  (CRDT sync)  │    │  (embedded)  │    │  (shared state)  │ │
│  └──────────────┘    └──────────────┘    └──────────────────┘ │
│                              │                                 │
│                              │ opt-in                          │
│                              ▼                                 │
│                       ┌──────────────┐                         │
│                       │   MongoDB    │                         │
│                       │ (dashboards, │                         │
│                       │  analytics)  │                         │
│                       └──────────────┘                         │
└────────────────────────────────────────────────────────────────┘
```

### Tiers

| Tier | Config needed | What you get |
|---|---|---|
| **Local** (default) | Nothing — just `bun run dev` | Full agent orchestration, CRDT co-editing, filesystem persistence. Works offline. |
| **+ Cloud Blob** | `L2_STORAGE_TYPE=azure` + connection string | CRDT state backed up to cloud. Survives machine loss. Shareable across team. |
| **+ MongoDB** | `MONGODB_URI=...` | Dashboard queries, cross-goal analytics, execution history. Optional derived index. |
| **+ Remote Hocuspocus** | `COLLAB_PROVIDER_URL=wss://...` | Distributed agents on separate machines, horizontal scaling. |

### User Experience

```bash
# Tier 0: Local (developer laptop, hackathon, POC)
bun run dev
# → Everything works. Files in data/collab/. No accounts, no cloud.

# Tier 1: + Cloud blob (small team, shared state)
echo 'L2_STORAGE_TYPE=azure' >> .env
echo 'AZURE_STORAGE_CONNECTION_STRING=...' >> .env
echo 'AZURE_COLLAB_CONTAINER=ping-collab' >> .env
bun run dev
# → Same app, CRDT state now in Azure Blob. Team members share state.

# Tier 2: + MongoDB (dashboards, analytics)
echo 'MONGODB_URI=mongodb://...' >> .env
bun run dev
# → Plan/task history queryable. Dashboard works.

# Tier 3: + Remote Hocuspocus (distributed agents)
echo 'COLLAB_PROVIDER_URL=wss://collab.mycompany.com' >> .env
bun run dev
# → Agents can run on separate machines, all sync via remote CRDT server.
```

**Key principle:** Each tier is additive. No tier requires the previous. A user can skip straight to Tier 2 (local + MongoDB) without blob storage.

### Open Issue: MongoDB Is Currently Required

**Today, `MONGODB_URI` is required at startup** — the server crashes without it. Teams, agents, skills, chat history, and goals are all stored in MongoDB. This conflicts with the Tier 0 "zero config" vision.

**What currently lives in MongoDB (9 collections):**

| Collection | What | Local Alternative |
|---|---|---|
| Team | Team CRUD, membership | JSON file or lowdb |
| Agent | Agent definitions, config | YAML files (already exist on disk) |
| TeamMember | Role assignments | Part of team config file |
| AgentSkill | Skill assignments | Part of agent config |
| Skill | Global skill registry | JSON/YAML registry |
| ChatMessage | Conversation history | JSON files per team |
| Goal | Team objectives | JSON files per team |
| TeamConfig | Orchestration state | JSON config snapshot |
| AgentRole | Role definitions | YAML agent definitions |

**CRDT state and plans/tasks** are already filesystem-based (FilePlanStore, FileTaskStore, Hocuspocus `.bin` files). Only the CRUD/management layer depends on MongoDB.

**Paths to true Tier 0 (decided: Path C — lowdb for local CRUD):**

| Path | Description | Effort | Verdict |
|---|---|---|---|
| ~~A: Make MongoDB optional~~ | Raw fs service rewrites | High | Over-engineered |
| ~~B: Embedded MongoDB~~ | `mongodb-memory-server` or Docker | Low | Not truly local-first |
| **C: lowdb for local CRUD** | **Service interfaces + lowdb JSON files locally, Mongoose when MongoDB available** | **Medium** | **Chosen ✅** |

### Decision: lowdb for Local CRUD

Create service interfaces (e.g. `ITeamService`, `IAgentService`) with two implementations:
- `FileTeamService` (lowdb, JSON files) — used when `MONGODB_URI` is absent
- `MongoTeamService` (Mongoose) — used when `MONGODB_URI` is present

Factory selects at startup based on env:

```typescript
function createTeamService(): ITeamService {
  return process.env.MONGODB_URI
    ? new MongoTeamService()
    : new FileTeamService('data/teams.json');
}
```

**Services to implement:**

| Service | File Version | Data File | Lines |
|---|---|---|---|
| TeamService | `FileTeamService` | `data/teams.json` | ~60 |
| AgentService | `FileAgentService` | `data/agents.json` | ~50 |
| SkillService | `FileSkillService` | `data/skills.json` | ~50 |
| ChatMessageService | `FileChatService` | `data/chats/{teamId}.json` | ~40 |
| GoalService | `FileGoalService` | `data/goals/{teamId}.json` | ~40 |
| TeamMemberService | `FileTeamMemberService` | Part of `data/teams.json` | ~30 |

**Total:** ~270 lines of new file implementations + ~30 lines factory/startup.

### Final Tier Model

| Tier | CRUD Storage | L2 (CRDT) Storage | MongoDB | Config |
|---|---|---|---|---|
| **0: Local** | lowdb (JSON files) | Hocuspocus → filesystem | Not needed | `bun run dev` |
| **1: +Cloud blob** | lowdb (JSON files) | Hocuspocus → S3/Azure | Not needed | `L2_STORAGE_TYPE=azure` |
| **2: +MongoDB** | Mongoose (MongoDB) | Hocuspocus → filesystem or blob | Connected | `MONGODB_URI=...` |
| **3: +Remote CRDT** | Mongoose (MongoDB) | Remote Hocuspocus | Connected | `COLLAB_PROVIDER_URL=wss://...` |

---

## Desktop App: `packages/desktop` (Electron)

### Why Electron

The goal is a **double-click-to-run desktop app** — like VS Code, Slack, Claude, Obsidian. Electron is the proven choice:
- VS Code, Claude Desktop, Slack, Discord, Obsidian, MongoDB Compass — all Electron
- Ships Chromium (renderer) + Node.js (main process) — our React frontend + Node backend both run natively
- Cross-platform: Windows, macOS, Linux from one codebase
- Auto-updates via `autoUpdater` (Squirrel)
- Tray icon, native menus, file dialogs, notifications
- v41.x stable, actively maintained by OpenJS Foundation

### Architecture

```
┌────────────────────────────────────────────────────────┐
│                    ping-desktop.exe                     │
│                                                        │
│  ┌──────────────────┐    ┌──────────────────────────┐ │
│  │  Main Process     │    │  Renderer Process        │ │
│  │  (Node.js)        │    │  (Chromium)              │ │
│  │                    │    │                          │ │
│  │  • Starts backend  │    │  • React 19 frontend    │ │
│  │    as UtilityProcess│   │  • Socket.IO client     │ │
│  │  • Express :3002   │    │  • BlockNote editor     │ │
│  │  • Socket.IO       │    │  • Connects to          │ │
│  │  • Hocuspocus CRDT │    │    localhost:3002        │ │
│  │  • lowdb / Mongoose│    │                          │ │
│  │  • AI SDK agents   │    │                          │ │
│  │                    │    │                          │ │
│  │  userData/         │    │                          │ │
│  │  ├── collab/       │    │                          │ │
│  │  ├── plans/        │    │                          │ │
│  │  ├── tasks/        │    │                          │ │
│  │  └── teams.json    │    │                          │ │
│  └──────────────────┘    └──────────────────────────┘ │
│           │                        ▲                   │
│           │    WebSocket/HTTP      │                   │
│           └────────────────────────┘                   │
└────────────────────────────────────────────────────────┘
```

**Key design:** The backend runs as a **UtilityProcess** (Electron's Node.js child process API). The frontend loads in a `BrowserWindow`. They communicate via `localhost` WebSocket/HTTP — identical to `bun run dev` but self-contained.

### Process Model

| Process | What Runs | Technology |
|---|---|---|
| **Main** (Electron) | App lifecycle, window management, tray icon, auto-updater, spawn backend | Electron main (Node.js) |
| **Utility** (Backend) | Express, Socket.IO, Hocuspocus, AI SDK agents, lowdb/Mongoose | Electron UtilityProcess |
| **Renderer** (Frontend) | React 19 UI, BlockNote, Socket.IO client | Chromium (BrowserWindow) |

### Package Structure

```
packages/desktop/
├── package.json              # @ping/desktop
├── forge.config.ts           # Electron Forge (build, makers, publishers)
├── tsconfig.json
├── src/
│   ├── main.ts               # Electron main process entry
│   │   ├── createWindow()    # BrowserWindow with frontend
│   │   ├── startBackend()    # Spawn backend as UtilityProcess
│   │   ├── createTray()      # System tray icon
│   │   └── setupAutoUpdate() # Squirrel auto-updater
│   ├── preload.ts            # Context bridge (desktop APIs → renderer)
│   └── backend-entry.ts      # Backend entry for UtilityProcess
│       └── imports @ping/backend server.ts
├── resources/
│   ├── icon.icns             # macOS icon
│   ├── icon.ico              # Windows icon
│   └── icon.png              # Linux icon
└── out/                      # Build output (not committed)
```

### How It Connects

```
packages/desktop/           ← NEW (Electron shell, ~200 lines)
  ├── imports @ping/backend   ← Existing backend (unchanged)
  ├── loads @ping/frontend    ← Existing frontend build (unchanged)
  └── uses @ping/agent-manager, @ping/collaboration, etc.
```

**No code changes to existing packages.** The desktop shell just:
1. Spawns the backend as a UtilityProcess
2. Loads the frontend in a BrowserWindow
3. Stores data in `app.getPath('userData')` — OS-native location

### Main Process Sketch

```typescript
import { app, BrowserWindow, Tray, utilityProcess } from 'electron';
import path from 'path';

let mainWindow: BrowserWindow | null = null;
let backend: ReturnType<typeof utilityProcess.fork> | null = null;

function startBackend() {
  backend = utilityProcess.fork(
    path.join(__dirname, 'backend-entry.js'),
    [], {
      env: {
        ...process.env,
        PORT: '3002',
        L2_STORAGE_TYPE: 'fs',
        DATA_DIR: app.getPath('userData'),
      }
    }
  );
  backend.on('message', (msg) => {
    if (msg === 'ready') createWindow();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3000'); // Vite dev server
  } else {
    mainWindow.loadFile(path.join(__dirname, '../frontend/index.html'));
  }
}

app.whenReady().then(startBackend);
app.on('window-all-closed', () => {
  backend?.kill();
  if (process.platform !== 'darwin') app.quit();
});
```

### Build & Distribution

```bash
# Dev (from packages/desktop/)
bun run start              # Electron + hot-reload backend + Vite frontend

# Build installers
bun run make               # .exe (Windows), .dmg (macOS), .deb (Linux)

# Publish to GitHub Releases
bun run publish

# Root-level (from monorepo root)
bun run desktop            # Start desktop app
bun run desktop:build      # Build installers
```

### Desktop Features

| Feature | API | Use Case |
|---|---|---|
| System tray | `Tray` | Ping icon in taskbar, quick actions |
| Auto-updates | `autoUpdater` + GitHub Releases | Silent background updates |
| Notifications | `Notification` | "Task completed", "Agent needs approval" |
| File dialogs | `dialog` | Workspace selection, export |
| Deep links | `setAsDefaultProtocolClient('ping')` | `ping://team/goal` opens in app |
| Menu bar | `Menu` | File, Edit, View, Help with shortcuts |
| Data dir | `app.getPath('userData')` | OS-native: `AppData/Ping/` (Win), `Library/Application Support/Ping/` (Mac) |

### Size

| Component | Size |
|---|---|
| Electron (Chromium + Node.js) | ~150MB |
| @ping/backend + deps | ~30-50MB |
| @ping/frontend (Vite build) | ~2-5MB |
| **Total installer** | **~200-250MB** |

Comparable: VS Code (~350MB), Slack (~300MB), Claude Desktop (~250MB).

### Tier Model in Desktop

| Tier | Desktop Experience |
|---|---|
| **0: Local** | Double-click Ping.exe → runs immediately. No cloud, no installs. |
| **1: +Cloud** | Settings → "Enable cloud sync" → enter Azure/S3 creds |
| **2: +MongoDB** | Settings → "Connect database" → enter MongoDB URI |
| **3: +Remote** | Settings → "Connect team server" → enter WebSocket URL |

### Implementation Phases

| Phase | What | Effort |
|---|---|---|
| **1** | Minimal Electron shell: main + BrowserWindow + UtilityProcess for backend | 1-2 sprints |
| **2** | Desktop features: tray, notifications, menus, data directory | 1 sprint |
| **3** | Auto-updates: GitHub Releases + Squirrel | 1 sprint |
| **4** | Installers: .exe (NSIS), .dmg, .deb, .rpm. Code signing. | 1 sprint |
| **5** | Settings UI: tier config panel in frontend | 1 sprint |

---

## Monetization: Trial + Account-Based Subscription

### Decisions

- **No free tier** — 14-day trial, then paid
- **Account-based** (email/password), not license keys
- **Auth**: existing better-auth (already in codebase)
- **Payments**: Stripe (Checkout + Payment Links)
- **Webhook**: single serverless function (Vercel/Cloudflare, free tier)
- **Offline**: 30-day grace period with cached JWT

### User Journey

```
1. Download Ping Desktop from landing page
   ↓
2. First launch → "Start 14-day free trial"
   → Local trial, no account needed, full access
   → Trial banner: "12 days remaining"
   ↓
3. Day 14 → "Trial expired. Sign up to continue."
   ↓
4. "Create Account" → email/password (better-auth)
   → Opens Stripe Checkout (in browser) → pays
   → Webhook → updates subscription status in DB
   ↓
5. Back in app → log in → subscription validated → full access
   ↓
6. Subsequent launches → auto-login (cached JWT)
   → Online: validates with backend
   → Offline: 30-day grace (cached session)
   ↓
7. Subscription lapses → "Renew to continue" → app locked
```

### What Already Exists

| Piece | Status |
|---|---|
| Sign up / sign in / sign out | ✅ better-auth (`/api/auth/*`) |
| JWT sessions (7-day) | ✅ better-auth |
| MongoDB user storage | ✅ better-auth mongodbAdapter |
| Admin seed | ✅ `admin@ping.local` |

### What to Add

| Piece | Effort |
|---|---|
| Subscription field on user (`plan`, `active`, `expiresAt`, `stripeCustomerId`) | ~20 lines |
| Stripe webhook endpoint (`POST /api/webhooks/stripe`) | ~40 lines (serverless function) |
| Trial tracker in Electron main process | ~20 lines |
| Login UI in frontend (React) | 1 sprint |
| Offline session cache in Electron (`electron-store`) | ~15 lines |

### Stripe Setup

```
YOU DO:
1. Create Stripe account
2. Create Product + Price in Stripe Dashboard
3. Create Payment Link (or Checkout session via API)
4. Set up webhook endpoint URL in Stripe Dashboard
5. Build landing page with "Subscribe" button → Payment Link

STRIPE HANDLES:
• Hosted checkout page (stripe.com)
• Payment processing (cards, Apple Pay, Google Pay)
• Recurring billing (monthly/yearly)
• Invoice emails
• Failed payment retries (Smart Retries)
• Customer portal (manage subscription, update card)
• Tax calculation (Stripe Tax, optional)
```

### Webhook (Single Serverless Function)

Hosted on Vercel, Cloudflare Workers, or AWS Lambda (all have free tiers).

```typescript
// api/webhooks/stripe.ts — deployed to Vercel
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request) {
  const sig = req.headers.get('stripe-signature')!;
  const event = stripe.webhooks.constructEvent(
    await req.text(), sig, process.env.STRIPE_WEBHOOK_SECRET!
  );

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      await db.users.updateOne(
        { email: session.customer_email },
        { $set: { 'subscription.active': true, 'subscription.stripeId': session.customer } }
      );
      break;
    }
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused': {
      const sub = event.data.object;
      await db.users.updateOne(
        { 'subscription.stripeId': sub.customer },
        { $set: { 'subscription.active': false } }
      );
      break;
    }
  }
  return new Response('ok');
}
```

### Electron License Check

```typescript
// Electron main process — runs on every app launch
async function checkAccess(): Promise<'trial' | 'active' | 'expired'> {
  const trialStart = store.get('trialStart');
  const cached = store.get('session');

  // No session → check trial
  if (!cached?.token) {
    if (!trialStart) { store.set('trialStart', Date.now()); return 'trial'; }
    return (Date.now() - trialStart) / 86400000 <= 14 ? 'trial' : 'expired';
  }

  // Have session → validate online, fallback to cache
  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/get-session`, {
      headers: { Authorization: `Bearer ${cached.token}` }
    });
    const session = await res.json();
    store.set('session', { ...session, cachedAt: Date.now() });
    return session.subscription?.active ? 'active' : 'expired';
  } catch {
    // Offline — 30-day grace
    if (cached.cachedAt && (Date.now() - cached.cachedAt) < 30 * 86400000) {
      return cached.subscription?.active ? 'active' : 'expired';
    }
    return 'expired';
  }
}
```

### App States

| State | Screen |
|---|---|
| First launch | "Welcome! 14-day trial started." + full app |
| Trial (day 7) | Banner: "7 days left. [Create Account]" |
| Trial expired | Full screen: "[Sign Up] or [Log In]" — app locked |
| Logged in, active | Normal app, no banners |
| Logged in, expired | "[Renew Subscription]" — app locked |
| Offline, within grace | Normal app + "Offline mode" indicator |
| Offline, grace expired | "Connect to internet to verify subscription" |

### Pricing (Your Choice)

| Plan | Suggested | Includes |
|---|---|---|
| **Solo** | $X/mo or $Y/year | 1 user, local + cloud sync, unlimited agents |
| **Team** | $Z/seat/mo | Multi-user, shared CRDT, team features |
| **Enterprise** | Custom | Self-hosted, SSO, priority support, SLA |

### What Needs Hosting

| Component | Hosting | Cost |
|---|---|---|
| Landing page | Vercel / Netlify / GitHub Pages | Free |
| Stripe webhook function | Vercel / Cloudflare Workers | Free tier |
| Stripe Checkout page | Stripe hosts it | $0 (Stripe fee on transactions) |
| App itself | ❌ None — runs locally in Electron | $0 |
| Auth | ❌ None — better-auth runs in Electron | $0 |

**Total infrastructure cost:** ~$0/mo (until you exceed free tiers)

---

## Critical Discovery: Embedded Hocuspocus Already Works Locally

Before proposing alternatives, a key finding: **the current L2 plugin already has a local embedded mode** that requires no external services.

```typescript
// Current local setup — already works today:
const plugin = new L2CollaborationPlugin({
  teamId: "team-1",
  collabStorageDir: "./data/collab",  // Filesystem only
  repoPath: ".",
  collabPort: 1234,  // Optional — enables frontend WebSocket
});
await plugin.initialize();
// Done. No MongoDB. No remote server. Just Yjs + filesystem.
```

**What embedded mode provides:**
- In-process Hocuspocus server (no separate service)
- File-based CRDT persistence (`data/collab/yjs/*.bin`)
- `projectToFilesystem` mirrors CRDT → readable JSON/markdown in `.ping/collaboration/`
- Optional WebSocket on a port (for frontend BlockNote connection)
- Agents access docs directly via `plugin.openDoc()` (in-process, no network)

**What it does NOT require:**
- MongoDB (persistence is filesystem-only)
- External Hocuspocus server
- Any cloud services

**Actual dependency cost of embedded mode:**
- `@hocuspocus/server` + `@hocuspocus/extension-database` (~100KB)
- `yjs` + `y-protocols` (~180KB)
- Total: ~280KB of CRDT/server code

So the real question becomes: **is there something lighter than Hocuspocus that still gives us CRDT + WebSocket + file persistence?**

---

## Prior Art & Open-Source Research

### How Other Multi-Agent Frameworks Handle Shared State

| Framework | Shared State Approach | Local Mode | Distributed Mode |
|---|---|---|---|
| **LangGraph** (LangChain) | **Checkpointer interface** — pluggable backends: `InMemorySaver`, `SqliteSaver`, `PostgresSaver`. State is a serialized checkpoint per superstep. Thread-scoped | In-memory or SQLite file | PostgreSQL |
| **CrewAI** | **Unified Memory System** — short-term (per-task context), long-term (RAG embeddings), entity memory. File-based `storage/` backend using JSON and SQLite. No CRDT | JSON/SQLite files locally | Same (no distributed mode yet) |
| **Microsoft Agent Framework** (ex-AutoGen successor) | **Graph-based workflows** with checkpointing. State is per-workflow, stored via durable task framework. Sessions are isolated | In-process state | Durable Functions / Azure |
| **AutoGPT** (classic) | **FileManager component** — agents read/write a sandboxed workspace directory. Shared state via filesystem. No real-time sync | Local filesystem | N/A |
| **OpenDevin / Devin-like** | **Event stream + state snapshots** — append-only event log, filesystem workspace mounted per-agent. Shared via filesystem | Local filesystem + event log | Event streaming service |

### Key Insight: The Checkpoint/Saver Pattern

LangGraph's approach is the closest analogue to what we need. Their `BaseCheckpointSaver` defines:

```
put(config, checkpoint, metadata) → save state
get_tuple(config) → load state  
list(config) → list snapshots
```

With pluggable backends:
- `InMemorySaver` — dict-backed, dev/testing
- `SqliteSaver` — single-file database, local persistence  
- `PostgresSaver` — production distributed
- `MongoDBSaver` — community contrib

**The same pattern applies to our L2 layer.** We already have the interface (`IL2CollaborationPlugin`). The CRDT plugin is like `PostgresSaver` (production, distributed). The new file plugin is like `InMemorySaver`/`SqliteSaver` (local, zero-dep).

### Why File-Based Over SQLite?

CrewAI's memory system uses a mix of JSON files and SQLite. For our case, **plain JSON files** are better because:

1. **Agent tool compatibility** — agents already have `read_file` / `grep` tools that work on JSON. SQLite requires a query tool.
2. **Human inspectability** — developers can `cat data/collab/tasks.json` to debug. SQLite is opaque.
3. **Projection compatibility** — the existing CRDT plugin already has `projectToFilesystem` that writes JSON/markdown. The file plugin produces identical output natively.
4. **Diff-friendly** — JSON changes are visible in `git diff`. Good for L1 workspace integration.

---

## NPM Package Candidates

We evaluated existing packages to avoid building from scratch. The question: can any off-the-shelf package serve as the storage engine inside `FileCollaborationPlugin`?

| Package | Weekly DLs | Size | What It Does | Fit? |
|---|---|---|---|---|
| **lowdb** | 1.4M | 23KB | JSON file database. In-memory `db.data` + `JSONFile` adapter. Atomic writes. TypeScript. ESM. | **Best fit** ✅ |
| **keyv** | 93M | 117KB | Key-value store with pluggable backends (Redis, SQLite, etc.). Default: in-memory Map. | Overkill — no file persistence built-in, needs adapter |
| **flat-cache** | 103M | 59KB | In-memory cache + auto-persist to disk. TTL, LRU, events. | Close — but cache semantics (TTL/eviction) don't match collaboration docs |
| **tinybase** | 30K | 9MB unpacked | Reactive data store + CRDT sync + file persisters. Tables + key-value. | **Very interesting** — native CRDT, file persistence, listeners, but heavy (9MB) and UI-focused |
| **configstore** | 58M | small | Simple JSON config persistence per-package. | Too simple — single flat object, no namespacing per goal |
| **file-system-cache** | 13M | small | Promise-based file cache. | Cache semantics, not structured docs |

### Recommendation: **lowdb**

`lowdb` is the strongest fit because:

1. **Exact paradigm match** — in-memory object (`db.data`) + JSON file adapter (`JSONFile`). This IS the "in-memory Maps + debounced flush" pattern from Option A, but as a maintained package.
2. **Atomic writes** — lowdb uses `steno` for safe atomic file writes (write to temp → rename). Prevents corruption on crash.
3. **TypeScript & ESM** — first-class types, pure ESM (matches our monorepo).
4. **Pluggable adapters** — `JSONFile` (async), `JSONFileSync`, `Memory` (testing), custom adapters. We could write a `StorageProvider` adapter trivially.
5. **Tiny** — 23KB, 1 dependency (`steno`). No native modules.
6. **1.4M weekly downloads, MIT, actively maintained** by `typicode` (author of json-server).

**How it would work:**

```typescript
import { JSONFilePreset } from 'lowdb/node';

// One lowdb instance per collaboration doc
const statuses = await JSONFilePreset<Record<string, AgentStatus>>(
  'data/collab/team-1/goal-1/agent-statuses.json',
  {}
);

// Agent writes (in-memory, then flush)
statuses.data['researcher'] = { status: 'busy', lastUpdated: new Date().toISOString() };
await statuses.write();

// Agent reads (from memory — instant)
const status = statuses.data['researcher'];
```

**Contrast with rolling our own:**
- We'd write ~150 lines of `Map` + `fs.writeFile` + debounce timer (copy of FileTaskStore pattern)
- lowdb gives us that *plus* atomic writes, adapter pattern, TypeScript types
- Trade-off: 1 external dependency vs. 0

### Alternative: **tinybase** (Deep Evaluation)

TinyBase (v8.1.1, MIT, zero runtime deps, 9.3k GitHub stars) is far more interesting than it first appears. It's not just a UI state library — it's a **complete reactive data store with native CRDT sync and pluggable persistence**, designed for local-first apps. Here's what it actually offers:

#### What TinyBase Provides

| Capability | Details |
|---|---|
| **Two data models** | **Tables** (tabular: table → row → cell) + **Values** (key-value pairs). Both in same Store |
| **CRDT sync** | `MergeableStore` — deterministic merge of concurrent changes across stores. No Yjs needed |
| **File persistence** | `createFilePersister(store, '/path/to.json')` — save/load to JSON files. `autoSave`/`autoLoad` |
| **WebSocket sync** | `createWsServer(webSocketServer)` — built-in sync server. `createWsSynchronizer` client |
| **Reactive listeners** | `addCellListener`, `addValueListener`, `addTableListener` — granular change notifications |
| **Schemas** | Optional typed schemas (Zod-compatible via schematizer modules) |
| **Queries** | TinyQL — SQL-adjacent reactive queries with joins, filters, aggregation |
| **Indexes** | `createIndexes` — fast lookups by cell value |
| **Checkpoints** | Built-in undo/redo stack |
| **Transactions** | `store.transaction(() => { ... })` — batch mutations |
| **Zero deps** | No runtime dependencies at all. Pure JavaScript |

#### Bundle Size (Modular Imports)

TinyBase is **tree-shakeable** via ESM submodule imports. The 9MB unpacked figure is the *entire* package (all persisters, all synchronizers, all UI bindings). What we'd actually import:

| Module | Gzipped | What |
|---|---|---|
| `tinybase/store` | **6.2 kB** | Core Store (tables + values + listeners) |
| `tinybase/mergeable-store` | included in `tinybase` (13.2 kB total) | CRDT-capable store |
| `tinybase/persisters/persister-file` | ~1 kB | File persistence (JSON) |
| `tinybase/synchronizers/synchronizer-ws-server` | ~2 kB | WebSocket sync server |
| **Total (local-only)** | **~7-8 kB** | Store + FilePersister |
| **Total (with CRDT sync)** | **~16-17 kB** | MergeableStore + FilePersister + WsServer |

That's **smaller than lowdb** (23KB) for local-only, and **replaces Yjs+Hocuspocus** (~180KB+) for distributed mode.

#### How It Maps to Our L2 Concepts

| Our L2 Concept | TinyBase Equivalent |
|---|---|
| `CollaborationSpace` (per goal) | One `Store` or `MergeableStore` per goal |
| `CollabDocument` (Y.Map) | A TinyBase `Table` or `Values` object |
| `collab.write(doc, key, value)` | `store.setCell(table, row, cell, value)` or `store.setValue(key, value)` |
| `collab.read(doc, key)` | `store.getCell(table, row, cell)` or `store.getValue(key)` |
| `collab.discover()` | `store.getTableIds()` + `store.getValueIds()` |
| Hocuspocus WebSocket server | `createWsServer(wss)` — one function call |
| Yjs `onChange` projection | `store.addTableListener(null, null, null, onChange)` — reactive |
| `PlanStore` (save/load plans) | Store table with plan rows, persisted to file |
| `GroupChatManager` | Store table for chat messages |
| CRDT merge (2 agents, same key) | `mergeableStore.merge(otherStore)` — deterministic |

#### The Key Insight: **Unified Local + Distributed**

With TinyBase, you don't need two separate plugins. One plugin, two modes:

```typescript
// LOCAL MODE: Store + FilePersister
import { createStore } from 'tinybase/store';
import { createFilePersister } from 'tinybase/persisters/persister-file';

const store = createStore();
const persister = createFilePersister(store, 'data/collab/team-1/goal-1.json');
await persister.load();  // load from disk
// ... agents read/write ...
await persister.save();  // save to disk

// DISTRIBUTED MODE: MergeableStore + WsSynchronizer + FilePersister
import { createMergeableStore } from 'tinybase';
import { createWsServer } from 'tinybase/synchronizers/synchronizer-ws-server';
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client';

const store = createMergeableStore();
const server = createWsServer(new WebSocketServer({ port: 4000 }));
// Clients connect via createWsSynchronizer — CRDT merge automatic
```

**Same data model, same API, same listeners** — just swap `createStore` → `createMergeableStore` and add a synchronizer. No IL2CollaborationPlugin interface change needed.

#### TinyBase vs. Yjs+Hocuspocus (Current Stack)

| Aspect | Yjs + Hocuspocus (current) | TinyBase |
|---|---|---|
| **Bundle** | ~180KB (yjs) + ~100KB (hocuspocus) | ~13-17 kB gzipped |
| **Dependencies** | 5+ packages (yjs, y-protocols, hocuspocus-server, hocuspocus-extension-database) | 0 runtime deps |
| **CRDT model** | Yjs (academic CRDT, very mature) | TinyBase MergeableStore (simpler, cell-level timestamps) |
| **Data model** | Y.Doc → Y.Map / Y.Array / Y.Text / Y.XmlFragment | Store → Tables (rows/cells) + Values (key-value) |
| **Rich text** | Y.XmlFragment (BlockNote integration) | No rich text types (cells are primitives: string/number/boolean) |
| **Persistence** | Hocuspocus Database Extension (custom) | `createFilePersister`, `createSqlite3Persister`, `createPostgresPersister` |
| **Server** | Hocuspocus Server (Express + WebSocket) | `createWsServer(wss)` — one line |
| **Listeners** | Yjs `observe()` / Hocuspocus `onChange` | Granular: per-cell, per-row, per-table, per-value listeners |
| **Query/index** | None built-in (we added MiniSearch) | TinyQL queries + Indexes built-in |
| **Maturity** | Yjs: 10+ years, battle-tested | TinyBase: 3+ years, 100% test coverage, v8.1 |

#### Risks & Concerns

1. **No rich text** — Yjs has `Y.XmlFragment` which powers BlockNote collaborative editing. TinyBase cells are primitives (string, number, boolean). For `write-block` (markdown), we'd store markdown as a string cell — works but no character-level collaborative editing.
2. **CRDT model is simpler** — TinyBase uses HLC (Hybrid Logical Clocks) per-cell, not Yjs's operation-based CRDT. Sufficient for key-value and tabular data. Not suitable for text CRDT (character-by-character merge).
3. **Ecosystem smaller** — Yjs has a huge ecosystem (y-websocket, y-leveldb, BlockNote, Tiptap, etc.). TinyBase's ecosystem is growing but smaller.
4. **Migration** — Moving from Yjs to TinyBase would mean rewriting the L2 plugin, not just shimming it. But since we're building a new plugin anyway, this is the right time.

#### Verdict

TinyBase is **not just a local shim** — it's a potential **replacement for the entire Yjs+Hocuspocus stack** at a fraction of the size, with a unified local↔distributed story. The question is whether we need:

- **Just a local L2** → lowdb is simpler, TinyBase is overkill
- **A unified L2 that works both locally and distributed** → TinyBase is the better choice
- **Rich text collaborative editing (BlockNote)** → Keep Yjs (TinyBase can't do this)

### Decision: lowdb vs. tinybase vs. hand-rolled

| Approach | Size | Local L2 | Distributed L2 | Rich Text | Deps | Effort |
|---|---|---|---|---|---|---|
| **lowdb** | 23KB | ✅ Great | ❌ No (local only) | ❌ No | 1 (steno) | Low |
| **tinybase** | ~7KB (store only) | ✅ Great | ✅ Yes (MergeableStore + WsServer) | ❌ No | 0 | Medium |
| **Hand-rolled** (Map + fs) | 0 | ✅ Works | ❌ No | ❌ No | 0 | Low |
| **Keep Yjs+Hocuspocus** | ~280KB | ✅ (overkill) | ✅ Yes | ✅ Yes (BlockNote) | 5+ | Already done |

**If the goal is local-only L2:** lowdb — simplest, proven, done in a sprint.

**If the goal is unified local + distributed L2 (replacing Yjs):** TinyBase — bigger lift, but eliminates the entire CRDT dependency stack and gives both modes in one library.

**If BlockNote collaborative rich text is required:** Keep Yjs for that specific use case. TinyBase can handle everything else.

---

## Architecture Options (Revised for Co-Editing)

### Option A: Keep Embedded Hocuspocus (Status Quo, Optimize)

**Implementation:** Use the existing `L2CollaborationPlugin` in embedded mode. No new plugin needed. Focus on making the local startup simpler (auto-detect local mode, skip MongoDB, auto-set collabPort).

**What exists today:**
```typescript
const plugin = new L2CollaborationPlugin({
  teamId: "team-1",
  collabStorageDir: "./data/collab",
  collabPort: 1234,
});
```

**What to improve:**
- Auto-detect `L2_MODE=local` → skip MongoDB sync, use file persistence only
- Default `collabPort` if frontend is detected
- Simplify config (one-liner local setup)
- Document the "just works" local mode

**Pros:**
- **Zero new code** — everything works today
- Full CRDT merge (agents + human co-editing)
- BlockNote rich text works (Y.XmlFragment)
- `write-block` / `read-block` / `write` / `read` all work
- File persistence to `data/collab/yjs/*.bin` + projected JSON/markdown
- Battle-tested with existing agent workflows

**Cons:**
- ~280KB of CRDT/server dependencies (Yjs + Hocuspocus)
- Hocuspocus is built for multi-client distributed use — overkill for single-machine
- Hocuspocus HTTP server is separate from Express (extra port)

**Effort:** Very Low (config/docs only).

### Option B: TinyBase MergeableStore (Replace Hocuspocus, Keep Yjs for Rich Text)

**Implementation:** Use TinyBase `MergeableStore` for all key-value/tabular data (statuses, plans, tasks, outputs). Keep Yjs `Y.XmlFragment` only for `write-block`/`read-block` rich text docs. Two storage engines, one plugin.

```
Key-value data (statuses, plans, tasks):
  TinyBase MergeableStore → createFilePersister → JSON files
  TinyBase createWsServer → WebSocket sync to frontend

Rich text docs (write-block/read-block):
  Yjs Y.Doc → Y.XmlFragment → BlockNote editor
  Keep lightweight Yjs provider for these docs only
```

**Pros:**
- TinyBase for key-value: ~7KB, zero deps, native CRDT, reactive listeners
- Built-in WebSocket sync server for frontend
- Removes Hocuspocus dependency (~100KB saved)
- Key-value queries/indexes via TinyQL
- Still have full rich text via Yjs for docs that need it

**Cons:**
- **Hybrid**: two CRDT engines (TinyBase + Yjs) in one plugin
- More complex than status quo
- Must maintain bridge between TinyBase and Yjs
- Yjs still needed (~180KB) for `write-block`/`read-block`
- Total dep reduction: only ~100KB saved (Hocuspocus removed, Yjs stays)

**Effort:** Medium-High (3-4 sprints). Significant adaptation.

### Option C: TinyBase Only (Accept Rich Text Limitation)

**Implementation:** Use TinyBase `MergeableStore` for everything. Store markdown as string cells for "rich text" — no character-level merge, but agents typically write whole markdown blocks, not individual characters.

```typescript
// Agent writes a document
store.setCell('docs', 'api-design', 'content', 
  '## OAuth2 Patterns\n- Authorization Code flow...');

// Agent reads it back
const md = store.getCell('docs', 'api-design', 'content');
```

**Reality check:** Do agents actually need character-level collaborative editing? In practice:
- Agents write whole markdown strings via `write-block` — not character-by-character
- The `markdownToBlocks()` function takes a complete markdown string and inserts it as new blocks
- Agents never type one character at a time

The character-level CRDT matters for **human-to-human** co-editing (Google Docs style). For **agent-to-human**, the agent writes a complete block, the human can read/edit it. Last-write-wins on a per-cell basis is acceptable if cells are scoped to individual blocks or sections.

**Pros:**
- Single CRDT engine (~13KB gzipped, zero deps)
- Unified local + distributed (same code, just add WsSynchronizer)
- File persistence (`createFilePersister`)
- WebSocket sync (`createWsServer`)
- Reactive listeners (onChange callbacks)
- Simplest architecture — one library does everything

**Cons:**
- No BlockNote integration (would need custom frontend editor or adapt BlockNote to use TinyBase)
- Human-to-agent same-cell edits: last-write-wins (not character merge)
- Migration from current BlockNote/Yjs frontend
- Frontend work required to replace CollaborativeEditor.tsx

**Effort:** High (4-5 sprints including frontend changes).

### Option D: Yjs Without Hocuspocus (Lightweight Yjs)

**Implementation:** Keep Yjs for CRDT (all doc types including XmlFragment), but replace Hocuspocus with a minimal WebSocket provider. Use `y-websocket` (much lighter) or a custom Yjs sync server.

```typescript
// Replace HocuspocusHTTPServer with y-websocket server
import { WebSocketServer } from 'ws';
import { setupWSConnection } from 'y-websocket/bin/utils';

const wss = new WebSocketServer({ port: 1234 });
wss.on('connection', setupWSConnection);

// File persistence via y-websocket's built-in LevelDB or custom file handler
```

**Pros:**
- Same CRDT semantics as current (Yjs is identical)
- `Y.XmlFragment` for BlockNote works unchanged
- All agent tools (`write-block`, `read-block`, `write`, `read`) work unchanged
- Lighter than Hocuspocus (drops extensions framework, HTTP server)
- `y-websocket` is ~10KB vs Hocuspocus ~100KB

**Cons:**
- Still depends on Yjs (~180KB)
- `y-websocket` has fewer features than Hocuspocus (no auth, no persistence extensions)
- Must implement file persistence manually (Hocuspocus Database extension handles this)
- Less mature than Hocuspocus for production use

**Effort:** Medium (2-3 sprints).

---

## Recommendation

Given the requirement for **simultaneous multi-agent + human co-editing**:

**Option A (Keep Embedded Hocuspocus, optimize config)** is the pragmatic choice. The infrastructure already works. The "heavy dependency" concern is actually ~280KB — not huge. The real work should be making local mode a one-command experience.

**Option D (Yjs without Hocuspocus)** is the best "lighter alternative" if dependency size truly matters. Same CRDT, same BlockNote, just fewer wrapper layers.

**Option C (TinyBase only)** is the cleanest architecture long-term, but requires accepting that rich text co-editing would be per-block last-write-wins rather than per-character merge. For agent workflows (where agents write whole markdown blocks), this is likely acceptable. For human-to-human editing, it's a downgrade.

| Priority | Recommendation |
|---|---|
| **Ship fast** | Option A — just document + simplify the existing embedded mode |
| **Reduce deps** | Option D — swap Hocuspocus for y-websocket, keep everything else |
| **Clean architecture** | Option C — TinyBase only, accept per-block merge for rich text |
| **Not recommended** | Option B — hybrid is the worst of both worlds (complexity without simplicity) |

**Decision: Option A chosen.** Keep embedded Hocuspocus. Local = filesystem, production = cloud blob storage via StorageProvider.

---

## Chosen Architecture: Hocuspocus + Pluggable StorageProvider

### How It Works

The Hocuspocus Database extension has just **two callbacks**: `fetch(docName) → Buffer` and `store(docName, state: Buffer)`. Today these call `fs.readFile` / `fs.writeFile`. We inject a `StorageProvider` adapter to make the backend pluggable:

```
Local dev:    Hocuspocus → StorageProvider(fs)    → data/collab/yjs/*.bin
Production:   Hocuspocus → StorageProvider(azure)  → Azure Blob container
AWS:          Hocuspocus → StorageProvider(s3)     → S3 bucket
GCP:          Hocuspocus → StorageProvider(gcs)    → GCS bucket
```

The CRDT engine (Yjs), the collab tool, agent workflows, BlockNote editor — everything stays identical. Only the binary blob storage backend changes.

### What Already Exists

| Component | Status | Location |
|---|---|---|
| `StorageProvider` interface (`read/write/delete/list`) | ✅ Exists | `packages/agent-manager/src/persistence/FilePlanStore.ts` |
| `AzureBlobStorageProvider` | ✅ Implemented | `packages/backend/storage/AzureBlobStorageProvider.ts` |
| `HocuspocusServer` (embedded, filesystem) | ✅ Works | `packages/collaboration/src/L2/collaboration/HocuspocusServer.ts` |
| `FilePlanStore` with StorageProvider support | ✅ Works | `packages/agent-manager/src/persistence/FilePlanStore.ts` |
| `FileTaskStore` with StorageProvider support | ✅ Works | `packages/agent-manager/src/persistence/FileTaskStore.ts` |
| Storage factory (`STORAGE_TYPE=azure|fs`) | ✅ Works | `packages/backend/storage/index.ts` |

### What Needs to Be Built (~50 lines)

| Component | Description | Effort |
|---|---|---|
| `HocuspocusBlobStorageAdapter` | Bridges `StorageProvider` (string) → Database extension (Buffer) | ~15 lines |
| Wire `HocuspocusServer` constructor | Accept optional `StorageProvider`, use adapter | ~10 lines |
| `S3StorageProvider` | `@aws-sdk/client-s3` implementation of StorageProvider | ~40 lines |
| `GcsStorageProvider` (optional) | `@google-cloud/storage` implementation | ~40 lines |
| Config: `L2_STORAGE_TYPE` env var | Select fs/azure/s3/gcs | ~5 lines |

### The Adapter (~15 Lines)

```typescript
export class HocuspocusBlobStorageAdapter {
  constructor(private storage: StorageProvider, private prefix: string = 'yjs') {}

  async fetch({ documentName }: { documentName: string }): Promise<Buffer | null> {
    const key = `${this.prefix}/${docNameToFilename(documentName)}.bin`;
    const data = await this.storage.read(key);
    return data ? Buffer.from(data, 'base64') : null;
  }

  async store({ documentName, state }: { documentName: string; state: Buffer }): Promise<void> {
    const key = `${this.prefix}/${docNameToFilename(documentName)}.bin`;
    await this.storage.write(key, state.toString('base64'));
  }
}
```

### Configuration

```env
# Local development (default)
L2_STORAGE_TYPE=fs

# Azure production
L2_STORAGE_TYPE=azure
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;...
AZURE_COLLAB_CONTAINER=collab-state

# AWS production
L2_STORAGE_TYPE=s3
AWS_COLLAB_BUCKET=my-project-collab
AWS_REGION=us-east-1

# GCP production  
L2_STORAGE_TYPE=gcs
GCS_COLLAB_BUCKET=my-project-collab
```

```typescript
// In L2CollaborationPlugin or HocuspocusServer factory:
function createStorageProvider(): StorageProvider | null {
  switch (process.env.L2_STORAGE_TYPE) {
    case 'azure': return new AzureBlobStorageProvider(...);
    case 's3':    return new S3StorageProvider(...);
    case 'gcs':   return new GcsStorageProvider(...);
    default:      return null; // filesystem (built-in)
  }
}
```

### Data Flow

```
Agent calls collab.write("statuses", "researcher", { status: "busy" })
    ↓
L2CollaborationPlugin → CollaborationSpace → Y.Doc
    ↓
Yjs Y.Map.set("researcher", { status: "busy" })  ← CRDT merge
    ↓
Hocuspocus onChange callback
    ├── Database.store() → StorageProvider.write()  → fs / S3 / Azure / GCS
    └── projectToFilesystem() → .ping/collaboration/agent-statuses.json
    ↓
Frontend BlockNote / WebSocket → sees update in real-time
```

---

## Parallel Access Analysis (Updated for Co-Editing)

### The Real Concurrency Model

With multiple agents + human co-editing, there are two levels of concurrency:

| Level | Participants | Where | Concurrency |
|---|---|---|---|
| **In-process** | Multiple agents (async tasks) | Same Node.js event loop | Sequential (event loop ticks) |
| **Cross-process** | Backend agents ↔ Frontend human | WebSocket | True parallel |

**Agents vs. agents:** Safe in single-process (event loop guarantees atomic Map.set). Same as before.

**Agents vs. human:** This is the real challenge. The human is in the browser (a separate process), editing via BlockNote/WebSocket. The agent is in Node.js, writing via the `collab` tool. These happen truly in parallel — CRDT merge is needed.

### What Happens Without CRDT?

```
Agent (backend):  collab.write("statuses", "researcher", { status: "done" })
Human (browser):  edits the same "statuses" doc, changes "designer" status

Without CRDT:
  - Agent writes full JSON to file
  - Human writes full JSON to file (slightly later)
  - Human's write overwrites agent's write → agent's change lost

With CRDT (Yjs or TinyBase MergeableStore):
  - Agent's change to "researcher" key merges with human's change to "designer" key
  - Both preserved, no data loss
```

### Per-Option Safety

| Scenario | Option A (Hocuspocus) | Option C (TinyBase) | Option D (Yjs/y-websocket) |
|---|---|---|---|
| 2 agents, same key | ✅ CRDT merge | ✅ CRDT merge (cell-level) | ✅ CRDT merge |
| 2 agents, different keys | ✅ Both preserved | ✅ Both preserved | ✅ Both preserved |
| Agent + human, same rich text doc | ✅ Character merge (XmlFragment) | ⚠️ Per-block last-write-wins | ✅ Character merge |
| Agent + human, different keys | ✅ Both preserved | ✅ Both preserved | ✅ Both preserved |
| Agent writes whole markdown block | ✅ Block inserted | ✅ Cell updated | ✅ Block inserted |

---

## Data Layout

```
data/collab/{teamId}/{goalId}/
├── agent-statuses.json      # { "researcher": { status, lastUpdated }, ... }
├── chat-outcomes.json        # [ { sessionId, topic, summary, ... }, ... ]
├── docs/
│   ├── {docName}.json        # Custom agent docs (key-value)
│   └── {docName}.md          # Custom agent docs (rich text)
└── _meta.json                # Space metadata (createdAt, agents, etc.)

data/plans/{teamId}/{goalId}/
├── {planId}.json              # (Existing FilePlanStore — unchanged)
└── _archive/

data/tasks/{teamId}/
└── tasks.json                 # (Existing FileTaskStore — unchanged)
```

This layout mirrors what `projectToFilesystem` already produces from CRDT docs. Agents using `read_file` on these paths get identical content whether using File or CRDT backend.

---

## Implementation Surface

### What Needs to Be Built

| Component | Description | Package |
|---|---|---|
| `FileCollaborationPlugin` | Implements `IL2CollaborationPlugin` | `@ping/collaboration` |
| `FileCollaborationSpace` | Per-goal container (replaces `CollaborationSpace`) | `@ping/collaboration` |
| `FileDocument` | JSON document wrapper (replaces `CollabDocument`) | `@ping/collaboration` |
| `FileGroupChatManager` | Group chat via JSON array (replaces `GroupChatManager`) | `@ping/collaboration` |
| `createCollabTool` adapter | Same `collab` tool, reads/writes `FileDocument` | `@ping/collaboration` |

### What Stays Unchanged

| Component | Why |
|---|---|
| `FilePlanStore` | Already file-based, used as default |
| `FileTaskStore` | Already file-based, used as default |
| `AgentManagerV2` | Plugin interface unchanged |
| `WorkerPool` | Gets tools via PluginRegistry (same API) |
| `OrchestratorService` | Reads plan from plugin storage (same API) |
| All agent code | `collab` tool API identical |
| `PluginRegistry` | Just registers a different plugin |

### Configuration

```typescript
// Local mode (new)
const l2 = new FileCollaborationPlugin({
  teamId: 'my-team',
  dataDir: './data/collab',        // default
});

// Hosted mode (existing, unchanged)
const l2 = new L2CollaborationPlugin({
  teamId: 'my-team',
  collabPort: 4000,
});

// AgentManager doesn't care which one
agentManager.registerPlugin(l2);
```

Or via environment variable:
```env
L2_MODE=local    # uses FileCollaborationPlugin
L2_MODE=crdt     # uses L2CollaborationPlugin (default)
```

---

## Open Questions

1. **Should FileDocument support `write-block` (rich text/markdown)?** The CRDT plugin renders `Y.XmlFragment` → markdown. For file mode, we could simply store markdown files directly.
2. **Should we support migration** from file L2 → CRDT L2? (Export JSON → import into Yjs docs)
3. **Notification mechanism** — CRDT has `onChange`. File backend would use polling or skip notifications (since all consumers are in-process and can read memory directly).
