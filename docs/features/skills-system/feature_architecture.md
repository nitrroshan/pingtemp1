# Skills System Architecture

**Feature:** Portable, reusable agent capabilities that teams can install and use across Ping

---

## Overview

The Skills System provides a layer of portable expertise that separates **what agents can do** (skills) from **which agents exist** (agent instances). This enables:

- **Reusability**: "Security Review Skill" used by multiple teams without duplicating configs
- **Open Source Ecosystem**: Community-contributed skills from GitHub/npm packages
- **Progressive Disclosure**: Load lightweight skill descriptions (30-50 tokens), fetch full implementations on-demand
- **Standardization**: Role Templates define standard worker types, teams instantiate with custom configs

**Inspired by:** Claude's Skills approach (portable expertise + progressive disclosure)

---

## Core Concepts

### 1. Skills (Portable Capabilities)

**Definition:** A skill is a directory containing a `SKILL.md` file with packaged expertise.

**Filesystem Structure:**
```
security-review/              # Skill directory
├── SKILL.md                  # Required: Metadata (YAML) + Instructions (Markdown)
├── owasp-rules.md            # Optional: Supporting documentation
├── scripts/                  # Optional: Executable utilities
│   └── run_semgrep.py
└── config/                   # Optional: Tool configurations
    └── semgrep.yaml
```

**SKILL.md Format:**
```markdown
---
name: security-review
description: Reviews code for security vulnerabilities using OWASP rules. Use when reviewing code for security.
category: security
version: 1.0.0
allowed-tools: ["bash", "grep"]
---

# Security Review

## Instructions
[How to perform security review...]

## Resources
- See [owasp-rules.md](owasp-rules.md) for detailed rules
- Run: `python scripts/run_semgrep.py <file>`
```

**Database Storage (Metadata Only):**
```typescript
Skill {
  id: string                    // "security-review"
  name: string                  // "Security Review"
  description: string           // From YAML frontmatter (max 1024 chars)
  category: SkillCategory       // "code_analysis" | "testing" | "security" | etc.
  version: string               // "1.0.0"
  
  // Filesystem paths (NOT stored content)
  skillPath: string             // "/path/to/skills/security-review/"
  skillMdPath: string           // "/path/to/skills/security-review/SKILL.md"
  supportingFiles?: string[]    // ["owasp-rules.md", "scripts/run_semgrep.py"]
  
  // Metadata
  author: string                // "ping-official" | "community"
  installCount: number
  rating?: number
  tags: string[]
  
  // Installation
  source: SkillSource           // "registry" | "github" | "local" | "personal"
  sourceUrl?: string            // GitHub repo URL
  
  createdAt: Date
  updatedAt: Date
}
```

**Key Insight:** Skills are **files**, not **database records**. Database stores only metadata + paths for discovery.

**Progressive Disclosure (Filesystem-Based):**
- **Discovery (Startup):** Agent loads only YAML frontmatter (name, description, category, version) from all SKILL.md files
- **Activation (When Triggered):** Agent reads SKILL.md markdown body (instructions, examples, guidelines)
- **Execution (As Needed):** Agent reads supporting files (owasp-rules.md) or runs scripts (run_semgrep.py)
- **Benefit:** Agent can "know" about 100+ skills (~10KB metadata) without loading full instructions (~500KB)

### 2. Role Templates (Standardized Worker Types)

**Definition:** A role template defines a standard worker type that teams can instantiate with custom skills.

**Structure:**
```typescript
RoleTemplate {
  id: string                    // "frontend-developer"
  name: string                  // "Frontend Developer"
  description: string           // What this role does
  
  // Default skills (can be overridden by teams)
  defaultSkills: string[]       // ["react-expert", "testing-automation"]
  
  // Required capabilities
  requiredSkillCategories: SkillCategory[]  // ["code_analysis", "testing"]
  
  // Base configuration
  basePrompt: string            // Role-specific system prompt
  baseTools: Tool[]             // Core tools (file system, git)
  
  // Metadata
  author: string
  isOfficial: boolean           // Ping-maintained vs community
}
```

**Role Template vs Instance:**
- **Template**: "Frontend Developer" role definition (reusable)
- **Instance**: Team's specific "Frontend Developer" agent with custom skills installed

