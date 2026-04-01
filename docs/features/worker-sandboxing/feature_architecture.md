# Worker Sandboxing — Feature Architecture

**Status:** New  
**Date:** March 30, 2026  
**ID:** A4

---

## Overview

Run worker agents in isolated sandboxes so they can't interfere with each other or the host system. Critical for security, reproducibility, and multi-tenant operation.

### Current State
- Workers run in the same Node.js process as the backend
- `AgentWorkspace` provides filesystem isolation by path but no process isolation
- `simple-git` runs git commands directly on host
- No resource limits, no network isolation

### Target State
- Each worker gets an isolated sandbox (filesystem, process, optionally network)
- Docker containers for real isolation (free, self-hosted)
- Agent tools (file ops, commands) execute inside the sandbox
- Sandbox persists for task duration, cleaned up after

---

## Why Microsandbox (Not Raw Docker)

| Option | Isolation | Boot Time | JS SDK | MCP | Cost | Maturity |
|---|---|---|---|---|---|---|
| **Microsandbox** ✅ | **Hardware VM** (microVM via libkrun) | **<200ms** | ✅ `npm install microsandbox` | ✅ Built-in | Free, self-hosted | Experimental (v0.3.3) |
| **Docker** (fallback) | Container (cgroups) | ~2-5s | Via `dockerode` | ❌ | Free | Battle-tested |
| **OpenSandbox** (Alibaba) | Docker + gVisor/Kata | ~2-5s | ✅ TS SDK | ❌ | Free | Production (9.5k stars) |
| **AIO Sandbox** | Docker container | ~2-5s | ✅ npm SDK | ✅ MCP | Free | Active (3.7k stars) |
| **E2B** | Cloud VM | ~1s | ✅ | ❌ | **$0.10-0.50/min** | Production |
| **Mastra LocalSandbox** | None (just directory) | Instant | ✅ | ❌ | Free | Minimal isolation |

**Microsandbox wins because:**
- **Stronger isolation than Docker** — hardware-level microVMs (like Firecracker) not just container namespaces
- **10-25x faster boot** — <200ms vs 2-5s for Docker containers
- **Native JS/TS SDK** — `npm install microsandbox`, works with our Node.js stack
- **Built-in MCP server** — agents can use sandbox tools via MCP protocol
- **OCI compatible** — runs standard Docker images (our `ping-worker` image works)
- **Self-hosted, fully free** — no cloud costs ever
- **Persistent environments** — changes survive restart (perfect for task branches)
- **Cross-platform** — macOS, Linux, Windows

**The risk:** Microsandbox is experimental (v0.3.3, 5.2k stars). If it proves unstable, Docker is the proven fallback with identical container images.

---

## Architecture: Microsandbox Primary, Docker Fallback

```
Worker Task assigned:
  │
  ▼
Orchestrator → WorkerPool.spawn(role, task)
  │
  ├── MICROSANDBOX (primary):
  │     import { NodeSandbox } from 'microsandbox';
  │
  │     const sandbox = await NodeSandbox.create({
  │       name: `worker-${taskId}`,
  │       image: 'ping-worker:latest',    // same OCI image either way
  │     });
  │
  │     // Execute commands inside microVM
  │     await sandbox.run('cat /workspace/file.ts');
  │     await sandbox.run('git commit -m "task complete"');
  │
  │     // Cleanup
  │     await sandbox.stop();
  │
  ├── DOCKER (fallback — if Microsandbox unavailable):
  │     docker create --name worker-{taskId}
  │       --memory 2g --cpus 2
  │       -v /data/workspaces/{taskId}:/workspace
  │       ping-worker:latest
  │
  │     docker exec worker-{taskId} cat /workspace/file.ts
  │     docker stop worker-{taskId} && docker rm worker-{taskId}
  │
  └── DEV MODE (no sandbox):
        Direct filesystem access. Path isolation only.
```

### Sandbox Provider Abstraction

The WorkerPool doesn't care which sandbox is running — it uses a common interface:

