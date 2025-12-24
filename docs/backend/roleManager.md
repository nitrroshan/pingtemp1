# RoleManager - Role Discovery and Worker Management

## Overview
RoleManager discovers agent roles needed for task execution, generates configurations, and manages worker lifecycle.

## Location
`src/worker/roleManager/RoleManager.ts`

## Responsibilities

### 1. Role Discovery
Uses ROLE Builder to identify required roles for a task.

### 2. Configuration Generation
Creates agent configurations for each role using CONFIG Builder.

### 3. Worker Initialization
Instantiates AgentWorker instances with proper configurations.

### 4. Worker Registry
Maintains a registry of active workers keyed by role name.

## Key Methods

### getRoles()
Discovers roles for a given task.

**Signature**:
```typescript
async getRoles(taskDescription: string): Promise<RoleDescriptor[]>
```

**Process**:
1. Checks if roles already discovered (cached)
2. If not, calls `suggestRoles()` to discover
3. Returns normalized role descriptors

**Output**:
```typescript
[
  {
    name: "ResearchAgent",
    goal: "Gather comprehensive information",
    manager: false
  },
  {
    name: "WriterAgent",
    goal: "Create engaging content",
    manager: false
  }
]
```

### getRoleWorkers()
Initializes and returns worker instances.

**Signature**:
```typescript
async getRoleWorkers(taskDescription: string): Promise<Record<string, AgentWorker>>
```

**Process**:
1. Checks if workers already initialized (cached)
2. If not, calls `initRoles()` to create workers
3. Returns worker registry

**Output**:
```typescript
{
  "researchagent": AgentWorker,
  "writeragent": AgentWorker
}
```

**Important**: Keys are lowercase role names for consistent lookup.

### suggestRoles() (Private)
Invokes ROLE Builder to discover roles.

**Fallback Behavior**:
If builder fails or returns invalid data, falls back to:
```typescript
[{
  name: "GeneralAgent",
  goal: "Handle the task end-to-end"
}]
```

### initRoles() (Private)
Creates agent configurations and initializes workers.

**Process**:
```typescript
for (const role of roles) {
  // 1. Build configuration prompt
  const prompt = buildConfigPrompt(taskDescription, role);
  
  // 2. Generate config using CONFIG Builder
  const config = await configBuilder.runAgent(prompt);
  
  // 3. Define response format schema
  const responseFormat = z.object({
    type: z.enum(['inprogress', 'result', 'delegate', 'question', 'error', 'request_info']),
    content: z.string().min(1)
  });
  
  // 4. Create AgentConfig
  const agentConfig = {
    role: config.role,
    goal: config.goal || taskDescription,
    systemPrompt: config.systemPrompt,
    responseFormat: responseFormat
  };
  
  // 5. Initialize agent and worker
  const agent = new Agent(agentConfig);
  const worker = new AgentWorker(agent);
  
  // 6. Register worker (lowercase key!)
  this.roleWorkers[role.name.toLowerCase()] = worker;
}
```

## Data Structures

### RoleDescriptor
```typescript
interface RoleDescriptor {
  name: string;               // Role name (e.g., "ResearchAgent")
  goal?: string;              // Role's primary objective
  systemPrompt?: string;      // Optional custom system prompt
  capabilities?: string[];    // Skills/capabilities
  responsibilities?: string[]; // Specific duties
}
```

### Worker Registry
```typescript
roleWorkers: Record<string, AgentWorker>
// Example:
{
  "researchagent": AgentWorker,
  "writeragent": AgentWorker,
  "editoragent": AgentWorker
}
```

## Response Format Schema

Workers use a standardized response format:

```typescript
{
  type: 'inprogress' | 'result' | 'delegate' | 'question' | 'error' | 'request_info',
  content: string
}
```

**Type Definitions**:
- `inprogress`: Actively working/conversing
- `result`: Task complete, user confirmed
- `delegate`: Needs another agent, user confirmed
- `question`: Needs user clarification
- `error`: Execution error
- `request_info`: Needs system context

## Configuration Building

### buildConfigPrompt()
Constructs prompt for CONFIG Builder.

**Template**:
```typescript
`Task: ${taskDescription}
Role: ${role.name}
Role Goal: ${role.goal}
${role.systemPrompt ? `Existing System Prompt: ${role.systemPrompt}` : ''}`
```

**Purpose**: Provides context for generating role-specific configuration.

## Usage Examples

### Basic Usage
```typescript
const roleManager = new RoleManager();

// Discover roles
const roles = await roleManager.getRoles("Create a research report");
console.log(roles);
// [{ name: "ResearchAgent", goal: "..." }, { name: "WriterAgent", goal: "..." }]

// Get initialized workers
const workers = await roleManager.getRoleWorkers("Create a research report");
console.log(Object.keys(workers));
// ["researchagent", "writeragent"]

// Use worker
const researchWorker = workers["researchagent"];
await researchWorker.createTask("Research AI trends");
```

### Accessing Specific Worker
```typescript
const roleManager = new RoleManager();
await roleManager.getRoleWorkers(taskDescription);

// Access by lowercase role name
const worker = roleManager.roleWorkers["researchagent"];
if (worker) {
  await worker.createTask("Perform research");
}
```

