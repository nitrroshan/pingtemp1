# Ping Organism — Practical Implementation

**Status:** Vision → Implementation  
**Last Updated:** February 1, 2026

---

## The Insight

The "organism" metaphor helps us understand WHAT Ping should do. But implementation doesn't need 11 separate systems. Most capabilities are:

| Capability | Actually Is |
|------------|-------------|
| Sense | **Tools** that query state |
| Remember | **State** we already track |
| React | **Event handlers** on existing events |
| Communicate | **Socket events** we already emit |
| Protect | **Middleware** wrapping actions |
| Focus | **Priority algorithm** in TaskQueue |
| Adapt | **Retry strategies** + prompt variations |
| Grow | **Metrics** + prompt versioning |
| Collaborate | **Shared state** + handoff protocol |
| Anticipate | **Caching** + estimation functions |
| Reproduce | **Templates** + cloning |

---

## Unified Implementation

### Core Principle: Tools + State + Events

```typescript
// Everything lives in ONE orchestrator with:
// 1. State (what we know)
// 2. Tools (what we can do)  
// 3. Events (how we communicate)

interface OrchestratorState {
  // REMEMBER - just state
  tasks: Map<string, Task>;
  agents: Map<string, Agent>;
  context: Map<string, any>;        // Team memory
  decisions: Decision[];            // Audit trail
  metrics: MetricsStore;            // Performance data
  
  // SENSE - derived from state + queries
  budget: { remaining: number; total: number };
  rateLimits: Map<string, RateLimit>;
  deadlines: Deadline[];
}

// TOOLS - functions the orchestrator can call
const orchestratorTools = [
  // Sense tools
  getBudget,
  getDeadlines,
  getBlockedTasks,
  getAgentStatus,
  
  // Action tools
  createTask,
  assignTask,
  retryTask,
  
  // Communication tools
  notifyUser,
  askForClarification,
  requestApproval,
  
  // Memory tools
  remember,
  recall,
  logDecision,
];
```

---

## Implementation: Skills Instead of Systems

### 1. SENSE = Query Tools

Not a "perception layer". Just tools that return current state.

```typescript
// src/tools/sense.ts

export const senseTools = {
  getBudget: tool({
    description: "Get remaining budget and burn rate",
    execute: async () => {
      const used = await costTracker.getTotal();
      const limit = config.budgetLimit;
      return {
        remaining: limit - used,
        total: limit,
        burnRate: await costTracker.getBurnRate(),
        willExhaustIn: (limit - used) / await costTracker.getBurnRate()
      };
    }
  }),

  getDeadlines: tool({
    description: "Get tasks with approaching deadlines",
    parameters: z.object({ hoursAhead: z.number().default(24) }),
    execute: async ({ hoursAhead }) => {
      const now = Date.now();
      const cutoff = now + hoursAhead * 60 * 60 * 1000;
      
      return memoryManager.getTasks()
        .filter(t => t.deadline && t.deadline.getTime() < cutoff)
        .map(t => ({
          id: t.id,
          name: t.name,
          deadline: t.deadline,
          hoursRemaining: (t.deadline.getTime() - now) / (1000 * 60 * 60),
          status: t.status
        }));
    }
  }),

  getBlockers: tool({
    description: "Get what's blocking progress",
    execute: async () => {
      const blocked = memoryManager.getBlockedTasks();
      const rateLimited = Array.from(rateLimiter.getBlocked());
      const waitingApproval = memoryManager.getTasksByStatus('pending_approval');
      
      return { blocked, rateLimited, waitingApproval };
    }
  }),

  getTeamStatus: tool({
    description: "Get status of all agents and their current work",
    execute: async () => {
      return Array.from(workerRegistry.entries()).map(([role, worker]) => ({
        role,
        status: worker.status,
        currentTask: worker.currentTask?.id,
        completedToday: worker.metrics.completedToday,
        errorRate: worker.metrics.errorRate
      }));
    }
  })
};
```

### 2. REMEMBER = State + Simple Helpers

Not a "memory layer". Just state with query helpers.

```typescript
// src/state/memory.ts

// Already have MemoryManager - just add context methods
class MemoryManager {
  // Existing task storage...
  
  // Add team context (shared facts)
  private context: Map<string, ContextEntry> = new Map();
  
  remember(key: string, value: any, source: string): void {
    this.context.set(key, {
      value,
      source,
      timestamp: new Date(),
      confidence: 1.0
    });
  }
  
  recall(key: string): ContextEntry | undefined {
    return this.context.get(key);
  }
  
  recallRelated(query: string): ContextEntry[] {
    // Simple keyword match, or use embeddings if needed
    return Array.from(this.context.entries())
      .filter(([k, v]) => k.includes(query) || JSON.stringify(v).includes(query))
      .map(([k, v]) => v);
  }
  
  // Decision logging - just an array
  private decisions: Decision[] = [];
  
  logDecision(decision: Omit<Decision, 'id' | 'timestamp'>): void {
    this.decisions.push({
      id: generateId(),
      timestamp: new Date(),
      ...decision
    });
  }
  
  getDecisionsFor(taskId: string): Decision[] {
    return this.decisions.filter(d => d.taskId === taskId);
  }
}

// Tools for memory
export const memoryTools = {
  remember: tool({
    description: "Store a fact or decision for future reference",
    parameters: z.object({
      key: z.string(),
      value: z.any(),
      reason: z.string()
    }),
    execute: async ({ key, value, reason }) => {
      memoryManager.remember(key, value, reason);
      return { stored: true };
    }
  }),

  recall: tool({
    description: "Recall stored facts related to a topic",
    parameters: z.object({ query: z.string() }),
    execute: async ({ query }) => {
      return memoryManager.recallRelated(query);
    }
  }),

  getTaskHistory: tool({
    description: "Get history of decisions and events for a task",
    parameters: z.object({ taskId: z.string() }),
    execute: async ({ taskId }) => {
      return {
        decisions: memoryManager.getDecisionsFor(taskId),
        events: memoryManager.getEventsFor(taskId)
      };
    }
  })
};
```

### 3. REACT = Event Handlers

Not a "reaction engine". Just handlers on events we already emit.

