# Team Builder — Design Mode for Ping

**Team Builder is Ping's design-time interface for creating teams, synthesizing agents, and defining team compositions.**

**Like Lovable or Rocket, but for agent teams**: Describe what you want to build in natural language, and AI designs specialized agents with the right roles and capabilities - no manual configuration needed.

---

## What is Team Builder?

Team Builder is **not a separate product** — it's Ping's **design mode**, like Figma's design canvas vs. the published prototype.

**The paradigm shift:**
- **Traditional**: Manually configure agents (choose models, write prompts, select tools)
- **Team Builder**: Conversational design - describe goals, get agent suggestions, refine iteratively

**Just as:**
- Lovable/Rocket: "Build a fitness app" → AI generates code
- **Team Builder**: "Build a fitness app" → AI generates agent team (Product Manager, Mobile Dev, Backend Dev, QA)

### Design Mode (Team Builder)
- Create teams
- Synthesize agents using Role Manager meta-agent
- Define team composition
- Save team configurations

### Execution Mode (Ping Runtime)
- Load team configurations
- Execute team workflows
- Orchestrate tasks
- Supervise agents

---

## Role Manager (Meta-Agent)

The heart of Team Builder is the **Role Manager** — a meta-agent whose sole purpose is **agent synthesis**.

**It's a conversational AI architect** that designs teams through dialogue, asking clarifying questions and suggesting solutions.

**Example interaction:**
```
💬 You: "I need to build a mobile fitness tracking app"

🤖 Role Manager:
"Analyzing goal... What platforms are you targeting?
- iOS only
- Android only  
- Cross-platform (React Native/Flutter)

And what's your team size preference?"

💬 You: "Cross-platform with React Native, keep team lean"

🤖 Role Manager:
"Understood. Proposing 5-agent team:
1. Product Manager - requirements, user stories
2. Mobile Developer - React Native, cross-platform
3. Backend Developer - API, real-time sync  
4. UX Designer - UI/UX, design system
5. QA Engineer - testing, performance

Would you like to proceed with this team?"
```

### Role Manager is NOT:
- ❌ A task planner
- ❌ A workflow engine
- ❌ A router

### Role Manager IS:
- ✅ An **organizational architect**
- ✅ A **role synthesizer**
- ✅ An **agent factory**
- ✅ A **conversational design assistant**

---

## The Four Phases: Think, Plan, Suggest, Build

### 1. Think (System Diagnosis)

**Inputs:**
* User intent / high-level objective
* Existing agents + their capabilities
* Current workload, failure modes, bottlenecks
* Non-functional constraints (latency, cost, autonomy)

**Role Manager asks internally:**
* Is this solvable with existing agents?
* Are responsibilities overloaded or poorly scoped?
* Is there a missing specialization?
* Is coordination complexity increasing?

**Output:**
* **Need for new role(s)** (yes/no)
* **Reasoning trace** (internal, not exposed)

> This is **organizational reasoning**, not task planning.

---

### 2. Plan (Role Topology Design)

If new roles are needed, Role Manager designs:

**For each proposed role:**
* Purpose (single sentence, strict)
* Inputs / Outputs
* Authority boundary (what it can decide vs must ask)
* Interaction protocol (sync/async, event-driven, pull/push)
* Lifetime (ephemeral, session-bound, persistent)

**Output: Role Spec**

Example:

```yaml
role_name: "Requirements Decomposer"
objective: "Convert vague product intent into atomic, testable requirements"
inputs: ["user_intent", "constraints"]
outputs: ["requirements_graph"]
authority: "May create artifacts but not trigger execution"
lifecycle: "ephemeral"
```

---

### 3. Suggest (Approval Layer)

Depending on configuration, this step can be:
* **Auto-approved** (fully autonomous mode)
* **Human-in-the-loop** (recommended for MVP)
* **Policy-gated** (rule-based approval)

**Role Manager presents:**
* Why this role is needed
* What risk it mitigates
* Cost of not creating it
* Estimated token / time impact

> This is critical to avoid agent sprawl.

---

### 4. Build (Agent Materialization)

This is where Role Manager becomes an **agent builder**.

**Building a role means:**

1. **Selecting a base agent template**
   * Planner-type
   * Executor-type
   * Critic-type
   * Memory-centric

