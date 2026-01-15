# Artifact API Reference

**Access and manage team workspace artifacts.** All agent-created outputs are stored as version-controlled artifacts.

---

## Base URL

```
https://api.ping.ai/v1
```

All endpoints require authentication and team access.

---

## Artifacts

### List Artifacts

Lists all artifacts in team workspace with optional filters.

**Endpoint:**
```http
GET /teams/{teamId}/artifacts
```

**Query Parameters:**
- `path` - Filter by directory path (e.g., `docs/`, `code/src/`)
- `type` - Filter by file type (e.g., `md`, `ts`, `json`, `png`)
- `createdBy` - Filter by agent ID
- `taskId` - Filter by task that created the artifact
- `goalId` - Filter by goal execution
- `since` - Return artifacts created after this timestamp
- `limit` - Max results (default: 50, max: 200)
- `offset` - Pagination offset

**Response:**
```typescript
{
  artifacts: [
    {
      id: string
      path: string              // e.g., 'docs/api-documentation.md'
      name: string              // File name
      type: string              // File extension
      size: number              // Bytes
      
      created: {
        by: string              // Agent ID
        at: string              // ISO 8601 timestamp
        taskId?: string
        goalId?: string
      }
      
      updated: {
        by: string
        at: string
        version: number         // Revision count
      }
      
      git: {
        commit: string          // Latest commit hash
        branch: string          // Current branch
        url: string             // Git blob URL
      }
      
      approval: {
        status: 'pending' | 'approved' | 'rejected'
        by?: string             // User ID who approved/rejected
        at?: string
        comment?: string
      }
    }
  ]
  
  pagination: {
    total: number
    limit: number
    offset: number
  }
}
```

**Example:**
```bash
curl -X GET 'https://api.ping.ai/v1/teams/team-123/artifacts?type=md&limit=20' \
  -H "Authorization: Bearer $TOKEN"
```

---

### Get Artifact

Retrieves a specific artifact with full metadata and content.

**Endpoint:**
```http
GET /teams/{teamId}/artifacts/{artifactId}
```

**Response:**
```typescript
{
  id: string
  path: string
  name: string
  type: string
  size: number
  
  content: string               // File content (UTF-8 text files)
  encoding: 'utf-8' | 'base64'  // 'base64' for binary files
  
  created: {
    by: string
    agentName: string
    at: string
    taskId?: string
    goalId?: string
  }
  
  updated: {
    by: string
    at: string
    version: number
  }
  
  git: {
    commit: string
    branch: string
    url: string
    history: [
      {
        commit: string
        message: string
        author: string          // Agent ID
        timestamp: string
      }
    ]
  }
  
  approval: {
    status: 'pending' | 'approved' | 'rejected'
    by?: string
    at?: string
    comment?: string
  }
  
  metadata: {
    language?: string           // For code files
    lineCount?: number
    wordCount?: number          // For text files
  }
}
```

---

### Get Artifact by Path

Retrieves artifact using workspace path instead of ID.

**Endpoint:**
```http
GET /teams/{teamId}/workspace/files
```

**Query Parameter:**
- `path` - Full workspace path (e.g., `docs/api-documentation.md`)

**Response:** Same as Get Artifact

**Example:**
```bash
curl -X GET 'https://api.ping.ai/v1/teams/team-123/workspace/files?path=docs/api-docs.md' \
  -H "Authorization: Bearer $TOKEN"
```

---

### Download Artifact

Downloads artifact content as raw file.

**Endpoint:**
```http
GET /teams/{teamId}/artifacts/{artifactId}/download
```

**Response:**
- Content-Type: Based on file type (e.g., `text/markdown`, `application/json`, `image/png`)
- Content-Disposition: `attachment; filename="api-documentation.md"`
- Body: Raw file content

**Example:**
```bash
curl -X GET https://api.ping.ai/v1/teams/team-123/artifacts/artifact-001/download \
  -H "Authorization: Bearer $TOKEN" \
  -o api-documentation.md
```

---

### Get Artifact Versions

Retrieves version history for an artifact.

**Endpoint:**
```http
GET /teams/{teamId}/artifacts/{artifactId}/versions
```

