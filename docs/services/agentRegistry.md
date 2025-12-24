# Agent Registry Service

## Overview
The Agent Registry is a standalone service that enables agent discovery, registration, and semantic capability matching using embeddings and vector similarity. It provides a centralized registry for agents across the system, allowing dynamic agent discovery based on required capabilities.

## Location
`src/agentRegistry/`

## Technology Stack
- **Runtime**: Node.js with TypeScript
- **Database**: MongoDB with Mongoose
- **Embeddings**: Azure OpenAI Embeddings (text-embedding-3-small)
- **Vector Search**: Cosine similarity matching
- **Framework**: Express.js for API endpoints

## Architecture

```
AgentRegistry/
├── agentRegistry.ts        # Core registry logic (ServiceRegistry class)
├── index.ts                # Entry point and API server
├── db/                     # Database layer
│   ├── db.ts              # MongoDB connection and schema
│   ├── vectorQuery.ts     # Vector search operations
│   └── dbindex.json       # Database index configuration
├── embedding/              # Embedding generation
├── embeddingClient/        # Azure OpenAI client
├── registiry/              # Registry management
├── schema/                 # Data schemas
├── types/                  # TypeScript type definitions
└── util.ts                 # Utility functions
```

## Core Features

### 1. Agent Registration
Register agents with their capabilities, specializations, and metadata.

### 2. Semantic Discovery
Find agents using natural language queries and capability matching.

### 3. Capability Matching
Match agents based on:
- Semantic similarity of capabilities
- Skill level requirements (basic, intermediate, advanced)
- Coverage of required capabilities

### 4. Vector-based Search
Uses embeddings for semantic understanding beyond keyword matching.

## ServiceRegistry Class

### Core Components

#### Initialization
```typescript
constructor() {
  this.agents = new Map<string, Agent>();
  this.embeddings = new AzureOpenAIEmbeddings({
    azureOpenAIEndpoint: process.env.AZURE_OPENAI_EMBEDDINGS_ENDPOINT_URL!,
    apiKey: process.env.AZURE_OPENAI_EMBEDDINGS_API_KEY!,
    deploymentName: "text-embedding-3-small",
    openAIApiVersion: "2023-05-15"
  });
  this.similarityThreshold = 0.3;
}
```

### Key Methods

#### registerAgent()
Registers a new agent in the registry.

**Signature**:
```typescript
async registerAgent(agent: Omit<Agent, "id" | "status">): Promise<void>
```

**Requirements**:
- Agent must declare at least one capability
- Capabilities include name, description, and level

**Process**:
```typescript
async registerAgent(agent: Omit<Agent, "id" | "status">) {
  // Validate capabilities
  if (!agent.capabilities || agent.capabilities.length === 0) {
    throw new Error("Agent must declare capabilities");
  }
  
  // Generate unique ID
  const agentId = `local-${Date.now()}-${Math.random()
    .toString(36)
    .substr(2, 5)}`;
  
  // Create full agent object
  const newAgent: Agent = {
    ...agent,
    id: agentId,
    status: "available"
  };
  
  // Store agent
  this.agents.set(agentId, newAgent);
  
  // Notify subscribers
  this.notifySubscribers(newAgent);
}
```

**Example**:
```typescript
await registry.registerAgent({
  name: "ResearchAgent",
  description: "Specialized in research and information gathering",
  capabilities: [
    {
      name: "web_research",
      description: "Search and analyze web content",
      level: "advanced"
    },
    {
      name: "data_analysis",
      description: "Analyze and summarize data",
      level: "intermediate"
    }
  ],
  endpoint: "http://localhost:3003",
  protocols: ["http", "websocket"]
});
```

#### discoverAgents()
Discovers agents matching required capabilities.

**Signature**:
```typescript
async discoverAgents(
  requiredCapabilities?: AgentCapability[],
  includeStatus: boolean = false
): Promise<Agent[]>
```

**Process**:
1. Get all agent IDs
2. Fetch agent details in parallel
3. Filter by capabilities if provided
4. Return matching agents

**Example**:
```typescript
const agents = await registry.discoverAgents([
  { name: "web_research", level: "intermediate" }
]);
console.log(agents); // Agents with web_research capability
```

