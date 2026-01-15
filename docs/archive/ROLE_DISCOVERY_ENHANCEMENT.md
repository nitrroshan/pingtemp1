# Role Discovery Event Enhancement

## Overview
Enhanced the `roleDiscovery` event to include full role details (name, goal, systemPrompt, capabilities, responsibilities) so the frontend can automatically create agent cards when roles are discovered by the backend.

## Changes Made

### Backend Changes

#### 1. AgentManager.ts
- **Added EventEmitter**: Re-added `public events: EventEmitter` property
- **Enhanced configureNewWorkflow()**: 
  - Emits `workflowStart` event when workflow configuration begins
  - Emits `roleDiscovery` event with full role details array:
    ```typescript
    {
      roles: [
        {
          name: "Researcher",
          goal: "Research and gather information",
          systemPrompt: "You are a researcher...",
          capabilities: [...],
          responsibilities: [...]
        },
        ...
      ],
      timestamp: 1234567890
    }
    ```
  - Emits `workerUpdate` events with `roleDetails` for each initialized worker:
    ```typescript
    {
      role: "researcher",
      status: "initialized",
      roleDetails: {
        name: "Researcher",
        goal: "...",
        systemPrompt: "..."
      },
      timestamp: 1234567890
    }
    ```

### Frontend Changes

#### 1. App.tsx

**Added Helper Function:**
```typescript
const getIconForRole = (roleName: string): string => {
  const role = roleName.toLowerCase();
  if (role.includes('research') || role.includes('analyst')) return 'Search';
  if (role.includes('write') || role.includes('content')) return 'FileText';
  if (role.includes('review') || role.includes('quality')) return 'CheckCircle';
  if (role.includes('code') || role.includes('dev')) return 'Code';
  if (role.includes('design')) return 'Palette';
  if (role.includes('test')) return 'TestTube';
  if (role.includes('data')) return 'Database';
  if (role.includes('plan') || role.includes('manage')) return 'Calendar';
  return 'Bot'; // Default icon
};
```

**Enhanced handleRoleDiscovery:**
- Parses the `roles` array from the event
- Creates Agent objects dynamically with:
  - ID: Generated unique ID
  - Name: From role.name
  - Role: From role.name
  - Description: From role.goal
  - System Instruction: From role.systemPrompt
  - Icon: Automatically determined by role name
- Adds agents as sub-agents to the Orchestrator
- Logs creation to console

**Enhanced handleWorkerUpdate:**
- Checks for `initialized` status with `roleDetails`
- Creates agent cards if they don't exist yet
- Prevents duplicate agent creation
- Adds as sub-agent to Orchestrator

## Event Flow

```
1. User: POST /api/createtask { description: "Analyze customer feedback" }
   ↓
2. Backend: AgentManager.configureNewWorkflow()
   ↓
3. Emit: workflowStart
   → Frontend: Logs workflow start
   ↓
4. Backend: RoleManager.getRoles() → AI discovers roles
   ↓
5. Emit: roleDiscovery
   → {
       roles: [
         { name: "Researcher", goal: "Gather customer feedback data", ... },
         { name: "Analyst", goal: "Analyze feedback patterns", ... },
         { name: "Writer", goal: "Create improvement suggestions", ... }
       ]
     }
   ↓
6. Frontend: handleRoleDiscovery()
   → Creates 3 Agent cards automatically
   → Adds them as sub-agents to Orchestrator
   → Sidebar shows: Orchestrator → Researcher, Analyst, Writer
   ↓
7. Backend: RoleManager.getRoleWorkers() → Initialize workers
   ↓
8. Emit: workerUpdate (for each worker)
   → {
       role: "researcher",
       status: "initialized",
       roleDetails: { name: "Researcher", goal: "...", systemPrompt: "..." }
     }
   ↓
9. Frontend: handleWorkerUpdate()
   → Verifies agent card exists (already created by roleDiscovery)
   → Updates orchestration panel with worker status
```

## UI Updates

### Before (Manual Agent Creation)
1. User creates workflow
2. Orchestrator agent appears
3. User manually adds sub-agents via modal
4. Backend has no knowledge of UI agents

### After (Automatic Role Discovery)
1. User creates workflow
2. Orchestrator agent appears
3. **Backend discovers roles automatically**
4. **Frontend receives roleDiscovery event**
5. **Agent cards appear dynamically in sidebar**
6. **Each agent card has:**
   - Name from backend
   - Goal/description from backend
   - Appropriate icon based on role
   - Ready for chat interaction