## Caching Strategy

RoleManager caches both roles and workers:

```typescript
// First call: discovers roles
await roleManager.getRoles(task1);

// Second call: returns cached roles
await roleManager.getRoles(task2); // Uses same roles!
```

**Implication**: All tasks share the same role set and workers.

**To Reset**:
```typescript
roleManager.roles = [];
roleManager.roleWorkers = {};
```

## Integration with Builders

### ROLE Builder
```typescript
const roleBuilder = await AgentBuilderFactory.getBuilder(BuilderType.ROLE);
const result = await roleBuilder.runAgent(taskDescription);

// Handle multiple response formats
const roles = result?.roles ?? result; // Flexible parsing
```

### CONFIG Builder
```typescript
const configBuilder = await AgentBuilderFactory.getBuilder(BuilderType.CONFIG);
const config = await configBuilder.runAgent(prompt);

// config = {
//   role: "ResearchAgent",
//   goal: "...",
//   systemPrompt: "...",
//   tools: [...],
//   mcpClientConfigs: {...}
// }
```

## Error Handling

### Role Discovery Failure
```typescript
try {
  const resp = await roleBuilder.runAgent(taskDescription);
  identifiedRoles = resp?.roles ?? resp;
} catch (e) {
  logger.error("Role builder failed:", e);
  // Falls back to GeneralAgent
}
```

### Configuration Generation Failure
```typescript
const generatedConfig = await configBuilder.runAgent(prompt);
if (!generatedConfig) {
  logger.error(`Config builder returned null for role ${role.name}`);
  continue; // Skip this role
}
```

### Worker Initialization Failure
```typescript
try {
  const agent = new Agent(agentConfig);
  const worker = new AgentWorker(agent);
  this.roleWorkers[role.toLowerCase()] = worker;
} catch (e) {
  logger.error(`Failed to start worker for role '${role}':`, e);
  // Worker not added to registry
}
```

## Best Practices

### 1. Lowercase Role Keys
Always use lowercase when accessing workers:
```typescript
// ✅ Correct
const worker = roleManager.roleWorkers[roleName.toLowerCase()];

// ❌ Wrong
const worker = roleManager.roleWorkers[roleName]; // May not match
```

### 2. Check Worker Existence
```typescript
const worker = roleManager.roleWorkers[roleName.toLowerCase()];
if (!worker) {
  logger.error(`Worker not found for role: ${roleName}`);
  return;
}
```

### 3. Await Initialization
```typescript
// Ensure workers are initialized before use
const workers = await roleManager.getRoleWorkers(task);
// Now safe to access workers
```

### 4. Clear Cache When Needed
```typescript
// For new task with different requirements
roleManager.roles = [];
roleManager.roleWorkers = {};
await roleManager.getRoles(newTask);
```

## Testing

### Unit Test Example
```typescript
describe('RoleManager', () => {
  it('should discover roles', async () => {
    const manager = new RoleManager();
    const roles = await manager.getRoles('Test task');
    expect(roles).toBeInstanceOf(Array);
    expect(roles.length).toBeGreaterThan(0);
  });
  
  it('should initialize workers', async () => {
    const manager = new RoleManager();
    const workers = await manager.getRoleWorkers('Test task');
    expect(Object.keys(workers).length).toBeGreaterThan(0);
  });
  
  it('should use lowercase keys for workers', async () => {
    const manager = new RoleManager();
    await manager.getRoleWorkers('Test task');
    const keys = Object.keys(manager.roleWorkers);
    keys.forEach(key => {
      expect(key).toBe(key.toLowerCase());
    });
  });
});
```

## Debugging

### Inspect Roles
```typescript
const roles = await roleManager.getRoles(task);
console.log('Discovered roles:', roles);
```

### Inspect Workers
```typescript
const workers = await roleManager.getRoleWorkers(task);
console.log('Worker keys:', Object.keys(workers));
console.log('Worker count:', Object.keys(workers).length);
```

### Check Worker Status
```typescript
const worker = roleManager.roleWorkers['rolename'];
if (worker) {
  console.log('Messages:', worker.getMessages());
  console.log('Task queue:', worker['taskQueue']);
}
```

## Performance Considerations

### Single Initialization
Workers are initialized once and reused:
```typescript
// First call: initializes
await roleManager.getRoleWorkers(task1);

// Second call: returns existing
await roleManager.getRoleWorkers(task2); // No re-initialization
```

### Lazy Loading
Roles and workers are only created when requested:
```typescript
new RoleManager(); // No roles/workers yet
await manager.getRoles(task); // Now roles discovered
await manager.getRoleWorkers(task); // Now workers initialized
```

## Future Enhancements

1. **Dynamic Role Addition**: Add roles during execution
2. **Worker Pooling**: Multiple workers per role for parallelism
3. **Role Specialization**: Fine-tune roles based on performance
4. **Worker Lifecycle**: Start/stop/restart workers
5. **Resource Limits**: CPU/memory limits per worker
6. **Health Checks**: Monitor worker availability

## Related Files

- [AgentManager](./agentManager.md)
- [AgentWorker](./agentWorker.md)
- [Agent Builders](./agentBuilder/README.md)
- [Agent Configuration](./agentConfig.md)