#### filterByCapabilities()
Enhanced capability matching with semantic understanding.

**Signature**:
```typescript
async filterByCapabilities(
  agents: Agent[],
  requiredCapabilities: AgentCapability[]
): Promise<Agent[]>
```

**Process**:
1. Create embeddings for required capabilities
2. Score each agent against requirements
3. Filter by similarity threshold
4. Sort by match score

**Scoring Algorithm**:
```typescript
// For each required capability:
//   1. Find best matching agent capability (cosine similarity)
//   2. Apply level weight (agent level vs required level)
//   3. Calculate capability score = similarity × levelWeight
// 
// Total Score = (Σ capability scores / match count) × coverage
// Where coverage = matched capabilities / total required
```

## Capability System

### AgentCapability Interface
```typescript
interface AgentCapability {
  name: string;              // Capability identifier
  description?: string;      // Detailed description
  level: 'basic' | 'intermediate' | 'advanced';
  parameters?: any;          // Optional parameters
}
```

### Capability Levels

#### 1. Basic
Entry-level proficiency. Can perform fundamental tasks.

**Example**: Basic web search, simple data retrieval

#### 2. Intermediate
Moderate proficiency. Handles complex scenarios.

**Example**: Advanced web scraping, data analysis, API integration

#### 3. Advanced
Expert-level proficiency. Sophisticated operations.

**Example**: Multi-source research, machine learning, complex data pipelines

### Level Matching Weight

```typescript
calculateLevelWeight(agentCap, requiredCap): number {
  const agentLevel = agentCap.level;      // e.g., "advanced"
  const requiredLevel = requiredCap.level; // e.g., "intermediate"
  
  // Agent meets or exceeds required level
  if (agentLevel >= requiredLevel) {
    return 1.0 + (levelGap × 0.1);  // Bonus for higher level
  }
  
  // Agent is below required level
  const gap = requiredLevelIdx - agentLevelIdx;
  return Math.max(0.3, 1.0 - gap × 0.25);  // Penalty
}
```

**Examples**:
- Agent: advanced, Required: intermediate → Weight: 1.1 (bonus)
- Agent: intermediate, Required: intermediate → Weight: 1.0 (perfect)
- Agent: basic, Required: intermediate → Weight: 0.75 (penalty)
- Agent: basic, Required: advanced → Weight: 0.5 (large penalty)

## Semantic Matching

### Embedding Generation

Capabilities are converted to text and embedded:

```typescript
capabilityToText(cap: AgentCapability): string {
  return `${cap.name}: ${cap.description || cap.name} (${cap.level})`;
}
```

**Example**:
```
"web_research: Search and analyze web content (advanced)"
```

### Cosine Similarity

Vector similarity measures semantic closeness:

```typescript
cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}
```

**Returns**: Value between 0 (completely different) and 1 (identical)

### Similarity Threshold

Default threshold: 0.3

- Above 0.5: Strong match
- 0.3 - 0.5: Moderate match
- Below 0.3: Filtered out

## Agent Structure

### Agent Interface
```typescript
interface Agent {
  id: string;                     // Unique identifier
  name: string;                   // Agent name
  description: string;            // Purpose and specialization
  capabilities: AgentCapability[]; // Skills and abilities
  status: 'available' | 'busy' | 'offline';
  endpoint?: string;              // API endpoint
  protocols?: string[];           // Supported protocols (http, ws, etc.)
  metadata?: Record<string, any>; // Additional metadata
}
```

### Example Agent
```typescript
{
  id: "local-1672531200-abc12",
  name: "ResearchAgent",
  description: "Advanced research and analysis specialist",
  capabilities: [
    {
      name: "web_research",
      description: "Deep web research and content analysis",
      level: "advanced"
    },
    {
      name: "data_extraction",
      description: "Extract structured data from unstructured sources",
      level: "intermediate"
    },
    {
      name: "summarization",
      description: "Summarize long-form content",
      level: "advanced"
    }
  ],
  status: "available",
  endpoint: "http://localhost:3003/agent/research",
  protocols: ["http", "websocket"],
  metadata: {
    version: "1.0.0",
    region: "us-east-1",
    maxConcurrency: 5
  }
}
```

## API Endpoints

