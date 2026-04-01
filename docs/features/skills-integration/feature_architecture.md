# Skills Integration — Feature Architecture

**Status:** New  
**Date:** March 29, 2026  
**ID:** C3  
**Depends on:** A1 (Mastra/AI SDK Migration), C2 (Skills System design)

---

## Overview

Wire the skills system into the agent runtime — the industry-standard way. Agent definitions declare skills, the runtime resolves them into AI SDK `tool()` objects, and the agent gets a curated toolset. Simple, explicit, predictable.

### Current State
- `packages/backend/skills/` has: SkillIntegration, SkillRegistry, EmbeddingService
- Skills have MongoDB models, vector search for discovery
- `seedOfficialSkills.ts` seeds skill definitions
- Skills NOT wired into agent tool loading — they exist in parallel
- `enhanceAgentWithSkills()` exists but is dead code (never called)
- `SkillTools.ts` has 5 tool functions — never injected into any agent
- All tools load eagerly during `InternalAgent.initialize()`

### Target State (v1 — Industry Standard)
- Agent YAML declares `skills: ['code-review', 'web-search']`
- Runtime resolves skills → converts to AI SDK `tool()` → injects into agent
- Users can add/remove skills from agents via UI
- All loading is eager (upfront at agent creation) — same as Claude, GPT, LangChain, CrewAI

---

## How the Industry Does It

Every major platform uses the same pattern: **explicit tool declaration, eager loading, curated sets.**

| Platform | How Tools Are Assigned | Discovery | Loading |
|---|---|---|---|
| **Claude API** | Caller passes `tools[]` per API call | None — caller decides | Eager (schema in request) |
| **OpenAI API** | Caller passes `tools[]` per API call | None — caller decides | Eager (schema in request) |
| **Gemini API** | Caller passes `tools[]` per API call | None — caller decides | Eager (schema in request) |
| **MCP** | Client connects to servers, gets `tools/list` | Per-server (get all tools from a server) | Eager describe, lazy execute |
| **LangChain** | Tools bound to agent at creation | None — developer assigns | Eager |
| **CrewAI** | Each agent declares its tools | None — developer assigns | Eager |
| **Mastra** | Agent config lists tools + `.md` instruction skills | None — config-based | Eager |
| **Ping v1** | Agent YAML lists skills, runtime resolves to `tool()` | Explicit by name | **Eager** |

**Nobody does semantic search for individual tools at runtime.** The LLM is good at picking which tool to call from a curated set. The hard problem is **which tools to give the agent in the first place** — and that's a curation/configuration decision, not a search problem.

---

## v1 Architecture: Explicit Skills, Eager Loading

```
Agent Definition (YAML)
  └── skills: ['code-review', 'web-search', 'summarize']
        │
        ▼
  SkillResolver.resolve(skillNames)
        │
        ├── SkillRegistry.findByName('code-review')
        │   └── Returns: name, description, Zod schema, execute function
        │
        ├── Convert each to AI SDK tool()
        │   └── tool({ description, parameters, execute })
        │
        └── Inject into agent toolset (all loaded, ready to use)
              │
              ▼
        createAgent({ tools: [...resolvedSkills, ...builtinTools] })
```

### Skill Resolution: Name → `tool()`

```typescript
class SkillResolver {
  constructor(private registry: SkillRegistry) {}

  async resolve(skillNames: string[]): Promise<CoreTool[]> {
    const tools: CoreTool[] = [];

    for (const name of skillNames) {
      const skill = await this.registry.findByName(name);
      if (!skill) throw new Error(`Skill not found: ${name}`);

      switch (skill.type) {
        case 'tool':
          tools.push(tool({
            description: skill.description,
            parameters: skill.parameters,
            execute: skill.execute,
          }));
          break;

        case 'mcp':
          // MCP skill: connect to server, get tool by name
          const mcpTool = await this.loadMcpTool(skill.serverUrl, skill.toolName);
          tools.push(mcpTool);
          break;

        // Instruction skills don't become tools — they append to system prompt
        // Handled separately by SkillResolver.getInstructions(skillNames)
      }
    }
    return tools;
  }
}
```

### Skill Types

| Type | What It Is | Loaded As |
|---|---|---|
| **Tool Skill** | Zod schema + execute function | AI SDK `tool()` — standard callable tool |
| **MCP Skill** | MCP server URL + tool name | AI SDK `tool()` wrapping MCP `tools/call` |
| **Instruction Skill** | SKILL.md knowledge file | Appended to system prompt (not a tool) |
| **Composite Skill** | Bundle of tools + instructions | Multiple `tool()` objects + prompt text |

### Agent YAML Example

```yaml
# agent/agents/researcher.yaml
name: researcher
model: azure/gpt-4o
instructions: "You are a research agent..."
skills:
  - web-search        # Tool skill
  - read-url          # Tool skill  
  - summarize         # Tool skill
  - academic-search   # MCP skill (connects to academic search server)
  - research-methods  # Instruction skill (appended to prompt)
```

### Skill Registry

Skills are registered in MongoDB (seeded by `seedOfficialSkills.ts`):

```typescript
interface SkillDefinition {
  name: string;                          // 'web-search'
  type: 'tool' | 'mcp' | 'instruction' | 'composite';
  description: string;                   // What the LLM sees
  category: string;                      // 'research', 'coding', 'writing'
  
  // Tool skills
  parameters?: ZodSchema;               // Input schema
  execute?: (args: any) => Promise<any>; // Implementation

  // MCP skills
  serverUrl?: string;                    // MCP server endpoint
  toolName?: string;                     // Tool name on MCP server

  // Instruction skills
  instructions?: string;                 // Prompt text to append
  
  // Metadata
  tags: string[];
  version: string;
}
```

