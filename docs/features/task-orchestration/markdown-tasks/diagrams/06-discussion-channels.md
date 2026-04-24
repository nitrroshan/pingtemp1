---
title: Discussion Communication Channels
---

```mermaid
flowchart LR
    subgraph Agents [Backend Agents]
        A1[Architect Agent]
        A2[Frontend-Dev Agent]
    end

    subgraph CRDT [Hocuspocus CRDT Layer]
        YArr["Y.Array('discussion')<br/>append-only blocks"]
        YMap["Y.Map('decisions')<br/>agreed outcomes"]
        YCur["Y.Map('cursors')<br/>per-agent read position"]
        YCfg["Y.Map('config')<br/>guard rails + status"]
    end

    subgraph Backend [Backend Services]
        Hoc[Hocuspocus Server]
        Sock[SocketServerV2]
        Proj[projectToFilesystem]
    end

    subgraph Frontend [React Frontend]
        DT[DiscussionThread<br/>yarray.observe]
        DP[DecisionPanel<br/>ymap.observe]
        DC[DiscussionComposer<br/>yarray.push]
        Toast[Notification Toast]
    end

    A1 -->|"collab discuss post"| YArr
    A2 -->|"collab discuss post"| YArr
    A1 -->|"collab discuss read<br/>(cursor filter)"| YArr
    A2 -->|"collab discuss read"| YArr
    A1 & A2 -->|"cursor update"| YCur

    YArr -->|"onChange"| Hoc
    Hoc -->|"discussion:activity"| Sock
    Hoc -->|"discussion:mention"| Sock
    Hoc -->|"auto-persist"| Hoc
    Hoc -->|"onChange"| Proj
    Proj -->|".json / .md files"| Proj

    Sock -->|"Socket.IO event"| Toast
    Sock -->|"Socket.IO event"| DT

    DC -->|"Y.Array.push<br/>(via HocuspocusProvider)"| YArr
    YArr -->|"yarray.observe()"| DT
    YMap -->|"ymap.observe()"| DP
```

**Key separation of concerns:**
- **CRDT (Hocuspocus)** — all discussion content. Agents read/write via `collab discuss`. Frontend reads via `yarray.observe()`, writes via `Y.Array.push()`.
- **Socket.IO** — notifications only. `discussion:activity` (badge counts), `discussion:mention` (@mention alerts). Does NOT carry discussion content.
- **projectToFilesystem** — read-only file projections for human browsing and post-mortem.
