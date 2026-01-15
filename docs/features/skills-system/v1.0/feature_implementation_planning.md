# Skills System v1.0 Implementation Planning

**Version:** 1.0 (Core Infrastructure)  
**Goal:** Filesystem-based portable skills with progressive disclosure (inspired by Claude Skills)

**Architecture:** Skills as directories with `SKILL.md` files, loaded in 3 phases:
- **Discovery:** Metadata (name/description) - always loaded for matching
- **Activation:** Instructions (SKILL.md body) - loaded when skill triggered
- **Execution:** Resources (scripts, docs, templates) - loaded/run as needed

---

## Skills Philosophy

### What Skills Are (vs What They're Not)

**Skills = "Packaged Expertise"** (How to approach a domain/workflow)
- Example: "How to review code for our team's standards" (skill)
- NOT just: "Run ESLint" (that's a tool)

**Key Distinction:**
| Concept | Role | Example |
|---------|------|----------|
| **Tools** | The "hands" - executable functions | "Search Google", "Query Database", "Read File" |
| **MCP** | The "hands" - external tool providers | MCP server gives tools like "GitHub API", "Database connector" |
| **Skills** | The "brain" - logic & expertise | "How to optimize SQL for our DB", "Write in our brand voice" |
| **Subagents** | Independent assistants | Separate context/memory for isolated complex tasks |

**When to Use Skills:**
- ✅ You want consistent behavior across tasks ("always use 2-column format")
- ✅ You need domain expertise bundled ("OWASP security rules + how to apply them")
- ✅ You want to teach Claude your team's workflow ("our code review checklist")
- ✅ You need to combine tools + guidance ("use Semgrep + interpret results our way")

**When NOT to Use Skills (use Tools instead):**
- ❌ Just executing a function ("search the web" - that's a tool)
- ❌ No specialized knowledge needed ("read a file" - that's a tool)

### Progressive Disclosure: Discovery → Activation → Execution

| Phase | What Claude Sees | Token Cost | Benefit |
|-------|------------------|------------|----------|
| **Discovery** | Only name + description of ALL skills | ~100 tokens/skill | Fast startup; can "know" about 100+ skills without lag |
| **Activation** | SKILL.md instructions when triggered | ~5k tokens | Detailed guidance only when needed |
| **Execution** | Referenced files/scripts as used | Variable | Scripts executed (output only), docs loaded on-demand |

**Example Flow:**
1. **Discovery:** Claude sees "security-review - Scans code for vulnerabilities"
2. **User:** "Review this code for security issues"
3. **Activation:** Claude loads SKILL.md → sees "Run Semgrep, check OWASP rules"
4. **Execution:** Claude runs `scripts/run_semgrep.py`, reads `owasp-rules.md` if needed

---

## Branch Strategy

- `feature/skills-system-v1.0`
- Branch off: `main`
- Merge to: `main` after testing

---

## Scope

This version implements the foundational Skills System infrastructure:

✅ **Included:**
- **Filesystem-based skills** (directories with `SKILL.md` files)
- **Progressive disclosure** (3-level loading: metadata → instructions → resources)
- **Semantic discovery** (embedding search on skill descriptions)
- **Team Builder integration** (suggests skills during agent design)
- **Skill bundling** (instructions, scripts, examples, reference docs)
- **Agent skill assignment** (skills → agents, not teams)
- **Migration tool** (convert existing agent configs to skills)

❌ **Not Included (Future Versions):**
- Progressive disclosure optimization (v1.1)
- Role Templates (v1.2)
- GitHub integration (v1.3)
- Skill marketplace/payments (v2.0)

---

## Implementation Steps

### Step 1: Database Schema & Migrations (0.5 day)

**Goal:** Create tables for skills and agent_skills

**Files to create:**
- `src/worker/database/migrations/006_create_skills_tables.sql`

**Schema:**
```sql
-- Skills registry (metadata only, instructions in filesystem)
CREATE TABLE skills (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT NOT NULL,           -- From YAML frontmatter
  category VARCHAR(50) NOT NULL,       -- From YAML frontmatter
  version VARCHAR(20) NOT NULL,        -- From YAML frontmatter
  
  -- Filesystem paths
  skill_path TEXT NOT NULL,            -- Path to skill directory
  skill_md_path TEXT NOT NULL,         -- Path to SKILL.md file
  
  -- Registry metadata
  author VARCHAR(255) NOT NULL,
  source VARCHAR(20) NOT NULL,         -- 'registry', 'github', 'local', 'personal', 'project'
  source_url TEXT,
  install_count INTEGER DEFAULT 0,
  rating DECIMAL(3,2),
  tags TEXT[],
  
  -- Progressive disclosure (instructions NOT stored in DB)
  supporting_files TEXT[],             -- List of bundled files (reference.md, scripts/)
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_skills_category ON skills(category);
CREATE INDEX idx_skills_rating ON skills(rating DESC);

-- Agent skill assignments
CREATE TABLE agent_skills (
  agent_id VARCHAR(255) REFERENCES agents(id) ON DELETE CASCADE,
  skill_id VARCHAR(255) REFERENCES skills(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (agent_id, skill_id)
);
```

**Testing:**
- Migration runs without errors
- Indexes created successfully
- Foreign keys enforce referential integrity

---

### Step 2: SKILL.md Format & Type Definitions (1 day)

**Goal:** Define SKILL.md format (the "brain" of the skill) and TypeScript types

**SKILL.md = "Packaged Expertise"**
- Not just "run this tool" - but "how to approach this domain"
- Combines: What to do + How to do it + When to do it + Why it matters
- Example: Security skill teaches "OWASP principles + how to apply them + interpret results"

**SKILL.md Format (Packaged Expertise, Not Just Tool Calls):**
```markdown
---
name: security-review
description: Reviews code for security vulnerabilities using OWASP rules. Use when reviewing code for security issues, scanning for vulnerabilities, or when user mentions security.
allowed-tools: ["bash", "grep", "semgrep"]
version: 1.0.0
category: security
---

# Security Review

## What This Skill Does
This skill teaches Claude to think like a security engineer, not just run tools.
It combines OWASP knowledge + tool usage + result interpretation + our team's standards.

## Instructions

When reviewing code for security:

**Phase 1: Automated Scanning (Use the "hands")**
1. Run Semgrep with OWASP ruleset
2. Run dependency vulnerability check

**Phase 2: Apply Domain Expertise (Use the "brain")**
3. Check for common vulnerabilities (SQL injection, XSS, CSRF)
4. Validate input sanitization patterns
5. Review authentication/authorization logic
6. Check for hardcoded secrets (even if tools miss them)

**Phase 3: Contextualize Results (Our team's standards)**
7. Severity classification based on our threat model
8. Prioritize fixes by business impact
9. Suggest specific remediation with code examples

## Examples

Example 1: SQL Injection Check
```python
# BAD - vulnerable to SQL injection
query = f"SELECT * FROM users WHERE id = {user_id}"

# GOOD - parameterized query
query = "SELECT * FROM users WHERE id = ?"
cursor.execute(query, (user_id,))
```

## Resources

For detailed OWASP rules, see [OWASP_RULES.md](OWASP_RULES.md)
For Semgrep configuration, run: `python scripts/setup_semgrep.py`

## Guidelines

- Severity levels: Critical, High, Medium, Low
- Always explain *why* code is vulnerable
- Suggest specific fixes with code examples
```

**Three-Level Loading:**
1. **Level 1 (Metadata):** YAML frontmatter (name, description, category) - loaded at startup
2. **Level 2 (Instructions):** Markdown body - loaded when skill triggered
3. **Level 3 (Resources):** Referenced files (OWASP_RULES.md, scripts/) - loaded as needed

**Files to create:**
- `src/worker/skillRegistry/types/Skill.ts`
- `src/worker/skillRegistry/types/SkillCategory.ts`
- `src/worker/skillRegistry/types/index.ts` (barrel export)

**Key types:**
```typescript
// Skill.ts (filesystem-based)
export type SkillCategory = 
  | "code_analysis"
  | "testing"
  | "documentation"
  | "deployment"
  | "security"
  | "performance";

export type SkillSource = "registry" | "github" | "local" | "personal" | "project";

export interface SkillMetadata {
  // Level 1: Always loaded (from YAML frontmatter)
  name: string;               // Skill identifier (lowercase, hyphens)
  description: string;        // What & when to use (max 1024 chars)
  version: string;
  category: SkillCategory;
  allowedTools?: string[];    // Tools skill can use without asking
  author: string;
  tags?: string[];
}

export interface Skill extends SkillMetadata {
  id: string;                 // Generated from name
  
  // Filesystem paths
  skillPath: string;          // Path to skill directory
  skillMdPath: string;        // Path to SKILL.md
  
  // Level 2: Loaded when triggered
  instructions?: string;      // Markdown body of SKILL.md
  
  // Level 3: Loaded as needed
  supportingFiles?: string[]; // Paths to resources (scripts, docs)
  
  // Registry metadata
  source: SkillSource;
  sourceUrl?: string;
  installCount: number;
  rating?: number;
  
  createdAt: Date;
  updatedAt: Date;
}
```

**Testing:**
- Type definitions compile without errors
- Barrel export works correctly

---

### Step 3: SkillRegistry Service with Embedding Search (2 days)

**Goal:** Service class with semantic search for skill discovery

**Files to create:**
- `src/worker/skillRegistry/SkillRegistry.ts`
- `src/worker/skillRegistry/SkillRegistry.test.ts`
- `src/worker/skillRegistry/EmbeddingService.ts` (wrapper for OpenAI embeddings)

**Key methods:**
```typescript
class SkillRegistry {
  private db: Database
  private embeddings: EmbeddingService
  private vectorStore: VectorStore
  private skillsBasePath: string  // Where skills are stored (e.g., ~/.ping/skills/)
  
  // Level 1: Load metadata only (startup)
  async loadSkillMetadata(): Promise<SkillMetadata[]> {
    // Scan skill directories for SKILL.md files
    // Parse YAML frontmatter only (don't load markdown body)
    // Embed descriptions for semantic search
  }
  
  // Semantic search (primary for Team Builder)
  async searchSkillsBySemantic(query: string, limit = 20): Promise<SkillMetadata[]> {
    const queryEmbedding = await this.embeddings.embed(query)
    const results = await this.vectorStore.query(queryEmbedding, limit)
    return results.map(r => r.metadata as SkillMetadata)
  }
  
  // Level 2: Load full instructions when triggered
  async loadSkillInstructions(skillName: string): Promise<string> {
    const skillPath = path.join(this.skillsBasePath, skillName, 'SKILL.md')
    const content = await fs.readFile(skillPath, 'utf-8')
    return extractMarkdownBody(content)  // Skip YAML frontmatter
  }
  
  // Level 3: Load supporting files as needed
  async loadSupportingFile(skillName: string, filePath: string): Promise<string> {
    const fullPath = path.join(this.skillsBasePath, skillName, filePath)
    return fs.readFile(fullPath, 'utf-8')
  }
  
  // Execute bundled scripts (zero-context execution)
  async executeSkillScript(skillName: string, scriptPath: string, args: string[]): Promise<string> {
    const fullPath = path.join(this.skillsBasePath, skillName, scriptPath)
    const result = await exec(`${fullPath} ${args.join(' ')}`)
    return result.stdout  // Only output consumes context, not script code
  }
  
  // Filtered search (category/author for UI browsing)
  async searchSkills(params: {
    category?: SkillCategory;
    author?: string;
    tags?: string[];
    sort?: "rating" | "installs" | "created";
    limit?: number;
    offset?: number;
  }): Promise<{ skills: Skill[]; total: number }>;  // SQL query for metadata filters
  
  // Get skill details
  async getSkill(skillId: string): Promise<Skill | null>;
  
  // Create/update skills (admin only for v1.0)
  async createSkill(skill: Omit<Skill, "id" | "createdAt" | "updatedAt">): Promise<Skill>;
  async updateSkill(skillId: string, updates: Partial<Skill>): Promise<Skill>;
  
  // Agent creation with skills (called by Team Builder)
  async getSkillsByIds(skillIds: string[]): Promise<Skill[]>;
  async validateSkills(skillIds: string[]): Promise<{ valid: string[]; invalid: string[] }>;
  
  // Agent operations
  async assignSkillToAgent(agentId: string, skillId: string): Promise<void>;
  async getAgentSkills(agentId: string): Promise<Skill[]>;
  async removeSkillFromAgent(agentId: string, skillId: string): Promise<void>;
  
  // Usage tracking
  async incrementSkillUsage(skillId: string): Promise<void>;
}
```

**Dependencies:**
- PostgreSQL connection from existing database service
- Transaction support for multi-table updates

**Testing:**
- Unit tests: Each method with mock database
- Integration tests: Real database operations
- Edge cases: Duplicate installs, missing skills, invalid team IDs

---

### Step 4: API Endpoints (1 day)

**Goal:** HTTP endpoints for skill operations

**Files to modify:**
- `src/worker/api/HttpServer.ts` (add skill routes)

**Files to create:**
- `src/worker/api/routes/skills.ts`
- `src/worker/api/routes/agentSkills.ts`

**Endpoints:**
```typescript
// Browse skills (public registry)
GET /api/skills
  ?category=code_analysis
  &author=ping-official
  &tags=security,performance
  &sort=rating
  &limit=20
  &offset=0
  
Response: {
  skills: Skill[],
  total: number
}

// Semantic skill search (used by Team Builder)
GET /api/skills/search/semantic
  ?q=security+vulnerabilities
  &limit=10
  
Response: {
  skills: Skill[]
}

// Get skill details
GET /api/skills/:skillId
Response: Skill

// Assign skills to agent (Team Builder creates agents with skills)
POST /api/agents/:agentId/skills
Body: {
  skillIds: string[]  // e.g., ["security-review", "code-analysis"]
}
Response: { success: true }

// Get agent's skills
GET /api/agents/:agentId/skills
Response: {
  skills: Skill[]
}

// Remove skill from agent
DELETE /api/agents/:agentId/skills/:skillId
Response: { success: true }
```

**Authentication:**
- Require user authentication for all endpoints
- Only agent owners/team managers can assign/remove skills from agents
- GET endpoints (browse skills) are public
- Skill assignment happens during Team Builder (agent creation)

**Testing:**
- API tests with supertest
- Authorization tests (non-managers cannot install)
- Error handling (404, 400, 500)

---

### Step 5: Seed Official Skills (0.5 day)

**Goal:** Create 10 official Ping skills demonstrating "packaged expertise"

**Design Principle:** Each skill should teach "how to think" about a domain, not just "what tool to run"

**Example: Security Review Skill**
- ❌ **Bad (just a tool wrapper):** "Run Semgrep"
- ✅ **Good (packaged expertise):** "Apply OWASP principles + use Semgrep + interpret results for our threat model + suggest contextual fixes"

**Files to create:**
- `src/worker/database/seeds/skills.json`
- `src/worker/database/seeds/seedSkills.ts`

**Official Skills (v1.0) - Real-World Structure (inspired by Anthropic's pptx skill):**

1. **security-review/** (category: security)
   
   **Directory structure:**
   ```
   security-review/
   ├── SKILL.md                 # Level 1: Metadata + Level 2: Instructions
   ├── owasp-rules.md           # Level 3: Detailed OWASP ruleset documentation
   ├── vulnerability-patterns.md # Level 3: Common vulnerability patterns
   ├── scripts/                 # Level 3: Executable utilities (zero-context)
   │   ├── run_semgrep.py       # Run Semgrep scan with custom config
   │   ├── check_deps.py        # Check dependency vulnerabilities
   │   └── generate_report.py   # Generate security report
   ├── config/                  # Configuration files for tools
   │   ├── semgrep.yaml         # Semgrep ruleset configuration
   │   └── bandit.yaml          # Bandit configuration
   └── LICENSE.txt              # Skill license
   ```
   
   **SKILL.md:**
   ```markdown
   ---
   name: security-review
   description: Scans code for security vulnerabilities using OWASP rules. Use when reviewing code for security, checking for vulnerabilities, or when user mentions security scanning.
   category: security
   version: 1.0.0
   allowed-tools: ["bash", "grep", "read"]
   ---
   
   # Security Review
   
   ## Instructions
   
   When performing security review:
   
   1. **Run automated scans:**
      ```bash
      python scripts/run_semgrep.py <file_or_directory>
      ```
   
   2. **Check dependencies:**
      ```bash
      python scripts/check_deps.py
      ```
   
   3. **Manual review checklist:**
      - Authentication/Authorization vulnerabilities
      - Input validation and sanitization
      - SQL injection, XSS, CSRF risks
      - Hardcoded secrets or credentials
   
   4. **Generate report:**
      ```bash
      python scripts/generate_report.py --format markdown
      ```
   
   ## Resources
   
   - **OWASP Rules:** See [owasp-rules.md](owasp-rules.md) for complete ruleset
   - **Common Patterns:** See [vulnerability-patterns.md](vulnerability-patterns.md) for examples
   
   ## Severity Levels
   
   - **Critical:** Remote code execution, authentication bypass
   - **High:** SQL injection, XSS, CSRF
   - **Medium:** Information disclosure, weak cryptography
   - **Low:** Missing security headers, verbose error messages
   ```

2. **code-review/** (category: code_analysis)
   
   **Directory structure:**
   ```
   code-review/
   ├── SKILL.md
   ├── best-practices/          # Level 3: Language-specific guides
   │   ├── python.md
   │   ├── typescript.md
   │   ├── javascript.md
   │   └── java.md
   ├── scripts/
   │   ├── analyze_complexity.py  # Cyclomatic complexity analysis
   │   └── detect_smells.py       # Code smell detection
   └── LICENSE.txt
   ```
   
   **SKILL.md:**
   ```markdown
   ---
   name: code-review
   description: Reviews code for best practices, readability, and maintainability. Use when reviewing pull requests, checking code quality, or improving codebases.
   category: code_analysis
   version: 1.0.0
   allowed-tools: ["bash", "grep", "read"]
   ---
   
   # Code Review
   
   ## Instructions
   
   1. **Style & Formatting:**
      - Check indentation, naming conventions
      - Verify consistent code style
   
   2. **Code Quality:**
      ```bash
      python scripts/analyze_complexity.py <file>
      ```
   
   3. **Best Practices:**
      - Language-specific: See [best-practices/](best-practices/) for your language
      - DRY, SOLID, KISS principles
   
   4. **Code Smells:**
      ```bash
      python scripts/detect_smells.py <file>
      ```
   
   ## Language-Specific Guides
   
   - [Python Best Practices](best-practices/python.md)
   - [TypeScript Best Practices](best-practices/typescript.md)
   - [JavaScript Best Practices](best-practices/javascript.md)
   - [Java Best Practices](best-practices/java.md)
   ```
   
3. **unit-testing/** (category: testing)
   - **Expertise:** "Teaches Claude our testing philosophy: what to test, how to structure tests, edge cases to cover, and how to write maintainable test code"
   - **Not just:** "Run Jest" (that's a tool)
   - **Includes:** Test patterns, naming conventions, coverage standards, mocking strategies
   
4. **documentation-generator/** (category: documentation)
   - **Expertise:** "Teaches Claude our documentation standards: what details matter, our template structure, tone/voice, and examples to include"
   - **Not just:** "Run JSDoc" (that's a tool)
   - **Includes:** Doc templates, style guide, example patterns, required sections
   
5. **performance-analysis/** (category: performance)
   - **Expertise:** "Teaches Claude how to think about performance: what metrics matter for our apps, acceptable thresholds, common bottlenecks, and optimization strategies"
   - **Not just:** "Run profiler" (that's a tool)
   - **Includes:** Performance budgets, optimization patterns, trade-off guidelines
   
6. **Dependency Update** (category: maintenance)
   - Description: "Checks for outdated dependencies and suggests updates"
   - Tools: npm audit, pip-audit
   
7. **Code Formatter** (category: code_analysis)
   - Description: "Formats code according to style guides (Prettier, Black)"
   - Tools: Prettier, Black
   
8. **Git Workflow** (category: deployment)
   - Description: "Manages branches, commits, pull requests"
   - Tools: Git CLI, GitHub API
   
9. **Database Migration** (category: deployment)
   - Description: "Creates and applies database schema changes"
   - Tools: Knex, Alembic
   
10. **API Testing** (category: testing)
    - Description: "Tests REST/GraphQL endpoints with assertions"
    - Tools: Postman, Insomnia

**Seed script for filesystem-based skills:**
```typescript
async function seedSkills() {
  const skillsSourceDir = './seeds/official-skills/';  // Source directory
  const skillsTargetDir = '~/.ping/skills/';           // User's skills directory
  
  // Copy skill directories to user skills folder
  await fs.copy(skillsSourceDir, skillsTargetDir);
  
  // Scan and index skills
  const skillDirs = await fs.readdir(skillsTargetDir);
  
  for (const skillDir of skillDirs) {
    const skillMdPath = path.join(skillsTargetDir, skillDir, 'SKILL.md');
    if (!await fs.pathExists(skillMdPath)) continue;
    
    // 1. Parse SKILL.md frontmatter (Level 1: Metadata)
    const content = await fs.readFile(skillMdPath, 'utf-8');
    const { data: frontmatter } = matter(content);  // gray-matter library
    
    // 2. Save metadata to database
    await db.skills.create({
      id: frontmatter.name,
      name: frontmatter.name,
      description: frontmatter.description,
      category: frontmatter.category,
      version: frontmatter.version,
      skill_path: path.join(skillsTargetDir, skillDir),
      skill_md_path: skillMdPath,
      author: 'ping-official',
      source: 'registry'
    });
    
    // 3. Generate embedding for description (Level 1)
    const embedding = await embeddings.embed(frontmatter.description);
    
    // 4. Index in vector store
    await vectorStore.upsert({
      id: frontmatter.name,
      vector: embedding,
      metadata: frontmatter
    });
  }
  
  console.log(`Seeded ${skillDirs.length} official skills (filesystem-based)`);
}
```

**Testing:**
- Seed script runs without errors
- Embeddings generated and indexed
- Skills appear in semantic search
- Each skill has valid schema

---

### Step 6: Team Builder Integration (1.5 days)

**Goal:** Team Builder assigns skills during agent design conversation

**Files to modify:**
- `src/worker/roleManager/RoleManager.ts` (add skill suggestion)
- `src/worker/teamService/TeamService.ts` (create agents with skills)
- `src/worker/agentManager/AgentManager.ts` (load agent skills)

**RoleManager changes (Team Builder):**
```typescript
class RoleManager {
  // During agent design conversation
  async suggestSkillsForRole(userDescription: string): Promise<Skill[]> {
    // Semantic search based on user's description
    return this.skillRegistry.searchSkillsBySemantic(userDescription);
  }
  
  async designAgentWithSkills(teamId: string, conversation: {
    userInput: string;  // "I need a security specialist"
  }): Promise<Agent> {
    // 1. LLM extracts intent from conversation
    const intent = await this.extractIntent(conversation.userInput);
    // { role: "security-engineer", responsibilities: "code review, vulnerability scanning" }
    
    // 2. Search for relevant specialized skills
    const suggestedSkills = await this.skillRegistry.searchSkillsBySemantic(
      intent.responsibilities
    );
    // Returns: ["security-review", "vulnerability-scanning", "code-analysis"]
    
    // 3. Ask user to confirm (or LLM auto-selects)
    const confirmedSkills = await this.confirmSkills(suggestedSkills);
    
    // 4. Add basic skills automatically
    const basicSkills = ["write-document", "send-email", "write-code"];
    const allSkills = [...basicSkills, ...confirmedSkills];
    
    // 5. Create agent config
    const agentConfig = {
      name: intent.role,
      role: intent.role,
      skills: allSkills  // REPLACES old "capabilities" array
    };
    
    // 6. Publish to Orchestrator (TeamService creates agent)
    return this.teamService.createAgent(teamId, agentConfig);
  }
}
```

**TeamService changes:**
```typescript
class TeamService {
  async createAgent(teamId: string, config: {
    name: string;
    type: AgentType;
    skills: string[];  // NEW: Skills array (replaces capabilities)
  }): Promise<Agent> {
    // Validate skills exist
    const { valid, invalid } = await this.skillRegistry.validateSkills(config.skills);
    if (invalid.length > 0) {
      throw new Error(`Invalid skills: ${invalid.join(', ')}`);
    }
    
    // Create agent with skills
    const agent = await db.agents.create({
      teamId,
      name: config.name,
      type: config.type,
      skills: config.skills  // Store as TEXT[] in Postgres
    });
    
    // Link skills in agent_skills junction table
    for (const skillId of config.skills) {
      await db.agent_skills.create({ agentId: agent.id, skillId });
    }
    
    return agent;
  }
}
```

**AgentManager changes:**
```typescript
class AgentManager {
  async initializeWorker(agentId: string): Promise<AgentWorker> {
    const agent = await this.getAgent(agentId);
    
    // Load agent's assigned skills
    const skills = await this.skillRegistry.getAgentSkills(agentId);
    
    // Merge skill configs into agent config
    const mergedConfig = this.mergeSkillConfigs(agent.config, skills);
    
    return new AgentWorker(agentId, mergedConfig);
  }
  
  private mergeSkillConfigs(baseConfig: any, skills: Skill[]): any {
    // Combine tools from all skills
    const allTools = skills.flatMap(s => s.fullConfig?.tools || []);
    
    // Merge prompts
    const systemPrompt = [
      baseConfig.systemPrompt,
      ...skills.map(s => s.fullConfig?.prompts || [])
    ].filter(Boolean).join('\n\n');
    
    return {
      ...baseConfig,
      tools: [...baseConfig.tools, ...allTools],
      systemPrompt
    };
  }
}
```

**Testing:**
- RoleManager suggests skills via semantic search
- Team Builder conversation assigns skills to agents
- Agents created with basic + specialized skills
- Skill configs merge correctly (no conflicts)
- Invalid skills rejected with clear error messages

---

### Step 7: Frontend Integration (0.5 day)

**Goal:** UI for Team Builder to show skill suggestions

**Files to modify:**
- `src/AgentChat/components/TeamBuilderChat.tsx` (show skill suggestions)
- `src/AgentChat/components/SkillPill.tsx` (display selected skills)
- `src/AgentChat/services/SkillService.ts` (semantic search API)

**Components:**

**TeamBuilderChat.tsx changes:**
```typescript
// During agent design, show suggested skills
{showSkillSuggestions && (
  <div className="skill-suggestions">
    <h4>Recommended Skills:</h4>
    {suggestedSkills.map(skill => (
      <SkillPill 
        key={skill.id}
        skill={skill}
        selected={selectedSkills.includes(skill.id)}
        onToggle={() => toggleSkill(skill.id)}
      />
    ))}
  </div>
)}

// Show selected skills in agent summary
<div className="agent-skills">
  <span className="basic">Basic: write-code, send-email, write-document</span>
  <span className="specialized">Specialized: {selectedSkills.join(', ')}</span>
</div>
```

**SkillService.ts:**
```typescript
class SkillService {
  async searchSkillsSemantic(query: string): Promise<Skill[]> {
    return this.http.get('/api/skills/search/semantic', { params: { q: query } });
  }
}
```

**Testing:**
- Skill suggestions appear in Team Builder UI
- Users can toggle skills on/off
- Selected skills sent to backend when creating agent
- Agent card shows basic + specialized skills

---

### Step 8: Migration Tool (0.5 day)

**Goal:** Convert existing agent configs to skills

**Files to create:**
- `src/worker/scripts/migrateAgentConfigsToSkills.ts`

**Migration logic:**
```typescript
async function migrateAgentConfigs() {
  const agents = await db.query('SELECT * FROM agents WHERE capabilities IS NOT NULL');
  
  for (const agent of agents) {
    // Old: capabilities: ["code-review", "security-scan"]
    // New: skills: ["code-review", "security-scan", "write-code", "send-email"]
    
    const basicSkills = ["write-document", "send-email", "write-code"];
    const specializedSkills = agent.capabilities || [];
    const allSkills = [...basicSkills, ...specializedSkills];
    
    // Update agent with skills array
    await db.query(
      'UPDATE agents SET skills = $1, capabilities = NULL WHERE id = $2',
      [allSkills, agent.id]
    );
    
    // Create agent_skills junction records
    for (const skillId of allSkills) {
      await db.query(
        'INSERT INTO agent_skills (agent_id, skill_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [agent.id, skillId]
      );
    }
  }
  
  console.log(`Migrated ${agents.length} agents: capabilities → skills`);
}
    
    for (const skillId of skills) {
      // Check if skill exists in registry
      const skillExists = await skillRegistry.getSkill(skillId);
      if (!skillExists) {
        console.warn(`Skill ${skillId} not found, skipping`);
        continue;
      }
      
      // Assign skill to agent
      await skillRegistry.assignSkillToAgent(agent.id, skillId);
    }
    
    // Remove duplicated config from agent (now in skills)
    const slimConfig = removeSkillConfigFromAgent(agent.config, skills);
    await db.query('UPDATE agents SET config = $1 WHERE id = $2', [slimConfig, agent.id]);
  }
  
  console.log(`Migrated ${agents.length} agents to use skills`);
}

function detectSkillsFromConfig(config: any): string[] {
  const skills = [];
  
  // Example: If config has Semgrep tool, detect "security-scan" skill
  if (config.tools?.some(t => t.name === 'semgrep')) {
    skills.push('security-scan');
  }
  
  // Add more pattern matching...
  
  return skills;
}
```

**Testing:**
- Migration script runs on test database
- Agent configs slimmed down correctly
- Skills assigned to agents
- No data loss

---

### Step 9: Documentation (0.5 day)

**Goal:** Update product and developer docs

**Files to modify:**
- `docs/product/ping/guides/creating-teams.md` (add skill installation section)
- `docs/developer-guide/modules/skill-registry.md` (new file)

**Product docs additions:**
- How to browse skills in registry
- How Team Builder suggests skills during agent design
- How skills are assigned to agents automatically
- Example: "Creating Security Specialist with Skills"

**Developer docs:**
- SkillRegistry architecture
- Database schema explanation
- API endpoint reference
- Migration guide (agent configs → skills)

---

### Step 10: Error Handling & Validation (0.5 day)

**Goal:** Robust error handling for skill operations

**Error scenarios:**
- **Skill not found**: Return 404 with helpful message
- **Duplicate installation**: Return 409, indicate skill already installed
- **Permission denied**: Return 403, non-managers cannot install
- **Invalid skill config**: Validate JSON schema before creating skill
- **Dependency missing**: If Skill A requires Skill B, error if B not installed

**Validation:**
```typescript
// Skill schema validation
const skillSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(255),
  description: z.string().min(30).max(500),
  category: z.enum(['code_analysis', 'testing', 'documentation', 'deployment', 'security', 'performance']),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  fullConfig: z.object({
    tools: z.array(z.any()),
    prompts: z.array(z.any()),
    examples: z.array(z.any()),
    dependencies: z.array(z.string())
  }).optional(),
  // ... rest of fields
});

async function createSkill(data: unknown): Promise<Skill> {
  const validated = skillSchema.parse(data);  // Throws if invalid
  return db.insert('skills', validated);
}
```

**Testing:**
- All error cases return correct HTTP status codes
- Error messages are user-friendly
- Validation catches malformed skill data

---

## Testing Strategy

### Unit Tests
- **SkillRegistry methods:**
  - Level 1: Load metadata from SKILL.md YAML frontmatter
  - Level 2: Load instructions (markdown body) when triggered
  - Level 3: Load supporting files on-demand
  - Semantic search (embedding-based skill discovery)
  - Execute bundled scripts (zero-context execution)
- **SKILL.md parsing:**
  - YAML frontmatter validation (name, description required)
  - Markdown body extraction
  - Supporting file path resolution
- **Progressive disclosure:**
  - Metadata-only loading at startup (fast)
  - Instructions loaded when skill triggered
  - Resources loaded only when referenced
- **Embedding generation and vector indexing**
- **RoleManager skill suggestion logic**
- **Skill config merging (AgentManager)**
- **Migration script (capabilities → skills)**

### Integration Tests
- Full Team Builder flow: Design agent → Suggest skills → Create agent → Skills assigned
- Semantic search accuracy (test query → expected skill matches)
- Database transactions (rollback on error)
- Agent creation with basic + specialized skills

### E2E Tests
- Team Builder conversation with skill suggestions
- Select/deselect skills in UI
- Create agent with skills via Team Builder
- Verify agent uses skill tools in task execution
- Migration script on test database

### Performance Tests
- Semantic search on 1000 skills (< 300ms)
- Embedding generation (< 100ms per skill)
- Load agent with 20 skills (< 500ms)
- Vector similarity search (< 200ms)

---

## Rollback Plan

If critical issues arise:

1. **Database rollback**: Revert migration 006
   ```bash
   npm run migrate:rollback
   ```

2. **Feature flag**: Disable skills system
   ```typescript
   if (!process.env.ENABLE_SKILLS) {
     return oldAgentInitialization();
   }
   ```

3. **Restore agent configs**: Re-apply tool configurations directly to agents (reverse migration)

4. **Revert API changes**: Remove skill endpoints from HttpServer

**Data safety:**
- Migration creates backup of `agents` table before modification
- Skills table can be dropped without affecting existing teams/agents
- `team_skills` and `agent_skills` are non-critical (can be recreated)

---

## Estimated Complexity

| Step | Complexity | Time | Risk |
|------|-----------|------|------|
| 1. Database Schema | Low | 0.5 day | Low |
| 2. Type Definitions | Low | 0.5 day | Low |
| 3. SkillRegistry + Embeddings | High | 2 days | Medium |
| 4. API Endpoints | Medium | 1 day | Medium |
| 5. Seed Skills + Embeddings | Medium | 0.5 day | Low |
| 6. Team Builder Integration | High | 1.5 days | High |
| 7. Frontend Integration | Low | 0.5 day | Low |
| 8. Migration Tool | Medium | 0.5 day | Medium |
| 9. Documentation | Low | 0.5 day | Low |
| 10. Error Handling | Low | 0.5 day | Low |

**Total**: ~8 days (1.6 weeks)

**High-risk steps:**
- Step 3: Embedding search integration (choosing vector store, accuracy tuning)
- Step 6: Team Builder integration (LLM extracting intent, skill suggestion logic)
- Step 8: Migration (capabilities → skills transformation)

**Mitigation:**
- Use FAISS for local vector store (no external deps initially, can swap to Pinecone later)
- Extensive testing on skill suggestion accuracy (measure precision/recall)
- Database backup before migration

---

## Dependencies

**External:**
- PostgreSQL 14+ (skills table, TEXT[] for skills)
- **Vector Store:** FAISS (local) or Pinecone/Weaviate (cloud)
- **Embedding Model:** OpenAI text-embedding-3-small or local model
- Node.js 18+ (TypeScript 5+)

**Internal:**
- Team Service (for agent creation)
- RoleManager/Team Builder (skill suggestion during design)
- AgentManager (skill config merging at runtime)

**MCP Integration:**
Skills work WITH MCP tools, not instead of them:
- **MCP provides:** The "hands" (tools like GitHub API, database connectors)
- **Skills provide:** The "brain" (how to use those tools effectively)
- **Example:** 
  - MCP: Gives access to GitHub API (create PR, comment, merge)
  - Skill: Teaches "our PR review workflow" (what to check, how to comment, when to approve)
  - Agent: Uses MCP tools GUIDED by skill expertise

**Blocks:**
- This feature enables v1.1 (Progressive Disclosure)
- This feature enables v1.2 (Role Templates)
- Required for v1.3 (GitHub Integration)

---

## Success Criteria

✅ **v1.0 Complete When:**
- [ ] Database schema deployed with skills and agent_skills tables
- [ ] 10 official skills seeded with embeddings indexed
- [ ] Semantic search returns relevant skills (>80% accuracy on test queries)
- [ ] Team Builder suggests skills during agent design conversation
- [ ] Agents created with basic + specialized skills (stored in agent_skills table)
- [ ] Frontend shows skill suggestions in Team Builder UI
- [ ] Migration tool converts capabilities → skills (100% success, no data loss)
- [ ] All tests passing (unit, integration, E2E)
- [ ] Documentation updated (product guides + developer docs)

🎯 **Metrics:**
- Semantic search accuracy: >80% (query → relevant skill in top 5)
- Embedding generation time: <100ms per skill
- Team Builder suggests 3-5 relevant skills per agent role
- Skills replace capabilities field (no dual state)
- Migration completes without data loss

---

## Next Steps After v1.0

**v1.1 - Progressive Disclosure:**
- Redis caching for skill descriptions
- Lazy-load `fullConfig` on agent execution
- Context size reduction metrics

**v1.2 - Role Templates:**
- RoleTemplate table + service
- Official role templates (Frontend Dev, QA, etc.)
- Team Builder integration (suggest templates)

**v1.3 - GitHub Integration:**
- Install skills from GitHub repos
- Skill package validation (skill.json schema)
- Registry indexing of GitHub skills

See [feature_architecture.md](../feature_architecture.md) for full roadmap.