```typescript
interface SandboxProvider {
  create(config: SandboxConfig): Promise<Sandbox>;
}

interface Sandbox {
  exec(command: string): Promise<ExecResult>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  stop(): Promise<void>;
}

// Implementations
class MicrosandboxProvider implements SandboxProvider { ... }
class DockerProvider implements SandboxProvider { ... }
class LocalProvider implements SandboxProvider { ... }  // dev mode, no isolation
```

Config selects the provider:

```typescript
// Team or global config
sandboxing: {
  provider: 'microsandbox' | 'docker' | 'local',  // default: 'microsandbox'
  image: 'ping-worker:latest',
  memory: '2g',
  cpus: 2,
}
```

### Container Image

Pre-bake everything the worker needs:

```dockerfile
# Dockerfile.worker
FROM node:20-slim

# Tools every worker needs
RUN apt-get update && apt-get install -y \
    git \
    ripgrep \
    python3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Node.js tools
RUN npm install -g typescript tsx

# Working directories
WORKDIR /workspace
VOLUME ["/workspace", "/memory"]

# Default: keep container alive for exec commands
CMD ["sleep", "infinity"]
```

Teams can customize the image (add language runtimes, SDKs, etc.):

```yaml
# team config
sandboxing:
  image: 'ping-worker:latest'         # default
  # image: 'ping-worker-python:latest'  # Python-heavy team
  # image: 'custom-registry/my-worker'  # custom image
  memory: '2g'
  cpus: 2
  networkPolicy: 'isolated'            # or 'allowlist' with specific hosts
```

### What Runs WHERE

```
HOST PROCESS (Node.js backend):
  ├── AgentManager (orchestrator)
  ├── Planner agent (LLM calls happen here — no sandbox needed)
  ├── WorkerPool (manages containers)
  ├── MCP servers (@ping/mcp-collab, @ping/mcp-knowledge)
  └── Socket.IO / HTTP API

DOCKER CONTAINER (per worker):
  ├── Mounted /workspace (task files, git branch)
  ├── Mounted /memory (role's memory repo)
  ├── Agent tool execution:
  │   ├── File read/write → filesystem ops inside container
  │   ├── Git operations → git inside container
  │   ├── Command execution → runs inside container (sandboxed!)
  │   └── Search → ripgrep/grep inside container
  └── Container destroyed on task completion
```

**Key insight:** The LLM calls and orchestration logic stay on the host. Only tool execution (file ops, commands, git) runs inside the container. This means:
- No extra latency for LLM calls
- Container only needs tools, not the full AI SDK
- Container can be a lightweight Linux image

### Tool Execution via Sandbox

The `@ping/workspace-tools` package wraps tool execution through the sandbox provider:

```typescript
function createWorkspaceTools(config: WorkspaceConfig): Tools {
  const sandbox = config.sandbox;  // SandboxProvider instance

  return {
    workspace_read_file: tool({
      description: 'Read a file from the workspace',
      parameters: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        return sandbox.readFile(`/workspace/${sanitizePath(path)}`);
      },
    }),

    workspace_write_file: tool({
      description: 'Write a file to the workspace',
      parameters: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path, content }) => {
        return sandbox.writeFile(`/workspace/${sanitizePath(path)}`, content);
      },
    }),

    run_command: tool({
      description: 'Run a shell command in the workspace',
      parameters: z.object({ command: z.string() }),
      execute: async ({ command }) => {
        return sandbox.exec(command);
      },
    }),
    // ... other tools
  };
}
```

Same tool interface regardless of provider. Agent doesn't know or care if it's in a microVM, Docker container, or local directory.

### Microsandbox MCP Integration

Microsandbox ships with a built-in MCP server. This means external agents can connect to a running sandbox via MCP and use it as an execution environment — without any custom bridge code:

```
External agent → MCP connect → Microsandbox MCP server → exec, read, write inside sandbox
```

This aligns with Ping's MCP-first architecture (A3). A sandbox IS an MCP server that provides execution tools.

---

## Dev vs Prod

| Environment | Provider | Why |
|---|---|---|
| **Dev (local)** | **`local`** — direct filesystem | No setup required. Path isolation is enough for development. |
| **Staging** | **`microsandbox`** — microVMs | Test real isolation. <200ms boot, no Docker daemon needed. |
| **Prod (self-hosted)** | **`microsandbox`** — microVMs | Hardware-level isolation, fast boot, free. |
| **Prod (fallback)** | **`docker`** — containers | If Microsandbox proves unstable, Docker is battle-tested. |
| **Prod (cloud, future)** | **E2B** or **OpenSandbox on K8s** | When you need managed cloud sandboxes at scale. |

