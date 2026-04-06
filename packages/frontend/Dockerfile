# Stage 1: Build with Bun
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy workspace root files
COPY package.json bunfig.toml ./
COPY packages/frontend/package.json packages/frontend/package.json
# Stub other workspace packages
COPY packages/backend/package.json packages/backend/package.json
COPY packages/registry/package.json packages/registry/package.json

RUN bun install --frozen-lockfile

# Copy frontend source
COPY packages/frontend/ packages/frontend/

# Build-time env — override API URL at build
ARG VITE_API_URL=http://localhost:3002
ENV VITE_API_URL=$VITE_API_URL

WORKDIR /app/packages/frontend
RUN bun run build

# Stage 2: Serve with nginx
FROM nginx:alpine AS runtime

# Copy built assets
COPY --from=builder /app/packages/frontend/dist /usr/share/nginx/html

# SPA fallback: all routes → index.html
RUN printf 'server {\n\
  listen 80;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  location / {\n\
    try_files $uri $uri/ /index.html;\n\
  }\n\
  # Cache static assets\n\
  location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {\n\
    expires 1y;\n\
    add_header Cache-Control "public, immutable";\n\
  }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
