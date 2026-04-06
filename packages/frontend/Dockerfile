# ─── Frontend Dockerfile ──────────────────────────────────────────────────────
# Multi-stage: Vite build → nginx static serving
# ─────────────────────────────────────────────────────────────────────────────

# Stage 1: build
FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json bun.lockb ./
COPY packages/frontend/package.json ./packages/frontend/

RUN bun install --frozen-lockfile

COPY packages/frontend ./packages/frontend
COPY tsconfig.json ./

WORKDIR /app/packages/frontend
RUN bun run build

# Stage 2: serve with nginx
FROM nginx:alpine AS runtime

# Remove default nginx static assets
RUN rm -rf /usr/share/nginx/html/*

# Copy built Vite output
COPY --from=builder /app/packages/frontend/dist /usr/share/nginx/html

# SPA fallback: all routes serve index.html
RUN printf 'server {\n\
  listen 80;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  location / {\n\
    try_files $uri $uri/ /index.html;\n\
  }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