### 3. Team Skill Installation

**Model:**
```typescript
TeamSkill {
  teamId: string
  skillId: string
  installedAt: timestamp
  installedBy: string           // User ID (manager)
  
  // Usage tracking
  usageCount: number
  lastUsedAt: timestamp
  
  // Customization (optional)
  customConfig?: {
    enabledTools: string[]      // Subset of skill's tools
    promptOverrides: Record<string, string>
  }
}
```

**Flow:**
```
Manager talks to Team Builder: "I need a security specialist"
  → Team Builder: "I'll design a Security Specialist agent"
  → Team Builder searches skills semantically:
      User input: "security vulnerabilities code review"
      → Embedding search returns: ["security-review", "code-analysis"]
  → Team Builder shows skill suggestions with descriptions
  → User confirms: "Yes, add security-review"
  → Team Builder assigns skills to agent:
      - Basic skills: ["write-document", "send-email", "write-code"]
      - Specialized skills: ["security-review"]
  → Agent created with skill IDs stored in database
  → When agent executes:
      1. Load SKILL.md metadata (name, description)
      2. If skill triggered, read SKILL.md instructions
      3. If needed, read supporting files or run scripts
```

**Skills Replace "capabilities" Array:**
- Old: `agent.config.capabilities = ["security", "code-review"]` (custom strings)
- New: `agent.skills = ["security-review", "code-analysis"]` (references to SKILL.md files)

---

## Integration with Team Service

### How Skills Enhance Teams

**Without Skills (Current):**
```typescript
Team {
  id, name, ownerId
  agents: Agent[]               // Each agent has full config embedded
}

Agent {
  id, teamId, type, role
  config: {
    tools: [...],               // Duplicated across teams
    prompts: [...],
    examples: [...]
  }
}
```

**With Skills (Enhanced):**
```typescript
Team {
  id, name, ownerId
  agents: Agent[]
  installedSkills: string[]     // ["security-review", "react-expert"]
}

Agent {
  id, teamId, type, role
  roleTemplateId?: string       // "frontend-developer" (if using template)
  assignedSkills: string[]      // ["react-expert", "testing-automation"]
  customConfig?: {              // Team-specific overrides
    promptAdditions: string
    disabledTools: string[]
  }
}
```

**Benefits:**
1. **Agent configs are lightweight** (just skill IDs + overrides)
2. **Skill updates propagate** (update "react-expert" skill → all teams benefit)
3. **Teams can share expertise** (community publishes "Medical Coding" skill)
4. **Onboarding faster** (use role templates instead of configuring from scratch)

### Orchestrator Changes

**Current Orchestrator Startup:**
```typescript
// Load all team configs (heavy)
teams.forEach(team => {
  team.agents.forEach(agent => {
    loadFullAgentConfig(agent)  // 1000s of tokens per agent
  })
})
```

**With Progressive Disclosure:**
```typescript
// Startup: Load only skill descriptions
const skillRegistry = await loadSkillDescriptions()  // 30-50 tokens each

// Runtime: Load full configs on-demand
team.agents.forEach(agent => {
  const skillSummaries = agent.assignedSkills.map(skillId => 
    skillRegistry.get(skillId).description  // Lightweight
  )
  // Only load fullConfig when agent actually executes task
})
```

**Impact:**
- Current: 100 teams × 5 agents × 2000 tokens = 1M tokens loaded
- With Skills: 100 teams × 5 agents × (5 skills × 50 tokens) = 125K tokens loaded
- **8x reduction in context usage**

---

## Architecture Options

### Option A: Registry-First (Recommended)

**Implementation:**
- Central Skill Registry (PostgreSQL + Redis cache)
- Skills published as JSON schemas to registry API
- Teams install from registry (like npm install)
- GitHub repos can publish to registry (CI/CD)

**Pros:**
- Fast skill discovery (search, filter, sort by rating)
- Version control (teams can pin skill versions)
- Analytics (track popular skills, usage patterns)
- Moderation (review community skills before publishing)

**Cons:**
- Requires registry infrastructure
- Single point of failure (mitigated by cache)

### Option B: Decentralized GitHub-Only

