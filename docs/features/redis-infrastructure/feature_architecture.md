# Redis Infrastructure — Feature Architecture

> **Date:** May 1, 2026  
> **Status:** Research complete — awaiting architecture decision  
> **Blocks:** Multi-instance deployment, resumable streams, horizontal scaling  
> **Related:** [communication-layer-refactor](../communication-layer-refactor/), [data-persistence](../data-persistence/)

---

## Problem Statement

Ping's backend is **single-instance only**. 24 in-memory data structures hold critical state (goals, tasks, sessions, streams, rate limits) that is lost on restart and invisible to a second instance. This blocks:

1. **Horizontal scaling** — can't run 2+ backend instances behind a load balancer
2. **Zero-downtime deploys** — restarting the server kills all active workflows
3. **Resumable streams** — page reload mid-stream shows empty chat (no stream recovery)
4. **Rate limit enforcement** — per-instance limits bypassed with multiple instances

### In-Memory State Inventory (24 components)

| Category | Component | Data Structure | Lost on Restart | Breaks Multi-Instance |
|----------|-----------|---------------|:-:|:-:|
| **Workflow** | TaskStore.tasks | `Map<taskId, Task>` | Yes | Yes |
| **Workflow** | GoalManager.goals | `Map<goalId, GoalContext>` | Yes | Yes |
| **Workflow** | WorkerPool.workers | `Map<taskId, Worker>` | Yes | Yes |
| **Workflow** | DispatchManager.activeDispatches | `Set<taskId>` | Yes | Duplicate execution |
| **Workflow** | DispatchManager.taskAttempts | `Map<taskId, number>` | Yes | Retry logic breaks |
| **Workflow** | RoleTaskQueue.queues | `Map<role, Task[]>` | Yes | Priority lost |
| **Workflow** | NotificationQueue.pending | `Map<goalId, events[]>` | Yes | Planner not notified |
| **Session** | SocketConnectionManager.connections | `Map<connId, Connection>` | Yes | User invisible to instance 2 |
| **Session** | SocketConnectionManager.userSockets | `Map<userId, Set<connId>>` | Yes | Same |
| **Session** | UserManager.users | `Map<userId, User>` | Yes | User data lost |
| **Session** | SocketServerV2.attachedTeams | `Set<teamId>` | Yes | No callbacks on instance 2 |
| **Stream** | SocketServerV2.messageAccumulator | `Map<taskId, {text, parts}>` | Yes | Partial message lost |
| **Stream** | SocketServerV2.streamedTasks | `Set<taskId>` | Yes | Duplicate finish events |
| **Agent** | ChatAgent.threads | `Map<role, messages[]>` | Yes | Chat context lost |
| **Agent** | WorkerPool.lastResponses | `Map<taskId, response>` | Yes | Can't continue |
| **Agent** | WorkerPool.definitions | `Map<role, AgentDef>` | No (re-loaded) | OK |
| **Security** | TokenBucketLimiter.buckets | `Map<userId, bucket>` | Yes | 2x rate limit bypass |
| **Interaction** | UserInteractionManager.pending | `Map<questionId, Promise>` | Yes | Questions unanswered |
| **Persistence** | FileTaskStore | JSON files | No (disk) | Race condition |
| **Cache** | AgentManagerRegistry.managers | `Map<teamId, Manager>` | Yes (lazy reload) | OK (each creates own) |
| **Cache** | PluginLoader cache | In-memory | Yes (lazy reload) | OK |
| **Cache** | SkillResolver cache | In-memory | Yes (lazy reload) | OK |

**Classification:**
- 🔴 **Must persist** (13): TaskStore, GoalManager, sessions, dispatch state, streams, rate limits
- 🟡 **Should persist** (5): ChatAgent threads, worker responses, notification queue, user interactions, role queues
- 🟢 **OK as-is** (6): Lazy-loaded caches (AgentManagerRegistry, PluginLoader, SkillResolver, WorkerPool.definitions)

---

## Where Redis Fits vs MongoDB

Redis and MongoDB serve different roles. The key question for each piece of state: **is it accessed at high frequency with low latency requirements, or is it durable data queried by complex criteria?**