**Response:**
```typescript
{
  artifactId: string
  path: string
  
  versions: [
    {
      version: number
      commit: string
      updatedBy: string
      updatedAt: string
      message: string
      changes: {
        linesAdded: number
        linesRemoved: number
        sizeDelta: number
      }
    }
  ]
  
  currentVersion: number
}
```

---

### Get Artifact Version Content

Retrieves content of a specific version.

**Endpoint:**
```http
GET /teams/{teamId}/artifacts/{artifactId}/versions/{version}
```

**Response:**
```typescript
{
  id: string
  path: string
  version: number
  content: string
  encoding: 'utf-8' | 'base64'
  
  metadata: {
    commit: string
    updatedBy: string
    updatedAt: string
  }
}
```

---

## Artifact Approval

### Approve Artifact

Approves an artifact for release/use.

**Endpoint:**
```http
POST /teams/{teamId}/artifacts/{artifactId}/approve
```

**Request Body:**
```typescript
{
  comment?: string              // Optional approval comment
}
```

**Response:**
```typescript
{
  id: string
  path: string
  approval: {
    status: 'approved'
    by: string                  // Your user ID
    at: string
    comment?: string
  }
}
```

---

### Reject Artifact

Rejects an artifact with feedback for agents.

**Endpoint:**
```http
POST /teams/{teamId}/artifacts/{artifactId}/reject
```

**Request Body:**
```typescript
{
  comment: string               // Required: Reason for rejection
  requestChanges?: string       // Optional: Specific changes needed
}
```

**Response:**
```typescript
{
  id: string
  path: string
  approval: {
    status: 'rejected'
    by: string
    at: string
    comment: string
  }
  
  notification: {
    agentNotified: string       // Agent that created it
    taskId?: string             // Related task (if any)
    message: 'Agent notified of rejection with feedback'
  }
}
```

---

### Request Artifact Changes

Requests specific changes to an artifact without fully rejecting it.

**Endpoint:**
```http
POST /teams/{teamId}/artifacts/{artifactId}/request-changes
```

**Request Body:**
```typescript
{
  changes: [
    {
      section?: string          // e.g., 'Authentication section'
      issue: string             // What needs to change
      suggestion?: string       // How to fix it
    }
  ]
  assignTo?: string             // Agent ID to handle changes
}
```

**Response:**
```typescript
{
  id: string
  path: string
  changeRequest: {
    requestedBy: string
    requestedAt: string
    changes: [...]
    assignedTo?: string
  }
  
  taskCreated?: {
    id: string
    name: string
    description: string
    assignedTo: string
  }
}
```

---

## Artifact Export

### Export Artifacts

Exports multiple artifacts as a zip archive.

**Endpoint:**
```http
POST /teams/{teamId}/artifacts/export
```

**Request Body:**
```typescript
{
  artifactIds?: string[]        // Specific artifacts (or all if omitted)
  path?: string                 // Export all in path (e.g., 'docs/')
  format: 'zip' | 'tar.gz'
}
```

**Response:**
- Content-Type: `application/zip` or `application/x-tar`
- Content-Disposition: `attachment; filename="team-123-artifacts.zip"`
- Body: Archive file

---

### Export to External Storage

Exports artifacts to external storage (S3, Azure Blob, etc.).

**Endpoint:**
```http
POST /teams/{teamId}/artifacts/export-external
```

**Request Body:**
```typescript
{
  destination: {
    type: 's3' | 'azure-blob' | 'gcs'
    bucket: string
    path?: string
    credentials?: {
      accessKeyId?: string
      secretAccessKey?: string
      // ... other provider-specific credentials
    }
  }
  
  artifactIds?: string[]
  path?: string
}
```

**Response:**
```typescript
{
  exportId: string
  status: 'exporting'
  destination: {
    type: string
    bucket: string
    path: string
  }
  
  progress: {
    total: number
    exported: number
    failed: number
  }
  
  _links: {
    status: string              // Check export progress
  }
}
```

---

## Workspace Operations

### Get Workspace Tree

Retrieves full directory structure of team workspace.

