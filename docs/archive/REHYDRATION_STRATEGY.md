# AgentManager Rehydration Strategy

## Overview
Plan to enable rehydration of AgentManager, MemoryManager, RoleManager, and WorkspaceManager to support stateless request handling and multi-team isolation.

## Current Challenges

### 1. Expensive Initialization Chain
Every AgentManager instantiation triggers:
- MemoryManager creation (new task storage Map)
- RoleManager creation (role definitions + worker registry)
- WorkspaceManager creation (git repository initialization at `D:/Refer/agent-workspace`)

### 2. Role Discovery Overhead
Current flow on each message:
1. Call Role Builder (LLM call) - ~3-5s
2. Generate role definitions
3. Create AgentConfig per role via Config Builder (LLM call per role) - ~3-5s each
4. Initialize Agent instances (Azure OpenAI setup)
5. Create AgentWorker instances
6. Build worker registry

**Impact:** 15-30 seconds minimum per message, $0.05-0.20 cost

### 3. Lost State Without Persistence
- **Conversation context**: `AgentWorker.messages[]` array lost
- **LangGraph checkpoints**: `MemorySaver` is in-memory only
- **Task dependencies**: `MemoryManager.tasks` Map reset
- **Event subscriptions**: EventEmitter listeners disconnected
- **Worker registry**: All workers need recreation

## State Analysis

### MemoryManager State
```typescript
private tasks: Map<string, Task>

interface Task {
  id: string;
  description: string;
  assigned_role: string;
  context?: any;
  status: "ready" | "pending" | "in_progress" | "completed" | "failed";
  output?: any;
  prerequisites: Map<string, boolean>;
  dependants: string[];
}
```

**Serialization needs:**
- Convert Map to Object for JSON/DB storage
- Preserve task dependencies and status
- Store per teamId for multi-tenancy

### RoleManager State
```typescript
roleDefinitions: RoleDefinition[]
roleWorkers: Record<string, AgentWorker> // NOT serializable!
```

**Key insight:** Only persist `roleDefinitions`, rebuild workers lazily on demand

### WorkspaceManager State
```typescript
repoPath: string
defaultBranch: string
```

**Key insight:** Git state already persistent on disk, just need reconnection

## Implementation Plan

### Phase 1: JSON File Persistence (Quick Win)