2. **Binding:**
   * System prompt
   * Tool access
   * Memory scope
   * Communication channels

3. **Registering it with:**
   * Agent Registry
   * Message Bus
   * Permission system

**Result:**
* A **live agent** with an ID
* Discoverable by Ping
* Callable by other agents

> This is **runtime agent instantiation**, not code generation.

---

## Architecture Placement

```
User / External App
        ↓
      Ping
        ↓
  ┌───────────────┐
  │ Role Manager  │  ← meta-agent (Team Builder)
  └───────────────┘
        ↓
Agent Registry / Runtime
        ↓
 Task Agents / Tool Agents / External BYOA Agents
```

**Important:**
* **Ping does not think about roles**
* **Role Manager does**
* Ping only executes routing and enforcement

---

## Team Builder Interface (MVP)

### Features

**Design Mode UI:**
1. **Team Designer**
   - Create team
   - Add humans (approvers, supervisors)
   - Invoke Role Manager to synthesize agents

2. **Role Manager Console**
   - View Think phase reasoning
   - Review Plan phase role specs
   - Approve/reject Suggest phase proposals
   - Monitor Build phase agent creation

3. **Team Configuration Export**
   - Save team config (JSON/YAML)
   - Version team configurations
   - Load into Ping Runtime

**Example Workflow:**
```
1. User: "I need a team to launch a product"
2. Role Manager (Think): Analyzes existing agents, determines need for:
   - Product Manager agent
   - Marketing Strategist agent
   - Content Creator agent
3. Role Manager (Plan): Designs role specs for each
4. Role Manager (Suggest): Presents to user for approval
5. User: Approves
6. Role Manager (Build): Instantiates agents, adds to team
7. Team Builder: Exports team config
8. Ping Runtime: Imports config, ready to execute
```

---

## Role Manager Minimal Interface

```typescript
interface RoleManagerAgent {
  analyze(context: TeamContext): RoleDecision
  design(roleIntent: string): RoleSpec[]
  validate(roleSpecs: RoleSpec[]): ApprovalResult
  instantiate(roleSpec: RoleSpec): AgentHandle
}
```

### Key Types

```typescript
interface RoleSpec {
  name: string
  objective: string
  inputs: string[]
  outputs: string[]
  authority: string
  lifecycle: 'ephemeral' | 'session-bound' | 'persistent'
  template: 'planner' | 'executor' | 'critic' | 'memory-centric'
}

interface RoleDecision {
  needsNewRoles: boolean
  reasoning: string
  proposedRoles: string[]
}

interface ApprovalResult {
  approved: boolean
  feedback?: string
  constraints?: Record<string, any>
}

interface AgentHandle {
  id: string
  role: string
  status: 'active' | 'idle' | 'terminated'
}
```

---

## Constraints & Safeguards

### Hard Truth

Role Manager is the **most dangerous and powerful agent** in Ping.

Bugs here create runaway agent creation.

**You must enforce:**
* Creation quotas (max X agents per team)
* Cost ceilings (max Y tokens per synthesis)
* Role de-duplication (don't create duplicate roles)
* Mandatory justification (every role needs a "why")

**Without this, Ping collapses into chaos.**

---

## Team Builder vs Ping Runtime

| Aspect | Team Builder (Design) | Ping Runtime (Execution) |
|--------|----------------------|--------------------------|
| **Purpose** | Create teams & agents | Execute team workflows |
| **User Role** | Architect, planner | Supervisor, approver |
| **Role Manager** | Meta-agent (Think/Plan/Suggest/Build) | Agent registry (lookup & assign) |
| **Output** | Team configuration | Work artifacts |
| **Mode** | Design-time | Runtime |

---

## Next Steps

1. **Define Role Spec Schema** (YAML/JSON formal schema)
2. **Define Policies for Role Creation** (quotas, constraints, approval rules)
3. **Build Role Manager v0** (bare-minimum Think → Plan → Suggest → Build)
4. **Integrate with Ping Runtime** (config import/export)

---

## Related Documentation

- [Ping Vision](./vision.md) - Overall product vision
- [Ping Architecture](./architecture.md) - Technical architecture
- [Monorepo Structure](../developer-guide/monorepo-architecture.md) - Package organization
