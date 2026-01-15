# RAG (Retrieval-Augmented Generation) Opportunities in Ping

**Date:** January 15, 2026  
**Purpose:** Identify all places in Ping where RAG/embedding search can improve search, discovery, and recommendations

---

## Overview

RAG is beneficial when:
1. **Semantic search** is needed (not just keyword matching)
2. **Finding similar items** (skills, tasks, artifacts, code examples)
3. **Natural language queries** ("find agent that can review security" vs exact filters)
4. **Large knowledge bases** (documentation, codebases, artifact history)
5. **Context retrieval** for LLM prompts (relevant docs, similar tasks, best practices)

---

## 1. Skill Discovery (✅ Already Implemented)

**Current Status:** RAG-based semantic search implemented in Skills System v1.0

**Implementation:**
```typescript
// Embedding search for skills
async searchSkillsBySemantic(query: string): Promise<Skill[]> {
  const queryEmbedding = await embed(query);
  const results = await vectorStore.query(queryEmbedding, limit);
  return getSkillsByIds(results.map(r => r.id));
}
```

**Use Cases:**
- Team Builder: "I need security review capabilities" → finds `security-review`, `vulnerability-scanning`, `code-analysis` skills
- Natural language queries replace rigid category filters

**Files:**
- `docs/features/skills-system/feature_architecture.md`
- `docs/features/skills-system/v1.0/feature_implementation_planning.md`

---

## 2. Agent Discovery/Registry (✅ Partially Implemented)

**Current Status:** Vector search exists in `src/agentRegistry/db/vectorQuery.ts`

**Enhancement Needed:** Expand to semantic agent discovery

**Current Implementation:**
```typescript
// Already has vector search infrastructure
performVectorQuery(searchQuery: SearchQuery): Promise<Document[]>
// Uses MongoDB Atlas Vector Search with embeddings
```

**Enhancement Opportunities:**

### 2a. Semantic Agent Search
```typescript
// Natural language agent discovery
async findAgentsByCapability(query: string): Promise<Agent[]> {
  // "find agent that can write Python code and deploy to AWS"
  const queryEmbedding = await embed(query);
  return vectorStore.query(queryEmbedding);
}
```

### 2b. Similar Agent Recommendations
```typescript
// Find agents similar to a given agent
async findSimilarAgents(agentId: string): Promise<Agent[]> {
  const agent = await getAgent(agentId);
  const agentEmbedding = await embed(agent.description + agent.capabilities);
  return vectorStore.query(agentEmbedding, { exclude: [agentId] });
}
```

**Files:**
- `src/agentRegistry/db/vectorQuery.ts` (infrastructure exists)
- `src/agentRegistry/agentRegistry.ts` (add semantic search methods)
- `src/roleManager/role-manager.ts` (use for agent assignment)

**Benefits:**
- RoleManager can find best agent via natural language
- "Find agent with React expertise and API integration experience"
- Discover agents you didn't know existed

---

## 3. Task Search & Similar Tasks

**Current Status:** No semantic search (only SQL queries by status, role, etc.)

**Enhancement Needed:** RAG-based task discovery

**Opportunities:**

### 3a. Similar Task Retrieval
```typescript
// Find similar tasks from history
async findSimilarTasks(taskDescription: string): Promise<Task[]> {
  const queryEmbedding = await embed(taskDescription);
  return vectorStore.query(queryEmbedding, { collection: 'tasks' });
}

// Use case: Reuse task breakdowns
// New task: "Build login page"
// Finds: Previous "Build registration page" task
// Reuse: Similar subtask structure, agent assignments
```

### 3b. Task Template Suggestions
```typescript
// Suggest task templates based on description
async suggestTaskTemplates(goal: string): Promise<TaskTemplate[]> {
  const similar = await findSimilarTasks(goal);
  return extractTemplates(similar); // Common patterns
}
```

