# API Types

This folder contains all type definitions for the API module (HTTP and WebSocket servers).

## Type Files

### User.types.ts
Defines user account types:
- `User` - User account with activity tracking

### SocketConnection.types.ts
Defines WebSocket connection types:
- `SocketConnection` - Active Socket.IO connection with subscription tracking

## Usage

Import types from the barrel export:

```typescript
import type { User, SocketConnection } from './types/index.js';
```

## Type Descriptions

### User
Represents a user account with:
- **userId** - Unique user identifier
- **lastActive** - Timestamp of last activity
- **createdAt** - Account creation timestamp

### SocketConnection
Represents an active WebSocket connection with:
- **connectionId** - Unique connection identifier
- **userId** - Associated user ID
- **socket** - Socket.IO socket instance
- **subscribedAgents** - Set of agent IDs subscribed to
- **connectedAt** - Connection establishment timestamp

## Database Migration Notes

Both UserManager and SocketConnectionManager are designed with database migration in mind:
- Currently use in-memory Maps
- TODO: Migrate to Redis/MongoDB/PostgreSQL
- Type definitions remain consistent regardless of storage backend