```typescript
// src/events/reactions.ts

// Reactions are just event handlers
function setupReactions(orchestrator: AgentManager) {
  
  // Budget low → alert user
  costTracker.on('threshold', ({ remaining, percentage }) => {
    if (percentage < 0.1) {
      orchestrator.emit('alert', {
        type: 'budget_critical',
        message: `Budget critically low: ${Math.round(percentage * 100)}% remaining`,
        action: 'pausing_expensive_operations'
      });
      orchestrator.pauseExpensiveOperations();
    }
  });
  
  // Rate limited → queue for retry
  rateLimiter.on('limited', ({ request, resetAt }) => {
    taskQueue.queueForRetry(request, resetAt);
  });
  
  // Task failed → decide retry or escalate
  memoryManager.on('taskFailed', async ({ task, error, attempts }) => {
    if (attempts < 3) {
      await orchestrator.retryTask(task.id, { 
        delay: Math.pow(2, attempts) * 1000 // Exponential backoff
      });
    } else {
      await orchestrator.escalateToUser(task, error);
    }
  });
  
  // Deadline approaching → notify
  setInterval(async () => {
    const urgent = await senseTools.getDeadlines.execute({ hoursAhead: 2 });
    for (const task of urgent.filter(t => t.status !== 'completed')) {
      orchestrator.emit('deadline_warning', { task });
    }
  }, 15 * 60 * 1000); // Check every 15 min
}
```

### 4. PROTECT = Middleware

Not a "safety layer". Just middleware that wraps tool execution.

```typescript
// src/middleware/protection.ts

// Wrap all tool calls with guards
function withProtection<T>(
  tool: Tool<T>, 
  guards: Guard[]
): Tool<T> {
  return {
    ...tool,
    execute: async (params) => {
      // Run all guards
      for (const guard of guards) {
        const result = guard.check(params);
        if (!result.pass) {
          return { 
            blocked: true, 
            reason: result.reason,
            suggestion: result.suggestion 
          };
        }
      }
      
      // Execute with audit
      const startTime = Date.now();
      try {
        const result = await tool.execute(params);
        auditLog.success(tool.name, params, result, Date.now() - startTime);
        return result;
      } catch (error) {
        auditLog.failure(tool.name, params, error, Date.now() - startTime);
        throw error;
      }
    }
  };
}

// Guards are simple functions
const guards: Guard[] = [
  // Budget guard
  {
    name: 'budget',
    check: (params) => {
      const cost = estimateCost(params);
      const budget = costTracker.getRemaining();
      if (cost > budget) {
        return { 
          pass: false, 
          reason: `Would exceed budget (need ${cost}, have ${budget})`,
          suggestion: 'Request budget increase or use cheaper approach'
        };
      }
      return { pass: true };
    }
  },
  
  // PII guard
  {
    name: 'pii',
    check: (params) => {
      if (params.content && containsPII(params.content)) {
        return {
          pass: false,
          reason: 'Output contains PII',
          suggestion: 'Redact sensitive information'
        };
      }
      return { pass: true };
    }
  },
  
  // Loop detection
  {
    name: 'loop',
    check: (params) => {
      const recentCalls = callHistory.getRecent(60000); // Last minute
      const similar = recentCalls.filter(c => 
        c.tool === params.tool && 
        JSON.stringify(c.args) === JSON.stringify(params.args)
      );
      if (similar.length > 5) {
        return {
          pass: false,
          reason: 'Potential infinite loop detected',
          suggestion: 'Review logic, same call repeated 5+ times'
        };
      }
      return { pass: true };
    }
  }
];

// Simple PII detection
function containsPII(text: string): boolean {
  const patterns = [
    /\b[\w.-]+@[\w.-]+\.\w+\b/,  // email
    /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,  // phone
    /\b\d{3}-\d{2}-\d{4}\b/,  // SSN
  ];
  return patterns.some(p => p.test(text));
}
```

### 5. FOCUS = Priority Function

Not an "attention layer". Just a sorting function.

```typescript
// src/utils/priority.ts

interface PriorityFactors {
  urgency: number;    // 0-1, from deadline
  importance: number; // 0-1, from task.priority
  blocking: number;   // 0-1, how many tasks depend on this
  momentum: number;   // 0-1, continue what's working
}

function calculatePriority(task: Task, context: Context): number {
  const factors = {
    urgency: getUrgency(task),
    importance: getImportance(task),
    blocking: getBlockingFactor(task, context),
    momentum: getMomentum(task, context)
  };
  
  // Weighted sum
  return (
    factors.urgency * 0.35 +
    factors.importance * 0.30 +
    factors.blocking * 0.20 +
    factors.momentum * 0.15
  );
}

function getUrgency(task: Task): number {
  if (!task.deadline) return 0.3;
  const hours = (task.deadline.getTime() - Date.now()) / 3600000;
  if (hours < 0) return 1.0;
  if (hours < 1) return 0.95;
  if (hours < 4) return 0.8;
  if (hours < 24) return 0.6;
  return 0.3;
}

function getBlockingFactor(task: Task, context: Context): number {
  const dependents = context.allTasks.filter(t => 
    t.prerequisites?.includes(task.id)
  );
  return Math.min(dependents.length / 5, 1.0);
}

// Use it in task queue
class TaskQueue {
  getNext(context: Context): Task | null {
    const ready = this.tasks
      .filter(t => t.status === 'ready')
      .sort((a, b) => calculatePriority(b, context) - calculatePriority(a, context));
    
    return ready[0] || null;
  }
}
```

### 6. ADAPT = Retry Strategies + Prompt Variants

Not an "adaptation system". Just smart retry logic.

```typescript
// src/utils/adapt.ts

interface RetryStrategy {
  shouldRetry: (error: Error, attempts: number) => boolean;
  getDelay: (attempts: number) => number;
  modifyRequest?: (request: any, error: Error) => any;
}

const strategies: Record<string, RetryStrategy> = {
  default: {
    shouldRetry: (error, attempts) => attempts < 3,
    getDelay: (attempts) => Math.pow(2, attempts) * 1000,
  },
  
  withPromptVariation: {
    shouldRetry: (error, attempts) => attempts < 3,
    getDelay: (attempts) => 1000,
    modifyRequest: (request, error) => {
      // Try different prompt approach
      const variations = [
        (p: string) => `Let's try a different approach. ${p}`,
        (p: string) => `Step by step: ${p}`,
        (p: string) => `Simplify this: ${p}`,
      ];
      const variation = variations[request.attempts % variations.length];
      return {
        ...request,
        prompt: variation(request.originalPrompt)
      };
    }
  },
  
  withDifferentAgent: {
    shouldRetry: (error, attempts) => attempts < 2,
    getDelay: () => 0,
    modifyRequest: (request, error) => {
      // Try backup agent for same role
      const backups = agentRegistry.getBackups(request.role);
      if (backups.length > request.attempts) {
        return { ...request, agentId: backups[request.attempts].id };
      }
      return request;
    }
  }
};

