# Stage 1: Install dependencies
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy workspace root files needed for bun install
COPY package.json bunfig.toml ./
COPY packages/collaboration/package.json packages/collaboration/package.json
# Stub other workspace packages so bun resolves workspace deps
COPY packages/backend/package.json packages/backend/package.json
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/registry/package.json packages/registry/package.json
COPY packages/agent-manager/package.json packages/agent-manager/package.json
COPY packages/workspace/package.json packages/workspace/package.json
COPY packages/knowledge/package.json packages/knowledge/package.json

RUN bun install --frozen-lockfile

# Copy collaboration source
COPY packages/collaboration/ packages/collaboration/
COPY tsconfig.json tsconfig.json

# Stage 2: Slim production runtime
FROM oven/bun:1-slim AS runtime

WORKDIR /app

# Copy dependencies + source (bun runs TypeScript directly)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/collaboration ./packages/collaboration
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Create data directories for CRDT persistence
RUN mkdir -p /app/data/collab/yjs /app/data/workspaces

ENV NODE_ENV=production
EXPOSE 1234

# Run the standalone collab server entry point
WORKDIR /app/packages/collaboration
CMD ["bun", "src/standalone.ts"]
