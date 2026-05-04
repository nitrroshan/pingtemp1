# Plugin Marketplace — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Plugin Ecosystem:** [Plugin Ecosystem](../feature_architecture.md)

---

## Branch
`feature/plugin-marketplace` (from `dev`)

## Scope — v1.0

Install plugins from GitHub repos ("taps"), list/disable/offboard teams, Socket.IO events, frontend UI.

---

## How It Integrates with Current Code

### Current Architecture (What Exists)

```
ServiceRegistry.createServiceRegistry()
  ├─ PluginLoader(registryDir)           → scans packages/registry/plugins/
  ├─ PluginTeamService(pluginLoader)     → projects plugins as teams
  ├─ SqliteChatService | MongoChatService
  ├─ SqliteGoalService | MongoGoalService
  └─ SqliteTeamRegistryService | MongoTeamRegistryService
        │
        ▼
AgentManagerAPI(port, services)
  ├─ agentManagerRegistry.setServices(services)
  ├─ HttpServer({ agentManager, services })
  │     └─ app.use("/api/v2", createAgentManagerHandlerV2(services))
  │     └─ app.use("/api/registry", registryRouter)
  └─ SocketServerV2(httpServer, services)
        └─ on("message") → agentManagerRegistry.getForTeam(teamId) → lazy init
```

### After Integration (What Changes)

```
ServiceRegistry.createServiceRegistry()
  ├─ PluginLoader([registryDir, tapsDir])  ← CHANGED: multi-directory
  ├─ PluginTeamService(pluginLoader)        (unchanged — automatically sees tapped plugins)
  ├─ TapService(tapsDir, pluginLoader)     ← NEW: git clone/pull/remove
  ├─ ...existing services...
  └─ Return { ...existing, taps: tapService }
        │
        ▼
AgentManagerAPI(port, services)
  ├─ HttpServer({ agentManager, services })
  │     └─ app.use("/api/v2", agentManagerHandlerV2)  (unchanged)
  │     └─ app.use("/api/v2/taps", tapRouter)          ← NEW
  └─ SocketServerV2(httpServer, services)
        └─ tap:* events broadcast on install/remove     ← NEW
```

**Key insight:** `PluginTeamService` doesn't need changes. It reads from `PluginLoader`. If `PluginLoader` scans taps dir too, tapped plugins automatically appear as teams. `agentManagerRegistry.getForTeam()` lazy-loads them with zero changes.

---

## Sequence Diagrams

### Install Plugin from GitHub

```
User              TapInstallModal      AgentServiceV2       tapRouter         TapService         PluginLoader
 │                    │                     │                   │                  │                   │
 │ Enter "acme/eng"   │                     │                   │                  │                   │
 │ Click [Install]    │                     │                   │                  │                   │
 │───────────────────>│                     │                   │                  │                   │
 │                    │  POST /api/v2/taps  │                   │                  │                   │
 │                    │  {repo:"acme/eng"}  │                   │                  │                   │
 │                    │────────────────────>│                   │                  │                   │
 │                    │                     │──────────────────>│                  │                   │
 │                    │                     │                   │  install("acme/eng")                 │
 │                    │                     │                   │─────────────────>│                   │
 │                    │                     │                   │                  │                   │
 │                    │                     │                   │                  │ 1. Check limits   │
 │                    │                     │                   │                  │    (config-based) │
 │                    │                     │                   │                  │                   │
 │                    │                     │                   │                  │ 2. Check duplicate│
 │                    │                     │                   │                  │    (config.json)  │
 │                    │                     │                   │                  │                   │
 │                    │                     │                   │                  │ 3. git clone      │
 │                    │                     │                   │                  │    github.com/    │
 │                    │                     │                   │                  │    acme/eng       │
 │                    │                     │                   │                  │    → ~/.ping/taps/│
 │                    │                     │                   │                  │                   │
 │                    │                     │                   │                  │ 4. Validate       │
 │                    │                     │                   │                  │    .ping-plugin/  │
 │                    │                     │                   │                  │    plugin.json    │
 │                    │                     │                   │                  │───────────────────>
 │                    │                     │                   │                  │  loadPlugin()     │
 │                    │                     │                   │                  │<───────────────────
 │                    │                     │                   │                  │                   │
 │                    │                     │                   │                  │ 5. Save to        │
 │                    │                     │                   │                  │    config.json    │
 │                    │                     │                   │                  │                   │
 │                    │                     │                   │ Return TapInfo   │                   │
 │                    │                     │                   │<─────────────────│                   │
 │                    │                     │ 200: {tapId,      │                  │                   │
 │                    │                     │  teamId, name,    │                  │                   │
 │                    │  Response           │  agents, skills}  │                  │                   │
 │                    │<────────────────────│<──────────────────│                  │                   │
 │                    │                     │                   │                  │                   │
 │                    │                     │  io.emit(         │                  │                   │
 │  tap:installed     │                     │  "tap:installed") │                  │                   │
 │  event received    │                     │                   │                  │                   │
 │  by agentStore     │                     │                   │                  │                   │
 │  → team appears    │                     │                   │                  │                   │
 │     in sidebar     │                     │                   │                  │                   │
 │<───────────────────│                     │                   │                  │                   │
 │                    │                     │                   │                  │                   │
 │ Show success       │                     │                   │                  │                   │
 │ Close modal        │                     │                   │                  │                   │
 │<───────────────────│                     │                   │                  │                   │
```