#### 1.1 MemoryManager Design (No Persistence - Database Managed Externally)
```typescript
// MemoryManager - Simplified without persistence logic
// Database layer will handle saving/loading tasks

class MemoryManager {
  private teamId?: string;
  private tasks: Map<string, Task> = new Map();
  
  constructor() {
    // Empty constructor - use factory methods for initialization
  }
  
  // Factory method 1: Create from tasks (used when loading from database)
  static fromTasks(teamId: string, tasks: Task[]): MemoryManager {
    const manager = new MemoryManager();
    manager.teamId = teamId;
    
    for (const task of tasks) {
      // Convert plain objects back to Map for prerequisites
      const taskWithMap: Task = {
        ...task,
        prerequisites: task.prerequisites instanceof Map 
          ? task.prerequisites 
          : new Map(Object.entries(task.prerequisites || {}))
      };
      manager.tasks.set(task.id, taskWithMap);
    }
    
    log.info(`MemoryManager initialized with ${tasks.length} tasks for team ${teamId}`);
    return manager;
  }
  
  // Factory method 2: Create empty manager
  static empty(teamId: string): MemoryManager {
    const manager = new MemoryManager();
    manager.teamId = teamId;
    log.info(`MemoryManager initialized empty for team ${teamId}`);
    return manager;
  }
  
  // Get all tasks (for external persistence)
  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }
  
  // Get tasks serializable format (for database storage)
  getSerializableTasks(): any[] {
    return Array.from(this.tasks.values()).map(task => ({
      ...task,
      prerequisites: Object.fromEntries(task.prerequisites),
      context: typeof task.context === 'string' ? task.context : JSON.stringify(task.context)
    }));
  }
  
  // Regular task operations (no auto-persist)
  addTask(task: Task): void {
    if (!task.id) task.id = randomUUID();
    this.tasks.set(task.id, task);
    log.info("Task added", { id: task.id, description: task.description });
  }
  
  getTasks(role: string): Task[] {
    const readyTasks: Task[] = [];
    for (const task of this.tasks.values()) {
      if (this.checkTaskReady(task.id) && task.assigned_role === role) {
        readyTasks.push(task);
      }
    }
    return readyTasks;
  }
  
  updateTaskStatus(taskId: string, status: TaskStatus): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = status;
    this.tasks.set(taskId, task);
    log.info("Task status updated", { taskId, status });
  }
  
  completeTask(taskId: string, outputData: any): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      log.error("completeTask: Task not found", { taskId });
      return;
    }
    task.output = outputData;
    this.updateTaskStatus(taskId, "completed");
    this.updateDependantTasks(task);
    this.tasks.set(taskId, task);
  }
  
  isComplete(): boolean {
    for (const task of this.tasks.values()) {
      if (task.status !== "completed") return false;
    }
    return true;
  }
  
  private checkTaskReady(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.prerequisites.size === 0) return true;
    for (const completed of task.prerequisites.values()) {
      if (completed === false) return false;
    }
    return true;
  }
  
  private updateDependantTasks(task: Task): void {
    for (const dependantId of task?.dependants) {
      const dependantTask = this.tasks.get(dependantId);
      if (dependantTask) {
        this.updateContext(dependantTask, task);
        dependantTask.prerequisites.set(task.id, true);
        this.tasks.set(dependantId, dependantTask);
      }
    }
  }
  
  private updateContext(task: Task, completedTask: Task): void {
    if (!task || !completedTask.output) return;
    task.context = {
      ...JSON.parse(task.context || "{}"),
      [completedTask.id]: {
        description: completedTask.description,
        assigned_role: completedTask.assigned_role,
        output: completedTask.output,
        status: completedTask.status,
      },
    };
  }
}

/**
 * Usage Pattern:
 * 
 * // First time (no saved tasks in database):
 * const memoryManager = MemoryManager.empty(teamId);
 * 
 * // Add tasks...
 * memoryManager.addTask(task1);
 * 
 * // Save to database when needed:
 * await db.saveTasks(teamId, memoryManager.getSerializableTasks());
 * 
 * // Subsequent times (load from database):
 * const savedTasks = await db.getTasks(teamId);
 * const memoryManager = MemoryManager.fromTasks(teamId, savedTasks);
 */
```

