# L2 as Deployed Service — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** Parked (premature — L2 works embedded)  
**ID:** D3  
**Approach:** Option B — Embedded Module with Optional Extraction

---

## Branch
- `feature/l2-service` (when unparked)

## Scope
Clean `L2Client` interface that works both in-process and over HTTP. Extraction to standalone service deferred until scale demands it.

## Implementation Steps

### Step 1: Define L2Client Interface
**Files to create:**
- `packages/backend/memory/L2/client/L2Client.ts` — Interface: `search(query)`, `read(docName)`, `write(docName, content)`, `query(jsonpath)`, `list()`, `subscribe(docName, callback)`

**Exit criteria:** Interface defined, consumed by agents and orchestrator

### Step 2: Implement In-Process L2Client
**Files to create:**
- `packages/backend/memory/L2/client/InProcessL2Client.ts` — Directly calls Hocuspocus/SearchExtension methods. Zero network overhead.

**Exit criteria:** In-process client works identically to current direct access

### Step 3: Implement HTTP L2Client (Prep)
**Files to create:**
- `packages/backend/memory/L2/client/HttpL2Client.ts` — Calls L2 HTTP endpoints (from L2 Search feature). WebSocket for CRDT sync.

**Exit criteria:** HTTP client passes same tests as in-process client

### Step 4: Switch Consumers to L2Client
**Files to modify:**
- All code accessing L2 directly → use `L2Client` interface
- `packages/backend/orchestrator/OrchestratorService.ts`, agent tools, etc.

**Exit criteria:** All L2 access goes through client interface

### Step 5: Extraction to Standalone Service (When Needed)
**Files to create (future):**
- `packages/l2-service/` — Standalone Express + Hocuspocus server
- Docker Compose entry for L2 service

**Trigger:** When L2 needs independent scaling or CLI/external agents need direct L2 access without full backend.

## Testing Strategy  
- Both clients pass identical test suite
- In-process performance baseline documented
- HTTP client latency measured

## Complexity
Low-Medium — 1-2 weeks for interface + in-process client. +2 weeks for extraction when needed.
