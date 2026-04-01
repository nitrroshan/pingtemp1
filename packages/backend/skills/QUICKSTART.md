# Skills System v1.0 - Quick Start Guide

**Branch:** `feature/skills-system-v1.0`  
**Status:** Step 1 Complete (Database Schema & Types)

---

## What We Just Created

### 1. Database Documentation
📄 **Location:** [docs/backend/database/README.md](../../../docs/backend/database/README.md)

**Covers:**
- MongoDB connection setup
- Current schema (skills, agent_skills)
- Common commands (mongosh, queries, indexes)
- Vector search guide
- Troubleshooting
- Backup & recovery

### 2. MongoDB Schemas

#### Skills Collection
📄 **Schema:** [src/worker/skillRegistry/schema/skillSchema.ts](../schema/skillSchema.ts)

```typescript
{
  skillId: "security-review",          // Unique identifier
  name: "Security Review",              // Display name
  description: "Reviews code for...",   // Embedded for search
  category: "security",                 // Filter category
  embedding: [0.023, -0.891, ...],     // 1536-dim vector
  skillPath: "~/.ping/skills/...",     // Filesystem location
  // ... metadata
}
```

**Indexes:**
- `skillId` (unique)
- `category`, `rating`, `tags`, `author`, `source`
- Vector search index (Atlas) on `embedding`

#### Agent Skills Collection
📄 **Schema:** [src/worker/skillRegistry/schema/agentSkillSchema.ts](../schema/agentSkillSchema.ts)

```typescript
{
  agentId: "agent-123",
  skillId: "security-review",
  assignedAt: Date
}
```

**Indexes:**
- `agentId`, `skillId`
- Compound unique: `(agentId, skillId)`

### 3. TypeScript Types
📄 **Types:** [src/worker/skillRegistry/types/](../types/)

- `Skill` - Full skill with embedding
- `SkillMetadata` - Level 1 (Discovery)
- `SkillWithInstructions` - Level 2 (Activation)
- `AgentSkill` - Assignment record
- `SkillCategory`, `SkillSource` - Enums

### 4. Seeding Script
📄 **Script:** [src/worker/skillRegistry/scripts/seedOfficialSkills.ts](../scripts/seedOfficialSkills.ts)

**Creates 10 official skills:**
1. security-review
2. code-review
3. performance-analysis
4. api-testing
5. database-migration
6. documentation-writer
7. ci-cd-setup
8. ui-component-builder
9. unit-test-writer
10. error-debugger

### 5. Embedding Service
📄 **Service:** [src/worker/skillRegistry/services/EmbeddingService.ts](../services/EmbeddingService.ts)

**Functions:**
- `generateEmbedding(text)` - Single embedding
- `generateEmbeddings(texts[])` - Batch embeddings
- `cosineSimilarity(a, b)` - Similarity calculation

---

## How to Test

### Step 1: Configure Environment

```bash
cd src/worker
cp .env.example .env
```

**Edit `.env`:**
```bash
MONGODB_URI=mongodb://localhost:27017/ping
# OR for Atlas:
# MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/ping

# Azure OpenAI Embeddings (used by OAIEmbeddingClient)
AZURE_OPENAI_EMBEDDINGS_ENDPOINT_URL=https://your-endpoint.openai.azure.com/
AZURE_OPENAI_EMBEDDINGS_API_KEY=your-key
AZURE_OPENAI_EMBEDDINGS_INSTANCE_NAME=text-embedding-3-small
```

### Step 2: Install Dependencies

```bash
npm install
# OR
yarn install
```

### Step 3: Build TypeScript

```bash
npm run build
```

### Step 4: Seed Skills

```bash
npm run seed:skills
```

**Expected output:**
```
[INFO] Starting skill seeding...
[INFO] Generating embeddings for 10 skills...
[INFO]   Generated embedding for: Reviews code for security vulnerabilities...
[INFO]   Generated embedding for: Reviews code for best practices...
...
[INFO] Inserting skills into database...
[INFO] Successfully seeded 10 official skills

✅ Seeding complete!
Skills by category:
  security: 1
  code_analysis: 2
  performance: 1
  testing: 2
  database: 1
  documentation: 1
  devops: 1
  ui: 1
```