### Offboard (Remove) Plugin

```
User              TeamsPage            AgentServiceV2       tapRouter         TapService      AgentMgrRegistry
 │                    │                     │                   │                  │                │
 │ Click [🗑] on      │                     │                   │                  │                │
 │ "Acme Engineering" │                     │                   │                  │                │
 │───────────────────>│                     │                   │                  │                │
 │                    │ Confirm dialog      │                   │                  │                │
 │ Click [Remove]     │                     │                   │                  │                │
 │───────────────────>│                     │                   │                  │                │
 │                    │ POST /taps/:id/     │                   │                  │                │
 │                    │ offboard            │                   │                  │                │
 │                    │────────────────────>│──────────────────>│                  │                │
 │                    │                     │                   │ offboard(tapId,  │                │
 │                    │                     │                   │  registry)       │                │
 │                    │                     │                   │─────────────────>│                │
 │                    │                     │                   │                  │                │
 │                    │                     │                   │                  │ Check goals    │
 │                    │                     │                   │                  │ via registry   │
 │                    │                     │                   │                  │───────────────>│
 │                    │                     │                   │                  │                │
 │                    │                     │                   │                  │  ┌─ active?    │
 │                    │                     │                   │                  │  │ YES → 409   │
 │   "3 goals active" │  409               │                   │                  │<─┘             │
 │<───────────────────│<────────────────────│<──────────────────│<─────────────────│                │
 │                    │                     │                   │                  │                │
 │                    │                     │                   │                  │  ┌─ NO goals   │
 │                    │                     │                   │                  │  │             │
 │                    │                     │                   │                  │  │ remove()    │
 │                    │                     │                   │                  │  │────────────>│
 │                    │                     │                   │                  │  │ dispose()   │
 │                    │                     │                   │                  │  │<────────────│
 │                    │                     │                   │                  │  │             │
 │                    │                     │                   │                  │  │ Delete files│
 │                    │                     │                   │                  │  │ Update cfg  │
 │                    │                     │                   │                  │  └             │
 │                    │                     │                   │ Return result    │                │
 │                    │                     │  200: {offboarded}│<─────────────────│                │
 │  Team removed      │                     │                   │                  │                │
 │  from sidebar      │  tap:offboarded     │  io.emit()        │                  │                │
 │<───────────────────│<────────────────────│<──────────────────│                  │                │
```

### First Message to Tapped Team (No Changes Needed)