### Sidebar View
```
📊 Orchestrator (Active)
  ├─ 🔍 Researcher (Initialized)
  │   └─ Goal: Gather customer feedback data
  ├─ 📊 Analyst (Initialized)
  │   └─ Goal: Analyze feedback patterns
  └─ 📝 Writer (Initialized)
      └─ Goal: Create improvement suggestions
```

### AgentManagerPanel - Swarm View
- Shows real-time worker status
- Displays role names from backend
- Updates status as workers process tasks

## Testing

### Test 1: Basic Role Discovery
1. Start backend: `npm run api`
2. Start frontend: `cd src/AgentChat && npm run dev`
3. Create workflow: "Analyze customer feedback and suggest improvements"
4. **Expected:**
   - Console: `[App] Roles discovered: { roles: [...] }`
   - Console: `[App] Created agent cards for roles: Researcher, Analyst, Writer`
   - Sidebar: Shows Orchestrator with 3 sub-agents
   - AgentManagerPanel: Shows 3 active workers

### Test 2: Icon Mapping
Test role names and verify correct icons:
- "Researcher" → Search icon
- "Content Writer" → FileText icon
- "Code Reviewer" → CheckCircle icon
- "Developer" → Code icon
- "Designer" → Palette icon
- "Tester" → TestTube icon
- "Data Analyst" → Database icon
- "Project Manager" → Calendar icon
- "Unknown Role" → Bot icon (default)

### Test 3: Duplicate Prevention
1. Create workflow
2. Backend emits roleDiscovery (creates agents)
3. Backend emits workerUpdate with roleDetails
4. **Expected:** No duplicate agents created
5. **Verify:** `agents` array has unique entries

### Test 4: Chat Interaction
1. Create workflow with role discovery
2. Wait for agents to appear in sidebar
3. Click on "Researcher" agent
4. Send message in chat
5. **Expected:** Message routed to researcher worker
6. Backend sends agentResponse
7. Response appears in chat history

## Icon Reference

| Role Pattern | Icon | Lucide Icon Name |
|-------------|------|------------------|
| research, analyst | 🔍 | Search |
| write, content | 📝 | FileText |
| review, quality | ✅ | CheckCircle |
| code, dev | 💻 | Code |
| design | 🎨 | Palette |
| test | 🧪 | TestTube |
| data | 🗄️ | Database |
| plan, manage | 📅 | Calendar |
| default | 🤖 | Bot |

## Benefits

1. **Automatic UI Sync**: Frontend UI automatically reflects backend role discovery
2. **No Manual Agent Creation**: Users don't need to manually add agents
3. **Accurate Role Names**: Agent cards use exact role names from backend
4. **Descriptive Goals**: Each agent shows its specific goal from backend
5. **Real-time Updates**: UI updates immediately when roles are discovered
6. **Scalable**: Works with any number of roles discovered by AI

## Future Enhancements

1. **Dynamic Icon Selection**: Use AI to suggest icons based on role description
2. **Agent Status Indicators**: Show loading/processing/idle states per agent
3. **Role Capabilities Display**: Show tools/capabilities in agent card
4. **Role Dependencies**: Visualize which roles depend on others
5. **Agent Performance Metrics**: Track response times, success rates per role

## Troubleshooting

### Issue: Agents Not Appearing

**Symptoms:**
- roleDiscovery event received but no agents in sidebar

**Solution:**
1. Check browser console for `[App] Created agent cards for roles: ...`
2. Verify `data.roles` is an array in handleRoleDiscovery
3. Check agents state in React DevTools
4. Ensure Orchestrator exists before adding sub-agents

### Issue: Duplicate Agents

**Symptoms:**
- Same agent appears multiple times in sidebar

**Solution:**
1. Check if both roleDiscovery and workerUpdate create agents
2. Add duplicate check: `!agents.some(a => a.role === data.role)`
3. Clear agents state and refresh

### Issue: Wrong Icons

**Symptoms:**
- All agents have Bot icon

**Solution:**
1. Check role name casing (function uses `.toLowerCase()`)
2. Verify role names match patterns in `getIconForRole()`
3. Add custom mappings for specific roles

### Issue: Agent Cards Empty

**Symptoms:**
- Agents appear but have no description/goal

**Solution:**
1. Check backend emits full roleDetails in events
2. Verify `role.goal` exists in roleDiscovery event
3. Check AgentManager logs for role discovery output

## Related Files

- `src/worker/agentManager/agentManager.ts` - Event emission
- `src/worker/api/AgentManagerAPI.ts` - WebSocket broadcast
- `src/AgentChat/App.tsx` - Event handling and agent creation
- `src/AgentChat/services/AgentManagerService.ts` - WebSocket client
- `docs/EVENT_SYSTEM_INTEGRATION.md` - Overall event system docs