| State | Access Pattern | Right Store | Why |
|-------|---------------|-------------|-----|
| Task status/output | Write on each status change, read on dispatch | MongoDB (primary) + Redis (cache) | Needs durability + fast dispatch lookup |
| GoalContext state | Write on state transitions, read on every request | MongoDB (primary) + Redis (cache) | Needs durability + fast session lookup |
| Socket connections | Read/write on every Socket.IO event (100s/sec) | **Redis only** | Ephemeral, ultra-high frequency |
| Rate limit buckets | Read/write on every API call | **Redis only** | Ephemeral, needs atomicity |
| Stream accumulator | Write per stream part (100s/sec), read on finish | **Redis Streams** | High throughput, ordered, TTL |
| Dispatch locks | Read/write on task assignment | **Redis only** | Needs atomic CAS for distributed locking |
| Notification queue | Batch writes, periodic flush | **Redis List** | Ephemeral, ordered, bounded |
| User interactions | Write question, await answer (5min TTL) | **Redis** with TTL | Short-lived, cross-instance |
| Chat messages | Write on completion, read on restore | **MongoDB only** | Already persisted there |
| Goal metadata | Write on create/update, read on list | **MongoDB only** | Already persisted there |

---

## Architecture Options

### Option A: Redis as Cache + Pub/Sub (Minimum Viable)

**Implementation:** Add Redis for the 6 most critical use cases. MongoDB stays primary for durable data. No new persistence schemas.

| Use Case | Redis Structure | Key Pattern | TTL |
|----------|----------------|-------------|-----|
| Resumable streams | Redis Streams | `stream:{teamId}:{taskId}` | 30min |
| Rate limiting | String + INCR | `ratelimit:{userId}` | 60s window |
| Socket sessions | Hash | `session:{connId}` | None (cleanup on disconnect) |
| Dispatch locks | String + NX | `dispatch:{taskId}` | 5min (safety) |
| Pub/Sub for Socket.IO | Pub/Sub channels | `room:{teamId}:goal:{goalId}` | — |
| Stream accumulator | Hash | `acc:{teamId}:{taskId}` | 30min |

**Changes:**
- Add `ioredis` dependency to `@ping/backend`
- Add `@socket.io/redis-adapter` for multi-instance Socket.IO
- Create `packages/backend/services/RedisService.ts` — connection, health check
- Wire into: SocketServerV2 (streams, rate limits, sessions), WorkerPool (dispatch locks)
- Add `redis` service to `docker-compose.yml`

**What this fixes:**
- ✅ Resumable streams (page reload mid-stream)
- ✅ Multi-instance Socket.IO (rooms work across instances)
- ✅ Rate limiting across instances
- ✅ No duplicate task execution (distributed lock)
- ❌ Tasks/goals still lost on restart (needs MongoDB — separate feature)

**Pros:**
- Smallest scope — 6 focused integrations
- Doesn't touch the persistence layer (MongoDB schemas unchanged)
- Each integration independently testable
- Socket.IO Redis adapter is a well-tested pattern

**Cons:**
- Doesn't fix restart recovery (tasks/goals still in-memory)
- Two infra dependencies to manage (Redis + MongoDB)
- Stream accumulator in Redis adds complexity vs current in-memory Map

**Effort:** Medium — 3-5 days

---

### Option B: Redis as Session Store + MongoDB for Persistence (Full Solution)

**Implementation:** Redis for all ephemeral/high-frequency state. MongoDB for all durable state (adding GoalContext + Task schemas from v3.0 plan). Complete multi-instance readiness.

**Redis layer (ephemeral, high-frequency):**

| Use Case | Redis Structure | Key Pattern |
|----------|----------------|-------------|
| Resumable streams | Redis Streams | `stream:{teamId}:{taskId}` |
| Rate limiting | String + INCR | `ratelimit:{userId}` |
| Socket sessions | Hash + Set | `session:{connId}`, `user:{userId}:sockets` |
| Dispatch locks | String + NX | `dispatch:{taskId}` |
| Socket.IO adapter | Pub/Sub | (managed by @socket.io/redis-adapter) |
| Stream accumulator | Hash | `acc:{teamId}:{taskId}` |
| Notification queue | List | `notifications:{teamId}:{goalId}` |
| User interactions | Hash + TTL | `question:{questionId}` |
| Active streams tracking | Set | `active-streams:{teamId}` |

**MongoDB layer (durable, already planned in v3.0):**