```
User              Sidebar          AgentServiceV2      SocketServerV2    AgentMgrRegistry
 │                   │                  │                    │                  │
 │ Select tapped     │                  │                    │                  │
 │ team in sidebar   │                  │                    │                  │
 │──────────────────>│                  │                    │                  │
 │                   │ connect(teamId)  │                    │                  │
 │                   │─────────────────>│                    │                  │
 │                   │                  │ socket.emit("register")               │
 │                   │                  │───────────────────>│                  │
 │                   │                  │                    │                  │
 │ Type goal         │                  │                    │                  │
 │ Press Enter       │                  │                    │                  │
 │──────────────────>│                  │                    │                  │
 │                   │ sendToManager()  │                    │                  │
 │                   │─────────────────>│                    │                  │
 │                   │                  │ socket.emit("message")                │
 │                   │                  │───────────────────>│                  │
 │                   │                  │                    │ getForTeam(id)   │
 │                   │                  │                    │─────────────────>│
 │                   │                  │                    │                  │
 │                   │                  │                    │ Cache miss →     │
 │                   │                  │                    │ loadTeam()       │
 │                   │                  │                    │ (reads from      │
 │                   │                  │                    │  ~/.ping/taps/   │
 │                   │                  │                    │  via PluginLoader│
 │                   │                  │                    │  multi-dir)      │
 │                   │                  │                    │                  │
 │                   │                  │                    │ → Registers 4    │
 │                   │                  │                    │   plugins        │
 │                   │                  │                    │ → initOrchestrator│
 │                   │                  │                    │ → WorkerPool     │
 │                   │                  │                    │                  │
 │  Stream events    │                  │  stream/state      │ manager.handle() │
 │  (normal flow)    │                  │  events            │ → planner + workers
 │<──────────────────│<─────────────────│<───────────────────│                  │
```

**This flow requires ZERO changes.** PluginLoader scans taps dir → PluginTeamService sees it → AgentManagerRegistry lazy-loads it. Existing code handles everything.

---

## Frontend Wireframes

### Team Switcher Dropdown

```
┌──────────────────────────────┐
│ ▼ Engineering Team           │
├──────────────────────────────┤
│                              │
│  🟢 Engineering Team         │  ← Built-in
│  🟢 Marketing Team           │  ← Built-in
│  🟢 Meta Team                │  ← Built-in
│  🔵 Acme Sales          ⟳   │  ← Tapped (blue dot, update icon)
│  🔵 Content Marketing   ⟳   │  ← Tapped
│                              │
│  ─────────────────────────── │
│  + Add Team from GitHub      │  ← Opens TapInstallModal
│  ⚙ Manage Teams              │  ← Opens TeamsPage
└──────────────────────────────┘
```

### TapInstallModal

```
┌─────────────────────────────────────────┐
│ ✕  Add Team from GitHub                 │
│ ─────────────────────────────────────── │
│                                         │
│ GitHub Repository                       │
│ ┌─────────────────────────────────────┐ │
│ │ acme/engineering-team               │ │
│ └─────────────────────────────────────┘ │
│ Format: owner/repo                      │
│                                         │
│ Branch (optional)                       │
│ ┌─────────────────────────────────────┐ │
│ │ main                                │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ── Progress ─────────────────────────── │
│ ✅ Cloning repository                   │
│ ⏳ Validating plugin...                 │
│                                         │
│                      [Cancel] [Install] │
└─────────────────────────────────────────┘
```

### TeamsPage — Tapped Teams Section

```
┌──────────────────────────────────────────────────────┐
│ ← Back    Manage Teams              [+ From GitHub]  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  BUILT-IN (3)                                        │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │
│  │ Engineering   │ │ Marketing    │ │ Meta Team    │ │
│  │ 4 agents      │ │ 3 agents     │ │ 2 agents     │ │
│  │ [Select]      │ │ [Select]     │ │ [Select]     │ │
│  └──────────────┘ └──────────────┘ └──────────────┘ │
│                                                      │
│  INSTALLED FROM GITHUB (2)                           │
│  ┌──────────────┐ ┌──────────────┐                   │
│  │ Acme Sales    │ │ Content Mktg │                   │
│  │ 3 agents      │ │ 2 agents     │                   │
│  │ acme/sales    │ │ user/content │                   │
│  │ 2h ago        │ │ 1d ago       │                   │
│  │ [⟳] [🗑]      │ │ [⟳] [🗑]     │                   │
│  └──────────────┘ └──────────────┘                   │
└──────────────────────────────────────────────────────┘
```

---

## Implementation Steps

### Step 1: TapService
**Deps:** None  
**New file:** `packages/backend/services/TapService.ts`

