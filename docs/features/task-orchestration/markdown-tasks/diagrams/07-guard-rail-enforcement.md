---
title: Guard Rail Enforcement Flow
---

```mermaid
flowchart TD
    A[Agent calls collab discuss post] --> B{Check Y.Map config}
    B --> C{totalTokensUsed < maxTokens?}
    C -->|No| D[Reject: Token limit hit]
    D --> E[Escalate to planner]
    C -->|Yes| F{roundsPerAgent[role] < maxRounds?}
    F -->|No| G[Reject: Round limit hit]
    G --> E
    F -->|Yes| H{config.status === 'active'?}
    H -->|No| I[Reject: Discussion closed]
    H -->|Yes| J[Push block to Y.Array]
    J --> K[Update config.totalTokensUsed]
    J --> L[Update config.roundsPerAgent]
    J --> M[Reset timeout timer]
    
    N[Timeout timer fires] --> O{Any blocks in last N min?}
    O -->|No| P{escalationPaused?}
    P -->|No| E
    P -->|Yes user active| Q[Wait 2× timeout]
    O -->|Yes| R[Timer reset]

    style D fill:#f44336,color:white
    style G fill:#f44336,color:white
    style I fill:#9E9E9E,color:white
    style J fill:#4CAF50,color:white
    style E fill:#FF9800,color:white
```
