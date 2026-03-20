# AgentManager Types

This folder contains all type definitions for the AgentManager module, organized into separate files for better maintainability and code organization.

## Type Files

### AgentConfig.types.ts
Defines the configuration interface for AI agents, including:
- `AgentConfig` - Main configuration interface with role, goal, system prompts, tools, and MCP configurations

### AgentManager.types.ts
Contains core AgentManager type definitions:
- `Status` - Task lifecycle states (`ready`, `pending`, `in_progress`, `completed`, `failed`)
- `TaskAssignments` - Mapping of roles to assigned tasks
- `WorkerRegistry` - Mapping of role names to AgentWorker instances

### Team.types.ts
Defines team-related types:
- `TeamConfig` - Configuration for multi-agent teams with goals, members, and metadata

### Workspace.types.ts
Contains workspace configuration types:
- `WorkspaceConfig` - Configuration for git repositories and agent workspaces, including repo path, branches, and remote settings

## Usage

Import types from the barrel export file:

```typescript
import type { 
  AgentConfig, 
  Status, 
  TeamConfig, 
  WorkspaceConfig 
} from './types/index.js';
```

Or import specific types directly:

```typescript
import type { AgentConfig } from './types/AgentConfig.types.js';
import type { Status } from './types/AgentManager.types.js';
```

## Migration Notes

The following files now re-export from this types folder for backwards compatibility:
- `AgentConfig.ts` - Deprecated, use `types/AgentConfig.types.ts`
- `workspace/WorkspaceConfig.ts` - Deprecated, use `types/Workspace.types.ts`
- `team/team.ts` - Now imports and re-exports `TeamConfig` from types folder

These deprecated files will be removed in a future version.

## Type Documentation

All types include comprehensive JSDoc comments explaining:
- Purpose and usage
- Property descriptions
- Optional vs required fields
- Related types and dependencies

## Best Practices

1. Always import types using the barrel export (`types/index.ts`) when possible
2. Use `import type` syntax for type-only imports to enable proper tree-shaking
3. Keep type definitions close to their domain (Agent, Team, Workspace, etc.)
4. Document new types with JSDoc comments
5. Update the barrel export when adding new type files