```typescript
import { execSync } from "child_process";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { PluginLoader } from "@ping/registry/src/loader/PluginLoader";

interface TapConfig {
  taps: Array<{
    repo: string;
    ref?: string;
    addedAt: string;
    lastUpdated: string;
    disabled?: boolean;
  }>;
}

export class TapService {
  constructor(
    private tapsDir: string,       // ~/.ping/taps/
    private configPath: string,    // ~/.ping/config.json
    private pluginLoader: PluginLoader,
    private maxTaps: number = 20,
  ) {
    if (!existsSync(tapsDir)) mkdirSync(tapsDir, { recursive: true });
    if (!existsSync(configPath)) writeFileSync(configPath, JSON.stringify({ taps: [] }));
  }

  async install(repo: string, ref?: string): Promise<TapInfo> { /* ... */ }
  async list(): Promise<TapInfo[]> { /* ... */ }
  async get(tapId: string): Promise<TapInfo | null> { /* ... */ }
  async update(tapId: string): Promise<UpdateResult> { /* ... */ }
  async disable(tapId: string): Promise<void> { /* ... */ }
  async enable(tapId: string): Promise<void> { /* ... */ }
  async offboard(tapId: string, agentManagerRegistry: any): Promise<OffboardResult> { /* ... */ }
  async remove(tapId: string): Promise<void> { /* ... */ }

  private sanitizeRepo(repo: string): string {
    return repo.replace(/\//g, "--");  // "acme/eng" → "acme--eng"
  }
  private readConfig(): TapConfig { /* ... */ }
  private writeConfig(config: TapConfig): void { /* ... */ }
}
```

**Integration point:** `ServiceRegistry.ts` line 42 — after creating `pluginLoader`:
```typescript
// NEW: TapService
const tapsDir = process.env.PING_TAPS_DIR ?? join(homedir(), ".ping", "taps");
const configPath = join(tapsDir, "..", "config.json");
const tapService = new TapService(tapsDir, configPath, pluginLoader);
```

**Exit:** `TapService` unit tests pass — install clones repo, list reads config, remove deletes files.

### Step 2: Multi-Directory PluginLoader
**Deps:** Step 1  
**Modified file:** `packages/registry/src/loader/PluginLoader.ts`

Currently PluginLoader takes `IPluginStorage | string` (single dir). Change to accept multiple:

```typescript
// Constructor change:
constructor(sources: Array<IPluginStorage | string>) {
  this.storages = sources.map(s =>
    typeof s === "string" ? new LocalPluginStorage(s) : s
  );
}

// loadAllPlugins change:
async loadAllPlugins(): Promise<LoadedPlugin[]> {
  const plugins = new Map<string, LoadedPlugin>();
  for (const storage of this.storages) {
    // ... scan each, last-wins on name conflict
  }
}
```

**Integration point:** `ServiceRegistry.ts` line 42:
```typescript
// CHANGED: multi-directory
const pluginLoader = new PluginLoader([registryDir, tapsDir]);
```

Also add `.ping-plugin/` path support in `hasManifest()` / `readManifest()`.

**Exit:** PluginLoader discovers plugins from both built-in and taps directories.

### Step 3: HTTP Routes
**Deps:** Steps 1-2  
**New file:** `packages/backend/api/tapRouter.ts`  
**Modified file:** `packages/backend/api/HttpServer.ts`

```typescript
// tapRouter.ts — follows same pattern as agentManagerHandlerV2.ts
export function createTapRouter(services: ServiceRegistry): express.Router {
  const router = express.Router();

  router.post("/", async (req, res) => { /* install */ });
  router.get("/", async (req, res) => { /* list */ });
  router.get("/:tapId", async (req, res) => { /* get */ });
  router.post("/:tapId/update", async (req, res) => { /* git pull */ });
  router.post("/:tapId/disable", async (req, res) => { /* disable */ });
  router.post("/:tapId/enable", async (req, res) => { /* enable */ });
  router.post("/:tapId/offboard", async (req, res) => { /* offboard */ });
  router.delete("/:tapId", async (req, res) => { /* force delete */ });

  return router;
}
```

**Integration point:** `HttpServer.ts` after line 189:
```typescript
// NEW: Tap routes
if (options.services?.taps) {
  const tapRoutes = createTapRouter(options.services);
  this.app.use("/api/v2/taps", tapRoutes);
  logger.info("[HttpServer] Tap API mounted at /api/v2/taps");
}
```

**Exit:** All 8 endpoints return correct responses via curl/Postman.

### Step 4: Socket.IO Events
**Deps:** Step 3  
**Modified file:** `packages/backend/api/SocketServerV2.ts`

