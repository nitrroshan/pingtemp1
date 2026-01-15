# Team API Reference

**Manage teams, members, and agent delegation.** Teams are execution boundaries owned by managers who can delegate worker agents to employees.

---

## Base URL

```
https://api.ping.ai/v1
```

All endpoints require authentication via API key or OAuth token.

---

## Teams

### Create Team

Creates a new team with the manager as owner. Automatically includes a Planner Agent.

**Endpoint:**
```http
POST /teams
```

**Request Body:**
```typescript
{
  name: string                    // Team name
  description?: string            // Optional description
  visibility: 'private' | 'team'  // Who can see the team
}
```

**Response:**
```typescript
{
  id: string                      // Team ID
  name: string
  description: string
  visibility: 'private' | 'team'
  ownerId: string                 // Manager who created the team
  createdAt: string               // ISO 8601 timestamp
  workspace: {
    path: string                  // e.g., "/workspaces/team-abc123"
    rootUrl: string               // Git repository URL
  }
  agents: {
    planner: {
      id: string                  // Planner Agent (always included)
      role: 'planner'
      name: 'Planner Agent'
      ownedBy: string             // Manager (cannot be delegated)
    }
  }
}
```

**Example:**
```bash
curl -X POST https://api.ping.ai/v1/teams \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Product Team",
    "description": "Mobile app development team",
    "visibility": "team"
  }'
```

---

### Get Team

Retrieves team information including all agents and their ownership.

**Endpoint:**
```http
GET /teams/{teamId}
```

**Response:**
```typescript
{
  id: string
  name: string
  description: string
  visibility: 'private' | 'team'
  ownerId: string                 // Manager
  createdAt: string
  updatedAt: string
  
  workspace: {
    path: string
    rootUrl: string
    branches: string[]            // Active Git branches
  }
  
  agents: [
    {
      id: string
      role: string                // 'planner' | 'product-manager' | 'engineer' | etc.
      name: string
      ownedBy: string             // Manager or employee ID
      delegatedTo?: string        // Employee ID (if delegated)
      delegatedAt?: string        // When delegated
      capabilities: string[]
      mcps: Array<{
        server: string
        access: 'read-only' | 'read-write'
      }>
      customTools: string[]
    }
  ]
  
  members: [
    {
      userId: string
      role: 'owner' | 'member'
      joinedAt: string
      assignedAgents: string[]    // Agent IDs delegated to this user
    }
  ]
}
```

---

### List Teams

Lists all teams accessible to the authenticated user.

**Endpoint:**
```http
GET /teams
```