### POST /agents/register
Register a new agent.

**Request Body**:
```json
{
  "name": "WriterAgent",
  "description": "Content creation specialist",
  "capabilities": [
    {
      "name": "content_writing",
      "description": "Create engaging written content",
      "level": "advanced"
    }
  ],
  "endpoint": "http://localhost:3004"
}
```

**Response**:
```json
{
  "success": true,
  "agentId": "local-1672531200-xyz89"
}
```

### GET /agents/discover
Discover agents by capabilities.

**Query Parameters**:
- `capabilities`: JSON array of required capabilities
- `includeStatus`: Boolean to include status verification

**Example**:
```
GET /agents/discover?capabilities=[{"name":"web_research","level":"intermediate"}]
```

**Response**:
```json
{
  "agents": [
    {
      "id": "local-1672531200-abc12",
      "name": "ResearchAgent",
      "score": 0.95,
      "capabilities": [...]
    }
  ]
}
```

### GET /agents/:id
Get agent details.

**Response**:
```json
{
  "id": "local-1672531200-abc12",
  "name": "ResearchAgent",
  "description": "...",
  "capabilities": [...],
  "status": "available"
}
```

### GET /agents
List all registered agents.

**Response**:
```json
{
  "agents": [
    { "id": "...", "name": "...", "status": "..." },
    { "id": "...", "name": "...", "status": "..." }
  ],
  "total": 2
}
```

## Database Integration

### MongoDB Schema
```typescript
const AgentSchema = new Schema({
  agentId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  description: String,
  capabilities: [{
    name: String,
    description: String,
    level: String,
    embedding: [Number]  // Vector embedding
  }],
  status: { type: String, default: 'available' },
  endpoint: String,
  protocols: [String],
  metadata: Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
```

### Vector Indexing
MongoDB indexes for efficient vector search:

```typescript
db.agents.createIndex({
  "capabilities.embedding": "vector"
}, {
  vectorOptions: {
    dimensions: 1536,  // text-embedding-3-small dimension
    similarity: "cosine"
  }
});
```

## Environment Configuration

Required environment variables (`.env`):

```env
# Azure OpenAI Embeddings
AZURE_OPENAI_EMBEDDINGS_ENDPOINT_URL=https://your-endpoint.openai.azure.com
AZURE_OPENAI_EMBEDDINGS_API_KEY=your-api-key
AZURE_OPENAI_EMBEDDINGS_INSTANCE_NAME=your-instance-name

# MongoDB
MONGODB_URI=mongodb://localhost:27017/agentregistry
MONGODB_DATABASE=agentregistry

# Server
PORT=3005
```

## Usage Examples

### Register an Agent
```typescript
import { ServiceRegistry } from './agentRegistry';

const registry = new ServiceRegistry();

await registry.registerAgent({
  name: "DataAnalysisAgent",
  description: "Specialized in data analysis and visualization",
  capabilities: [
    {
      name: "data_analysis",
      description: "Statistical analysis and insights",
      level: "advanced"
    },
    {
      name: "data_visualization",
      description: "Create charts and graphs",
      level: "intermediate"
    }
  ],
  endpoint: "http://localhost:3006",
  protocols: ["http"]
});
```

### Discover Agents
```typescript
// Find agents with specific capabilities
const agents = await registry.discoverAgents([
  { name: "data_analysis", level: "intermediate" },
  { name: "web_research", level: "basic" }
]);

console.log(`Found ${agents.length} matching agents`);
agents.forEach(agent => {
  console.log(`- ${agent.name}: ${agent.description}`);
});
```

### Filter by Capabilities
```typescript
// Get all agents
const allAgents = await registry.discoverAgents();

// Filter with semantic matching
const filtered = await registry.filterByCapabilities(allAgents, [
  { 
    name: "research", 
    description: "Can search and analyze information",
    level: "advanced" 
  }
]);

console.log('Top matches:', filtered.slice(0, 3));
```

## Integration with Worker System

### Dynamic Agent Discovery
```typescript
// In AgentManager
class AgentManager {
  async discoverAndRegisterAgents(requiredCapabilities: AgentCapability[]) {
    // Discover agents from registry
    const agents = await registryClient.discoverAgents(requiredCapabilities);
    
    // Register as workers
    for (const agent of agents) {
      await this.roleManager.registerExternalAgent(agent);
    }
  }
}
```