// Adaptive executor
async function executeWithAdaptation<T>(
  fn: () => Promise<T>,
  strategy: RetryStrategy = strategies.default
): Promise<T> {
  let attempts = 0;
  let lastError: Error;
  
  while (true) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      attempts++;
      
      if (!strategy.shouldRetry(error, attempts)) {
        throw error;
      }
      
      await sleep(strategy.getDelay(attempts));
    }
  }
}
```

### 7. COMMUNICATE = Events We Already Have

Not a "communication layer". Just structured events.

```typescript
// src/events/communication.ts

// Already have socket events - just standardize them
type MessageType = 
  | 'status'           // Progress update
  | 'question'         // Need clarification
  | 'approval_needed'  // Human approval required
  | 'completed'        // Task done
  | 'error'            // Something went wrong
  | 'discovery'        // Found something interesting
  | 'warning';         // Heads up

interface AgentMessage {
  type: MessageType;
  from: string;        // agent role
  content: string;
  data?: any;
  confidence?: number; // 0-1 for uncertain outputs
  requiresResponse?: boolean;
}

// Communication is just emitting events
class Communicator {
  constructor(private socket: SocketServer) {}
  
  status(agentId: string, message: string, progress?: number): void {
    this.socket.emit('agent:message', {
      type: 'status',
      from: agentId,
      content: message,
      data: { progress }
    });
  }
  
  askClarification(agentId: string, question: string, options?: string[]): void {
    this.socket.emit('agent:message', {
      type: 'question',
      from: agentId,
      content: question,
      data: { options },
      requiresResponse: true
    });
  }
  
  requestApproval(artifact: Artifact): void {
    this.socket.emit('approval:needed', {
      type: 'approval_needed',
      from: artifact.createdBy,
      content: `Please review: ${artifact.name}`,
      data: { artifactId: artifact.id }
    });
  }
  
  warn(message: string, severity: 'low' | 'medium' | 'high'): void {
    this.socket.emit('system:warning', {
      type: 'warning',
      from: 'system',
      content: message,
      data: { severity }
    });
  }
}
```

### 8. GROW = Metrics + Prompt Versioning

Not a "growth system". Just track what works.

```typescript
// src/metrics/growth.ts

interface AgentMetrics {
  tasksCompleted: number;
  tasksFailed: number;
  avgDuration: number;
  approvalRate: number;  // How often outputs are approved first try
  promptVersion: string;
}

class MetricsTracker {
  private metrics: Map<string, AgentMetrics> = new Map();
  
  recordCompletion(agentId: string, task: Task, duration: number): void {
    const m = this.getOrCreate(agentId);
    m.tasksCompleted++;
    m.avgDuration = (m.avgDuration * (m.tasksCompleted - 1) + duration) / m.tasksCompleted;
    this.metrics.set(agentId, m);
  }
  
  recordApproval(agentId: string, approved: boolean): void {
    const m = this.getOrCreate(agentId);
    const total = m.tasksCompleted;
    const previousApproved = m.approvalRate * (total - 1);
    m.approvalRate = (previousApproved + (approved ? 1 : 0)) / total;
    this.metrics.set(agentId, m);
  }
  
  // Find best agent for a task type
  getBestAgent(taskType: string): string | null {
    const candidates = Array.from(this.metrics.entries())
      .filter(([id, m]) => m.tasksCompleted > 5) // Minimum sample
      .sort((a, b) => b[1].approvalRate - a[1].approvalRate);
    
    return candidates[0]?.[0] || null;
  }
}

// Prompt versioning - just keep old versions
interface PromptVersion {
  version: string;
  prompt: string;
  createdAt: Date;
  approvalRate: number;
  usageCount: number;
}

class PromptManager {
  private versions: Map<string, PromptVersion[]> = new Map();
  
  addVersion(agentId: string, prompt: string): string {
    const versions = this.versions.get(agentId) || [];
    const version = `v${versions.length + 1}`;
    versions.push({
      version,
      prompt,
      createdAt: new Date(),
      approvalRate: 0,
      usageCount: 0
    });
    this.versions.set(agentId, versions);
    return version;
  }
  
  getBestPrompt(agentId: string): PromptVersion {
    const versions = this.versions.get(agentId) || [];
    // Use version with best approval rate (min 10 uses)
    const proven = versions.filter(v => v.usageCount >= 10);
    if (proven.length === 0) return versions[versions.length - 1]; // Latest
    return proven.sort((a, b) => b.approvalRate - a.approvalRate)[0];
  }
}
```

### 9. ANTICIPATE = Estimation + Caching

Not a "prediction system". Just use history.

```typescript
// src/utils/anticipate.ts

// Duration estimation from history
function estimateDuration(taskType: string, context: any): number {
  const similar = memoryManager.getCompletedTasks()
    .filter(t => t.type === taskType)
    .slice(-20); // Last 20 similar tasks
  
  if (similar.length === 0) return 60 * 60 * 1000; // Default 1 hour
  
  const durations = similar.map(t => t.completedAt - t.startedAt);
  return durations.reduce((a, b) => a + b, 0) / durations.length;
}

// Pre-fetch likely needed data
async function prefetchForTask(task: Task): Promise<void> {
  // Based on task type, prefetch common needs
  const prefetchers: Record<string, () => Promise<void>> = {
    'research': async () => {
      await cache.warm('search_api_token');
      await cache.warm('recent_research_results');
    },
    'code_review': async () => {
      await cache.warm('git_diff', task.context?.prId);
      await cache.warm('code_standards');
    },
    'writing': async () => {
      await cache.warm('style_guide');
      await cache.warm('previous_content', task.context?.topic);
    }
  };
  
  await prefetchers[task.type]?.();
}

// Prepare alternatives for risky operations
function prepareAlternatives(task: Task): Alternative[] {
  const failureHistory = memoryManager.getFailures(task.type);
  
  return failureHistory
    .map(f => f.resolution)
    .filter(Boolean)
    .map(resolution => ({
      description: resolution.description,
      apply: () => resolution.strategy
    }));
}
```

---

## The Unified Orchestrator

Everything comes together in one place:

```typescript
// src/orchestrator/Orchestrator.ts

class Orchestrator {
  private state: OrchestratorState;
  private tools: Tool[];
  private events: EventEmitter;
  