### Step 5: Verify in MongoDB

```bash
mongosh $MONGODB_URI
```

```javascript
> show collections
agent_skills
skills

> db.skills.countDocuments()
10

> db.skills.findOne({}, { skillId: 1, name: 1, category: 1, embedding: 1 })
{
  _id: ObjectId("..."),
  skillId: "security-review",
  name: "Security Review",
  category: "security",
  embedding: [0.023, -0.891, 0.145, ...]  // 1536 numbers
}

> db.skills.find({}, { skillId: 1, name: 1 }).pretty()
```

### Step 6: Create Vector Search Index (Atlas Only)

**If using MongoDB Atlas:**

```javascript
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

**OR via Atlas UI:**
1. Go to Atlas → Your Cluster → Search
2. Click "Create Search Index"
3. Choose "Atlas Vector Search"
4. Select `skills` collection
5. Field: `embedding`, Dimensions: `1536`, Similarity: `cosine`

---

## Next Steps

### Step 2: SkillRegistry Service (Next)
📄 **Plan:** [feature_implementation_planning.md](../../features/skills-system/v1.0/feature_implementation_planning.md#step-3-skillregistry-service-with-embedding-search-2-days)

**Will implement:**
- `SkillRegistry.ts` - Service class
- `searchSkillsBySemantic(query)` - Vector search
- `loadSkillMetadata()` - Level 1 loading
- `getSkill(skillId)` - Full skill retrieval
- `assignSkillToAgent(agentId, skillId)` - Assignment

### Step 3-9: Remaining Implementation
- Official skills (SKILL.md files)
- Team Builder integration
- Frontend UI
- Migration tool
- Tests
- Documentation

---

## Troubleshooting

### "Cannot find module '@langchain/openai'"

**Fix:**
```bash
cd src/worker
npm install
```

### "MONGODB_URI not defined"

**Fix:**
```bash
cp .env.example .env
# Edit .env and add MONGODB_URI
```

### "Failed to generate embedding"

**Fix:**
```bash
# Check Azure OpenAI credentials in .env
# Verify deployment name matches text-embedding-3-small
```

### "Seeding fails with duplicate key"

**Fix:**
```bash
mongosh $MONGODB_URI
> db.skills.deleteMany({})
> exit

npm run seed:skills
```

---

## Files Created

```
docs/backend/database/
  └── README.md                                    # Database documentation

src/worker/skillRegistry/
  ├── schema/
  │   ├── skillSchema.ts                          # Skills collection schema
  │   └── agentSkillSchema.ts                     # Agent-skill assignments
  ├── types/
  │   ├── Skill.ts                                # Skill type definitions
  │   ├── AgentSkill.ts                           # Assignment type
  │   └── index.ts                                # Barrel export
  ├── services/
  │   └── EmbeddingService.ts                     # Vector embedding generation
  └── scripts/
      └── seedOfficialSkills.ts                   # Seed 10 official skills
```

**Modified:**
```
src/worker/package.json                           # Added seed:skills script
```

---

## Commit This Work

```bash
git status
git add .
git commit -m "feat(skills): add database schemas and seeding

- Add MongoDB schemas for skills and agent_skills
- Create 10 official skills with embeddings
- Add EmbeddingService for vector generation
- Add comprehensive database documentation
- Add seeding script: npm run seed:skills

Step 1 of Skills System v1.0 complete.
"
```

---

## Success Criteria ✅

**Step 1 Complete When:**
- [x] Database schemas created (skillSchema.ts, agentSkillSchema.ts)
- [x] TypeScript types defined (Skill, AgentSkill, SkillCategory)
- [x] 10 official skills defined with metadata
- [x] Seeding script creates skills with embeddings
- [x] Comprehensive documentation (database README)
- [x] npm scripts added for seeding
- [ ] **Next:** Test seeding locally (you do this!)

---

**Ready to test!** Run `npm run seed:skills` to verify everything works.
