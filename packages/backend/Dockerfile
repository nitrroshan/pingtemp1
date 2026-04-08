# Stage 1: Install dependencies and build
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy workspace root files needed for bun install
COPY package.json bunfig.toml ./
COPY packages/backend/package.json packages/backend/package.json
# Copy all workspace package.json files so bun resolves workspace deps
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/registry/package.json packages/registry/package.json
COPY packages/agent-manager/package.json packages/agent-manager/package.json
COPY packages/collaboration/package.json packages/collaboration/package.json
COPY packages/workspace/package.json packages/workspace/package.json
COPY packages/knowledge/package.json packages/knowledge/package.json

RUN bun install --frozen-lockfile

# Copy backend source + workspace package sources (consumed as TS by bun)
COPY packages/backend/ packages/backend/
COPY packages/agent-manager/ packages/agent-manager/
COPY packages/collaboration/ packages/collaboration/
COPY packages/workspace/ packages/workspace/
COPY packages/knowledge/ packages/knowledge/
COPY tsconfig.json tsconfig.json

# Build
WORKDIR /app/packages/backend
RUN bun run build

# Stage 2: Slim production runtime
FROM oven/bun:1-slim AS runtime

WORKDIR /app

# Copy only what's needed to run
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/backend/node_modules ./packages/backend/node_modules
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=builder /app/packages/backend/package.json ./packages/backend/package.json
COPY --from=builder /app/packages/agent-manager ./packages/agent-manager
COPY --from=builder /app/packages/collaboration ./packages/collaboration
COPY --from=builder /app/packages/workspace ./packages/workspace
COPY --from=builder /app/packages/knowledge ./packages/knowledge
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Create data directories
RUN mkdir -p /app/data/workspaces /app/data/plans

ENV NODE_ENV=production
EXPOSE 3002

WORKDIR /app/packages/backend
CMD ["bun", "dist/server.js"]
