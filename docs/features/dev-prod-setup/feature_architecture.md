# Dev/Prod Environment Setup — Feature Architecture

**Status:** New  
**Date:** March 29, 2026  
**ID:** B3

---

## Overview

Proper environment configuration for dev, staging, and prod. Docker Compose for local services. Environment validation on startup. Deployment-ready configuration that makes future deployment easy.

### Current State
- `.env` file with Azure OpenAI + MongoDB vars
- `start.ps1` script
- No environment validation
- No Docker Compose
- No staging/prod profiles
- MongoDB started via manual `docker run` command

### Target State
- `config/` directory with environment profiles
- Docker Compose for local dev (MongoDB, Hocuspocus, Redis if needed)
- `.env.example` with all required vars documented
- Startup validation — fail fast if required vars missing
- Build targets: `dev`, `staging`, `prod`
- Single command dev startup: `bun run dev` starts everything

---

## Architecture

### Environment Profiles

```
config/
  default.ts     — shared defaults
  development.ts — dev overrides (hot reload, verbose logging, seeding ON)
  staging.ts     — staging overrides (remote services, seeding OFF)
  production.ts  — prod overrides (optimized, no debug, seeding OFF)
```

### Docker Compose (Local Dev)

```yaml
# docker-compose.dev.yml
services:
  mongodb:
    image: mongo:8
    ports: ["27017:27017"]
    volumes: ["mongo-data:/data/db"]
  
  hocuspocus:
    # L2 collaboration server (if deployed separately — D3)
    # For now, part of backend
```

### Startup Validation

```typescript
// packages/backend/config/validate.ts
const required = ['AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT_URL', 'MONGODB_URI'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
}
```

### Build Targets

```json
{
  "scripts": {
    "dev": "docker compose -f docker-compose.dev.yml up -d && bun run dev:backend & bun run dev:frontend",
    "build:staging": "NODE_ENV=staging bun run build:backend",
    "build:prod": "NODE_ENV=production bun run build:backend"
  }
}
```

**Effort:** Low-Medium (1-2 weeks)