Tap events are broadcast to ALL connected clients (not room-scoped) since tap changes affect the global team list.

**Integration point:** In `tapRouter.ts` handlers, after successful operations:
```typescript
// After install success:
const io = req.app.get("io"); // Express stores Socket.IO instance
io.emit("tap:installed", { tapId, teamId, name, agents, skills });

// After offboard:
io.emit("tap:offboarded", { tapId, teamId });
```

**Alternative:** Pass `io` via ServiceRegistry or middleware.

**Exit:** Socket events fire on install/remove. Can verify in browser console.

### Step 5: ServiceRegistry Wiring
**Deps:** Steps 1-4  
**Modified files:** `packages/backend/services/ServiceRegistry.ts`, `packages/backend/api/AgentManagerAPI.ts`

```typescript
// ServiceRegistry.ts — add to interface:
export interface ServiceRegistry {
  teams: PluginTeamService;
  taps: TapService;           // NEW
  chat: IChatService;
  goals: IGoalService;
  teamRegistry: ITeamRegistryService;
  mode: "local" | "cloud";
}

// In createServiceRegistry():
const tapsDir = process.env.PING_TAPS_DIR ?? join(homedir(), ".ping", "taps");
const pluginLoader = new PluginLoader([registryDir, tapsDir]);
const tapService = new TapService(tapsDir, join(tapsDir, "..", "config.json"), pluginLoader);

return {
  teams: teamService,
  taps: tapService,          // NEW
  chat: chatService,
  // ...
};
```

**Exit:** Backend starts cleanly. `GET /api/v2/teams` returns both built-in and tapped teams.

### Step 6: Frontend — AgentServiceV2
**Deps:** Steps 3-5  
**Modified file:** `packages/frontend/services/AgentServiceV2.ts`

```typescript
// Add alongside existing team methods (near line 815):

async installTap(repo: string, ref?: string): Promise<TapInstallResult> {
  const response = await this.authFetch(`${this.baseUrl}/api/v2/taps`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo, ref }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to install tap");
  }
  return response.json();
}

async listTaps(): Promise<TapInfo[]> { /* GET /api/v2/taps */ }
async updateTap(tapId: string): Promise<UpdateResult> { /* POST /api/v2/taps/:id/update */ }
async offboardTap(tapId: string): Promise<OffboardResult> { /* POST /api/v2/taps/:id/offboard */ }
async deleteTap(tapId: string): Promise<void> { /* DELETE /api/v2/taps/:id */ }

// Socket subscriptions (add to constructor or init):
onTapInstalled(callback: (data: TapInstalledEvent) => void): () => void {
  return this.on("tap:installed", callback);
}
onTapOffboarded(callback: (data: TapOffboardedEvent) => void): () => void {
  return this.on("tap:offboarded", callback);
}
```

**Exit:** Frontend can call all tap APIs. TypeScript compiles.

### Step 7: Frontend — TapInstallModal
**Deps:** Step 6  
**New file:** `packages/frontend/components/TapInstallModal/TapInstallModal.tsx`

Uses same Dialog pattern as existing `PlanApproval` and `AgentModal`:

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Button } from '../ui/button';

interface TapInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInstalled: (teamId: string) => void;
}

export function TapInstallModal({ isOpen, onClose, onInstalled }: TapInstallModalProps) {
  const [repo, setRepo] = useState("");
  const [status, setStatus] = useState<"idle" | "installing" | "success" | "error">("idle");
  const [progress, setProgress] = useState<string[]>([]);
  // ...
}
```

**Integration point:** `App.tsx` — add modal alongside existing `AgentModal`:
```tsx
// In uiStore, add: isTapModalOpen, openTapModal(), closeTapModal()
<TapInstallModal
  isOpen={isTapModalOpen}
  onClose={closeTapModal}
  onInstalled={(teamId) => { closeTapModal(); setSelectedTeamId(teamId); }}
/>
```

**Exit:** Modal opens, user enters repo, clicks Install, sees progress, success shows team info.

### Step 8: Frontend — agentStore + Sidebar
**Deps:** Steps 6-7  
**Modified files:** `packages/frontend/stores/agentStore.ts`, `packages/frontend/components/Sidebar.tsx`

agentStore:
```typescript
// loadTeams() already works — tapped teams come through GET /teams
// Just need Socket.IO reactive updates:

