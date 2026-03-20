# Database Documentation

**Database:** MongoDB (via Mongoose)  
**Location:** Configured in `src/worker/db/config.ts`  
**Connection String:** `process.env.MONGODB_URI`

---

## Overview

Ping uses MongoDB for all persistence:
- **Collections:** Skills, Agents, Teams, Users, etc.
- **Vector Search:** MongoDB Atlas Vector Search for semantic skill discovery
- **Schemas:** Mongoose schemas in `src/worker/<module>/schema/`

---

## Getting Started

### 1. Prerequisites

- MongoDB 6.0+ (local or Atlas)
- Node.js 18+
- Environment variables configured

### 2. Setup Environment

Create `.env` file in `src/worker/`:

```bash
MONGODB_URI=mongodb://localhost:27017/ping
# OR for Atlas:
# MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/ping

AZURE_OPENAI_ENDPOINT_URL=https://your-endpoint.openai.azure.com/
AZURE_OPENAI_API_KEY=your-api-key
```

### 3. Install Dependencies

```bash
cd src/worker
npm install
```

### 4. Run Migrations/Seeds

```bash
# Seed official skills (first time)
npm run seed:skills

# Seed all data (skills + sample teams)
npm run seed:all
```

### 5. Verify Connection

```bash
# Start the worker API
npm run start:api

# Check logs for:
# "Connected to MongoDB"
```

---

## Current Schema

### Collections Overview

| Collection | Purpose | Schema File |
|------------|---------|-------------|
| `skills` | Skill metadata + embeddings | `src/worker/skillRegistry/schema/skillSchema.ts` |
| `agent_skills` | Agent → Skill assignments | `src/worker/skillRegistry/schema/agentSkillSchema.ts` |
| `agents` | Agent configurations (agentRegistry) | `src/agentRegistry/schema/agentSchema.ts` |
| `teams` | Team metadata (future) | TBD |
| `users` | User accounts (future) | TBD |

### Skills Collection

**Purpose:** Store skill metadata and vector embeddings for semantic search

**Schema:**
```typescript
{
  _id: ObjectId,
  skillId: string,              // Unique: "security-review"
  name: string,                 // Display: "Security Review"
  description: string,          // Embedded for search (max 1024 chars)
  category: string,             // "security" | "testing" | "code_analysis" | etc.
  version: string,              // "1.0.0"
  
  // Filesystem paths (NOT content - content lives in SKILL.md)
  skillPath: string,            // "/home/user/.ping/skills/security-review/"
  skillMdPath: string,          // "/home/user/.ping/skills/security-review/SKILL.md"
  supportingFiles: string[],    // ["owasp-rules.md", "scripts/run_semgrep.py"]
  
  // Vector embedding (1536 dimensions from text-embedding-3-small)
  embedding: number[],
  
  // Metadata
  author: string,               // "ping-official" | "community"
  source: string,               // "registry" | "github" | "local" | "personal"
  sourceUrl?: string,           // GitHub repo URL
  installCount: number,         // Usage tracking
  rating?: number,              // 0.0 - 5.0
  tags: string[],               // ["security", "owasp", "scanning"]
  
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes:**
```javascript
// Vector search index (Atlas)
{
  name: "skill_vector_search",
  type: "vectorSearch",
  definition: {
    fields: [{
      type: "vector",
      path: "embedding",
      numDimensions: 1536,
      similarity: "cosine"
    }]
  }
}

// Text search
skillId: unique
category: 1
rating: -1 (descending)
tags: 1
```

### Agent Skills Collection

**Purpose:** Many-to-many relationship between agents and skills

**Schema:**
```typescript
{
  _id: ObjectId,
  agentId: string,              // References agents collection
  skillId: string,              // References skills collection
  assignedAt: Date
}
```

**Indexes:**
```javascript
agentId: 1
skillId: 1
{ agentId: 1, skillId: 1 }: unique compound index
```

---

## Common Commands

### MongoDB Atlas CLI

```bash
# List deployments
atlas deployments list