**Endpoint:**
```http
GET /teams/{teamId}/workspace/tree
```

**Query Parameters:**
- `depth` - Max directory depth (default: unlimited)
- `includeFiles` - Include files in tree (default: true)

**Response:**
```typescript
{
  teamId: string
  workspace: string
  
  tree: {
    name: string                // Root folder name
    type: 'directory'
    path: '/'
    children: [
      {
        name: 'docs'
        type: 'directory'
        path: '/docs'
        children: [
          {
            name: 'api-documentation.md'
            type: 'file'
            path: '/docs/api-documentation.md'
            size: 15420
            createdBy: 'agent-790'
          }
        ]
      },
      {
        name: 'code'
        type: 'directory'
        path: '/code'
        children: [...]
      }
    ]
  }
  
  stats: {
    totalFiles: number
    totalDirectories: number
    totalSize: number
  }
}
```

---

### Create Directory

Creates a new directory in workspace.

**Endpoint:**
```http
POST /teams/{teamId}/workspace/directories
```

**Request Body:**
```typescript
{
  path: string                  // e.g., 'docs/api/v2'
}
```

**Response:**
```typescript
{
  path: string
  createdAt: string
  gitCommit: string
}
```

---

### Search Artifacts

Full-text search across all text artifacts.

**Endpoint:**
```http
GET /teams/{teamId}/artifacts/search
```

**Query Parameters:**
- `q` - Search query
- `path` - Limit search to path (e.g., `docs/`)
- `type` - File type filter
- `limit` - Max results

**Response:**
```typescript
{
  query: string
  results: [
    {
      artifactId: string
      path: string
      name: string
      score: number             // Relevance score (0-1)
      
      matches: [
        {
          line: number
          content: string       // Matched line
          highlight: string     // With search terms highlighted
        }
      ]
    }
  ]
  
  totalResults: number
}
```

---

## Git Operations

### Get Workspace Git Status

Retrieves Git status of workspace.

**Endpoint:**
```http
GET /teams/{teamId}/workspace/git/status
```

**Response:**
```typescript
{
  branch: string                // Current branch
  commit: string                // Latest commit hash
  
  status: {
    modified: string[]
    added: string[]
    deleted: string[]
    untracked: string[]
  }
  
  remote: {
    url: string
    ahead: number               // Commits ahead of remote
    behind: number              // Commits behind remote
  }
}
```

---

### Create Branch

Creates a new Git branch for workspace.

**Endpoint:**
```http
POST /teams/{teamId}/workspace/git/branches
```

**Request Body:**
```typescript
{
  name: string                  // Branch name
  from?: string                 // Base branch (default: current)
}
```

**Response:**
```typescript
{
  name: string
  commit: string
  createdAt: string
}
```

---

### List Branches

Lists all branches in workspace.

**Endpoint:**
```http
GET /teams/{teamId}/workspace/git/branches
```

**Response:**
```typescript
{
  branches: [
    {
      name: string
      commit: string
      isCurrent: boolean
      lastUpdated: string
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
    code: string
    message: string
    details?: any
  }
}
```

**Common Error Codes:**

| Code | Status | Description |
|------|--------|-------------|
| `ARTIFACT_NOT_FOUND` | 404 | Artifact does not exist |
| `PATH_NOT_FOUND` | 404 | Workspace path not found |
| `ACCESS_DENIED` | 403 | User lacks permission |
| `APPROVAL_REQUIRED` | 403 | Artifact must be approved first |
| `FILE_TOO_LARGE` | 413 | File exceeds max size (100MB) |
| `INVALID_PATH` | 400 | Invalid workspace path |
| `EXPORT_FAILED` | 500 | Export operation failed |

---

## Rate Limits

- **Standard tier**: 100 requests/minute
- **Pro tier**: 1000 requests/minute
- **Enterprise tier**: Custom limits

---

## Next Steps

- **[Orchestrator API](./orchestrator-api.md)** - Create goals that produce artifacts
- **[WebSocket Events](./websocket-events.md)** - Real-time artifact creation events
- **[Team API](./team-api.md)** - Manage team workspace access