// In App.tsx or GoalCoordinator, subscribe to tap events:
agentServiceV2.onTapInstalled((data) => {
  // Reload teams to pick up the new tapped team
  useAgentStore.getState().loadTeams();
});
agentServiceV2.onTapOffboarded((data) => {
  // Remove team from local state
  set(prev => ({
    agents: prev.agents.filter(a => a.id !== data.teamId),
    roleMap: buildRoleMap(prev.agents.filter(a => a.id !== data.teamId)),
  }));
});
```

Sidebar:
```typescript
// In team switcher dropdown, add separator + "Add Team from GitHub" link:
<DropdownMenuSeparator />
<DropdownMenuItem onClick={openTapModal}>
  <Plus className="h-4 w-4 mr-2" />
  Add Team from GitHub
</DropdownMenuItem>
```

**Exit:** Sidebar shows tapped teams. Installing a tap refreshes the team list reactively.

### Step 9: Frontend — TeamsPage Updates
**Deps:** Steps 6, 8  
**Modified file:** `packages/frontend/components/TeamsPage/TeamsPage.tsx`

- Split teams into "Built-in" and "Installed from GitHub" sections
- Add update (⟳) and remove (🗑) buttons for installed teams
- Add "Add from GitHub" button in header → opens TapInstallModal
- Offboard confirmation dialog (existing Dialog pattern)

**Exit:** TeamsPage shows both sections with full management actions.

### Step 10: End-to-End Testing
**Deps:** Steps 1-9

- Test: Install public GitHub plugin → team appears in sidebar → send goal → planner works
- Test: Install private repo (with GITHUB_TOKEN) → works
- Test: Offboard with active goals → 409 error shown
- Test: Offboard with no goals → team removed from sidebar
- Test: Update tap → git pull → team refreshed
- Test: Duplicate install → 409 "already installed"
- Test: Invalid plugin (no .ping-plugin/) → 422 validation error

**Exit:** All flows work end-to-end.

---

## Files Summary

### New Files (4)

| File | Package | Lines | Purpose |
|------|---------|-------|---------|
| `services/TapService.ts` | backend | ~200 | Core: git clone/pull/remove + config.json |
| `api/tapRouter.ts` | backend | ~150 | HTTP routes for /api/v2/taps/* |
| `components/TapInstallModal/TapInstallModal.tsx` | frontend | ~150 | Install dialog with progress |
| `components/TapInstallModal/index.ts` | frontend | ~3 | Barrel export |

### Modified Files (7)

| File | Package | Change | Lines Changed |
|------|---------|--------|---------------|
| `services/ServiceRegistry.ts` | backend | Add TapService to interface + creation | ~15 |
| `api/HttpServer.ts` | backend | Mount tapRouter | ~5 |
| `loader/PluginLoader.ts` | registry | Multi-directory + .ping-plugin/ path | ~20 |
| `services/AgentServiceV2.ts` | frontend | Add tap HTTP + Socket methods | ~50 |
| `stores/agentStore.ts` | frontend | Tap event handlers (loadTeams on install) | ~10 |
| `stores/uiStore.ts` | frontend | Add isTapModalOpen + actions | ~10 |
| `components/Sidebar.tsx` | frontend | "Add from GitHub" in dropdown | ~10 |
| `components/TeamsPage/TeamsPage.tsx` | frontend | Built-in vs installed sections | ~80 |

**Total new code: ~500 lines backend, ~250 lines frontend.**

---

## Complexity Estimate

| Step | Days | Notes |
|------|------|-------|
| Step 1: TapService | 1.5 | git clone, validation, config persistence |
| Step 2: Multi-dir PluginLoader | 0.5 | Array storage, name resolution |
| Step 3: HTTP Routes | 0.5 | Standard Express router |
| Step 4: Socket.IO Events | 0.25 | Broadcast pattern |
| Step 5: ServiceRegistry Wiring | 0.25 | Config + DI |
| Step 6: Frontend AgentServiceV2 | 0.5 | HTTP + Socket methods |
| Step 7: TapInstallModal | 1 | Dialog + progress states |
| Step 8: agentStore + Sidebar | 0.5 | Reactive + dropdown link |
| Step 9: TeamsPage Updates | 1 | Split sections + management |
| Step 10: E2E Testing | 1 | Integration testing |

**Total: ~7 days**