#### 1.2 RoleManager Design (No Persistence - Database Managed Externally)
```typescript
// RoleManager - Simplified without persistence logic
// Database layer will handle saving/loading AgentConfigs

class RoleManager {
  private teamId?: string;
  private agentConfigs: AgentConfig[] = [];
  roleDefinitions: RoleDefinition[] = [];
  roleWorkers: Record<string, AgentWorker> = {};
  
  constructor() {
    // Empty constructor - use factory methods for initialization
  }
  
  // Factory method 1: Create from AgentConfigs (used when loading from database)
  static fromAgentConfigs(teamId: string, agentConfigs: AgentConfig[]): RoleManager {
    const manager = new RoleManager();
    manager.teamId = teamId;
    manager.agentConfigs = agentConfigs;
    
    // Derive roleDefinitions from agentConfigs
    manager.roleDefinitions = agentConfigs.map(config => ({
      name: config.name,
      role: config.role,
      roleDescription: config.goal || '',
      capabilities: [],
      responsibilities: []
    }));
    
    logger.info(`RoleManager initialized with ${agentConfigs.length} pre-configured agents`);
    return manager;
  }
  
  // Factory method 2: Create from task description (first-time initialization with LLM role discovery)
  static async fromTaskDescription(teamId: string, taskDescription: string): Promise<RoleManager> {
    const manager = new RoleManager();
    manager.teamId = teamId;
    
    // Perform role discovery with task description
    await manager.discoverRoles(taskDescription);
    
    logger.info(`RoleManager initialized via role discovery for task: ${taskDescription}`);
    return manager;
  }
  
  // Get AgentConfigs (for external persistence)
  getAgentConfigs(): AgentConfig[] {
    return this.agentConfigs;
  }
  
  // Discover roles and generate AgentConfigs (private - used internally)
  private async discoverRoles(taskDescription: string): Promise<void> {
    logger.info("Starting role discovery for task:", taskDescription);
    
    // Get role definitions via Role Builder
    const roleDefinitions = await this.getRoleDefinitions(taskDescription);
    
    // Generate AgentConfigs via Config Builder
    const configBuilder = await AgentBuilderFactory.getBuilder(BuilderType.CONFIG);
    const agentConfigs: AgentConfig[] = [];
    
    for (const role of roleDefinitions) {
      const prompt = this.buildConfigPrompt(taskDescription, role);
      logger.debug(`Invoking config builder for role '${role.role}'`);
      const generatedConfig = await configBuilder.runAgent(prompt);
      
      if (!generatedConfig) {
        logger.error(`Config builder returned null for role ${role.role}`);
        continue;
      }
      
      // Define the responseFormat schema for worker outputs
      const workerResponseFormat = z.object({
        type: z.enum([
          "inprogress", "result", "delegate", 
          "question", "error", "request_info"
        ]).describe("Type of response"),
        content: z.string().min(1).describe("The detailed agent response content"),
      });
      
      // Create AgentConfig from CONFIG builder output
      const agentConfig: AgentConfig = {
        name: role.name,
        role: generatedConfig.role,
        goal: generatedConfig.goal,
        systemPrompt: generatedConfig.systemPrompt,
        responseFormat: workerResponseFormat,
        tools: [], // Temporarily disabled
        mcpClientConfigs: {},
      };
      
      agentConfigs.push(agentConfig);
      logger.info(`Created agent config for role '${agentConfig.role}'`);
    }
    
    this.agentConfigs = agentConfigs;
    this.roleDefinitions = roleDefinitions;
  }
  
  // Get workers - creates them if needed
  async getRoleWorkers(workspaceConfig?: WorkspaceConfig): Promise<Record<string, AgentWorker>> {
    const workerCount = Object.keys(this.roleWorkers).length;
    
    // If workers already exist, return them
    if (workerCount > 0) {
      logger.debug(`Reusing existing ${workerCount} workers`);
      return this.roleWorkers;
    }
    
    if (this.agentConfigs.length === 0) {
      throw new Error("No agent configs available. Initialize RoleManager via factory methods first.");
    }
    
    // Initialize workers from configs
    logger.info(`Initializing ${this.agentConfigs.length} workers...`);
    await this.initRoles(this.agentConfigs, workspaceConfig);
    
    return this.roleWorkers;
  }
  
  // Initialize workers from AgentConfigs
  private async initRoles(
    agentConfigs: AgentConfig[],
    workspaceConfig?: WorkspaceConfig
  ): Promise<void> {
    for (const agentConfig of agentConfigs) {
      try {
        // Create AgentWorkspace if workspaceConfig is provided
        let workspace: AgentWorkspace | undefined;
        if (workspaceConfig) {
          const agentId = agentConfig.role.toLowerCase();
          workspace = new AgentWorkspace(workspaceConfig, agentId);
          const workspaceTools = createWorkspaceTools(workspace);
          agentConfig.tools = [...(agentConfig.tools || []), ...workspaceTools];
          logger.info(`AgentWorkspace created for '${agentId}' with ${workspaceTools.length} tools`);
        }
        
        const agent = new Agent(agentConfig);
        const worker = new AgentWorker(agent, workspace);
        
        // Key workers by role (lowercase)
        this.roleWorkers[agentConfig.role.toLowerCase()] = worker;
        logger.info(`Worker initialized for role '${agentConfig.role}'`);
      } catch (e) {
        logger.error(`Failed to initialize worker for role '${agentConfig.role}':`, e);
      }
    }
  }
  
  // Helper methods (getRoleDefinitions, buildConfigPrompt) remain unchanged
  // These are used internally by discoverRoles()
}

/**
 * Usage Pattern:
 * 
 * // First time (no saved configs in database):
 * const roleManager = await RoleManager.fromTaskDescription(teamId, "Build a website");
 * const configs = roleManager.getAgentConfigs(); // Save these to database
 * 
 * // Subsequent times (configs exist in database):
 * const savedConfigs = await database.getAgentConfigs(teamId);
 * const roleManager = RoleManager.fromAgentConfigs(teamId, savedConfigs);
 * 
 * // Get workers when needed:
 * const workers = await roleManager.getRoleWorkers(workspaceConfig);
 */
```

