# Team Registry v2.0 — Implementation Planning

**Architecture**: [feature_architecture.md](../feature_architecture.md) (Marketplace Vision section)  
**Depends on**: [v1.0](../v1.0/feature_implementation_planning.md) (plugin format, loader, discovery), [v1.1](../v1.1/feature_implementation_planning.md) (meta-team, modes, Team Builder UI)

## Branch
`feature/team-registry-v2.0`

## Scope — Remote Marketplace

v2.0 delivers: **Remote registry sources, publish/install plugins from URLs, community contributions, and ratings/reviews.**

| In scope | Out of scope (v3.0+) |
|----------|---------------------|
| Remote index sources (git repos, custom URLs) | Full marketplace web UI |
| Multi-source index.json (local + remote) | Contributor accounts / auth |
| Plugin install from git repo / npm | Revenue sharing |
| Plugin publish to remote registry | Plugin certification |
| Plugin versioning (`version` in plugin.json, `git pull` to update) | Auto-updates |
| Ratings and reviews (per plugin/agent/skill) | Recommendation engine |
| Meta-team searches across all sources | Plugin analytics dashboard |
| Cross-source composition (mix local + remote items) | |
| Claude Code plugin import (compatibility adapter) | |
| **Browse/list view** (not just vector search) | |
| **Plugin scopes** (user, project, managed) | |
| **Admin restrictions** (allowed sources, managed settings) | |
| **Desktop/CI seed directory** (pre-bundled plugins) | |
| **Offline fallback** (keep stale cache on sync failure) | |

## Implementation Steps

### Step 1: Multi-Source Index
**Files:** `packages/registry/src/index/MultiSourceIndex.ts`

Extend `index.json` to support multiple sources — local + remote:

```typescript
interface IndexSource {
  name: string;              // "builtin" | "official" | "community"
  type: "local" | "remote";
  path?: string;             // For local: "./plugins/"
  url?: string;              // For remote: "https://registry.ping.dev/index.json"
  lastSynced?: string;       // ISO timestamp of last fetch
}

interface MultiSourceIndex {
  version: "2.0";
  sources: IndexSource[];
  agents: IndexEntry[];      // Each entry has a `source` field
  skills: IndexEntry[];
  mcpServers: IndexEntry[];
  hooks: IndexEntry[];
  plugins: IndexEntry[];
}
```

- On startup: load local index + fetch remote indices
- Merge into single in-memory index for search
- Cache remote indices locally (refresh on interval or manual sync)
- Graceful fallback: if remote unavailable, use cached version

**Depends on:** v1.0 IndexBuilder

---

### Step 2: Marketplace Git Repos
**Files:** `packages/registry/src/sync/MarketplaceSync.ts`

Add marketplace git repos as remote sources. Same model as Claude Code: a marketplace is a git repo with `marketplace.json` listing plugins.

```typescript
class MarketplaceSync {
  async addMarketplace(repoUrl: string, ref?: string): Promise<void>  // git clone
  async updateMarketplace(name: string): Promise<void>               // git pull
  async updateAll(): Promise<void>                                    // git pull all
  async removeMarketplace(name: string): Promise<void>
  listMarketplaces(): MarketplaceInfo[]
}
```

- `git clone` marketplace repo to `registry/.marketplaces/<name>/`
- Read `marketplace.json` → merge plugin entries into multi-source index
- `git pull` on startup (configurable) or manual via `POST /api/registry/marketplace/update`
- Offline fallback: if `git pull` fails, keep using cached version

**API endpoints:**
- `POST /api/registry/marketplace/add` — `{ repoUrl: string, ref?: string }`
- `POST /api/registry/marketplace/update` — `{ name?: string }` (update one or all)
- `DELETE /api/registry/marketplace/:name` — Remove
- `GET /api/registry/marketplace/list` — List added marketplaces

**Depends on:** Step 1

---

### Step 3: Plugin Install from URL
**Files:** `packages/registry/src/install/PluginInstaller.ts`, `packages/backend/api/registryRouter.ts`

Install a plugin from a git repo or npm package. Keep it simple — git is the standard.

```typescript
class PluginInstaller {
  async installFromGit(repoUrl: string, ref?: string): Promise<LoadedPlugin>
  async installFromNpm(packageName: string, version?: string): Promise<LoadedPlugin>
  async uninstall(pluginName: string): Promise<void>
  async update(pluginName: string): Promise<LoadedPlugin>  // git pull or npm update
  listInstalled(): InstalledPlugin[]
}
```