  constructor(config: Config) {
    this.state = initializeState(config);
    this.tools = [
      // Sense
      ...Object.values(senseTools),
      // Memory
      ...Object.values(memoryTools),
      // Action
      createTask, assignTask, retryTask,
      // Communication
      notifyUser, askClarification, requestApproval,
    ].map(t => withProtection(t, guards)); // Wrap with guards
    
    this.events = new EventEmitter();
    setupReactions(this); // Set up event handlers
  }
  
  // Single entry point
  async process(input: UserInput): Promise<Output> {
    // 1. Recall relevant context
    const context = await this.recall(input);
    
    // 2. Let the agent decide what to do
    const agent = this.getOrchestratorAgent();
    const response = await agent.invoke({
      messages: [
        { role: 'system', content: ORCHESTRATOR_PROMPT },
        { role: 'user', content: input.message }
      ],
      context,
      tools: this.tools
    });
    
    // 3. Remember what we did
    await this.remember(input, response);
    
    return response;
  }
  
  private async recall(input: UserInput): Promise<Context> {
    return {
      teamContext: memoryManager.recallRelated(input.message),
      recentDecisions: memoryManager.getRecentDecisions(10),
      currentTasks: memoryManager.getActiveTasks(),
      budget: await senseTools.getBudget.execute(),
      blockers: await senseTools.getBlockers.execute()
    };
  }
  
  private async remember(input: UserInput, response: Output): Promise<void> {
    if (response.decision) {
      memoryManager.logDecision(response.decision);
    }
    if (response.facts) {
      for (const fact of response.facts) {
        memoryManager.remember(fact.key, fact.value, 'orchestrator');
      }
    }
  }
}
```

---

## Summary: What Changed

| Before (Overengineered) | After (Practical) |
|------------------------|-------------------|
| SenseLayer class with monitors | `senseTools` - just query functions |
| MemoryLayer with episodic/semantic/procedural | Extend MemoryManager with `remember()` and `recall()` |
| ReactLayer with reflex engine | Event handlers using `orchestrator.on()` |
| ProtectLayer with guardrails | Middleware wrapper: `withProtection(tool, guards)` |
| CommunicateLayer with negotiation | Socket events we already emit |
| FocusLayer with attention | `calculatePriority()` function |
| AdaptLayer with strategies | Retry strategies + prompt variations |
| GrowthLayer with evolution | Metrics tracking + prompt versioning |
| AnticipateLayer with prediction | `estimateDuration()` + `prefetch()` |

---

## Implementation Plan

| Week | What | How |
|------|------|-----|
| 1 | Sense tools | Add 4-5 query tools to orchestrator |
| 1 | Memory helpers | Add `remember()`/`recall()` to MemoryManager |
| 2 | Protection middleware | Wrap tool execution with guards |
| 2 | Event reactions | Add event handlers for common scenarios |
| 3 | Priority function | Implement in TaskQueue |
| 3 | Retry strategies | Add to AgentWorker |
| 4 | Metrics tracking | Add to track what works |
| 4 | Integration | Wire everything in Orchestrator |

**Total: 4 weeks to implement "organism" capabilities without building 11 systems.**

---

## Key Files to Modify

| File | Changes |
|------|---------|
| `memoryManager.ts` | Add context/decision methods |
| `AgentManager.ts` | Add sense tools, event reactions |
| `AgentWorker.ts` | Add retry strategies, metrics |
| `tools/` | Create sense, memory, action tools |
| `middleware/protection.ts` | Guard wrapper |
| `utils/priority.ts` | Priority calculation |

---

## Related Documentation

- [Ping Vision](./vision.md) - Capability overview
- [Architecture](./architecture.md) - Technical architecture
- [Unified Orchestrator](./unified-orchestrator.md) - Orchestrator design
---

## Part 2: Real-World Integration

Everything above is internal. But humans work in the **real world**. Ping must connect to it.

---

## The Real World Map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           THE REAL WORLD                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  COMMUNICATION          INFORMATION           WORK SYSTEMS                   │
│  ┌─────────────┐       ┌─────────────┐       ┌─────────────┐               │
│  │ Email       │       │ Web/News    │       │ GitHub      │               │
│  │ Slack/Teams │       │ Documents   │       │ Jira/Linear │               │
│  │ Calendar    │       │ Databases   │       │ CRM         │               │
│  │ SMS         │       │ APIs        │       │ Analytics   │               │
│  │ Social      │       │ Research    │       │ Cloud/Infra │               │
│  └──────┬──────┘       └──────┬──────┘       └──────┬──────┘               │
│         │                     │                     │                       │
│         └─────────────────────┼─────────────────────┘                       │
│                               ▼                                              │
│                        ┌─────────────┐                                       │
│                        │    PING     │                                       │
│                        │  ORGANISM   │                                       │
│                        └─────────────┘                                       │
│                               │                                              │
│         ┌─────────────────────┼─────────────────────┐                       │
│         ▼                     ▼                     ▼                       │
│  ┌─────────────┐       ┌─────────────┐       ┌─────────────┐               │
│  │ OUTPUTS     │       │ ACTIONS     │       │ PRESENCE    │               │
│  │ Docs/Code   │       │ Deploy      │       │ Notifications│              │
│  │ Reports     │       │ Publish     │       │ Status       │              │
│  │ Artifacts   │       │ Send        │       │ Updates      │              │
│  └─────────────┘       └─────────────┘       └─────────────┘               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. AMBIENT AWARENESS

**Insight:** Humans constantly absorb context without being told. Ping should too.

### What It Means

Instead of: "User tells Ping about the project"
Reality: Ping already knows because it read the emails, Slack, docs, and calendar.

### Implementation: Connectors That Feed Context

```typescript
// src/connectors/ambient.ts

interface AmbientSource {
  type: 'email' | 'slack' | 'calendar' | 'github' | 'docs';
  poll?: Duration;           // How often to check
  realtime?: boolean;        // WebSocket/webhook
  extractContext: (raw: any) => ContextEntry[];
}