### Skill Discovery Patterns

| Pattern | When | How |
|---|---|---|
| **Explicit** (default, v1) | Agent role defines its toolset | `skills: ['web-search']` in YAML — resolved by name |
| **Role-based** (v1) | Standard toolset per role | `SkillRegistry.getSkillsForRole('researcher')` — curated preset |
| **User-selected** (v1) | User customizes agent | UI lets user add/remove skills before/during execution |

### User-Selected Skills at Runtime

Users can customize agent skills through the UI:

```
┌─────────────────────────────────────────────┐
│ Agent: Market Researcher                     │
│                                              │
│ Skills:                                      │
│  ✅ web-search          (default for role)   │
│  ✅ read-url            (default for role)   │
│  ✅ summarize           (default for role)   │
│  ☐  academic-search    (available)           │
│  ☐  data-analysis      (available)           │
│                                              │
│  [+ Add custom skill]                        │
│                                              │
│ User adds: ✅ academic-search                │
│                                              │
│ → Agent rebuilds with new tool on next task  │
└─────────────────────────────────────────────┘
```

```typescript
socket.emit('action', { 
  type: 'update-agent-skills', 
  agentId: 'researcher-001',
  skills: ['web-search', 'read-url', 'summarize', 'academic-search']
});
```

The orchestrator updates the agent's skill list. On the next `streamText()` call, the updated toolset is passed directly — **no agent rebuild needed.** AI SDK takes tools as a per-call parameter, unlike LangGraph which bakes tools into the agent graph.

### Hot-Swappable Skills (AI SDK Advantage)

With AI SDK, tools are **per-call, not per-agent**. This means skill changes are instant:

```typescript
// LangGraph (current — tools baked in, must rebuild agent)
const agent = createAgent({ tools: [...] });  // tools locked in
await agent.invoke(messages);                  // can't change tools mid-session

// AI SDK (target — tools per call, hot-swappable)
await streamText({
  model,
  messages,
  tools: agent.currentSkillSet,  // ← whatever skills the agent has RIGHT NOW
});
// User adds a skill? Update the set. Next streamText() call uses it. Zero downtime.
```

| Platform | Hot-swap tools mid-conversation? | How |
|---|---|---|
| **Claude/OpenAI/Gemini** | Yes | Tools passed per API call |
| **AI SDK** | **Yes** — tools are a `streamText()` parameter | Different tools every call |
| **MCP** | Yes — `tools/list_changed` notification | Client refreshes dynamically |
| **LangGraph** (current Ping) | No — must rebuild agent | `createAgent()` compiles tools into graph |
| **LangChain** | No — tools bound at creation | Same limitation |

After AI SDK migration, when a user toggles a skill in the UI, the orchestrator updates the agent's skill list in memory. The very next LLM call automatically uses the new set. No restart, no rebuild, no downtime.

### What to Wire (Implementation Checklist)

The pieces exist but aren't connected:

| Component | Status | Action |
|---|---|---|
| `SkillRegistry` | ✅ Exists | Use as-is — findByName, category queries |
| `SkillIntegration` | ✅ Exists | Wire into agent init flow |
| `enhanceAgentWithSkills()` | ⚠️ Dead code | Call it from `WorkerPool.createWorker()` |
| `SkillTools.ts` (5 tools) | ⚠️ Never injected | Decide: inject as meta-tools or remove |
| `seedOfficialSkills.ts` | ✅ Works | Keep — seeds initial skill catalog |
| Agent YAML `skills` field | ❌ Missing | Add to agent definition schema |
| `SkillResolver` | ❌ Missing | New class: name → `tool()` conversion |
| UI skill selector | ❌ Missing | Frontend component for user skill management |
| `InternalAgent.initialize()` | ✅ Exists | Add skill resolution step after tool loading |

---

## Future: Dynamic Skill Loading (v2+)

When the skill catalog grows large (50+ skills) or MCP connections become expensive, introduce lazy loading:

### Two-Phase Loading Pattern

```
Phase 1: DESCRIBE (at agent creation — lightweight)
  Load only: name + description + schema (metadata from registry)
  No execute functions. No MCP connections.

Phase 2: EXECUTE (when LLM calls the tool — on demand)
  Load implementation on first call. Cache for session.
  MCP: connect on first call. Tool: import on first call.
```

```typescript
// v2: Lazy execute wrapper
function skillToLazyTool(manifest: SkillManifest): CoreTool {
  let cachedImpl: SkillImpl | null = null;
  return tool({
    description: manifest.description,
    parameters: manifest.parameters,
    execute: async (args) => {
      if (!cachedImpl) {
        cachedImpl = await SkillLoader.load(manifest.name);
      }
      return cachedImpl.execute(args);
    },
  });
}
```

### Semantic Discovery (v2+)

Useful at the **agent/role level**, not tool level:

```typescript
// Planner tool: "find me an agent that can do X"
const searchAgents = tool({
  description: "Search for agents with a specific capability",
  parameters: z.object({ capability: z.string() }),
  execute: async ({ capability }) => {
    // Vector search against agent role descriptions, not individual tools
    return await AgentRegistry.searchByCapability(capability);
  },
});
```

---

**Effort:** Medium (2 weeks for v1)
