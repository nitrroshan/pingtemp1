# ─── Backend Dockerfile ───────────────────────────────────────────────────────
# Multi-stage build: installs deps + compiles TypeScript in builder,
# copies only the built artifacts to the final image.
# ─────────────────────────────────────────────────────────────────────────────

# Stage 1: builder
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package.json bun.lockb ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/teams/package.json ./packages/teams/
COPY packages/agent-manager/package.json ./packages/agent-manager/

# Install dependencies (workspace-aware)
RUN bun install --frozen-lockfile

# Copy source
COPY packages/backend ./packages/backend
COPY packages/teams ./packages/teams
COPY packages/agent-manager ./packages/agent-manager
COPY tsconfig.json ./

# Build backend (tsc compile + copy agent YAML)
WORKDIR /app/packages/backend
RUN bun run build

# Stage 2: runtime
FROM oven/bun:1-slim AS runtime

WORKDIR /app

# Copy compiled output from builder
COPY --from=builder /app/packages/backend/dist ./dist
COPY --from=builder /app/packages/backend/package.json ./
COPY --from=builder /app/node_modules ./node_modules

# Create workspaces directory
RUN mkdir -p /app/data/workspaces

EXPOSE 3002

CMD ["bun", "dist/server.js"]