**Files:**
- `src/worker/memoryManager/MemoryManager.ts` (add semantic search)
- `src/worker/agentManager/agentBuilder/PlanBuilder.ts` (use for planning)

**Benefits:**
- Learn from past executions
- Suggest optimal task breakdowns
- Identify similar goals ("We've done this before!")

---

## 4. Artifact Search & Discovery

**Current Status:** Basic full-text search in `docs/product/ping/api/artifact-api.md`

**Current Implementation:**
```typescript
GET /teams/{teamId}/artifacts/search?q=security
// Returns: Keyword matches with highlights
```

**Enhancement Needed:** Semantic artifact search

**Opportunities:**

### 4a. Semantic Artifact Search
```typescript
// Natural language artifact queries
async searchArtifacts(query: string, teamId: string): Promise<Artifact[]> {
  // "find documents about security best practices"
  // "show code that uses JWT authentication"
  const queryEmbedding = await embed(query);
  return vectorStore.query(queryEmbedding, { 
    filter: { teamId, type: ['document', 'code'] }
  });
}
```

### 4b. Related Artifacts
```typescript
// Find artifacts related to current work
async getRelatedArtifacts(artifactId: string): Promise<Artifact[]> {
  const artifact = await getArtifact(artifactId);
  const embedding = await embed(artifact.content);
  return vectorStore.query(embedding, { exclude: [artifactId] });
}
```

### 4c. Code Similarity Search
```typescript
// Find similar code snippets
async findSimilarCode(codeSnippet: string): Promise<Artifact[]> {
  const embedding = await embed(codeSnippet);
  return vectorStore.query(embedding, { filter: { type: 'code' } });
}
```

**Files:**
- `src/worker/artifactStore/` (create this directory)
- `docs/product/ping/api/artifact-api.md` (document semantic search endpoints)

**Benefits:**
- "Find all security-related documents" (semantic, not keyword)
- Discover reusable code patterns
- Context-aware artifact recommendations

---

## 5. Documentation Search (Internal & User-Facing)

**Current Status:** No semantic search for docs

**Enhancement Needed:** RAG for documentation Q&A

**Opportunities:**

### 5a. Developer Documentation RAG
```typescript
// Answer questions about the codebase
async askDocumentation(question: string): Promise<string> {
  // "How do I create a new agent?"
  // "What's the difference between Team Builder and Orchestrator?"
  
  const queryEmbedding = await embed(question);
  const relevantDocs = await vectorStore.query(queryEmbedding, {
    collection: 'documentation'
  });
  
  // Feed to LLM with retrieved context
  return llm.invoke({
    context: relevantDocs.map(d => d.content).join('\n\n'),
    question
  });
}
```

### 5b. User Guide Search
```typescript
// Help users find relevant guides
async searchUserGuides(query: string): Promise<Guide[]> {
  // "how to set up a team"
  // "best practices for agent design"
  const queryEmbedding = await embed(query);
  return vectorStore.query(queryEmbedding, {
    collection: 'user_guides'
  });
}
```

**Files:**
- `docs/product/ping/guides/*.md` (index all user guides)
- `docs/developer-guide/**/*.md` (index dev docs)
- Create: `src/worker/documentationRAG/` service

**Benefits:**
- Conversational documentation search
- Context-aware help ("Based on your setup, try...")
- Reduce support load (self-service answers)

---

## 6. Role Templates & Team Design Suggestions

**Current Status:** No semantic search for role templates (planned for Skills System v1.2)

**Enhancement Needed:** RAG for team composition suggestions

**Opportunities:**

### 6a. Role Template Discovery
```typescript
// Find role templates by description
async findRoleTemplates(description: string): Promise<RoleTemplate[]> {
  // "I need someone who can build React components and write tests"
  const queryEmbedding = await embed(description);
  return vectorStore.query(queryEmbedding, {
    collection: 'role_templates'
  });
}
```