const ambientSources: AmbientSource[] = [
  {
    type: 'email',
    poll: { minutes: 5 },
    extractContext: (emails) => emails.map(e => ({
      key: `email:${e.id}`,
      summary: extractEmailSummary(e),
      entities: extractEntities(e),  // People, companies, topics
      sentiment: analyzeSentiment(e),
      actionRequired: detectActionItems(e),
      relatedTo: linkToExistingContext(e)
    }))
  },
  
  {
    type: 'slack',
    realtime: true,  // WebSocket
    extractContext: (message) => ({
      key: `slack:${message.channel}:${message.ts}`,
      summary: message.text,
      mentions: message.mentions,
      thread: message.thread_ts,
      sentiment: analyzeSentiment(message),
      isDecision: detectDecision(message),
      isBlocker: detectBlocker(message)
    })
  },
  
  {
    type: 'calendar',
    poll: { minutes: 15 },
    extractContext: (events) => events.map(e => ({
      key: `calendar:${e.id}`,
      type: classifyMeeting(e),  // standup, 1:1, client, focus
      participants: e.attendees,
      topics: extractFromDescription(e),
      prepNeeded: detectPrepWork(e),
      followupExpected: detectFollowup(e)
    }))
  },
  
  {
    type: 'github',
    realtime: true,  // Webhooks
    extractContext: (event) => ({
      key: `github:${event.type}:${event.id}`,
      type: event.type,  // PR, issue, commit, review
      status: event.state,
      author: event.user,
      relatedTasks: linkToTasks(event),
      blocksDeployment: detectBlocking(event)
    })
  }
];

// The orchestrator can now query ambient context
const contextTools = {
  getRecentContext: tool({
    description: "Get context from ambient sources about a topic",
    parameters: z.object({ 
      topic: z.string(),
      sources: z.array(z.string()).optional(),
      timeRange: z.string().optional()
    }),
    execute: async ({ topic, sources, timeRange }) => {
      return ambientStore.search(topic, { sources, timeRange });
    }
  }),
  
  getUpcomingCommitments: tool({
    description: "Get upcoming meetings, deadlines, and commitments",
    parameters: z.object({ days: z.number().default(7) }),
    execute: async ({ days }) => {
      const calendar = await calendarConnector.getUpcoming(days);
      const deadlines = memoryManager.getDeadlines(days);
      const commitments = await extractCommitments([...emails, ...slack]);
      return { calendar, deadlines, commitments };
    }
  })
};
```

### Value

| Before | After |
|--------|-------|
| "Write a blog post about X" | Ping knows about X from emails, Slack, docs |
| "Follow up with client" | Ping knows last interaction, sentiment, context |
| "Prepare for meeting" | Ping knows agenda, participants, history |

---

## 2. PROACTIVE SYNTHESIS

**Insight:** The value isn't in storing data. It's in **connecting dots humans miss**.

### Cross-Source Intelligence

```typescript
// src/intelligence/synthesis.ts

interface Synthesis {
  type: 'risk' | 'opportunity' | 'conflict' | 'pattern' | 'insight';
  confidence: number;
  sources: string[];  // Which ambient sources contributed
  summary: string;
  suggestedAction?: Action;
}

class SynthesisEngine {
  // Run periodically or on significant new context
  async synthesize(): Promise<Synthesis[]> {
    const recentContext = await ambientStore.getRecent({ hours: 24 });
    const insights: Synthesis[] = [];
    
    // Pattern: Customer at risk
    const customerRisk = this.detectCustomerRisk(recentContext);
    if (customerRisk) {
      insights.push({
        type: 'risk',
        confidence: customerRisk.confidence,
        sources: ['email', 'slack', 'crm'],
        summary: `${customerRisk.customer} may be at risk: ${customerRisk.signals.join(', ')}`,
        suggestedAction: {
          type: 'create_task',
          payload: { 
            name: `Address ${customerRisk.customer} concerns`,
            priority: 'high',
            assignTo: 'account_manager'
          }
        }
      });
    }
    
    // Pattern: Opportunity
    const opportunities = this.detectOpportunities(recentContext);
    // Pattern: Internal conflict (two teams planning same thing)
    const conflicts = this.detectConflicts(recentContext);
    // Pattern: Deadline collision
    const collisions = this.detectDeadlineCollisions(recentContext);
    // Pattern: Knowledge gap (questions being asked repeatedly)
    const gaps = this.detectKnowledgeGaps(recentContext);
    
    return insights;
  }
  
  private detectCustomerRisk(context: ContextEntry[]): CustomerRisk | null {
    // Signals across sources
    const signals = {
      negativeEmail: context.filter(c => 
        c.source === 'email' && c.sentiment < 0.3
      ),
      supportTickets: context.filter(c => 
        c.source === 'zendesk' && c.priority === 'high'
      ),
      slackComplaints: context.filter(c => 
        c.source === 'slack' && c.isComplaint
      ),
      usageDropped: context.filter(c => 
        c.source === 'analytics' && c.type === 'usage_drop'
      ),
      missedMeetings: context.filter(c => 
        c.source === 'calendar' && c.type === 'no_show'
      )
    };
    
    // If multiple signals from same customer, it's a risk
    const customerSignals = groupByCustomer(Object.values(signals).flat());
    for (const [customer, sigs] of customerSignals) {
      if (sigs.length >= 2) {
        return {
          customer,
          confidence: Math.min(0.9, 0.3 * sigs.length),
          signals: sigs.map(s => s.summary)
        };
      }
    }
    return null;
  }
}
```

### Synthesis Types

| Type | Example | Sources |
|------|---------|---------|
| **Risk** | "Customer X showing churn signals" | Email + Support + Usage |
| **Opportunity** | "Competitor Y down, our feature matches their gap" | News + Product + Sales |
| **Conflict** | "Marketing and Product planning same launch date" | Calendar + Slack |
| **Pattern** | "Deployments on Friday cause weekend incidents" | GitHub + PagerDuty |
| **Insight** | "Customers asking for X, we have it but docs are bad" | Support + Slack + Docs |

---

## 3. TEMPORAL INTELLIGENCE

**Insight:** Time isn't just deadlines. It's patterns, rhythms, and optimal windows.

### Implementation

```typescript
// src/intelligence/temporal.ts

interface TemporalIntelligence {
  // Best time to do things
  bestTimeToSend(recipient: string, type: 'email' | 'slack'): TimeWindow;
  bestTimeForWork(type: 'deep' | 'meetings' | 'admin'): TimeWindow;
  
  // Patterns
  responsePattern(person: string): ResponsePattern;
  workloadPattern(team: string): WorkloadPattern;
  
  // Predictions
  estimateCompletion(task: Task): Date;
  predictBlockers(plan: Plan): PredictedBlocker[];
}