#### 1.3 WorkspaceManager Design (No Persistence - Config Managed Externally)
```typescript
// WorkspaceManager - Config provided from database
// Git state is persistent on disk, just need reconnection

class WorkspaceManager {
  private repoPath: string;
  private defaultBranch: string;
  
  constructor(config: WorkspaceConfig) {
    this.repoPath = config.repoPath;
    this.defaultBranch = config.defaultBranch || 'main';
  }
  
  // Factory method: Create and initialize
  static async create(config: WorkspaceConfig): Promise<WorkspaceManager> {
    const manager = new WorkspaceManager(config);
    await manager.initializeWorkspace(); // Reconnects to existing repo or creates new
    return manager;
  }
  
  // Get config (for external persistence)
  getConfig(): WorkspaceConfig {
    return {
      repoPath: this.repoPath,
      defaultBranch: this.defaultBranch
    };
  }
  
  async initializeWorkspace(): Promise<void> {
    const gitDir = path.join(this.repoPath, '.git');
    const exists = await this.directoryExists(gitDir);
    
    if (exists) {
      await this.connectToExistingRepo();
    } else {
      await this.createNewRepo();
    }
  }
  
  // ... rest of existing methods ...
}

/**
 * Usage Pattern:
 * 
 * // Load config from database:
 * const config = await db.getWorkspaceConfig(teamId) || { 
 *   repoPath: `./workspaces/${teamId}`, 
 *   defaultBranch: 'main' 
 * };
 * 
 * // Create workspace manager:
 * const workspaceManager = await WorkspaceManager.create(config);
 * 
 * // Save config to database if new:
 * await db.saveWorkspaceConfig(teamId, workspaceManager.getConfig());
 */
```

#### 1.4 AgentManager Design (Database-Backed State Management)
```typescript
// AgentManager - Uses database for all state persistence
// Coordinates MemoryManager, RoleManager, and WorkspaceManager

interface TeamStateData {
  tasks: Task[];
  agentConfigs: AgentConfig[];
  workspaceConfig: WorkspaceConfig;
}

class AgentManager {
  private teamId: string;
  memoryManager: MemoryManager;
  roleManager: RoleManager;
  workspaceManager: WorkspaceManager;
  isAvailable: boolean = false;
  events: EventEmitter;
  
  private constructor(teamId: string) {
    this.teamId = teamId;
    this.events = new EventEmitter();
  }
  
  // Factory method 1: Create from database state (rehydration)
  static async fromDatabase(
    teamId: string, 
    database: TeamStateRepository
  ): Promise<AgentManager> {
    const manager = new AgentManager(teamId);
    
    // Load state from database
    const state = await database.loadState(teamId);
    
    if (state) {
      // Initialize from saved state
      manager.memoryManager = MemoryManager.fromTasks(teamId, state.tasks);
      manager.roleManager = RoleManager.fromAgentConfigs(teamId, state.agentConfigs);
      manager.workspaceManager = await WorkspaceManager.create(state.workspaceConfig);
      
      logger.info(`AgentManager loaded from database for team ${teamId}`);
    } else {
      // No saved state - initialize empty
      manager.memoryManager = MemoryManager.empty(teamId);
      manager.roleManager = new RoleManager(); // Will be initialized via fromTaskDescription
      manager.workspaceManager = await WorkspaceManager.create({
        repoPath: `./workspaces/${teamId}`,
        defaultBranch: 'main'
      });
      
      logger.info(`AgentManager created new for team ${teamId}`);
    }
    
    manager.isAvailable = true;
    return manager;
  }
  
  // Factory method 2: Create from task description (first-time initialization)
  static async fromTaskDescription(
    teamId: string,
    taskDescription: string,
    database: TeamStateRepository
  ): Promise<AgentManager> {
    const manager = new AgentManager(teamId);
    
    // Initialize managers
    manager.memoryManager = MemoryManager.empty(teamId);
    manager.roleManager = await RoleManager.fromTaskDescription(teamId, taskDescription);
    manager.workspaceManager = await WorkspaceManager.create({
      repoPath: `./workspaces/${teamId}`,
      defaultBranch: 'main'
    });
    
    // Save initial state to database
    await manager.saveToDatabase(database);
    
    manager.isAvailable = true;
    logger.info(`AgentManager created from task description for team ${teamId}`);
    return manager;
  }
  
  // Save current state to database
  async saveToDatabase(database: TeamStateRepository): Promise<void> {
    await database.saveState(this.teamId, {
      tasks: this.memoryManager.getSerializableTasks(),
      agentConfigs: this.roleManager.getAgentConfigs(),
      workspaceConfig: this.workspaceManager.getConfig()
    });
    
    logger.debug(`AgentManager state saved to database for team ${this.teamId}`);
  }
  
  // Get workers (delegates to RoleManager)
  async getWorkers(taskDescription?: string): Promise<Record<string, AgentWorker>> {
    return await this.roleManager.getRoleWorkers(this.workspaceManager.getConfig());
  }
  
  // ... rest of existing AgentManager methods ...
}

/**
 * Usage Pattern:
 * 
 * // Scenario 1: Load existing team (has database records):
 * const agentManager = await AgentManager.fromDatabase(teamId, database);
 * const workers = await agentManager.getWorkers();
 * 
 * // Scenario 2: New team with task description:
 * const agentManager = await AgentManager.fromTaskDescription(
 *   teamId, 
 *   "Build a website",
 *   database
 * );
 * 
 * // After state changes:
 * await agentManager.saveToDatabase(database);
 */
```