# Connect to deployment
atlas deployment connect <deployment-name>

# Pause deployment (save costs)
atlas clusters pause <cluster-name>

# Resume deployment
atlas clusters start <cluster-name>

# Get connection string
atlas clusters connectionStrings describe <cluster-name>

# Check cluster status
atlas clusters describe <cluster-name>

# Create search index (vector search)
atlas clusters search indexes create <cluster-name> \
  --clusterName <cluster-name> \
  --collection skills \
  --database ping \
  --file vector-index.json
```

### Database Operations

```bash
# Connect to MongoDB (local)
mongosh mongodb://localhost:27017/ping

# Connect to Atlas (via CLI)
atlas deployment connect <deployment-name>

# Connect to Atlas (direct)
mongosh "mongodb+srv://cluster.mongodb.net/ping" --username <user>

# List collections
show collections

# Query skills
db.skills.find().pretty()

# Count documents
db.skills.countDocuments()

# Drop collection (DANGER)
db.skills.drop()
```

### Vector Search

```javascript
// Semantic search for skills
db.skills.aggregate([
  {
    $vectorSearch: {
      queryVector: [0.1, 0.2, ...],  // Embedding from query
      path: "embedding",
      numCandidates: 100,
      limit: 5,
      index: "skill_vector_search"
    }
  },
  {
    $project: {
      skillId: 1,
      name: 1,
      description: 1,
      category: 1,
      score: { $meta: "vectorSearchScore" }
    }
  }
])
```

### Application Code

```typescript
// src/worker/skillRegistry/SkillRegistry.ts

import { SkillModel } from './schema/skillSchema.js';

// Find skills by category
const securitySkills = await SkillModel.find({ category: 'security' });

// Semantic search (via embedding service)
const results = await skillRegistry.searchSkillsBySemantic(
  "I need to scan code for security vulnerabilities"
);

// Assign skill to agent
await skillRegistry.assignSkillToAgent(agentId, skillId);
```

---

## Migration Guide

### From No Database → MongoDB (v1.0)

**Step 1:** Install MongoDB locally or create Atlas cluster

**Step 2:** Configure `MONGODB_URI` in `.env`

**Step 3:** Run seed scripts
```bash
npm run seed:skills
```

**Step 4:** Verify data
```bash
mongosh $MONGODB_URI
> db.skills.countDocuments()
10  // Should return 10 official skills
```

### From Capabilities → Skills (v1.0)

**Migration script:** `src/worker/skillRegistry/scripts/migrateCapsToSkills.ts`

```bash
# Detect skills from existing agent configs
npm run migrate:capabilities

# Dry run (preview changes)
npm run migrate:capabilities -- --dry-run
```

**What it does:**
1. Scans all agent configs for tool patterns
2. Detects matching skills (e.g., Semgrep tool → `security-review` skill)
3. Creates `agent_skills` records
4. Removes duplicated config from agents

---

## Schema Versioning

### Current Version: 1.0

**Skills System schemas:**
- `skills` collection
- `agent_skills` collection
- Vector search index on `skills.embedding`

### Planned Changes (v1.1+)

**v1.1 - Progressive Disclosure:**
- Add `loadCount` field to track skill activation frequency
- Add `lastLoadedAt` timestamp

**v1.2 - Role Templates:**
- New `role_templates` collection
- Link role templates to default skills

**v1.3 - GitHub Integration:**
- Add `githubStars`, `githubForks` to skills
- Add `lastSyncedAt` for GitHub skills

---

## Troubleshooting

### "Cannot connect to MongoDB"

**Check:**
1. MongoDB is running: `sudo systemctl status mongod` (Linux) or Task Manager (Windows)
2. Connection string is correct in `.env`
3. Network access (Atlas IP whitelist)

**Fix:**
```bash
# Restart MongoDB (local)
sudo systemctl restart mongod