### Capability-Based Routing
```typescript
// Route task to best-match agent
async routeTask(task: Task) {
  const requiredCaps = this.analyzeTaskCapabilities(task);
  const agents = await registry.filterByCapabilities(allAgents, requiredCaps);
  
  if (agents.length > 0) {
    return agents[0]; // Best match
  }
  
  throw new Error('No suitable agent found');
}
```

## Best Practices

### 1. Detailed Capability Descriptions
```typescript
// ✅ Good
{
  name: "web_research",
  description: "Search web sources, analyze content, extract insights, verify facts",
  level: "advanced"
}

// ❌ Poor
{
  name: "research",
  level: "intermediate"
}
```

### 2. Appropriate Skill Levels
- Don't overstate: basic → advanced
- Be honest about capabilities
- Consider user requirements

### 3. Regular Status Updates
```typescript
// Update agent status
await registry.updateAgentStatus(agentId, 'busy');
// ... work ...
await registry.updateAgentStatus(agentId, 'available');
```

### 4. Comprehensive Metadata
```typescript
metadata: {
  version: "1.2.0",
  maxConcurrency: 3,
  avgResponseTime: 500,  // ms
  successRate: 0.98,
  region: "us-east-1",
  costPerRequest: 0.001
}
```

## Testing

### Unit Test Example
```typescript
describe('ServiceRegistry', () => {
  let registry: ServiceRegistry;
  
  beforeEach(() => {
    registry = new ServiceRegistry();
  });
  
  it('should register agent', async () => {
    await registry.registerAgent({
      name: 'TestAgent',
      description: 'Test',
      capabilities: [
        { name: 'test', level: 'basic' }
      ]
    });
    
    const agents = await registry.discoverAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('TestAgent');
  });
  
  it('should match capabilities semantically', async () => {
    // Register agents with different capabilities
    await registry.registerAgent({
      name: 'ResearchAgent',
      capabilities: [
        { 
          name: 'web_search',
          description: 'Search internet for information',
          level: 'advanced'
        }
      ]
    });
    
    // Search with related but different term
    const agents = await registry.discoverAgents([
      {
        name: 'research',
        description: 'Find information online',
        level: 'intermediate'
      }
    ]);
    
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('ResearchAgent');
  });
});
```

## Performance Optimization

### Caching
```typescript
// Cache embeddings to avoid regeneration
private embeddingCache = new Map<string, number[]>();

async getEmbedding(text: string): Promise<number[]> {
  if (this.embeddingCache.has(text)) {
    return this.embeddingCache.get(text)!;
  }
  
  const embedding = await this.embeddings.embedDocuments([text]);
  this.embeddingCache.set(text, embedding[0]);
  return embedding[0];
}
```

### Batch Processing
```typescript
// Embed multiple capabilities at once
const texts = capabilities.map(this.capabilityToText);
const embeddings = await this.embeddings.embedDocuments(texts);
```

### Index Optimization
```typescript
// MongoDB compound index
db.agents.createIndex({ 
  "status": 1, 
  "capabilities.level": 1 
});
```

## Troubleshooting

### No Agents Found
- Check similarity threshold (try lowering from 0.3)
- Verify capability descriptions are detailed
- Ensure embeddings are generated correctly

### Low Match Scores
- Improve capability descriptions
- Adjust level requirements
- Check semantic similarity manually

### Performance Issues
- Enable embedding caching
- Use batch operations
- Optimize MongoDB indexes

## Future Enhancements

1. **Multi-tenancy**: Separate registries per organization
2. **Agent Reputation**: Track success rates and ratings
3. **Load Balancing**: Distribute tasks across similar agents
4. **Auto-scaling**: Dynamically spawn agents based on demand
5. **Federation**: Discover agents across multiple registries
6. **Versioning**: Support multiple versions of same agent
7. **Health Monitoring**: Periodic health checks
8. **Cost Optimization**: Route to cost-effective agents

## Related Documentation

- [Backend Worker System](../backend/README.md)
- [Agent Types](../../types/agent.ts)
- [Database Schema](./db/db.ts)