### Phase 2: AgentManagerAPI with Caching and Database

```typescript
class AgentManagerAPI {
  private agentManagers: Map<string, {
    instance: AgentManager;
    lastUsed: number;
    teamId: string;
  }> = new Map();
  
  private cleanupInterval?: NodeJS.Timeout;
  private database: TeamStateRepository;
  
  constructor(port: number = 3002, database: TeamStateRepository) {
    this.database = database;
    
    logger.info("[AgentManagerAPI] Initializing API services...");
    
    // Initialize HTTP Server (no AgentManager dependency)
    this.httpServer = new HttpServer();
    
    // Create HTTP server and start listening
    this.server = createServer(this.httpServer.getApp());
    this.server.listen(port, () => {
      logger.info(`[AgentManagerAPI] HTTP server listening on port ${port}`);
    });
    
    // Initialize Socket.IO Server
    this.socketServer = new SocketServer(this.server, this);
    
    // Start cleanup scheduler
    this.startCleanupScheduler();
    
    logger.info("[AgentManagerAPI] All services initialized successfully");
  }
  
  // Get or create AgentManager for a team
  async getOrCreateAgentManager(teamId: string): Promise<AgentManager> {
    // Check cache
    const cached = this.agentManagers.get(teamId);
    if (cached) {
      logger.debug(`[AgentManagerAPI] Reusing cached AgentManager for team ${teamId}`);
      cached.lastUsed = Date.now();
      return cached.instance;
    }
    
    // Load from database
    logger.info(`[AgentManagerAPI] Loading AgentManager from database for team ${teamId}`);
    const instance = await AgentManager.fromDatabase(teamId, this.database);
    
    this.agentManagers.set(teamId, {
      instance,
      lastUsed: Date.now(),
      teamId
    });
    
    return instance;
  }
  
  // Cleanup stale instances (with auto-save before eviction)
  private startCleanupScheduler() {
    this.cleanupInterval = setInterval(async () => {
      const now = Date.now();
      const staleThreshold = 30 * 60 * 1000; // 30 minutes
      
      for (const [teamId, entry] of this.agentManagers) {
        if (now - entry.lastUsed > staleThreshold) {
          logger.info(`[AgentManagerAPI] Evicting stale AgentManager for team ${teamId}`);
          
          // Save to database before evicting
          try {
            await entry.instance.saveToDatabase(this.database);
          } catch (err) {
            logger.error(`Failed to save state before eviction for team ${teamId}:`, err);
          }
          
          this.agentManagers.delete(teamId);
        }
      }
    }, 5 * 60 * 1000); // Check every 5 minutes
  }
  
  async stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    // Save all active AgentManagers before shutdown
    logger.info("[AgentManagerAPI] Saving all active AgentManagers...");
    const savePromises = Array.from(this.agentManagers.values()).map(entry =>
      entry.instance.saveToDatabase(this.database).catch(err =>
        logger.error(`Failed to save team ${entry.teamId}:`, err)
      )
    );
    await Promise.all(savePromises);
    
    // Cleanup resources
    logger.info("[AgentManagerAPI] Stopping all services...");
    this.socketServer.close();
    await this.httpServer.close();
    logger.info("[AgentManagerAPI] All services stopped");
  }
}
```

### Phase 3: SocketServer Integration