**Query Parameters:**
- `ownedBy` - Filter by owner ID (e.g., show only teams I own)
- `memberOf` - Filter by member ID (e.g., teams I'm a member of)
- `limit` - Max results (default: 20, max: 100)
- `offset` - Pagination offset

**Response:**
```typescript
{
  teams: [
    {
      id: string
      name: string
      description: string
      ownerId: string
      memberCount: number
      agentCount: number
      createdAt: string
    }
  ]
  pagination: {
    total: number
    limit: number
    offset: number
  }
}
```

---

### Update Team

Updates team settings (owner only).

**Endpoint:**
```http
PATCH /teams/{teamId}
```

**Request Body:**
```typescript
{
  name?: string
  description?: string
  visibility?: 'private' | 'team'
}
```

---

### Delete Team

Deletes team and all associated data (owner only).

**Endpoint:**
```http
DELETE /teams/{teamId}
```

**Response:**
```typescript
{
  success: boolean
  message: string
  deletedAt: string
}
```

---

## Team Members

### Add Member

Adds a user to the team (owner only).

**Endpoint:**
```http
POST /teams/{teamId}/members
```

**Request Body:**
```typescript
{
  userId: string                  // User to add
  role: 'member'                  // Only 'member' supported (owner is automatic)
}
```

**Response:**
```typescript
{
  userId: string
  role: 'member'
  joinedAt: string
  assignedAgents: []              // Empty initially
}
```

---

### Remove Member

Removes a member from the team. Automatically unassigns all delegated agents.

**Endpoint:**
```http
DELETE /teams/{teamId}/members/{userId}
```

**Response:**
```typescript
{
  success: boolean
  unassignedAgents: string[]      // Agents that were delegated to this user
  message: 'Member removed and agents reclaimed by owner'
}
```

---

## Agent Management

### Add Agent to Team

Adds a worker agent to the team. Only the owner can add agents.

**Endpoint:**
```http
POST /teams/{teamId}/agents
```

**Request Body:**
```typescript
{
  role: string                    // e.g., 'frontend-developer', 'qa-engineer'
  name: string                    // Display name
  capabilities: string[]
  mcps?: Array<{
    server: string
    access: 'read-only' | 'read-write'
  }>
  customTools?: string[]
}
```

**Response:**
```typescript
{
  id: string
  role: string
  name: string
  ownedBy: string                 // Team owner (initially)
  delegatedTo: null               // Not delegated yet
  capabilities: string[]
  mcps: [...]
  customTools: [...]
  createdAt: string
}
```

---

### Delegate Agent

Delegates a worker agent to a team member. Owner only. Planner Agent cannot be delegated.

**Endpoint:**
```http
POST /teams/{teamId}/agents/{agentId}/delegate
```

**Request Body:**
```typescript
{
  userId: string                  // Team member to delegate to
}
```

**Response:**
```typescript
{
  id: string
  role: string
  name: string
  ownedBy: string                 // Still the owner
  delegatedTo: string             // Employee ID
  delegatedAt: string
  message: 'Agent delegated successfully. Owner retains ownership and can reclaim anytime.'
}
```

**Errors:**
- `403` - Cannot delegate Planner Agent
- `404` - Agent or user not found
- `400` - User is not a team member

---

### Reclaim Agent

Reclaims a delegated agent back to the owner.

**Endpoint:**
```http
POST /teams/{teamId}/agents/{agentId}/reclaim
```

**Response:**
```typescript
{
  id: string
  role: string
  name: string
  ownedBy: string                 // Owner
  delegatedTo: null               // No longer delegated
  reclaimedAt: string
  message: 'Agent reclaimed by owner'
}
```

---

### Remove Agent

Removes an agent from the team (owner only). Cannot remove Planner Agent.

**Endpoint:**
```http
DELETE /teams/{teamId}/agents/{agentId}
```

**Response:**
```typescript
{
  success: boolean
  message: string
  removedAt: string
}
```

**Errors:**
- `403` - Cannot remove Planner Agent (required for team operation)

---

## Team Workspace

### Get Workspace Info

Retrieves team workspace structure and content.

**Endpoint:**
```http
GET /teams/{teamId}/workspace
```

**Response:**
```typescript
{
  path: string                    // Workspace path
  rootUrl: string                 // Git repository URL
  
  structure: {
    docs: {
      files: string[]
      size: number
    }
    code: {
      files: string[]
      size: number
    }
    designs: {
      files: string[]
      size: number
    }
    data: {
      files: string[]
      size: number
    }
  }
  
  recentActivity: [
    {
      type: 'file_created' | 'file_updated' | 'commit'
      path: string
      agentId: string
      timestamp: string
    }
  ]
  
  stats: {
    totalFiles: number
    totalSize: number
    lastUpdated: string
  }
}
```

---

### List Workspace Files

Lists files in team workspace with optional path filter.

**Endpoint:**
```http
GET /teams/{teamId}/workspace/files
```

**Query Parameters:**
- `path` - Filter by directory (e.g., `docs/`, `code/src/`)
- `type` - Filter by file type (e.g., `md`, `ts`, `json`)
- `limit` - Max results

**Response:**
```typescript
{
  files: [
    {
      path: string
      name: string
      type: string
      size: number
      createdBy: string           // Agent ID
      createdAt: string
      updatedAt: string
      gitCommit?: string          // Latest commit hash
    }
  ]
}
```

---

## Error Responses

**Standard Error Format:**
```typescript
{
  error: {
    code: string                  // e.g., 'TEAM_NOT_FOUND'
    message: string
    details?: any
  }
}
```

**Common Error Codes:**

| Code | Status | Description |
|------|--------|-------------|
| `TEAM_NOT_FOUND` | 404 | Team does not exist |
| `UNAUTHORIZED` | 401 | Invalid or missing API key |
| `FORBIDDEN` | 403 | User lacks permission (not owner) |
| `AGENT_CANNOT_BE_DELEGATED` | 403 | Planner Agent cannot be delegated |
| `AGENT_CANNOT_BE_REMOVED` | 403 | Planner Agent cannot be removed |
| `USER_NOT_MEMBER` | 400 | User is not a team member |
| `AGENT_ALREADY_DELEGATED` | 400 | Agent is already delegated |
| `INVALID_TEAM_NAME` | 400 | Team name is invalid |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |

---

## Rate Limits

- **Standard tier**: 100 requests/minute
- **Pro tier**: 1000 requests/minute
- **Enterprise tier**: Custom limits

Rate limit headers:
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1640000000
```

---

## Next Steps

- **[Orchestrator API](./orchestrator-api.md)** - Give goals to your team's Planner Agent
- **[WebSocket Events](./websocket-events.md)** - Real-time agent activity
- **[Artifact API](./artifact-api.md)** - Access team workspace artifacts