| Collection | Fields | Replaces |
|-----------|--------|----------|
| `goal_contexts` | goalId, teamId, state, title, planId, repoUrl | In-memory GoalManager.goals |
| `tasks` | id, goalId, status, assignedRole, output, prerequisites | In-memory TaskStore |

**Changes:**
- Everything from Option A
- Plus: `MongoGoalContextService`, `MongoTaskService` (from v3.0 plan)
- Plus: `GoalManager.loadFromDb()`, `TaskStore.writeThrough()`
- Plus: Startup recovery (hydrate from MongoDB)
- Plus: `UserInteractionManager` → Redis with TTL
- Plus: `NotificationQueue` → Redis List

**What this fixes:**
- ✅ Everything from Option A
- ✅ Tasks/goals survive restart (MongoDB)
- ✅ Complete multi-instance readiness
- ✅ User interactions work across instances
- ✅ Zero-downtime deploys possible

**Pros:**
- Complete solution — no in-memory state gaps
- Subsumes v3.0 backend persistence plan
- Single deployment achieves horizontal scaling
- Clean separation: Redis (ephemeral) + MongoDB (durable)

**Cons:**
- Large scope — touches 15+ files
- Requires both Redis AND MongoDB schema changes
- More complex testing (need Redis + MongoDB in CI)
- Risk of over-engineering if multi-instance isn't needed yet

**Effort:** Large — 7-10 days

---

### Option C: Redis Streams Only (Narrowest Scope)

**Implementation:** Add Redis solely for resumable streams. Nothing else changes.

**Changes:**
- Add `ioredis` to backend
- Add Redis service to docker-compose
- On each stream part: `XADD stream:{taskId} * type {type} data {json}`
- On page reload: `GET /api/v2/tasks/{taskId}/stream` → `XRANGE` from Redis → replay
- On finish: `DEL stream:{taskId}`
- Track `activeStreamId` on GoalContext (in-memory, not persisted)

**What this fixes:**
- ✅ Resumable streams only
- ❌ No multi-instance support
- ❌ No rate limit fix
- ❌ No restart recovery

**Pros:**
- Tiniest scope — 1 use case
- No MongoDB changes
- Can ship in 1-2 days

**Cons:**
- Still single-instance
- Adds Redis infra for just one feature
- Will need to redo when multi-instance is needed

**Effort:** Small — 1-2 days

---

## Recommendation

**Option A** — Redis as Cache + Pub/Sub. It fixes the 4 most impactful problems (resumable streams, multi-instance Socket.IO, rate limiting, dispatch locks) without touching the persistence layer. Option B's MongoDB persistence is already planned as v3.0 of the communication-layer-refactor and should ship separately.

Option C is too narrow — if we're adding Redis infrastructure, we should get Socket.IO multi-instance and rate limiting for free (they're 10 lines each with `@socket.io/redis-adapter` and `INCR`).

**Decision Required:** Please choose Option A, B, or C.

---

## Integration Points

### Backend Components Affected

| Component | Change | Files |
|-----------|--------|-------|
| SocketServerV2 | Redis adapter, stream accumulator to Redis, rate limiter to Redis | `api/SocketServerV2.ts` |
| WorkerPool | Dispatch lock via Redis NX | `services/WorkerPool.ts` |
| AgentManagerAPI | Redis health check endpoint | `api/AgentManagerAPI.ts` |
| Docker stack | Redis service | `docker-compose.yml`, `docker-compose.dev.yml` |
| Environment | `REDIS_URL` config | `.env.example` |

### Frontend Components Affected

| Component | Change | Files |
|-----------|--------|-------|
| goalSessionStore | Resume endpoint call on restore | `stores/goalSessionStore.ts` |
| App.tsx | Show "resuming..." indicator for in-progress tasks | `App.tsx` |

### New API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v2/tasks/{taskId}/stream` | Resume active stream from Redis |
| GET | `/api/v2/health` | Extended with Redis connection status |

### Infrastructure

```yaml
# docker-compose.yml addition
redis:
  image: redis:7-alpine
  container_name: ping-redis
  restart: unless-stopped
  ports:
    - "${REDIS_PORT:-6379}:6379"
  volumes:
    - ping-redis:/data
  command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 10s
    timeout: 3s
    retries: 3

volumes:
  ping-redis:
    name: ping-redis
```

### Dependencies

```json
{
  "@ping/backend": {
    "ioredis": "^5.4.0",
    "@socket.io/redis-adapter": "^8.3.0"
  }
}
```