**API endpoints:**
- `POST /api/registry/install` — `{ source: "git" | "npm", ref: string }`
- `DELETE /api/registry/plugins/:name` — Uninstall
- `GET /api/registry/installed` — List installed plugins

**Flow:**
1. `git clone` (or `npm install`) to `registry/plugins/<name>/`
2. Validate: check for `.claude-plugin/plugin.json`
3. Parse with PluginLoader (v1.0)
4. File watcher auto-reindexes
5. Return installed plugin info

**Update flow:** `git pull` on installed git plugins, `npm update` on npm plugins. Compare `version` in plugin.json before/after — notify if changed.

**Security:**
- Validate plugin structure before install
- Sandbox hook scripts (don't auto-execute)
- Scan for malicious patterns in .md files

**Depends on:** v1.0 PluginLoader, Step 1

---

### Step 4: Plugin Publish
**Files:** `packages/registry/src/publish/PluginPublisher.ts`

Publish a local plugin to a remote registry.

```typescript
class PluginPublisher {
  async publish(pluginDir: string, registryUrl: string): Promise<PublishResult>
  async validateForPublish(pluginDir: string): Promise<ValidationResult>
}
```

- Package plugin folder as tarball
- Upload to registry endpoint
- Registry server validates, generates embeddings, adds to remote index
- Requires registry API key (configured in .env)

**Registry server endpoint (remote):**
- `POST /api/publish` — Upload plugin tarball
- `GET /api/plugins` — Browse published plugins
- `GET /api/plugins/:name/versions` — Version history

**Depends on:** Step 3

---

### Step 5: Ratings and Reviews
**Files:** `packages/registry/src/ratings/RatingsService.ts`, DB schema

Ratings stored in MongoDB (runtime DB, not plugin files).

```typescript
interface Rating {
  pluginName: string;        // or agentName, skillName
  itemType: "plugin" | "agent" | "skill";
  userId: string;
  score: number;             // 1-5
  review?: string;
  createdAt: Date;
}

class RatingsService {
  async rate(item: string, type: string, userId: string, score: number, review?: string): Promise<void>
  async getAverage(item: string, type: string): Promise<{ average: number, count: number }>
  async getReviews(item: string, type: string, limit?: number): Promise<Rating[]>
}
```

**API endpoints:**
- `POST /api/registry/rate` — Submit rating
- `GET /api/registry/ratings/:type/:name` — Get ratings for an item

- Ratings included in index entries for search ranking (score × relevance)
- Meta-team's search tools factor in ratings

**Depends on:** Step 1 (ratings added to index entries)

---

### Step 6: Cross-Source Meta-Team Search
**Files:** Modify `packages/registry/src/tools/discoveryTools.ts` (from v1.1)

Update meta-team discovery tools to search across all sources with source attribution.

```typescript
// Updated search result includes source
interface SearchResult {
  name: string;
  description: string;
  score: number;
  source: string;           // "builtin" | "official" | "community"
  rating?: number;          // Average rating (if available)
  installed: boolean;       // Whether already installed locally
}
```

- Search across local + all remote indices
- Rank by: relevance score × rating × recency
- Show source attribution in Team Builder UI
- When composing a team with remote agents: auto-install them first

**Depends on:** v1.1 Steps 3-6 (meta-team tools), Step 1 (multi-source index), Step 5 (ratings)

---

### Step 7: Claude Code Plugin Compatibility Adapter
**Files:** `packages/registry/src/loader/ClaudeCodeAdapter.ts`

Thin adapter that converts Claude Code plugin format to our format.

```typescript
class ClaudeCodeAdapter {
  isClaudeCodePlugin(pluginDir: string): boolean
  adapt(pluginDir: string): LoadedPlugin
}
```

**Conversions:**
- `.claude-plugin/plugin.json` manifest → our format (already same location)
- Agent `.md`: map Claude Code `tools` (Read, Bash, etc.) to our tool system
- Agent `.md`: map `model: sonnet` to our model config
- Skills: no conversion needed (agentskills.io compatible)
- Hooks: no conversion needed (same format)
- MCP: no conversion needed (same format)
- Add default `role` field if missing (derive from agent name)
- Add default `tags` field if missing (derive from description)

**Depends on:** v1.0 PluginLoader

---

### Step 8: Browse/List API + UI
**Files:** `packages/backend/api/registryRouter.ts`, `packages/frontend/components/registry/BrowseView.tsx`

Add a list/browse view alongside vector search — users should be able to see everything available, not just search results.

**API endpoints:**
- `GET /api/registry/browse?type=agents&source=all&sort=rating` — List all items
- `GET /api/registry/browse?type=plugins&tags=engineering` — Filter by tags

**Frontend:** Tab view:
- **Search tab** — vector search via goal text (from v1.1)
- **Browse tab** — filterable list sorted by rating/name/recency

**Depends on:** Step 1, Step 6

---

### Step 9: Plugin Scopes
**Files:** `packages/registry/src/scope/ScopeManager.ts`

| Scope | Where stored | Who sees it |
|-------|-------------|-------------|
| **User** | `~/.ping/plugins/` | This user, all teams |
| **Project** | `<workspace>/.ping/plugins/` | Everyone in workspace |
| **Managed** | Admin-configured path | All users (read-only) |

```typescript
class ScopeManager {
  getPluginsByScope(scope: 'user' | 'project' | 'managed'): LoadedPlugin[]
  installToScope(pluginName: string, scope: string): Promise<void>
  getEffectivePlugins(): LoadedPlugin[]  // Merge scopes, managed wins
}
```

**Depends on:** Step 3

---

### Step 10: Admin Restrictions
**Files:** `packages/registry/src/admin/AdminRestrictions.ts`

Admin controls over allowed sources (like Claude Code's `strictKnownMarketplaces`):

```typescript
interface AdminSettings {
  allowedSources?: IndexSource[];     // Only these sources permitted
  blockedPlugins?: string[];          // Specific plugins blocked
  requireApproval?: boolean;          // Install requires admin approval
}
```

- Configured via managed settings or env vars
- Checked before any install

**Depends on:** Step 3, Step 9

---

### Step 11: Desktop/CI Seed Directory
**Files:** `packages/registry/src/seed/SeedLoader.ts`

Pre-bundle plugins for desktop app and Docker images — available immediately without download.

```typescript
if (process.env.PING_PLUGIN_SEED_DIR) {
  // Load plugins from seed (read-only, can't uninstall)
  // Merge with user-installed plugins
}
```

**Desktop:** `packages/desktop/scripts/bundle-plugins.js` copies plugins into app bundle.
**Docker:** `COPY registry/plugins/ /opt/ping-plugins/` + `ENV PING_PLUGIN_SEED_DIR=/opt/ping-plugins`

**Depends on:** Step 10

---

## File Summary

| New files | Purpose |
|-----------|---------|
| `packages/registry/src/index/MultiSourceIndex.ts` | Merge local + remote indices |
| `packages/registry/src/sync/MarketplaceSync.ts` | Add/update/remove marketplace git repos |
| `packages/registry/src/install/PluginInstaller.ts` | Install from git/npm |
| `packages/registry/src/publish/PluginPublisher.ts` | Publish to remote registry |
| `packages/registry/src/ratings/RatingsService.ts` | Ratings + reviews |
| `packages/registry/src/loader/ClaudeCodeAdapter.ts` | Claude Code format adapter |
| `packages/registry/src/scope/ScopeManager.ts` | Plugin scopes (user/project/managed) |
| `packages/registry/src/admin/AdminRestrictions.ts` | Admin source restrictions |
| `packages/registry/src/seed/SeedLoader.ts` | Pre-bundled plugins for desktop/CI |
| `packages/frontend/components/registry/BrowseView.tsx` | Browse/list all plugins |

| Modified files | Change |
|---------------|--------|
| `packages/registry/src/tools/discoveryTools.ts` | Multi-source search + ratings |
| `packages/registry/src/index/IndexBuilder.ts` | Multi-source index format |
| `packages/backend/api/registryRouter.ts` | Install/publish/ratings endpoints |
| `packages/frontend/components/TeamBuilder/*` | Source badges, ratings display |

## Database Schema (new collection)

```typescript
// ratings collection
{
  pluginName: string,
  itemType: "plugin" | "agent" | "skill",
  userId: string,
  score: number,           // 1-5
  review?: string,
  createdAt: Date,
  updatedAt: Date
}
// Index: { pluginName: 1, itemType: 1, userId: 1 } unique
```

## Testing Strategy

1. **Unit tests:** MarketplaceSync, PluginInstaller, RatingsService
2. **Integration tests:** Install from git repo, multi-source search, publish flow
3. **E2E tests:** Install plugin → search across sources → create team with mixed sources
4. **Security tests:** Malicious plugin detection, hook sandboxing

## Rollback

- Remote sources are additive — local plugins always work
- Feature-flagged: `MARKETPLACE_ENABLED=true`
- Uninstall removes plugin files but doesn't affect existing teams
- Ratings in DB can be dropped without breaking functionality