class TemporalEngine {
  // Learn from historical data
  async learnPatterns(): Promise<void> {
    // Email response patterns
    const emailData = await emailConnector.getHistory({ months: 3 });
    this.responsePatterns = analyzeResponsePatterns(emailData);
    
    // Work patterns (when do people actually complete tasks?)
    const taskData = await memoryManager.getCompletedTasks({ months: 3 });
    this.completionPatterns = analyzeCompletionPatterns(taskData);
    
    // Meeting patterns
    const calendarData = await calendarConnector.getHistory({ months: 3 });
    this.meetingPatterns = analyzeMeetingPatterns(calendarData);
  }
  
  bestTimeToSend(recipient: string, type: 'email' | 'slack'): TimeWindow {
    const pattern = this.responsePatterns.get(recipient);
    if (!pattern) return { start: 9, end: 17, timezone: 'local' };  // Default
    
    // When do they respond fastest?
    return {
      start: pattern.peakResponseHour,
      end: pattern.peakResponseHour + 2,
      timezone: pattern.timezone,
      avoidDays: pattern.lowResponseDays  // e.g., Fridays
    };
  }
  
  protectFocusTime(user: string): TimeBlock[] {
    // Analyze when user does deep work
    const calendar = await calendarConnector.get(user);
    const workPattern = this.workPatterns.get(user);
    
    // Find blocks where user is most productive
    // Suggest protecting these from meetings
    return workPattern.peakProductivityBlocks.filter(block => 
      !hasConflict(calendar, block)
    );
  }
  
  // Smart scheduling
  suggestMeetingTime(participants: string[], duration: Duration): TimeSlot[] {
    const patterns = participants.map(p => this.workPatterns.get(p));
    
    // Find times that work for everyone AND are optimal
    return findOptimalSlots(patterns, duration, {
      preferMornings: patterns.every(p => p.peakHour < 12),
      avoidLunchtime: true,
      avoidFridayAfternoon: true,
      respectTimezones: true
    });
  }
}
```

### Temporal Tools for Orchestrator

```typescript
const temporalTools = {
  whenToSend: tool({
    description: "Get best time to send message to someone",
    parameters: z.object({ 
      recipient: z.string(),
      type: z.enum(['email', 'slack', 'sms'])
    }),
    execute: async ({ recipient, type }) => {
      return temporalEngine.bestTimeToSend(recipient, type);
    }
  }),
  
  scheduleForOptimalTime: tool({
    description: "Schedule a task/message for optimal time",
    parameters: z.object({
      action: z.any(),
      constraint: z.string().optional()  // "before EOD", "this week"
    }),
    execute: async ({ action, constraint }) => {
      const optimalTime = temporalEngine.findOptimalWindow(action, constraint);
      return scheduler.schedule(action, optimalTime);
    }
  }),
  
  estimateCompletion: tool({
    description: "Estimate when a task will realistically complete",
    parameters: z.object({ taskId: z.string() }),
    execute: async ({ taskId }) => {
      const task = await memoryManager.getTask(taskId);
      const similarTasks = await memoryManager.getSimilarCompleted(task);
      return temporalEngine.estimate(task, similarTasks);
    }
  })
};
```

---

## 4. RELATIONSHIP INTELLIGENCE

**Insight:** Work is done by people. Understanding people is understanding work.

### People Graph

```typescript
// src/intelligence/relationships.ts

interface Person {
  id: string;
  name: string;
  role: string;
  
  // Learned attributes
  expertise: string[];           // What they know
  influence: Map<string, number>; // Who they influence
  responsiveness: number;         // How quickly they respond
  preferredChannel: 'email' | 'slack' | 'call';
  communicationStyle: 'brief' | 'detailed' | 'visual';
  decisionPattern: 'fast' | 'deliberate' | 'consensus';
  
  // Relationships
  reportsTo: string;
  collaboratesWith: string[];
  conflictsWith: string[];       // Potential friction
}

class RelationshipEngine {
  private graph: Map<string, Person> = new Map();
  
  // Build from communication patterns
  async buildGraph(): Promise<void> {
    const emails = await emailConnector.getAll();
    const slack = await slackConnector.getAll();
    const calendar = await calendarConnector.getAll();
    
    // Analyze communication patterns
    for (const person of extractPeople([...emails, ...slack, ...calendar])) {
      this.graph.set(person.id, {
        ...person,
        expertise: await this.inferExpertise(person),
        influence: await this.calculateInfluence(person),
        responsiveness: await this.measureResponsiveness(person),
        preferredChannel: await this.detectPreferredChannel(person),
        communicationStyle: await this.analyzeStyle(person)
      });
    }
  }
  
  // Who should be involved in this decision?
  whoShouldBeInvolved(topic: string, decisionType: string): Person[] {
    const experts = this.findExperts(topic);
    const stakeholders = this.findStakeholders(topic);
    const approvers = this.findApprovers(decisionType);
    
    return unique([...experts, ...stakeholders, ...approvers]);
  }
  
  // Best person to ask about something
  whoKnows(topic: string): Person {
    return Array.from(this.graph.values())
      .filter(p => p.expertise.some(e => matches(e, topic)))
      .sort((a, b) => b.responsiveness - a.responsiveness)[0];
  }
  
  // Predict friction
  predictFriction(people: Person[]): Friction[] {
    const frictions: Friction[] = [];
    
    for (let i = 0; i < people.length; i++) {
      for (let j = i + 1; j < people.length; j++) {
        if (people[i].conflictsWith.includes(people[j].id)) {
          frictions.push({
            between: [people[i], people[j]],
            reason: await this.analyzePastConflicts(people[i], people[j]),
            mitigation: this.suggestMitigation(people[i], people[j])
          });
        }
      }
    }
    
    return frictions;
  }
  
  // Tailor communication
  tailorMessage(message: string, recipient: Person): string {
    switch (recipient.communicationStyle) {
      case 'brief':
        return summarize(message, { maxWords: 50 });
      case 'detailed':
        return expandWithContext(message);
      case 'visual':
        return addVisualsAndBullets(message);
    }
  }
}
```

### Relationship Tools

```typescript
const relationshipTools = {
  whoKnows: tool({
    description: "Find the best person to ask about a topic",
    parameters: z.object({ topic: z.string() }),
    execute: async ({ topic }) => {
      const expert = relationshipEngine.whoKnows(topic);
      return {
        person: expert,
        preferredChannel: expert.preferredChannel,
        typicalResponseTime: expert.responsiveness
      };
    }
  }),
  
  whoToInvolve: tool({
    description: "Who should be involved in a decision or project",
    parameters: z.object({ 
      topic: z.string(),
      decisionType: z.enum(['technical', 'budget', 'strategy', 'hiring'])
    }),
    execute: async ({ topic, decisionType }) => {
      return relationshipEngine.whoShouldBeInvolved(topic, decisionType);
    }
  }),
  
  tailorCommunication: tool({
    description: "Adapt message for recipient's style",
    parameters: z.object({ 
      message: z.string(),
      recipientId: z.string()
    }),
    execute: async ({ message, recipientId }) => {
      const person = relationshipEngine.get(recipientId);
      return relationshipEngine.tailorMessage(message, person);
    }
  })
};
```

---

## 5. ACTION LAYER

**Insight:** Knowing isn't enough. Ping must act in the real world.

### Actions Ping Can Take

```typescript
// src/actions/realworld.ts