# Test connection
mongosh $MONGODB_URI
```

### "Vector search not working"

**Check:**
1. Using MongoDB Atlas (vector search requires Atlas)
2. Index created: `db.skills.getSearchIndexes()`
3. Embeddings populated: `db.skills.findOne({}, {embedding: 1})`

**Fix Option 1 - Via Atlas CLI:**
Create `vector-index.json`:
```json
{
  "name": "skill_vector_search",
  "type": "vectorSearch",
  "definition": {
    "fields": [{
      "type": "vector",
      "path": "embedding",
      "numDimensions": 1536,
      "similarity": "cosine"
    }]
  }
}
```

Then run:
```bash
atlas clusters search indexes create <cluster-name> \
  --clusterName <cluster-name> \
  --collection skills \
  --database ping \
  --file vector-index.json
```

**Fix Option 2 - Via mongosh:**
```javascript
// Create vector search index (Atlas only)
db.skills.createSearchIndex({
  name: "skill_vector_search",
  type: "vectorSearch",
  definition: {
    fields: [{
      type: "vector",
      path: "embedding",
      numDimensions: 1536,
      similarity: "cosine"
    }]
  }
})
```

**Fix Option 3 - Via Atlas UI:**
1. Atlas → Clusters → Your Cluster → Search
2. Create Search Index → Atlas Vector Search
3. Collection: `skills`, Field: `embedding`, Dimensions: `1536`

### "Seeding fails with duplicate key error"

**Cause:** Skills already seeded

**Fix:**
```javascript
// Clear skills collection
db.skills.deleteMany({})

// Re-run seed
npm run seed:skills
```

---

## Performance Tips

### Indexes

Always create indexes on frequently queried fields:

```javascript
// Category filter (common in browse)
db.skills.createIndex({ category: 1 })

// Rating sort (popular skills first)
db.skills.createIndex({ rating: -1 })

// Compound index for agent skills lookup
db.agent_skills.createIndex({ agentId: 1, skillId: 1 }, { unique: true })
```

### Embedding Generation

**Batch embeddings** when seeding to reduce API calls:

```typescript
// Bad: 10 API calls for 10 skills
for (const skill of skills) {
  skill.embedding = await embed(skill.description);
  await SkillModel.create(skill);
}

// Good: 1 API call for 10 skills
const descriptions = skills.map(s => s.description);
const embeddings = await embedBatch(descriptions);
skills.forEach((skill, i) => skill.embedding = embeddings[i]);
await SkillModel.insertMany(skills);
```

### Caching

Use Redis for frequently accessed skills:

```typescript
// Cache skill metadata (30-day TTL)
await redis.set(`skill:${skillId}`, JSON.stringify(skill), 'EX', 60 * 60 * 24 * 30);

// Check cache before database
const cached = await redis.get(`skill:${skillId}`);
if (cached) return JSON.parse(cached);
```

---

## Backup & Recovery

### Backup

```bash
# Full database backup
mongodump --uri=$MONGODB_URI --out=./backup/$(date +%Y%m%d)

# Skills collection only
mongodump --uri=$MONGODB_URI --collection=skills --out=./backup/skills
```

### Restore

```bash
# Restore full database
mongorestore --uri=$MONGODB_URI ./backup/20260115

# Restore skills only
mongorestore --uri=$MONGODB_URI --collection=skills ./backup/skills/ping/skills.bson
```

### Atlas Automated Backups

Atlas provides automated daily backups. Access via:
1. Atlas UI → Clusters → Your Cluster
2. Backup tab
3. Download or restore to new cluster

---

## References

- [MongoDB Documentation](https://www.mongodb.com/docs/)
- [Mongoose Documentation](https://mongoosejs.com/)
- [MongoDB Atlas Vector Search](https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-overview/)
- [Ping Skills Architecture](../../features/skills-system/feature_architecture.md)