```typescript
class SocketServer {
  private io: SocketIOServer;
  private agentManagerAPI: AgentManagerAPI; // Changed from single AgentManager
  
  constructor(httpServer: any, agentManagerAPI: AgentManagerAPI) {
    this.agentManagerAPI = agentManagerAPI;
    // ... existing initialization
  }
  
  // Updated message routing with database-backed AgentManager
  private async routeMessageToAgent(
    connectionId: string,
    socket: Socket,
    message: {
      agentRole: string;
      payload: any;
    }
  ) {
    const { agentRole, payload } = message;
    
    try {
      // Get teamId from socket/user context
      const teamId = socket.data.teamId || socket.data.userId; // Derive from user
      
      // Get AgentManager for this team (cached or loaded from database)
      const agentManager = await this.agentManagerAPI.getOrCreateAgentManager(teamId);
      
      logger.debug(`[SocketServer] Routing message to agent: ${agentRole} for team ${teamId}`);
      
      // Get workers for this team
      const workers = await agentManager.getWorkers();
      const worker = workers[agentRole.toLowerCase()];
      
      if (!worker) {
        socket.emit("agent:message", {
          agentRole,
          error: `Agent '${agentRole}' not found`,
          timestamp: Date.now(),
        });
        return;
      }
      
      // Execute task and handle response
      // ... rest of existing logic
      
      // Save state after task execution
      await agentManager.saveToDatabase(this.agentManagerAPI.database);
      
    } catch (error: any) {
      logger.error(`[SocketServer] Error in agent ${agentRole}:`, error);
      // ... error handling
    }
  }
  
  // Add teamId to registration
  private handleRegister(socket: Socket, data: { userId: string; teamId?: string }) {
    const { userId, teamId } = data;
    
    // ... existing validation
    
    socket.data.userId = userId;
    socket.data.teamId = teamId || userId; // Default to userId if no teamId
    
    // ... rest of registration
  }
}
```

### Phase 4: Database Implementation (Recommended for Production)

#### Database Layer Design
```typescript
// repositories/TeamStateRepository.ts
interface TeamStateDocument {
  _id: string; // teamId
  
  // MemoryManager state
  tasks: Array<{
    id: string;
    description: string;
    assigned_role: string;
    context?: string;
    status: TaskStatus;
    output?: string;
    prerequisites: Record<string, boolean>;
    dependants: string[];
  }>;
  
  // RoleManager state
  agentConfigs: AgentConfig[];
  
  // WorkspaceManager config
  workspaceConfig: {
    repoPath: string;
    defaultBranch: string;
  };
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date;
}

class TeamStateRepository {
  async saveState(teamId: string, state: Partial<TeamStateDocument>): Promise<void> {
    await TeamStateModel.findByIdAndUpdate(
      teamId,
      { ...state, updatedAt: new Date() },
      { upsert: true }
    );
    logger.debug(`Team state saved to database: ${teamId}`);
  }
  
  async loadState(teamId: string): Promise<TeamStateDocument | null> {
    const doc = await TeamStateModel.findByIdAndUpdate(
      teamId,
      { lastAccessedAt: new Date() },
      { new: true }
    );
    
    if (doc) {
      logger.debug(`Team state loaded from database: ${teamId}`);
    }
    
    return doc?.toObject() || null;
  }
  
  async deleteState(teamId: string): Promise<void> {
    await TeamStateModel.findByIdAndDelete(teamId);
    logger.info(`Team state deleted from database: ${teamId}`);
  }
  
  async getAllTeamIds(): Promise<string[]> {
    const docs = await TeamStateModel.find({}, { _id: 1 });
    return docs.map(doc => doc._id);
  }
}

// For conversation history (optional enhancement):
interface ConversationDocument {
  _id: string;
  teamId: string;
  agentRole: string;
  threadId: string;
  messages: Array<{
    role: string;
    content: string;
    timestamp: number;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

class ConversationRepository {
  async saveMessages(
    teamId: string, 
    agentRole: string, 
    threadId: string, 
    messages: any[]
  ): Promise<void> {
    await ConversationModel.findOneAndUpdate(
      { teamId, agentRole, threadId },
      { messages, updatedAt: new Date() },
      { upsert: true }
    );
  }
  
  async loadMessages(
    teamId: string, 
    agentRole: string, 
    threadId: string
  ): Promise<any[]> {
    const doc = await ConversationModel.findOne({ teamId, agentRole, threadId });
    return doc?.messages || [];
  }
}
```

