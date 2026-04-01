# Worker Sandboxing — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** 6 (Isolation & Security)  
**ID:** A4

---

## Branch
- `feature/worker-sandboxing`

## Scope
Sandbox provider abstraction with two backends: **Microsandbox** (primary — dev AND prod) and **Docker** (fallback). No bare-metal "local" mode — dev starts Microsandbox locally via `microsandbox server` subprocess. SandboxProvider interface, container image, tool execution routing through sandbox.

## Implementation Steps

### Step 1: Define SandboxProvider Interface
**Files to create:**
- `packages/backend/services/sandbox/types.ts` — `SandboxProvider`, `Sandbox`, `SandboxConfig`, `ExecResult` interfaces
- `packages/backend/services/sandbox/index.ts` — Factory: `createSandboxProvider(config)`

```typescript
interface SandboxProvider { create(config: SandboxConfig): Promise<Sandbox>; }
interface Sandbox {
  exec(command: string): Promise<ExecResult>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  stop(): Promise<void>;
}
```

**Exit criteria:** Interfaces compile, factory dispatches by provider type

### Step 2: Implement MicrosandboxProvider (Primary — Dev + Prod)
**Files to create:**
- `packages/backend/services/sandbox/MicrosandboxProvider.ts` — Uses `microsandbox` npm SDK. `NodeSandbox.create()` for microVMs. <200ms boot. Same OCI image as Docker.
- `packages/backend/services/sandbox/MicrosandboxLifecycle.ts` — Auto-starts `microsandbox server` as child process in dev mode. Checks if server already running (health endpoint), starts if not. Graceful shutdown on process exit. Handles Windows + Linux + macOS.

**Dev mode flow:**
```
Backend starts → MicrosandboxLifecycle.ensureRunning()
  → Checks http://localhost:5555/health (default Microsandbox port)
  → Not running? → spawn('microsandbox', ['server'], { detached: true })
  → Wait for health check → Ready
  → On backend shutdown → kill child process
```

**Prod mode:** Microsandbox server runs as a separate service (Docker Compose / k8s sidecar). `MicrosandboxLifecycle` skips auto-start, just validates connection.

**Dependencies:** `microsandbox` npm package  
**Exit criteria:** Dev: `bun run dev:backend` auto-starts Microsandbox server, workers execute in microVMs. Prod: connects to external Microsandbox server.

### Step 3: Implement DockerProvider (Fallback)
**Files to create:**
- `packages/backend/services/sandbox/DockerProvider.ts` — Uses `dockerode` to create/start/exec/stop containers. Mounts workspace + memory volumes. Resource limits (memory, CPU). Network policy.

**When used:** Microsandbox unavailable (install issues, unsupported platform, explicit config override). Factory auto-detects: try Microsandbox health check → fail → try Docker socket → fail → error (no bare-metal fallback).

**Dependencies:** `dockerode` npm package  
**Exit criteria:** Worker tasks execute inside Docker containers with resource limits

### Step 4: Create Worker Container Image
**Files to create:**
- `Dockerfile.worker` — Base image: `node:20-slim`. Install: git, ripgrep, python3, curl, typescript, tsx. Working directory: `/workspace`. Volumes: `/workspace`, `/memory`.

**Exit criteria:** Docker image builds, contains all required tools

### Step 5: Route Tool Execution Through Sandbox
**Files to modify:**
- `packages/backend/memory/L1/workspace/tools/workspace-tools.ts` (or `@ping/workspace-tools`) — Accept `Sandbox` instance. Route `workspace_read_file`, `workspace_write_file`, `run_command` through `sandbox.exec()` / `sandbox.readFile()` / `sandbox.writeFile()`.

**Exit criteria:** Tool execution transparently uses sandbox when available

### Step 6: Wire SandboxProvider into WorkerPool
**Files to modify:**
- `packages/backend/services/WorkerPool.ts` — On task dispatch: create sandbox (based on team config), mount workspace + memory volumes, provide Sandbox to tools, destroy sandbox on task completion.
- `packages/backend/services/sandbox/index.ts` — Factory auto-detection: Microsandbox health check → Docker socket check → error. No silent bare-metal fallback.

**Config per team:**
```typescript
sandboxing: { provider: 'microsandbox' | 'docker' | 'auto', memory: '2g', cpus: 2, networkPolicy: 'isolated' }
// 'auto' (default): try Microsandbox → Docker → error
```

**Exit criteria:** Workers execute in configured sandbox, cleanup on completion. `auto` mode picks best available provider.

### Step 7: Add Network Isolation
**Files to modify:**
- `packages/backend/services/sandbox/DockerProvider.ts` — Docker network policies: `isolated` (no external), `allowlist` (specific URLs), `open`
- `packages/backend/services/sandbox/MicrosandboxProvider.ts` — Microsandbox network config

**Exit criteria:** Network policies enforced per sandbox

### Step 8: Container Image CI
**Files to create:**
- `.github/workflows/build-worker-image.yml` — Build and tag `ping-worker:latest` on push

**Exit criteria:** Worker image auto-built in CI

## Testing Strategy
- Unit test: MicrosandboxProvider creates/exec/stops correctly
- Unit test: DockerProvider creates/exec/stops correctly
- Integration test: task executes in Microsandbox microVM
- Integration test: task executes in Docker sandbox (fallback)
- Test: resource limits enforced (OOM, CPU)
- Test: network isolation (isolated sandbox can't reach internet)
- Test: dev mode auto-starts Microsandbox server, workers execute in microVMs
- Test: auto-detection fallback (Microsandbox unavailable → Docker → error)

## Research Added to Architecture
- Microsandbox experimental status (v0.3.3) — monitor stability, fallback to Docker if issues
- Cross-platform testing needed (Windows dev + Linux prod)
- Microsandbox server auto-start tested on Windows (dev) and Linux (CI/prod)

## Complexity
Medium — 2-3 weeks. Provider abstraction makes fallback easy.
