# Teams Integration — Feature Architecture

**Status:** New  
**Date:** March 29, 2026  
**ID:** E6  
**Depends on:** B1 (Team Package), E5 (Team Service)

---

## Overview

Wire teams into both **frontend** and **CLI**. Frontend uses team-based separation via AgentManager (through backend API). CLI directly imports and uses AgentManager from the teams package.

### Current State
- Frontend has basic team/agent listing via HTTP
- CLI exists (v1.0) but doesn't interact with teams
- No team-scoped agent management in either interface

### Target State

```
Frontend                              CLI
  │                                    │
  │ HTTP/WebSocket                     │ Direct import
  │ (team-scoped routes)               │ 
  ▼                                    ▼
Backend API                     @ping/teams package
  │                                    │
  │ imports                            │ same code
  ▼                                    ▼
@ping/teams package             AgentManager (per team)
  └── AgentManager                └── Local execution
       └── Per-team agents              └── No server needed
```

### Frontend Integration

```
/teams                    — Team list
/teams/:id                — Team dashboard  
/teams/:id/agents         — Team agents
/teams/:id/agents/:role   — Agent chat (scoped to team)
/teams/:id/tasks          — Task list with DAG visualization
/teams/:id/plan           — Plan approval UI
```

### CLI Integration

```bash
ping team list                    # List teams
ping team create "My Team"        # Create team
ping team use engineering         # Switch to team context
ping chat researcher              # Chat with team's researcher agent
ping plan "Build a REST API"      # Submit goal to orchestrator
ping tasks                        # View task DAG
ping resume T-001                 # Resume task from git branch
```

**Effort:** Medium (2-3 weeks)