### Dev Mode (No Docker Required)

Developers don't need Docker running to work on Ping:

```typescript
// WorkerPool checks config
if (config.sandboxing === 'docker') {
  await this.createDockerSandbox(taskId, role);
} else {
  // Dev mode: just use a directory
  await this.createLocalWorkspace(taskId, role);
}
```

---

## Network Isolation

Docker makes network control simple:

```yaml
# docker-compose.yml
networks:
  ping-isolated:
    driver: bridge
    internal: true    # no external access by default

  ping-allowlist:
    driver: bridge
    # Workers can reach specific hosts (APIs, npm registry)
```

| Policy | What Workers Can Access | Use Case |
|---|---|---|
| `isolated` | Nothing external. Only host via mounted volumes. | Maximum security. Research/writing agents. |
| `allowlist` | Specific URLs (npm registry, specific APIs) | Coding agents that need to install packages |
| `open` | Full internet access | Research agents that need web search (if not via MCP) |

---

## Resource Limits

Docker provides per-container resource control:

```typescript
interface SandboxConfig {
  memory: string;        // '2g' — hard limit, OOM killed if exceeded
  cpus: number;          // 2 — CPU cores allocated
  diskSize?: string;     // '10g' — workspace size limit
  timeout?: number;      // 1800000 — 30 min max task duration (watchdog handles this)
  networkPolicy: 'isolated' | 'allowlist' | 'open';
}
```

The Orchestrator's watchdog (from A5/A6) monitors containers. If a worker dies (OOM, crash), the watchdog detects it via missing heartbeats and reports to the Planner.

---

## OSS Reference Projects

| Project | Approach | Stars | What We Can Learn |
|---|---|---|---|
| **[Microsandbox](https://github.com/superradcompany/microsandbox)** | MicroVM (libkrun) + JS/Python/Rust SDK + MCP | 5.2k | **Primary choice** — our sandbox provider |
| **[OpenSandbox](https://github.com/alibaba/OpenSandbox)** (Alibaba) | Docker/K8s + gVisor/Kata/Firecracker, multi-lang SDK | 9.5k | Production K8s deployment patterns, CNCF landscape |
| **[AIO Sandbox](https://github.com/agent-infra/sandbox)** | All-in-one Docker (browser + shell + files + VSCode + MCP) | 3.7k | MCP integration pattern, browser automation |
| **[OpenHands](https://github.com/All-Hands-AI/OpenHands)** | Docker container per agent + event stream | 50k+ | Container lifecycle management pattern |
| **[SWE-agent](https://github.com/princeton-nlp/SWE-agent)** | Docker with interactive shell | 15k+ | Shell-in-container execution model |

---

## Implementation Checklist

| Component | Status | Action |
|---|---|---|
| `SandboxProvider` interface | ❌ Missing | Create abstraction: `create`, `exec`, `readFile`, `writeFile`, `stop` |
| `MicrosandboxProvider` | ❌ Missing | Implement using `microsandbox` npm SDK |
| `DockerProvider` (fallback) | ❌ Missing | Implement using `dockerode` |
| `LocalProvider` (dev mode) | ⚠️ Partial | Current path isolation serves as dev mode |
| `Dockerfile.worker` | ❌ Missing | Create base worker image (OCI, works with both providers) |
| `@ping/workspace-tools` sandbox mode | ❌ Missing | Route tool execution through sandbox provider |
| Volume/directory mounting | ❌ Missing | Mount workspace + memory repos into sandbox |
| Network isolation | ❌ Missing | Microsandbox network config / Docker network policies |
| Resource limits | ❌ Missing | Memory, CPU per sandbox |
| Provider config per team | ❌ Missing | Team config selects `microsandbox` / `docker` / `local` |
| Container image CI | ❌ Missing | Build + push worker image |
| Microsandbox MCP integration | ❌ Missing | Explore using built-in MCP server for external agents |

**Effort:** Medium (2-3 weeks)
