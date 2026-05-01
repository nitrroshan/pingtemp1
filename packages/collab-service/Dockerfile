# Stage 1: Install dependencies
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy workspace root files needed for bun install
COPY package.json bun.lock tsconfig.json ./
COPY packages/collab-service/package.json packages/collab-service/package.json

RUN bun install --frozen-lockfile

# Copy collab-service source
COPY packages/collab-service/ packages/collab-service/

# Stage 2: Slim production runtime
FROM oven/bun:1-slim AS runtime

WORKDIR /app

# Copy dependencies + source (bun runs TypeScript directly)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/collab-service ./packages/collab-service
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Create data directories for CRDT persistence
RUN mkdir -p /app/data/collab/yjs /app/data/workspaces

ENV NODE_ENV=production
EXPOSE 1234

# Run the standalone collab server entry point
WORKDIR /app/packages/collab-service
CMD ["bun", "src/standalone.ts"]