#### Migration from JSON to MongoDB
```typescript
// utils/migrateToDatabaseç
async function migrateJsonToDatabase(database: TeamStateRepository) {
  const dataDir = './data';
  const files = await fs.promises.readdir(dataDir);
  
  for (const file of files) {
    if (file.startsWith('memory-') && file.endsWith('.json')) {
      const teamId = file.replace('memory-', '').replace('.json', '');
      
      try {
        // Load JSON file
        const content = await fs.promises.readFile(
          path.join(dataDir, file), 
          'utf-8'
        );
        const data = JSON.parse(content);
        
        // Transform and save to database
        await database.saveState(teamId, {
          tasks: data.tasks || [],
          agentConfigs: [], // Load from separate files if needed
          workspaceConfig: {
            repoPath: `./workspaces/${teamId}`,
            defaultBranch: 'main'
          }
        });
        
        logger.info(`Migrated team ${teamId} to database`);
        
        // Optionally backup and delete JSON file
        await fs.promises.rename(
          path.join(dataDir, file),
          path.join(dataDir, 'backup', file)
        );
      } catch (err) {
        logger.error(`Failed to migrate team ${teamId}:`, err);
      }
    }
  }
}
```

## Migration Path

### Step 1: Update All Managers with Factory Pattern
- [ ] **MemoryManager**: Add `fromTasks()`, `empty()`, `getSerializableTasks()` methods
- [ ] **RoleManager**: Add `fromAgentConfigs()`, `fromTaskDescription()`, `getAgentConfigs()` methods
- [ ] **WorkspaceManager**: Add `create()` factory, `getConfig()` method
- [ ] Remove all internal persistence logic from managers

### Step 2: Implement Database Repository
- [ ] Create `TeamStateRepository` interface
- [ ] Implement in-memory version for testing
- [ ] Add `saveState()` and `loadState()` methods
- [ ] Test with single team

### Step 3: Update AgentManager
- [ ] Change constructor to private
- [ ] Implement `fromDatabase()` factory method
- [ ] Implement `fromTaskDescription()` factory method
- [ ] Add `saveToDatabase()` method
- [ ] Test rehydration cycle

### Step 4: Refactor AgentManagerAPI
- [ ] Add `TeamStateRepository` to constructor
- [ ] Update `getOrCreateAgentManager()` to use `fromDatabase()`
- [ ] Add auto-save in cleanup scheduler
- [ ] Add auto-save on shutdown
- [ ] Test multi-team caching

### Step 5: Update SocketServer
- [ ] Add `teamId` to registration flow
- [ ] Update message routing to call `saveToDatabase()` after task execution
- [ ] Test multi-team isolation
- [ ] Test state persistence across restarts

### Step 6: MongoDB Implementation (Production)
- [ ] Design MongoDB schemas
- [ ] Implement MongoDB-backed `TeamStateRepository`
- [ ] Create migration script from JSON to MongoDB
- [ ] Add conversation history persistence (optional)
- [ ] Deploy and monitor

## Benefits

1. **Consistent Architecture**: All managers follow the same pattern - factory methods + state getters, no internal persistence
2. **Clean Separation**: Business logic (managers) completely separated from persistence (database layer)
3. **Multi-tenancy**: Each team gets isolated AgentManager instance with database-backed state
4. **Performance**: Cache reuse (~10ms) vs fresh initialization (~15s) vs database load (~50-100ms)
5. **State preservation**: All state (tasks, roles, workspace) persists across restarts
6. **Scalability**: LRU cache with auto-save manages memory efficiently
7. **Cost reduction**: Avoid redundant LLM calls for role discovery
8. **Flexibility**: Easy to swap database implementations (in-memory → JSON → MongoDB)
9. **Testability**: Mock database layer for unit tests
10. **Reliability**: Auto-save on eviction and shutdown prevents data loss

## Testing Strategy

1. **Unit tests**: Test persist/rehydrate for each manager
2. **Integration tests**: Test full AgentManager rehydration cycle
3. **Load tests**: Verify cache eviction and memory management
4. **Multi-team tests**: Ensure proper isolation between teams

## Success Metrics

- [ ] All managers use factory pattern with no internal persistence
- [ ] Database repository handles all state storage and retrieval
- [ ] AgentManager loads from database in < 100ms (vs 15s+ for fresh init)
- [ ] Task state preserved across server restarts
- [ ] Role configurations cached and reused per team
- [ ] Memory usage stable with LRU eviction (< 500MB for 10 concurrent teams)
- [ ] Auto-save prevents data loss on eviction or shutdown
- [ ] Multi-team requests properly isolated
- [ ] MongoDB migration path validated with test data