### 6b. Team Composition Suggestions
```typescript
// Suggest optimal team based on goal
async suggestTeamComposition(goal: string): Promise<{
  roles: RoleTemplate[];
  reasoning: string;
}> {
  // "Build an e-commerce website"
  // Returns: [Frontend Dev, Backend Dev, Database Expert, QA Engineer]
  
  const similarGoals = await findSimilarTasks(goal); // RAG on past goals
  const commonRoles = extractCommonRoles(similarGoals);
  
  return {
    roles: commonRoles,
    reasoning: `Based on ${similarGoals.length} similar projects...`
  };
}
```

**Files:**
- `src/worker/roleManager/RoleManager.ts` (add team suggestion)
- `docs/features/skills-system/feature_architecture.md` (Role Templates section)

**Benefits:**
- Learn from past team configurations
- "Teams that built similar products used these roles"
- Prevent common team composition mistakes

---

## 7. Error & Troubleshooting RAG

**Current Status:** No semantic search for errors/solutions

**Enhancement Needed:** RAG for debugging assistance

**Opportunities:**

### 7a. Similar Error Search
```typescript
// Find similar errors and solutions
async findSimilarErrors(errorMessage: string): Promise<{
  error: Error;
  solution: string;
  source: string;
}[]> {
  const queryEmbedding = await embed(errorMessage);
  return vectorStore.query(queryEmbedding, {
    collection: 'error_solutions'
  });
}
```

### 7b. Contextual Debugging Help
```typescript
// Get debugging suggestions based on context
async getDebuggingHelp(context: {
  error: string;
  stackTrace: string;
  agentRole: string;
  taskDescription: string;
}): Promise<string> {
  // Retrieve similar debugging sessions
  const similar = await findSimilarErrors(context.error);
  
  // LLM generates contextual advice
  return llm.invoke({
    similarErrors: similar,
    currentContext: context,
    prompt: "Suggest debugging steps..."
  });
}
```

**Files:**
- Create: `src/worker/debuggingRAG/` service
- `docs/product/ping/guides/troubleshooting.md` (new file with RAG search)

**Benefits:**
- "This error happened before, here's what worked"
- Context-aware debugging suggestions
- Build institutional knowledge

---

## 8. MCP Server Discovery

**Current Status:** Keyword-based MCP discovery mentioned in guides

**Enhancement Needed:** Semantic MCP recommendation

**Opportunities:**

### 8a. MCP Server Semantic Search
```typescript
// Find MCP servers by capability description
async findMCPServers(capability: string): Promise<MCPServer[]> {
  // "I need to interact with GitHub pull requests"
  const queryEmbedding = await embed(capability);
  return vectorStore.query(queryEmbedding, {
    collection: 'mcp_servers'
  });
}
```

### 8b. MCP Server Recommendations
```typescript
// Recommend MCP servers for agent role
async recommendMCPServers(role: RoleTemplate): Promise<MCPServer[]> {
  const roleDescription = `${role.name}: ${role.description}`;
  const queryEmbedding = await embed(roleDescription);
  return vectorStore.query(queryEmbedding, {
    collection: 'mcp_servers',
    limit: 5
  });
}
```

**Files:**
- `src/worker/mcpRegistry/` (create service)
- `docs/product/ping/guides/designing-agents.md` (update MCP section)

**Benefits:**
- "For this role, you'll probably need these MCP servers"
- Discover MCP servers you didn't know existed
- Automatic tool suggestions during agent design

---

## 9. Workspace/Git History RAG

**Current Status:** No semantic search on workspace content

**Enhancement Needed:** RAG for code/doc history

**Opportunities:**

### 9a. Codebase Q&A
```typescript
// Answer questions about the workspace
async askCodebase(question: string, workspaceId: string): Promise<string> {
  // "Where is authentication implemented?"
  // "Show me examples of API error handling"
  
  const relevantCode = await searchWorkspace(question, workspaceId);
  
  return llm.invoke({
    code: relevantCode,
    question,
    prompt: "Answer based on this codebase..."
  });
}
```

