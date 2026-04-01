# L2 as Deployed Service — Feature Architecture

**Status:** New  
**Date:** March 29, 2026  
**ID:** D3  
**Depends on:** D2 (L2 Search & Indexing)

---

## Overview

Deploy L2 (Hocuspocus CRDT server + search) as a **standalone service**, separate from the backend runtime. Every agent should be able to call it for search and fetch indexed data. L2 becomes a shared collaboration + search layer.

### Current State
- Hocuspocus server embedded in backend process
- PlanStore, CollaborationSpace, GroupChatManager all in-process
- No independent deployment capability
- Agents access L2 through in-process `L2CollaborationPlugin`

### Target State
```
┌──────────────────────────────┐     ┌──────────────────────────┐
│ Backend (AgentManager, API)  │────→│ L2 Service (standalone)  │
│ - Agents call L2 via HTTP    │     │ - Hocuspocus CRDT server │
│ - Tool: l2_search, l2_read   │     │ - MiniSearch index       │
│ - Tool: l2_write              │     │ - JSONPath queries       │
└──────────────────────────────┘     │ - HTTP API               │
                                      │ - WebSocket (CRDT sync)  │
┌──────────────────────────────┐     │ - MongoDB persistence    │
│ CLI / External Agents        │────→│                          │
│ - Same HTTP API              │     └──────────────────────────┘
└──────────────────────────────┘
```

---

## Architecture Options

### Option A: Hocuspocus as Standalone Node.js Service (Recommended)

**Implementation:** Extract L2 code into `packages/l2-service/`. Run as standalone Express + Hocuspocus server. Backend and CLI connect via HTTP for search + WebSocket for CRDT sync.

**Pros:**
- Clean separation
- Can scale independently
- Any client (backend, CLI, external) can connect
- Hocuspocus already designed to run standalone

**Cons:**
- Network hop for every L2 operation
- Must maintain separate service
- CRDT sync needs WebSocket (not just HTTP)

**Effort:** Medium (2-3 weeks)

### Option B: L2 as Embedded Module with Optional Extraction

**Implementation:** Keep L2 in-process but behind a clean interface. Add `L2Client` that works both in-process and over HTTP. Extract to service later.

**Pros:**
- Start in-process (simpler)  
- Extract when scale demands it
- Same client interface either way

**Cons:**
- Delayed separation
- Risk of coupling leaking across the interface

**Effort:** Low-Medium (1-2 weeks for interface, +2 weeks for extraction)

## Recommendation

**Option B** for now — clean interface first, deploy separately when ready. This avoids premature optimization while keeping the door open.

**Decision Required:** Please choose Option A or B.