**Implementation:**
- Skills defined in GitHub repos (skill.json + implementation)
- Teams install via GitHub URL (like pip install git+https://...)
- No central registry, just Git clones

**Pros:**
- No registry infrastructure needed
- True open source (no gatekeeper)
- Uses existing Git workflows

**Cons:**
- Slower skill discovery (no search)
- No version guarantees (repos can disappear)
- No usage analytics

### Option C: Hybrid (Registry + GitHub)

**Implementation:**
- Central registry for official Ping skills
- GitHub repos can be installed directly (bypass registry)
- Registry can index GitHub skills (like npms.io)

**Pros:**
- Best of both worlds
- Registry provides discovery, GitHub provides storage
- Teams choose trust model (official vs community)

**Cons:**
- More complex to implement
- Requires syncing registry with GitHub

---

## Decision: Option C (Hybrid)

**Rationale:**
- **Official Skills**: Ping maintains core skills in registry (security, performance, accessibility)
- **Community Skills**: Anyone can publish GitHub repo, teams install via URL
- **Discovery**: Registry indexes popular GitHub skills (ratings, stars, forks)
- **Trust Model**: Teams decide between vetted (registry) vs bleeding-edge (GitHub)

---

## Skill Discovery: Embedding Search + Database

### Hybrid Approach

**Database:** Metadata storage (id, name, category, author, version)
**Embeddings:** Semantic search for skill discovery

**Why Embeddings?**
- Natural language queries: "I need to scan code for security issues" → finds "security-review" skill
- Better than SQL LIKE queries (category filters too rigid)
- Handles synonyms: "vulnerability scanning" = "security audit" = "pen testing"
- Scales to 1000s of skills without complex query logic

**Architecture:**
```typescript
// Skill Registry with Embeddings
class SkillRegistry {
  private db: PostgreSQL
  private vectorStore: VectorStore  // Pinecone, Weaviate, or local FAISS
  
  // Index skill on creation
  async createSkill(skill: Skill) {
    // 1. Store metadata in DB
    await this.db.insert('skills', skill)
    
    // 2. Generate embedding from description
    const embedding = await embed(skill.description)
    
    // 3. Store in vector DB
    await this.vectorStore.upsert({
      id: skill.id,
      vector: embedding,
      metadata: { name: skill.name, category: skill.category }
    })
  }
  
  // Semantic search
  async searchSkills(query: string, limit = 20): Promise<Skill[]> {
    // 1. Embed query
    const queryEmbedding = await embed(query)
    
    // 2. Vector similarity search
    const results = await this.vectorStore.query({
      vector: queryEmbedding,
      topK: limit
    })
    
    // 3. Fetch full skill data from DB
    const skillIds = results.map(r => r.id)
    return this.db.query('SELECT * FROM skills WHERE id = ANY($1)', [skillIds])
  }
}
```

**Team Builder Integration:**
```typescript
// During agent design conversation
TeamBuilder: "What should this agent be able to do?"
User: "Review code for security vulnerabilities and performance issues"

// Semantic search for relevant skills
const skills = await skillRegistry.searchSkills(
  "security vulnerabilities performance issues code review"
)
// Returns: ["security-review", "performance-analysis", "code-review"]

TeamBuilder: "I found these skills that match:
  - Security Review (scans for vulnerabilities)
  - Performance Analysis (profiles code execution)
  - Code Review (checks best practices)
  
  Should I assign all of these?"
```

### Basic vs Specialized Skills

**Basic Skills (Universal):**
- Always included for all agents
- `write-document`, `send-email`, `write-code`, `read-file`, `search-web`
- Embedded in base agent config (not searched)

**Specialized Skills (Role-Specific):**
- Assigned based on agent's role
- Discovered via embedding search during Team Builder conversation
- Examples: `security-review`, `database-migration`, `api-testing`

```typescript
const agentConfig = {
  name: "Security Specialist",
  basicSkills: ["write-document", "send-email", "write-code"],  // Auto-included
  specializedSkills: ["security-review", "vulnerability-scanning"],  // User/TB selected
}
```

---

## Database Schema

```sql
-- Skills Registry (metadata only, actual content in filesystem)
CREATE TABLE skills (
  id VARCHAR(255) PRIMARY KEY,           -- "security-review"
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,             -- From YAML frontmatter (max 1024 chars)
  category VARCHAR(50) NOT NULL,
  version VARCHAR(20) NOT NULL,
  
  -- Filesystem paths (where the skill lives)
  skill_path TEXT NOT NULL,              -- "/home/user/.ping/skills/security-review/"
  skill_md_path TEXT NOT NULL,           -- "/home/user/.ping/skills/security-review/SKILL.md"
  supporting_files TEXT[],               -- ["owasp-rules.md", "scripts/run_semgrep.py"]
  
  -- Metadata
  author VARCHAR(255) NOT NULL,
  source VARCHAR(20) NOT NULL,           -- "registry" | "github" | "local" | "personal"
  source_url TEXT,
  install_count INTEGER DEFAULT 0,
  rating DECIMAL(3,2),
  tags TEXT[],
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_skills_category ON skills(category);
CREATE INDEX idx_skills_author ON skills(author);
CREATE INDEX idx_skills_rating ON skills(rating DESC);

-- Role Templates
CREATE TABLE role_templates (
  id VARCHAR(255) PRIMARY KEY,           -- "frontend-developer"
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  
  default_skills TEXT[],                 -- Array of skill IDs
  required_skill_categories TEXT[],
  base_prompt TEXT,
  base_tools JSONB,
  
  author VARCHAR(255) NOT NULL,
  is_official BOOLEAN DEFAULT false,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Agent Skill Assignments
CREATE TABLE agent_skills (
  agent_id VARCHAR(255) REFERENCES agents(id) ON DELETE CASCADE,
  skill_id VARCHAR(255) REFERENCES skills(id) ON DELETE CASCADE,
  
  assigned_at TIMESTAMP DEFAULT NOW(),
  
  PRIMARY KEY (agent_id, skill_id)
);

CREATE INDEX idx_agent_skills_agent ON agent_skills(agent_id);
```

---

## API Design

### Skill Registry Endpoints

```typescript
// Browse skills (search filesystem + database metadata)
GET /api/skills
  ?category=code_analysis
  &author=ping-official
  &tags=security,performance
  &sort=rating|installs|created
  
Response: {
  skills: Array<{
    id, name, description, category, version,
    author, installCount, rating, tags
  }>,
  total: number
}

// Semantic search skills
GET /api/skills/search/semantic
  ?q=security+vulnerabilities
  &limit=10

Response: {
  skills: Array<SkillMetadata>
}

// Get skill details (reads SKILL.md from filesystem)
GET /api/skills/:skillId
Response: {
  id, name, description, category, version,
  skillPath, skillMdPath, supportingFiles,
  instructions: string,        // Markdown body from SKILL.md
  author, installCount, rating, tags
}

// Assign skills to agent (during Team Builder)
POST /api/agents/:agentId/skills
Body: {
  skillIds: string[]           // ["security-review", "code-analysis"]
}
Response: { success: true }

// Get agent's skills
GET /api/agents/:agentId/skills
Response: {
  skills: Array<Skill>
}
```

### Role Template Endpoints

```typescript
// Browse role templates
GET /api/role-templates
  ?isOfficial=true
  &category=development
  
Response: {
  templates: Array<{
    id, name, description,
    defaultSkills, requiredSkillCategories,
    author, isOfficial
  }>
}

// Create agent from role template
POST /api/teams/:teamId/agents/from-template
Body: {
  roleTemplateId: string
  name: string
  assignedSkills?: string[]   // Override defaults
  customConfig?: object
}
Response: { agent: Agent }
```

---

## Implementation Strategy

### Phase 1: Core Skills Infrastructure (v1.0)
**Goal:** Basic skill registry + team installation
- Database schema (skills, role_templates, team_skills, agent_skills)
- SkillRegistry service (CRUD, search, caching)
- API endpoints (browse, install, uninstall)
- Migration: Convert existing agent configs to skills

### Phase 2: Progressive Disclosure (v1.1)
**Goal:** Optimize Orchestrator context usage
- Lazy-load skill fullConfig (Redis cache)
- Orchestrator loads descriptions only at startup
- Fetch full configs when agents execute tasks
- Metrics: Context size before/after

### Phase 3: Role Templates (v1.2)
**Goal:** Standardize common worker types
- RoleTemplate service (CRUD, instantiation)
- Official templates (Frontend Dev, Backend Dev, QA, DevOps)
- Team Builder integration (suggest templates)
- Migration: Existing agents → role template instances

### Phase 4: GitHub Integration (v1.3)
**Goal:** Enable community skill publishing
- GitHub skill schema validation
- Install-from-GitHub endpoint
- Registry indexing of GitHub skills (webhooks)
- Example: `npm install github:ping-skills/security-review`

### Phase 5: Marketplace (v2.0)
**Goal:** Full-featured skill ecosystem
- Skill ratings + reviews
- Dependency resolution (Skill A requires Skill B)
- Skill versioning + compatibility matrix
- Payment integration (paid premium skills)

---

## Open Source Strategy

### Community Contributions

**Skill Package Format (Filesystem-Based):**
```
security-review/                # Skill directory
  SKILL.md                      # Required: Metadata + Instructions
  owasp-rules.md                # Supporting documentation
  vulnerability-patterns.md     # Examples and patterns
  scripts/                      # Executable utilities
    run_semgrep.py
    check_deps.py
    generate_report.py
  config/                       # Tool configurations
    semgrep.yaml
    bandit.yaml
  README.md                     # User-facing documentation
  LICENSE.txt                   # License (MIT, Apache, etc.)
```

**SKILL.md Structure:**
```markdown
---
name: security-review
description: Reviews code for security vulnerabilities using OWASP rules.
category: security
version: 1.0.0
author: ping-official
allowed-tools: ["bash", "grep", "read"]
---

# Security Review

## Instructions
[Detailed how-to guidance...]

## Resources
- [OWASP Rules](owasp-rules.md)
- [Vulnerability Patterns](vulnerability-patterns.md)

## Scripts
- Run scan: `python scripts/run_semgrep.py <file>`
- Check deps: `python scripts/check_deps.py`
```

**Publishing Flow:**
```
Developer creates skill directory:
  → Creates SKILL.md with YAML frontmatter + instructions
  → Adds supporting files (docs, scripts, configs)
  → Tests skill locally in ~/.ping/skills/
  → Publishes to GitHub repo
  → (Optional) Submits to Ping Registry for indexing
  
Teams discover via registry search:
  → Semantic search: "I need security code review"
  → Registry returns: "security-review" skill
  → Teams install via:
      A) GitHub URL: `ping install github:username/security-review`
      B) Registry: `ping install security-review` (if indexed)
  → Skill directory copied to team's skills folder
  → Agent can now use skill
```

**Quality Standards:**
- JSON schema validation (skill.json must conform)
- Example tests (skills must include usage examples)
- Documentation (README with setup + usage)
- License (MIT/Apache recommended)

**Curated Registry:**
- Ping reviews popular GitHub skills
- Promotes to "Official Community Skills" tier
- Guarantees quality, security, maintenance
- Teams trust official skills over random GitHub repos

---

## Integration Points

### With Team Service
- Teams table gains `installed_skills` array
- Agent creation checks team's installed skills
- TeamService.installSkill() method
- Team Builder suggests skills during agent design

### With Orchestrator
- Orchestrator loads skill descriptions at startup (progressive disclosure)
- AgentWorker fetches full skill config when executing task
- MemoryManager tracks skill usage per team
- RoleManager uses role templates for worker creation

### With Team Builder
- Conversational skill installation ("Add security review capability")
- Suggest skills based on team's goals
- Combine role templates + custom skills
- Validate skill dependencies before installation

### With MCP Tools
- Skills can package MCP tool configurations
- MCP servers registered per skill
- Teams don't configure MCP manually (skills handle it)
- Example: "GitHub Integration Skill" bundles GitHub MCP server config

---

## Success Metrics

### Technical Metrics
- **Context Reduction**: 8x reduction in Orchestrator startup context (goal)
- **Skill Reuse**: Average 3 teams per skill (measure adoption)
- **Load Time**: <100ms to fetch skill description, <500ms for full config
- **Cache Hit Rate**: >90% for skill descriptions (Redis)

### Product Metrics
- **Skill Catalog Size**: 50 official skills by v2.0
- **Community Contributions**: 200 GitHub skill repos indexed
- **Installation Rate**: Average 5 skills per team
- **Role Template Usage**: 60% of agents use role templates (vs custom)

### User Experience Metrics
- **Onboarding Time**: 50% reduction (role templates vs manual config)
- **Skill Discovery**: <30 seconds to find relevant skill
- **Setup Simplicity**: 1-click install (vs multi-step config)

---

## Risks & Mitigations

### Risk: Skill Version Conflicts
**Scenario:** Team installs Skill A v1.0, Skill B v2.0 depends on Skill A v1.5
**Mitigation:** 
- Dependency resolution engine (like npm)
- Warn users before installing incompatible skills
- Allow multiple versions (Skill A v1.0 + v1.5) if needed

### Risk: Malicious Community Skills
**Scenario:** Attacker publishes skill with backdoor
**Mitigation:**
- Registry review process (manual approval)
- Sandboxed skill execution (tools run in isolated environment)
- Reputation system (ratings, install count, verified authors)
- Code scanning (static analysis on skill tools)

### Risk: Skill Bloat (Too Many Skills)
**Scenario:** 1000+ skills, overwhelming users
**Mitigation:**
- Curated "Starter Packs" (Top 10 essential skills)
- Smart search (semantic search by goal, not just keywords)
- Personalized recommendations (based on team's industry/role)

### Risk: Breaking Changes in Skill Updates
**Scenario:** Skill v2.0 breaks teams using v1.0
**Mitigation:**
- Semantic versioning (MAJOR.MINOR.PATCH)
- Teams pin skill versions (explicit opt-in to upgrades)
- Deprecation warnings (v1.0 marked deprecated, sunset date)

---

## Future Enhancements

### Skill Composition
- Combine multiple skills into "Super Skills"
- Example: "Full Stack Developer" = Frontend + Backend + Database skills
- Dependency graph visualization

### Skill Marketplace
- Premium skills (paid by teams)
- Revenue sharing (70% author, 30% Ping)
- Enterprise skills (private, not public)

### AI-Generated Skills
- Team Builder generates custom skill from conversation
- "I need a skill that reviews Python code for security issues"
- LLM generates skill.json + prompts + tools
- User reviews + publishes to team (or GitHub)

### Skill Analytics
- Track skill usage across all teams
- "Security Review used 10K times this month"
- Identify gaps (missing skills for common tasks)
- Auto-suggest skills based on team's task history

---

## Comparison to Claude's Skills

| Aspect | Claude's Skills | Ping's Skills |
|--------|----------------|---------------|
| **Portability** | ✅ Sub-agents use shared skills | ✅ Teams install skills from registry |
| **Progressive Disclosure** | ✅ 30-50 token descriptions | ✅ Lazy-load fullConfig |
| **Role Templates** | ✅ "Frontend Dev" role separate from skills | ✅ RoleTemplate → Agent instances |
| **Open Source** | ❌ Closed (Anthropic internal) | ✅ GitHub repos + community registry |
| **Team Ownership** | ❌ No team model | ✅ Teams own agents + skills |
| **MCP Integration** | ✅ Universal data tools | ✅ Skills package MCP configs |
| **Marketplace** | ❌ N/A | 🔮 Future (v2.0) |

**Key Differences:**
- **Ping's Skills are team-scoped** (teams install skills, agents inherit)
- **Ping's Skills are open source** (community can publish)
- **Ping's Skills integrate with Team Service** (ownership + delegation model)

---

## Conclusion

The Skills System transforms Ping from a **team-centric multi-agent platform** into a **skill-powered collaboration ecosystem**. By separating expertise (skills) from execution (agents), we enable:

1. **Reusability**: Skills shared across teams, no config duplication
2. **Scalability**: Progressive disclosure reduces context bloat 8x
3. **Community**: Open source skills from GitHub, curated registry
4. **Standardization**: Role templates for common worker types
5. **Flexibility**: Teams customize skills with overrides

This aligns with the industry trend (Claude's Skills, GPT-4's Actions, Gemini's Extensions) while maintaining Ping's unique **team ownership model**.

**Next Steps:** See [v1.0 Implementation Planning](v1.0/feature_implementation_planning.md)
