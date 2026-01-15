# Project Context: Agent Chat Backend

## Overview
`refer-backendjs` is a multi-agent orchestration system designed to coordinate AI agents for complex tasks. It leverages **Node.js**, **TypeScript**, **LangGraph**, and **Azure OpenAI** to manage role discovery, task planning, and execution.

## Active Development Focus
The user has identified the following active areas of development. **All other directories (e.g., `src/roleManager`, `src/taskManager`) should be considered redundant or legacy.**

### 1. AgentChat (`src/AgentChat`)
- **Type**: Frontend Application (React + Vite + possibly Electron).
- **Purpose**: The user interface for interacting with the multi-agent system.
- **Key Files**: `App.tsx`, `components/`, `services/`.

### 2. Agent Registry (`src/agentRegistry`)
- **Type**: Backend Service.
- **Purpose**: Manages agent discovery, registration, and capabilities. Likely uses embeddings for semantic search.
- **Key Files**: `agentRegistry.ts`, `index.ts`, `embedding/`.

### 3. Worker Runtime (`src/worker`)
- **Type**: Backend Orchestration Engine.
- **Purpose**: Executes the agent workflows, manages `AgentManager`, `AgentWorker`, and `MemoryManager`.
- **Key Files**: `agentManager/`, `AgentWorker/`, `api/`.

### 4. Documentation (`docs/`)
- **Type**: Project Documentation.
- **Purpose**: Source of truth for specifications and architecture.

## Legacy / Redundant
- `src/roleManager` (Integrated into worker or deprecated)
- `src/taskManager` (Integrated into worker or deprecated)

## Core Architecture (Worker)

### 1. AgentManager
- **Role**: Top-level orchestrator.
- **Responsibilities**:
    - Coordinates the entire workflow.
    - Manages `RoleManager` for dynamic role discovery.
    - Uses `Plan Builder` to generate execution plans.
    - Initializes `AgentWorkers`.
    - Handles inter-agent communication.

### 2. RoleManager
- **Role**: Role discovery and management.
- **Responsibilities**:
    - Identifies necessary roles for a task using LLM.
    - Generates agent configurations (system prompts, tools).
    - Maintains a registry of active workers.

### 3. MemoryManager
- **Role**: Task and state management.
- **Responsibilities**:
    - Tracks task lifecycle: `ready` -> `pending` -> `in_progress` -> `completed`.
    - Manages task dependencies (prerequisites).
    - Storage for task outputs.

### 4. AgentWorker
- **Role**: Execution engine.
- **Responsibilities**:
    - Executes tasks using LangGraph agents.
    - Emits events (`taskComplete`, `log`).
    - Manages message history and context.

## API Architecture
The API is split into two modular servers coordinated by `AgentManagerAPI`:
- **SocketServer (`src/worker/api/SocketServer.ts`)**: Handles real-time communication (Socket.IO) for agent messages and updates.
- **HttpServer (`src/worker/api/HttpServer.ts`)**: Handles REST endpoints (Express) for task creation and health checks.

## Workflow
1.  **User Input**: Task description received via API.
2.  **Role Discovery**: `RoleManager` identifies needed roles (e.g., "Researcher", "Coder").
3.  **Configuration**: Agents are configured with specific goals and tools.
4.  **Planning**: A plan is generated with dependencies.
5.  **Execution**: `AgentManager` assigns ready tasks to `AgentWorkers`.
6.  **Loop**: As tasks complete, dependent tasks become ready and are executed.
7.  **Completion**: Final output is aggregated.

## Key Directories
- `src/worker/agentManager`: Core orchestration logic.
- `src/worker/roleManager`: Role discovery logic.
- `src/worker/memoryManager`: Task state tracking.
- `src/worker/AgentWorker`: Agent execution wrapper.
- `src/worker/api`: API server implementations.
- `docs/`: Comprehensive project documentation.