const actionTools = {
  // COMMUNICATION ACTIONS
  sendEmail: tool({
    description: "Send an email",
    parameters: z.object({
      to: z.array(z.string()),
      subject: z.string(),
      body: z.string(),
      cc: z.array(z.string()).optional(),
      attachments: z.array(z.string()).optional(),
      scheduledFor: z.string().optional()  // Send later
    }),
    execute: async (params) => {
      // Check guards
      await protectionMiddleware.check('send_email', params);
      
      // Tailor for recipients if needed
      const tailored = await tailorForRecipients(params);
      
      // Send or schedule
      if (params.scheduledFor) {
        return emailConnector.schedule(tailored, params.scheduledFor);
      }
      return emailConnector.send(tailored);
    }
  }),
  
  sendSlack: tool({
    description: "Send Slack message",
    parameters: z.object({
      channel: z.string(),
      message: z.string(),
      thread_ts: z.string().optional()
    }),
    execute: async (params) => slackConnector.send(params)
  }),
  
  scheduleMeeting: tool({
    description: "Schedule a meeting",
    parameters: z.object({
      title: z.string(),
      participants: z.array(z.string()),
      duration: z.number(),  // minutes
      agenda: z.string().optional(),
      preferredTimes: z.array(z.string()).optional()
    }),
    execute: async (params) => {
      // Find optimal time
      const slot = await temporalEngine.suggestMeetingTime(
        params.participants, 
        { minutes: params.duration }
      );
      
      // Create calendar event
      return calendarConnector.create({
        ...params,
        start: slot.start,
        end: slot.end
      });
    }
  }),
  
  // WORK SYSTEM ACTIONS
  createJiraTicket: tool({
    description: "Create a Jira ticket",
    parameters: z.object({
      project: z.string(),
      type: z.enum(['story', 'bug', 'task', 'epic']),
      title: z.string(),
      description: z.string(),
      assignee: z.string().optional(),
      priority: z.string().optional()
    }),
    execute: async (params) => jiraConnector.create(params)
  }),
  
  createGitHubPR: tool({
    description: "Create a GitHub PR",
    parameters: z.object({
      repo: z.string(),
      branch: z.string(),
      title: z.string(),
      body: z.string(),
      reviewers: z.array(z.string()).optional()
    }),
    execute: async (params) => githubConnector.createPR(params)
  }),
  
  updateCRM: tool({
    description: "Update CRM record",
    parameters: z.object({
      type: z.enum(['contact', 'deal', 'company']),
      id: z.string(),
      updates: z.record(z.any())
    }),
    execute: async (params) => crmConnector.update(params)
  }),
  
  // DEPLOYMENT ACTIONS
  deploy: tool({
    description: "Deploy to environment",
    parameters: z.object({
      service: z.string(),
      environment: z.enum(['staging', 'production']),
      version: z.string()
    }),
    execute: async (params) => {
      // Extra protection for production
      if (params.environment === 'production') {
        await requireApproval('deploy_production', params);
      }
      return deploymentConnector.deploy(params);
    }
  }),
  
  // NOTIFICATION ACTIONS
  notify: tool({
    description: "Send notification through best channel",
    parameters: z.object({
      recipient: z.string(),
      message: z.string(),
      urgency: z.enum(['low', 'medium', 'high', 'critical'])
    }),
    execute: async (params) => {
      const person = relationshipEngine.get(params.recipient);
      const channel = params.urgency === 'critical' 
        ? 'sms'  // Critical = SMS
        : person.preferredChannel;
      
      return notificationRouter.send(channel, params);
    }
  })
};
```

---

## 6. WORKFLOW AUTOMATION

**Insight:** Most business processes are predictable. Automate the pattern, not just the task.

### Common Workflow Patterns

```typescript
// src/workflows/patterns.ts

const workflowPatterns = {
  // Customer inquiry → Response → Follow-up
  customerInquiry: {
    trigger: { source: 'email', pattern: /inquiry|question|help/i },
    steps: [
      { action: 'classify', using: 'llm' },
      { action: 'draft_response', using: 'agent:support' },
      { action: 'review', by: 'human', timeout: '2h' },
      { action: 'send_email' },
      { action: 'schedule_followup', delay: '3d' },
      { action: 'update_crm' }
    ]
  },
  
  // PR merged → Deploy → Notify → Document
  deploymentPipeline: {
    trigger: { source: 'github', event: 'pr_merged', branch: 'main' },
    steps: [
      { action: 'run_tests' },
      { action: 'deploy', to: 'staging' },
      { action: 'run_smoke_tests' },
      { action: 'notify_slack', channel: '#deployments' },
      { 
        action: 'await_approval', 
        from: 'oncall', 
        for: 'production_deploy',
        timeout: '4h'
      },
      { action: 'deploy', to: 'production' },
      { action: 'update_changelog' },
      { action: 'notify_stakeholders' }
    ]
  },
  
  // Meeting → Notes → Tasks → Follow-ups
  meetingWorkflow: {
    trigger: { source: 'calendar', event: 'meeting_ended' },
    steps: [
      { action: 'transcribe', if: 'has_recording' },
      { action: 'summarize', using: 'agent:note_taker' },
      { action: 'extract_action_items' },
      { action: 'create_tasks', in: 'jira' },
      { action: 'share_notes', with: 'participants' },
      { action: 'schedule_followups', for: 'action_owners' }
    ]
  },
  
  // New hire → Onboarding sequence
  onboarding: {
    trigger: { source: 'hr_system', event: 'new_hire' },
    steps: [
      { action: 'create_accounts', systems: ['slack', 'github', 'jira'] },
      { action: 'add_to_channels' },
      { action: 'assign_buddy' },
      { action: 'schedule_intro_meetings' },
      { action: 'send_welcome_email' },
      { action: 'create_30_day_checklist' },
      { action: 'schedule_check_ins', at: ['7d', '14d', '30d'] }
    ]
  },
  
  // Content creation → Review → Publish
  contentPipeline: {
    trigger: { source: 'task', type: 'content_request' },
    steps: [
      { action: 'research', using: 'agent:researcher' },
      { action: 'outline', using: 'agent:writer' },
      { action: 'review_outline', by: 'human' },
      { action: 'write_draft', using: 'agent:writer' },
      { action: 'edit', using: 'agent:editor' },
      { action: 'review_final', by: 'human' },
      { action: 'publish', to: 'cms' },
      { action: 'promote', on: ['twitter', 'linkedin'] },
      { action: 'track_performance', for: '7d' }
    ]
  }
};

