<!-- filepath: d:\Refer\agent-chat-bacckent\src\docs\projecthost.md -->

# Project Hosting: agent-chat-bacckent

This file provides concise, project-specific hosting instructions for the agent-chat-bacckent application.

## Prerequisites
- Node.js (recommended LTS) installed on the host.
- A package manager (npm or pnpm) to install dependencies.
- Environment variables configured for the app (use a `.env` file or your host's secret manager).

Common environment variables for this project:
- PORT (e.g., 3000)
- NODE_ENV (development | production)
- MONGO_URL(connection string to your MongoDB instance)
- AZURE_OPENAI_EMBEDDINGS_API_KEY
- AZURE_OPENAI_EMBEDDINGS_ENDPOINT_URL
- AZURE_OPENAI_EMBEDDINGS_INSTANCE_NAME
## Local setup and run (project-specific)
1. From the project root (where package.json lives), install dependencies:
   npm install
2. Create a `.env` file from `.env.example` and set the values for the variables above.
3. Build the project for production (if a build step exists):
   npm run build
4. Start the application (use the script defined in package.json):
   npm start

If the project provides a development script, use it during development:
   npm run dev

## Docker (project-specific)
- Build the Docker image:
  docker build -t agent-chat-bacckent .
- Run the container with environment file and port mapping:
  docker run -d -p 3000:3000 --env-file .env --name agent-chat-bacckent agent-chat-bacckent

Use docker-compose if the project needs additional services (e.g., MongoDB).

## Production tips for agent-chat-bacckent
- Use a process manager (pm2) to run the app and enable restarts:
  pm2 start npm --name agent-chat-bacckent -- start
- Place the app behind NGINX for SSL termination and routing.
- Keep secrets out of source control; use environment variables or a secret manager.
- Run the app as a non-root user and limit permissions.

## Ports and entry point
- Confirm the listening port from environment variables or project config (default: 3000).
- Common server entry files: `server.js`, `index.js`, or `dist/index.js` after build — check package.json `main` or `scripts`.

## Where to find exact commands
- Inspect the `scripts` section in package.json for project-specific build/start/dev commands.
- Consult the repository README for any additional hosting notes.

This document is intentionally concise and focused on the agent-chat-bacckent project; adapt values (ports, env keys) as needed for your environment.