### 9b. Git Commit Context Retrieval
```typescript
// Find related commits
async findRelatedCommits(description: string): Promise<Commit[]> {
  const queryEmbedding = await embed(description);
  return vectorStore.query(queryEmbedding, {
    collection: 'commits'
  });
}
```

**Files:**
- Create: `src/worker/workspaceRAG/` service
- Integration with Git workspace in team-service

**Benefits:**
- "What changed when we added authentication?"
- Contextual code understanding
- Onboarding new team members ("Here's how we handle X")

---

## 10. Planner Agent Context Retrieval

**Current Status:** Planner Agent uses MemoryManager for task tracking

**Enhancement Needed:** RAG for planning context

**Opportunities:**

### 10a. Relevant Task History
```typescript
// Retrieve relevant past tasks for planning
async getPlanningContext(goal: string): Promise<{
  similarGoals: Task[];
  successfulStrategies: string[];
  commonPitfalls: string[];
}> {
  const similarGoals = await findSimilarTasks(goal);
  const successful = similarGoals.filter(t => t.status === 'completed');
  const failed = similarGoals.filter(t => t.status === 'failed');
  
  return {
    similarGoals: successful,
    successfulStrategies: extractStrategies(successful),
    commonPitfalls: extractPitfalls(failed)
  };
}
```

### 10b. Best Practices Retrieval
```typescript
// Get relevant best practices for goal
async getBestPractices(goal: string): Promise<string[]> {
  const queryEmbedding = await embed(goal);
  const practices = await vectorStore.query(queryEmbedding, {
    collection: 'best_practices'
  });
  return practices.map(p => p.content);
}
```

**Files:**
- `src/worker/agentManager/PlannerAgent.ts` (enhance with RAG)
- `src/worker/agentManager/agentBuilder/PlanBuilder.ts` (use RAG context)

**Benefits:**
- Planner learns from past executions
- "Last time we did this, X worked well"
- Avoid repeating mistakes

---

## 11. Agent Collaboration History

**Current Status:** No semantic search on collaboration patterns

**Enhancement Needed:** RAG for team dynamics insights

**Opportunities:**

### 11a. Collaboration Pattern Discovery
```typescript
// Find successful agent collaboration patterns
async findSuccessfulPatterns(roles: string[]): Promise<{
  pattern: string;
  efficiency: number;
  tasks: Task[];
}[]> {
  const rolesStr = roles.join(' + ');
  const queryEmbedding = await embed(rolesStr);
  return vectorStore.query(queryEmbedding, {
    collection: 'collaboration_patterns'
  });
}
```

### 11b. Communication Bottleneck Detection
```typescript
// Identify communication issues
async analyzeTeamDynamics(teamId: string): Promise<{
  bottlenecks: string[];
  suggestions: string[];
}> {
  const messages = await getTeamMessages(teamId);
  const embedding = await embed(messages.join(' '));
  
  const similarTeams = await vectorStore.query(embedding, {
    collection: 'team_dynamics'
  });
  
  return analyzeDynamics(similarTeams);
}
```

**Files:**
- Create: `src/worker/collaborationAnalytics/` service
- `src/worker/agentManager/AgentManager.ts` (integrate insights)

**Benefits:**
- "These roles work well together"
- Detect communication issues early
- Optimize team composition

---

## 12. Approval Workflow Context

**Current Status:** Approval/governance planned but not implemented

**Enhancement Needed:** RAG for approval decisions

**Opportunities:**

### 12a. Similar Approval Cases
```typescript
// Find similar artifacts that were approved/rejected
async findSimilarApprovals(artifactId: string): Promise<{
  artifact: Artifact;
  decision: 'approved' | 'rejected';
  reason: string;
}[]> {
  const artifact = await getArtifact(artifactId);
  const embedding = await embed(artifact.content);
  
  return vectorStore.query(embedding, {
    collection: 'approval_history'
  });
}
```