// Workflow engine
class WorkflowEngine {
  async executeWorkflow(pattern: WorkflowPattern, trigger: any): Promise<void> {
    const context = { trigger, results: {} };
    
    for (const step of pattern.steps) {
      // Check conditions
      if (step.if && !evaluate(step.if, context)) continue;
      
      // Execute step
      const result = await this.executeStep(step, context);
      context.results[step.action] = result;
      
      // Handle human approval
      if (step.by === 'human') {
        await this.awaitHumanApproval(step, context);
      }
    }
  }
}
```

---

## 7. ENERGY & ATTENTION MANAGEMENT

**Insight:** Humans have limited energy. Ping should optimize for human wellbeing, not just throughput.

```typescript
// src/intelligence/energy.ts

interface HumanState {
  focusLevel: 'deep' | 'shallow' | 'fragmented';
  energyLevel: 'high' | 'medium' | 'low';
  meetingLoad: number;  // Hours today
  contextSwitches: number;  // Today
  lastBreak: Date;
}

class EnergyManager {
  // Infer human state from behavior
  async inferState(userId: string): Promise<HumanState> {
    const today = await this.getTodayData(userId);
    
    return {
      focusLevel: this.inferFocusLevel(today),
      energyLevel: this.inferEnergyLevel(today),
      meetingLoad: today.meetingHours,
      contextSwitches: today.taskSwitches,
      lastBreak: today.lastBreak
    };
  }
  
  // Should we interrupt?
  async shouldInterrupt(userId: string, urgency: string): Promise<boolean> {
    const state = await this.inferState(userId);
    
    // Critical = always interrupt
    if (urgency === 'critical') return true;
    
    // High focus = only high urgency
    if (state.focusLevel === 'deep' && urgency !== 'high') {
      return false;
    }
    
    // Low energy = batch low priority
    if (state.energyLevel === 'low' && urgency === 'low') {
      return false;
    }
    
    return true;
  }
  
  // Batch similar work
  batchSimilarWork(tasks: Task[]): TaskBatch[] {
    const batches: TaskBatch[] = [];
    
    // Group by type
    const byType = groupBy(tasks, t => t.type);
    
    for (const [type, typeTasks] of byType) {
      // Further group by context (same project, same person, etc.)
      const byContext = groupBy(typeTasks, t => t.context);
      
      for (const [context, contextTasks] of byContext) {
        batches.push({
          type,
          context,
          tasks: contextTasks,
          estimatedTime: sum(contextTasks.map(t => t.estimate)),
          switchCost: 0  // No switching within batch
        });
      }
    }
    
    return batches;
  }
  
  // Suggest breaks
  async suggestBreak(userId: string): Promise<BreakSuggestion | null> {
    const state = await this.inferState(userId);
    
    if (state.meetingLoad > 4 && !state.lastBreak) {
      return { type: 'short', reason: 'Heavy meeting day, take 10 minutes' };
    }
    
    if (state.contextSwitches > 20) {
      return { type: 'focus', reason: 'Lots of switching, try 25min focused block' };
    }
    
    if (state.energyLevel === 'low' && isAfternoon()) {
      return { type: 'walk', reason: 'Afternoon energy dip, short walk helps' };
    }
    
    return null;
  }
}
```

---

## Summary: Real-World Capabilities

| Capability | What It Does | Implementation |
|------------|--------------|----------------|
| **Ambient Awareness** | Know without being told | Connectors + Context extraction |
| **Synthesis** | Connect dots across sources | Pattern detection on ambient data |
| **Temporal Intelligence** | Understand time patterns | Learn from history, predict, optimize |
| **Relationship Intelligence** | Understand people | Communication analysis, graph |
| **Action Layer** | Do things in the world | Connectors with write access |
| **Workflow Automation** | Automate patterns | Trigger → Steps → Outcome |
| **Energy Management** | Respect human limits | State inference, batching, breaks |

---

## Connector Architecture

All real-world interaction goes through **connectors**:

```typescript
interface Connector {
  // Read
  read(query: Query): Promise<Data[]>;
  subscribe(event: string, handler: Handler): void;
  
  // Write
  write(action: Action): Promise<Result>;
  
  // Metadata
  capabilities: ('read' | 'write' | 'subscribe')[];
  rateLimit: RateLimit;
  authentication: AuthConfig;
}

// Available connectors
const connectors = {
  email: new EmailConnector(config.email),      // Gmail, Outlook
  slack: new SlackConnector(config.slack),
  calendar: new CalendarConnector(config.calendar),
  github: new GitHubConnector(config.github),
  jira: new JiraConnector(config.jira),
  crm: new CRMConnector(config.crm),            // Salesforce, HubSpot
  docs: new DocsConnector(config.docs),         // Google Docs, Notion
  analytics: new AnalyticsConnector(config.analytics),
  // ... more
};
```

---

## Implementation Priority

| Phase | Capability | Value |
|-------|------------|-------|
| **Now** | Email + Slack connectors | Immediate context |
| **Now** | Calendar integration | Time awareness |
| **Soon** | GitHub + Jira | Dev workflow |
| **Soon** | Basic synthesis | Cross-source insights |
| **Later** | CRM + Analytics | Business intelligence |
| **Later** | Full relationship graph | People optimization |
| **Later** | Energy management | Human wellbeing |

---

## The 900 IQ Insight

The real power isn't any single feature. It's the **compounding**:

```
Email context + Slack context + Calendar context
    → Synthesis engine
    → "Client meeting tomorrow, they complained on Slack yesterday, 
        last email was ignored. Prepare talking points, loop in support."
    → Auto-draft agenda
    → Notify account manager
    → Track outcome
    → Learn for next time
```

**Ping isn't a tool. It's a second brain that never forgets, never misses connections, and always has context.**