### 12b. Approval Recommendations
```typescript
// Suggest approval decision based on history
async suggestApprovalDecision(artifactId: string): Promise<{
  decision: 'approve' | 'reject' | 'needs_changes';
  confidence: number;
  reasoning: string;
}> {
  const similar = await findSimilarApprovals(artifactId);
  const llmSuggestion = await llm.invoke({
    similar,
    artifact: await getArtifact(artifactId)
  });
  
  return llmSuggestion;
}
```

**Files:**
- `docs/features/approval-governance/` (future feature)
- Create: `src/worker/approvalRAG/` service

**Benefits:**
- Consistent approval decisions
- "Similar code was rejected because..."
- Learn organizational standards

---

## Implementation Priority

### High Priority (Immediate Value)
1. **Skill Discovery** (✅ Already planned in Skills System v1.0)
2. **Agent Discovery** (Enhance existing vector search)
3. **Task Search** (Reuse past task structures)
4. **Artifact Search** (Find relevant code/docs)

### Medium Priority (V1.1-V1.2)
5. **Documentation RAG** (Self-service help)
6. **Role Template Discovery** (Team composition suggestions)
7. **MCP Server Discovery** (Tool recommendations)

### Low Priority (V2.0+)
8. **Error/Troubleshooting RAG** (Debugging assistance)
9. **Workspace RAG** (Codebase Q&A)
10. **Planner Context Retrieval** (Planning insights)
11. **Collaboration Analytics** (Team dynamics)
12. **Approval Workflow RAG** (Decision support)

---

## Technical Considerations

### Vector Store Options
1. **FAISS** (local, no external deps, good for MVP)
2. **Pinecone** (cloud, production-ready, $70/month)
3. **Weaviate** (self-hosted, more control)
4. **MongoDB Atlas** (✅ already using for agent registry)

### Embedding Models
1. **OpenAI text-embedding-3-small** ($0.02/1M tokens) - Recommended
2. **Voyage AI** (better for code, $0.12/1M tokens)
3. **Local models** (sentence-transformers, free but slower)

### RAG Architecture Pattern
```typescript
// Standard RAG flow
async function ragQuery(query: string, options: {
  collection: string;
  filter?: object;
  limit?: number;
}): Promise<RAGResponse> {
  // 1. Embed query
  const queryEmbedding = await embeddings.embed(query);
  
  // 2. Vector similarity search
  const relevant = await vectorStore.query(queryEmbedding, options);
  
  // 3. Rerank (optional)
  const reranked = await reranker.rerank(query, relevant);
  
  // 4. LLM generation with context
  const response = await llm.invoke({
    context: reranked.map(r => r.content).join('\n\n'),
    query
  });
  
  return { answer: response, sources: reranked };
}
```

### Performance Targets
- Embedding generation: <100ms per query
- Vector search: <200ms for top 20 results
- End-to-end RAG query: <1s (embedding + search + LLM)
- Index update: <5s for new documents

---

## Next Steps

1. **Skills System v1.0** - Complete RAG-based skill discovery (✅ in progress)
2. **Agent Registry Enhancement** - Expand vector search to semantic agent discovery
3. **Task RAG Service** - Create service for similar task retrieval
4. **Artifact RAG Service** - Semantic artifact search
5. **Documentation RAG** - Index docs and create Q&A service

---

## Conclusion

RAG opportunities exist throughout Ping:
- **Discovery** (skills, agents, tasks, artifacts, docs, MCP servers)
- **Recommendations** (team composition, tools, best practices)
- **Context Retrieval** (planning, debugging, approvals)
- **Q&A** (documentation, codebase, troubleshooting)

**Key Insight:** Every search/filter operation is a candidate for RAG enhancement. Replace rigid filters with semantic queries for better UX.

**Implementation Strategy:** Start with highest-value, lowest-complexity (Skills Discovery ✅), then expand to other domains incrementally.
