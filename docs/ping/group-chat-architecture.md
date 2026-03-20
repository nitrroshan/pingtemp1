# Group Chat Architecture

**Feature:** Worker-to-Worker Collaboration via Time-Boxed Group Chats  
**Status:** Proposed  
**Last Updated:** January 24, 2026  
**Version:** 1.1 (with A2A readiness)  
**Parent Document:** [unified-orchestrator.md](unified-orchestrator.md)

---

## Overview

Group Chat enables workers to collaborate on complex decisions that require cross-role discussion. Instead of infinite back-and-forth task delegation, workers engage in a **time-boxed conversation** mediated by the Orchestrator.

### Key Principles

1. **Orchestrator as Moderator** — Workers don't talk directly; Orchestrator relays messages
2. **Time-Boxed** — Maximum 15 minutes (configurable) to prevent infinite loops
3. **Outcome Required** — Every session must produce agreed tasks or shared context
4. **User Visibility** — User can observe or participate at any time
5. **Turn-Based** — Round-robin turns, controlled by Orchestrator
6. **A2A Ready** — Uses `IAgentComm` abstraction for future direct/A2A communication

---

## Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     GROUP CHAT SYSTEM                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐                                                │
│  │   Worker A   │──── request_collaboration ────┐                │
│  │   (Writer)   │                               │                │
│  └──────────────┘                               ▼                │
│                                         ┌──────────────┐         │
│                                         │ Orchestrator │         │
│                                         │              │         │
│  ┌──────────────┐                       │ • Validates  │         │
│  │   Worker B   │◄── prompt to join ────│ • Requests   │         │
│  │   (Editor)   │                       │   approval   │         │
│  └──────────────┘                       │ • Moderates  │         │
│                                         └──────┬───────┘         │
│                                                │                  │
│                    ┌───────────────────────────┴──────┐          │
│                    ▼                                  ▼          │
│           ┌─────────────────┐              ┌─────────────────┐   │
│           │ GroupChatManager│              │  User (optional)│   │
│           │                 │              │  • Observe      │   │
│           │ • Session state │              │  • Participate  │   │
│           │ • Turn control  │              │  • End early    │   │
│           │ • Timer         │              └─────────────────┘   │
│           │ • Outcome       │                                    │
│           └─────────────────┘                                    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      GROUP CHAT FLOW                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  1. REQUEST                                                       │
│     Writer ──► request_collaboration(editor, "discuss tone")     │
│                        │                                          │
│  2. APPROVAL           ▼                                          │
│     Orchestrator ──► User: "Approve collaboration?"              │
│                        │                                          │
│  3. CREATE SESSION     ▼ (approved)                               │
│     GroupChatManager.createSession()                              │
│                        │                                          │
│  4. START DISCUSSION   ▼                                          │
│     ┌──────────────────────────────────────────────────────────┐ │
│     │ TURN 1: Writer                                            │ │
│     │   Orchestrator → Writer: "Start discussion on: tone"      │ │
│     │   Writer: "I'm thinking formal tone for intro..."         │ │
│     ├──────────────────────────────────────────────────────────┤ │
│     │ TURN 2: Editor                                            │ │
│     │   Orchestrator → Editor: [history] + "Your turn"          │ │
│     │   Editor: "Agree on intro, but casual for examples..."    │ │
│     ├──────────────────────────────────────────────────────────┤ │
│     │ TURN 3: Writer                                            │ │
│     │   Orchestrator → Writer: [history] + "Your turn"          │ │
│     │   Writer: "Agreed. I'll draft, you review sections 2-3"   │ │
│     ├──────────────────────────────────────────────────────────┤ │
│     │ TURN 4: Editor                                            │ │
│     │   Orchestrator → Editor: [history] + "Your turn"          │ │
│     │   Editor: "Confirmed. Agreed."                            │ │
│     └──────────────────────────────────────────────────────────┘ │
│                        │                                          │
│  5. DETECT AGREEMENT   ▼                                          │
│     GroupChatManager detects both said "Agreed"                   │
│                        │                                          │
│  6. EXTRACT OUTCOME    ▼                                          │
│     LLM extracts: tasks, context, summary                         │
│                        │                                          │
│  7. PROPOSE TASKS      ▼                                          │
│     Orchestrator → User: "New tasks from discussion: ..."        │
│                        │                                          │
│  8. APPROVE & QUEUE    ▼                                          │
│     User approves → Tasks queued                                  │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Interfaces

### GroupChatSession

```typescript
interface GroupChatSession {
  sessionId: string;
  
  // Participants
  initiator: string;           // Worker who requested
  participants: string[];      // All workers in chat (including initiator)
  userJoined: boolean;         // User participating (not just observing)
  
  // Topic & Goal
  topic: string;               // What they're discussing
  goal: string;                // Expected outcome type
  
  // Conversation State
  messages: GroupMessage[];
  currentTurn: string;         // Who should respond next
  turnCount: number;           // How many turns so far
  maxTurns: number;            // Limit to prevent runaway (default: 20)
  
  // Timing
  status: GroupChatStatus;
  startedAt: Date;
  maxDurationMs: number;       // Default: 15 minutes
  
  // Outcome
  outcome?: GroupChatOutcome;
}

type GroupChatStatus = 
  | 'pending_approval'   // Waiting for user to approve
  | 'active'             // Discussion in progress
  | 'concluded'          // Participants agreed
  | 'timeout'            // Time limit reached
  | 'cancelled'          // User or participant cancelled
  | 'failed';            // Error occurred

interface GroupMessage {
  id: string;
  from: string;          // 'writer' | 'editor' | 'user'
  content: string;
  timestamp: Date;
  type: MessageType;
}

type MessageType = 
  | 'discussion'     // Normal discussion
  | 'proposal'       // Proposing something specific
  | 'question'       // Asking for clarification
  | 'agreement'      // Signaling agreement
  | 'disagreement'   // Signaling disagreement
  | 'summary';       // Summarizing discussion

interface GroupChatOutcome {
  status: 'agreed' | 'partial' | 'no_agreement';
  agreedTasks: TaskDefinition[];
  sharedContext: Record<string, any>;
  summary: string;
  actionItems: ActionItem[];
}

interface ActionItem {
  description: string;
  assignedTo: string;
  priority: 'high' | 'medium' | 'low';
}
```

---

## GroupChatManager

### Class Definition

```typescript
class GroupChatManager extends EventEmitter {
  private sessions: Map<string, GroupChatSession> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private llm: ChatModel;
  
  constructor(private orchestrator: Orchestrator) {
    super();
  }
  
  // ═══════════════════════════════════════════════════════════════
  // SESSION LIFECYCLE
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Create a new group chat session (pending approval)
   */
  async createSession(
    initiator: string,
    participants: string[],
    topic: string,
    options?: GroupChatOptions
  ): Promise<GroupChatSession> {
    const session: GroupChatSession = {
      sessionId: generateId(),
      initiator,
      participants: [initiator, ...participants],
      userJoined: false,
      topic,
      goal: options?.goal ?? 'Reach agreement on approach',
      messages: [],
      currentTurn: initiator,
      turnCount: 0,
      maxTurns: options?.maxTurns ?? 20,
      status: 'pending_approval',
      startedAt: new Date(),
      maxDurationMs: (options?.maxDurationMinutes ?? 15) * 60 * 1000,
    };
    
    this.sessions.set(session.sessionId, session);
    this.emit('session:created', session);
    
    return session;
  }
  
  /**
   * Start session after user approval
   */
  async startSession(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);
    session.status = 'active';
    
    // Start timeout timer
    this.startTimer(sessionId);
    
    // Emit event for UI
    this.emit('session:started', session);
    
    // Get first message from initiator
    await this.promptParticipant(sessionId, session.initiator, 'start');
  }
  
  /**
   * User joins the session as participant
   */
  async userJoin(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);
    session.userJoined = true;
    session.participants.push('user');
    this.emit('session:userJoined', session);
  }
  
  /**
   * End session (by user or timeout)
   */
  async endSession(
    sessionId: string, 
    reason: 'agreed' | 'timeout' | 'cancelled' | 'user_ended'
  ): Promise<GroupChatOutcome> {
    const session = this.getSession(sessionId);
    
    // Clear timer
    this.clearTimer(sessionId);
    
    // Set status
    session.status = reason === 'agreed' ? 'concluded' : 
                     reason === 'timeout' ? 'timeout' : 'cancelled';
    
    // Extract outcome (even on timeout, try to get something useful)
    session.outcome = await this.extractOutcome(session);
    
    this.emit('session:ended', session);
    
    return session.outcome;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // MESSAGE HANDLING
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Process a message from a participant
   */
  async processMessage(
    sessionId: string,
    from: string,
    content: string
  ): Promise<ProcessMessageResult> {
    const session = this.getSession(sessionId);
    
    // Validate it's their turn (unless user, who can interject)
    if (from !== 'user' && from !== session.currentTurn) {
      throw new Error(`Not ${from}'s turn. Current turn: ${session.currentTurn}`);
    }
    
    // Classify message type
    const type = await this.classifyMessage(content);
    
    // Add to thread
    const message: GroupMessage = {
      id: generateId(),
      from,
      content,
      timestamp: new Date(),
      type,
    };
    session.messages.push(message);
    session.turnCount++;
    
    // Emit for real-time UI
    this.emit('message', { sessionId, message });
    
    // Check for conclusion
    if (await this.detectAgreement(session)) {
      const outcome = await this.endSession(sessionId, 'agreed');
      return { concluded: true, outcome };
    }
    
    // Check turn limit
    if (session.turnCount >= session.maxTurns) {
      const outcome = await this.endSession(sessionId, 'timeout');
      return { concluded: true, outcome, reason: 'max_turns_reached' };
    }
    
    // Rotate to next participant
    const nextTurn = this.getNextParticipant(session, from);
    session.currentTurn = nextTurn;
    
    // Prompt next participant
    await this.promptParticipant(sessionId, nextTurn, 'continue');
    
    return { concluded: false, nextTurn };
  }
  
  /**
   * User sends message (can interject anytime)
   */
  async userMessage(sessionId: string, content: string): Promise<void> {
    const session = this.getSession(sessionId);
    
    if (!session.userJoined) {
      session.userJoined = true;
      session.participants.push('user');
    }
    
    await this.processMessage(sessionId, 'user', content);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // TURN MANAGEMENT
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Get next participant in round-robin
   */
  private getNextParticipant(session: GroupChatSession, current: string): string {
    const participants = session.participants.filter(p => p !== 'user'); // User can interject
    const currentIndex = participants.indexOf(current);
    const nextIndex = (currentIndex + 1) % participants.length;
    return participants[nextIndex];
  }
  
  /**
   * Prompt a participant for their turn
   */
  private async promptParticipant(
    sessionId: string,
    participantId: string,
    phase: 'start' | 'continue'
  ): Promise<void> {
    const session = this.getSession(sessionId);
    const worker = this.orchestrator.getWorker(participantId);
    
    const prompt = phase === 'start'
      ? this.buildStartPrompt(session)
      : this.buildContinuePrompt(session);
    
    // Invoke worker with group chat context
    const response = await worker.invoke({
      type: 'group_chat',
      sessionId,
      prompt,
      history: session.messages,
      participants: session.participants,
      topic: session.topic,
    });
    
    // Process their response
    await this.processMessage(sessionId, participantId, response.content);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // AGREEMENT DETECTION
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Detect if participants have reached agreement
   */
  private async detectAgreement(session: GroupChatSession): Promise<boolean> {
    // Quick heuristic check first
    if (!this.hasAgreementSignals(session)) {
      return false;
    }
    
    // Use LLM for confirmation
    const prompt = `
      Analyze this group chat and determine if all participants have agreed.
      
      Topic: ${session.topic}
      Participants: ${session.participants.filter(p => p !== 'user').join(', ')}
      
      Recent messages:
      ${session.messages.slice(-6).map(m => `${m.from}: ${m.content}`).join('\n')}
      
      Return JSON:
      {
        "allAgreed": true/false,
        "confidence": 0.0-1.0,
        "reasoning": "..."
      }
    `;
    
    const result = await this.llm.invoke(prompt, { 
      responseFormat: AgreementCheckSchema 
    });
    
    return result.allAgreed && result.confidence > 0.8;
  }
  
  /**
   * Quick heuristic for agreement signals
   */
  private hasAgreementSignals(session: GroupChatSession): boolean {
    const recentMessages = session.messages.slice(-4);
    const agreementWords = ['agreed', 'confirmed', 'sounds good', 'let\'s do it', 'done', 'perfect'];
    
    const participantsAgreed = new Set<string>();
    
    for (const msg of recentMessages) {
      const lower = msg.content.toLowerCase();
      if (agreementWords.some(word => lower.includes(word))) {
        participantsAgreed.add(msg.from);
      }
    }
    
    // All non-user participants need to signal
    const workers = session.participants.filter(p => p !== 'user');
    return workers.every(w => participantsAgreed.has(w));
  }
  
  // ═══════════════════════════════════════════════════════════════
  // OUTCOME EXTRACTION
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Extract structured outcome from conversation
   */
  private async extractOutcome(session: GroupChatSession): Promise<GroupChatOutcome> {
    const prompt = `
      Extract the outcome from this group discussion between AI workers.
      
      Topic: ${session.topic}
      Goal: ${session.goal}
      Status: ${session.status}
      
      Full conversation:
      ${session.messages.map(m => `[${m.from}]: ${m.content}`).join('\n\n')}
      
      Extract:
      1. What was agreed upon (if anything)
      2. Specific tasks that should be created
      3. Shared context that should be passed to future tasks
      4. A brief summary
      5. Action items for each participant
      
      Return JSON:
      {
        "status": "agreed" | "partial" | "no_agreement",
        "agreedTasks": [
          { "description": "...", "assignedRole": "...", "priority": "high|medium|low" }
        ],
        "sharedContext": {
          "decisions": [...],
          "constraints": [...],
          "preferences": [...]
        },
        "summary": "...",
        "actionItems": [
          { "description": "...", "assignedTo": "...", "priority": "..." }
        ]
      }
    `;
    
    return await this.llm.invoke(prompt, { 
      responseFormat: GroupChatOutcomeSchema 
    });
  }
  
  // ═══════════════════════════════════════════════════════════════
  // TIMER MANAGEMENT
  // ═══════════════════════════════════════════════════════════════
  
  private startTimer(sessionId: string): void {
    const session = this.getSession(sessionId);
    
    const timer = setTimeout(async () => {
      if (session.status === 'active') {
        await this.endSession(sessionId, 'timeout');
      }
    }, session.maxDurationMs);
    
    this.timers.set(sessionId, timer);
    
    // Emit periodic warnings
    const warningAt = session.maxDurationMs - (2 * 60 * 1000); // 2 min warning
    setTimeout(() => {
      if (session.status === 'active') {
        this.emit('session:timeWarning', { sessionId, minutesLeft: 2 });
      }
    }, warningAt);
  }
  
  private clearTimer(sessionId: string): void {
    const timer = this.timers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(sessionId);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // PROMPTS
  // ═══════════════════════════════════════════════════════════════
  
  private buildStartPrompt(session: GroupChatSession): string {
    return `
You are starting a group discussion with other workers.

**Topic:** ${session.topic}
**Goal:** ${session.goal}
**Other participants:** ${session.participants.filter(p => p !== session.initiator).join(', ')}
**Time limit:** ${session.maxDurationMs / 60000} minutes

Start the discussion by stating your position or question clearly.
Keep responses focused and concise.
When you reach agreement, say "Agreed" or "Confirmed" clearly.
    `.trim();
  }
  
  private buildContinuePrompt(session: GroupChatSession): string {
    return `
You are in a group discussion with other workers.

**Topic:** ${session.topic}
**Goal:** ${session.goal}
**Turn:** ${session.turnCount + 1}/${session.maxTurns}

Respond to the discussion. Options:
- Add your perspective
- Ask clarifying questions
- Propose a solution
- Signal agreement ("Agreed", "Confirmed")
- Signal disagreement with alternative

Keep responses focused and concise.
    `.trim();
  }
  
  // ═══════════════════════════════════════════════════════════════
  // MESSAGE CLASSIFICATION
  // ═══════════════════════════════════════════════════════════════
  
  private async classifyMessage(content: string): Promise<MessageType> {
    const lower = content.toLowerCase();
    
    if (['agreed', 'confirmed', 'sounds good', 'done'].some(w => lower.includes(w))) {
      return 'agreement';
    }
    if (['disagree', 'don\'t think', 'instead'].some(w => lower.includes(w))) {
      return 'disagreement';
    }
    if (content.includes('?')) {
      return 'question';
    }
    if (['propose', 'suggest', 'how about', 'what if'].some(w => lower.includes(w))) {
      return 'proposal';
    }
    if (['in summary', 'to summarize', 'so we'].some(w => lower.includes(w))) {
      return 'summary';
    }
    
    return 'discussion';
  }
  
  // ═══════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════
  
  getSession(sessionId: string): GroupChatSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    return session;
  }
  
  getActiveSessions(): GroupChatSession[] {
    return Array.from(this.sessions.values())
      .filter(s => s.status === 'active');
  }
}

interface ProcessMessageResult {
  concluded: boolean;
  outcome?: GroupChatOutcome;
  nextTurn?: string;
  reason?: string;
}

interface GroupChatOptions {
  goal?: string;
  maxTurns?: number;
  maxDurationMinutes?: number;
}
```

---

## Orchestrator Integration

### Worker Tool: request_collaboration

```typescript
const requestCollaborationTool = tool(
  async ({ targetWorker, topic, goal }, context) => {
    const initiator = context.currentWorker;
    
    // Create session (pending approval)
    const session = await groupChatManager.createSession(
      initiator,
      [targetWorker],
      topic,
      { goal }
    );
    
    // Return pending status - Orchestrator will request user approval
    return {
      type: 'collaboration_request',
      sessionId: session.sessionId,
      from: initiator,
      with: targetWorker,
      topic,
      goal,
      status: 'pending_approval',
    };
  },
  {
    name: 'request_collaboration',
    description: 'Request a time-boxed discussion with another worker',
    schema: z.object({
      targetWorker: z.string().describe('The worker role to collaborate with'),
      topic: z.string().describe('What you want to discuss'),
      goal: z.string().optional().describe('Expected outcome of discussion'),
    }),
  }
);
```

### Orchestrator Handling

```typescript
class Orchestrator {
  private groupChatManager: GroupChatManager;
  
  async handleCollaborationRequest(
    request: CollaborationRequest
  ): Promise<OrchestratorResponse> {
    // Present to user for approval
    return {
      type: 'approval_required',
      category: 'collaboration',
      message: `${request.from} wants to discuss with ${request.with}`,
      details: {
        topic: request.topic,
        goal: request.goal,
        estimatedDuration: '15 minutes max',
      },
      actions: [
        { id: 'approve', label: 'Approve' },
        { id: 'approve_observe', label: 'Approve & Observe' },
        { id: 'approve_join', label: 'Approve & Join' },
        { id: 'reject', label: 'Reject' },
      ],
      sessionId: request.sessionId,
    };
  }
  
  async onCollaborationApproved(
    sessionId: string,
    userMode: 'none' | 'observe' | 'join'
  ): Promise<void> {
    // Start the session
    await this.groupChatManager.startSession(sessionId);
    
    if (userMode === 'join') {
      await this.groupChatManager.userJoin(sessionId);
    }
    
    // Subscribe to events for UI updates
    this.groupChatManager.on('message', (event) => {
      if (event.sessionId === sessionId) {
        this.emitToUser('groupChat:message', event);
      }
    });
    
    this.groupChatManager.on('session:ended', async (session) => {
      if (session.sessionId === sessionId) {
        // Create tasks from outcome
        await this.handleGroupChatOutcome(session);
      }
    });
  }
  
  async handleGroupChatOutcome(session: GroupChatSession): Promise<void> {
    const outcome = session.outcome;
    
    if (outcome.agreedTasks.length > 0) {
      // Present agreed tasks for approval
      await this.proposeTasksFromCollaboration(outcome.agreedTasks, session);
    }
    
    // Store shared context for dependent tasks
    if (Object.keys(outcome.sharedContext).length > 0) {
      await this.memoryManager.storeContext(
        `groupchat:${session.sessionId}`,
        outcome.sharedContext
      );
    }
  }
}
```

---

## UI Events

### Real-Time Updates

```typescript
// Events emitted to frontend
interface GroupChatEvents {
  'groupChat:created': {
    sessionId: string;
    topic: string;
    participants: string[];
    status: 'pending_approval';
  };
  
  'groupChat:started': {
    sessionId: string;
    participants: string[];
    currentTurn: string;
  };
  
  'groupChat:message': {
    sessionId: string;
    message: GroupMessage;
    currentTurn: string;
    turnCount: number;
  };
  
  'groupChat:timeWarning': {
    sessionId: string;
    minutesLeft: number;
  };
  
  'groupChat:ended': {
    sessionId: string;
    status: GroupChatStatus;
    outcome: GroupChatOutcome;
    duration: number;
  };
  
  'groupChat:userJoined': {
    sessionId: string;
  };
}
```

### UI Components Needed

```
┌─────────────────────────────────────────────────────────────┐
│                  GROUP CHAT PANEL                            │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Topic: Discuss tone and style for marketing copy            │
│  Participants: Writer, Editor                                │
│  Time: 12:34 remaining                      [End Chat]       │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ [Writer] I'm thinking formal tone for the intro,        │ │
│  │ but more conversational in the benefits section.        │ │
│  │                                           12:45:23      │ │
│  ├─────────────────────────────────────────────────────────┤ │
│  │ [Editor] I agree on formal intro. For benefits,         │ │
│  │ let's use bullet points with casual headers.            │ │
│  │                                           12:45:45      │ │
│  ├─────────────────────────────────────────────────────────┤ │
│  │ [Writer] Perfect. I'll draft sections 1-2, you          │ │
│  │ review section 3. Agreed?                               │ │
│  │                                           12:46:02      │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  Current turn: Editor                                        │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Type message to join discussion...                      │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Edge Cases & Error Handling

### Scenarios

| Scenario | Handling |
|----------|----------|
| **Worker doesn't respond** | Timeout per turn (60s), skip and prompt next |
| **Workers disagree completely** | Timeout → extract partial outcome → user decides |
| **User ends early** | Extract best-effort outcome from conversation |
| **Worker errors mid-chat** | Retry once, then end session with partial outcome |
| **Network disconnect** | Resume from last message on reconnect |
| **Nested collaboration request** | Reject - only one active session per worker |

### Recovery

```typescript
interface GroupChatRecovery {
  sessionId: string;
  lastMessageId: string;
  resumeFrom: 'last_message' | 'current_turn';
  retryCount: number;
  maxRetries: number;
}

async function recoverSession(sessionId: string): Promise<void> {
  const session = groupChatManager.getSession(sessionId);
  
  if (session.status !== 'active') {
    return; // Nothing to recover
  }
  
  // Resume from current turn
  await groupChatManager.promptParticipant(
    sessionId,
    session.currentTurn,
    'continue'
  );
}
```

---

## Configuration

```typescript
interface GroupChatConfig {
  // Timing
  defaultMaxDurationMinutes: number;  // Default: 15
  turnTimeoutSeconds: number;         // Default: 60
  warningBeforeEndMinutes: number;    // Default: 2
  
  // Limits
  maxTurns: number;                   // Default: 20
  maxParticipants: number;            // Default: 2 (+ optional user)
  maxConcurrentSessions: number;      // Default: 3
  
  // Behavior
  autoExtractOutcome: boolean;        // Default: true
  allowUserInterjection: boolean;     // Default: true
  requireAgreementFromAll: boolean;   // Default: true
  
  // LLM
  outcomeExtractionModel: string;     // Default: same as orchestrator
  agreementDetectionThreshold: number; // Default: 0.8
}
```

---

## MVP vs Future

### MVP Scope

| Feature | Included |
|---------|----------|
| 2-worker collaboration | ✅ |
| Orchestrator as relay | ✅ |
| Time-boxed (15 min) | ✅ |
| Turn-based round-robin | ✅ |
| Agreement detection | ✅ |
| Outcome extraction | ✅ |
| User observation | ✅ |
| User participation | ✅ |
| Basic UI panel | ✅ |

### Future Enhancements

| Feature | Phase |
|---------|-------|
| 3+ worker collaboration | Stable |
| Parallel turns (not round-robin) | Stable |
| Persistent session history | Stable |
| Direct communication (bypass relay) | Stable |
| Template-based discussions | Incremental 1 |
| Voting mechanism | Incremental 1 |
| Auto-mediation on conflict | Incremental 2 |
| A2A protocol for external agents | Incremental 2 |

---

## A2A Readiness

Group Chat uses the `IAgentComm` abstraction to enable future migration from relay to direct/A2A communication.

### Current: Relay Mode (MVP)

```
Worker A ◄───► Orchestrator ◄───► Worker B
                   │
                   ▼
            GroupChatManager
```

All messages go through Orchestrator. This provides:
- Full visibility and control
- User approval integration
- Conversation history management

### Future: Direct Mode (Stable)

```
Worker A ◄─────────────────────► Worker B
                   │
                   ▼
            GroupChatManager
            (monitoring only)
```

For trusted internal agents, bypass Orchestrator relay:
- Lower latency
- Less token usage
- Orchestrator monitors but doesn't relay

### Future: A2A Mode (Incremental 2)

```
Internal Worker ◄───── A2A Protocol ─────► External Agent
                            │
                            ▼
                   GroupChatManager
                   (protocol adapter)
```

For external agents via A2A protocol:
- Cross-organization collaboration
- Capability discovery
- Standard message format

### Using IAgentComm Abstraction

```typescript
class GroupChatManager extends EventEmitter {
  // Use abstraction, not concrete implementation
  constructor(
    private orchestrator: Orchestrator,
    private comm: IAgentComm  // ◄── Abstraction layer
  ) {
    super();
  }
  
  /**
   * Prompt a participant for their turn
   * Uses IAgentComm - works with relay, direct, or A2A
   */
  private async promptParticipant(
    sessionId: string,
    participantId: string,
    phase: 'start' | 'continue'
  ): Promise<void> {
    const session = this.getSession(sessionId);
    const prompt = this.buildPrompt(session, phase);
    
    // Get participant identity
    const participant = this.registry.get(participantId);
    
    // Use IAgentComm - implementation handles relay/direct/A2A
    const response = await this.comm.send(participant, {
      id: generateId(),
      from: this.orchestratorIdentity,
      to: participant,
      type: 'request',
      content: {
        action: 'group_chat_turn',
        payload: {
          sessionId,
          prompt,
          history: session.messages,
          topic: session.topic,
        },
      },
      metadata: {
        threadId: sessionId,
        timestamp: new Date(),
        ttl: 60000,  // 60 second timeout
      },
    });
    
    // Process response
    await this.processMessage(sessionId, participantId, response.content);
  }
}
```

### Configuration per Session

```typescript
interface GroupChatSession {
  // ... existing fields ...
  
  // Communication mode for this session
  commMode: 'relay' | 'direct' | 'a2a';
  
  // For mixed sessions (internal + external)
  participantModes: {
    [participantId: string]: 'relay' | 'direct' | 'a2a';
  };
}

// Example: mixed session
const session: GroupChatSession = {
  sessionId: 'gc-123',
  participants: ['writer', 'external-reviewer'],
  commMode: 'relay',  // Default
  participantModes: {
    'writer': 'direct',           // Internal, trusted
    'external-reviewer': 'a2a',   // External, use A2A
  },
  // ...
};
```

### Migration Path

| Phase | Group Chat Behavior |
|-------|--------------------|
| **MVP** | All relay through Orchestrator |
| **Stable** | Direct for trusted pairs, relay for others |
| **Incremental** | A2A for external participants |

---

## Related Documents

- [unified-orchestrator.md](unified-orchestrator.md) - Parent orchestrator design
- [architecture.md](architecture.md) - Overall system architecture
- [agent.md](agent.md) - Worker agent design

---

## Implementation Task

This feature is part of **Task-003: Orchestrator Agent**. Key implementation steps:

1. Create `GroupChatManager` class
2. **Use `IAgentComm` interface** for all participant communication
3. Add `request_collaboration` tool to workers
4. Integrate with Orchestrator message handling
5. Add agreement detection logic
6. Add outcome extraction with LLM
7. Emit events for UI
8. Create UI panel component

### Build Order

```
1. IAgentComm interface (from unified-orchestrator)
        │
        ▼
2. OrchestratorRelay implementation
        │
        ▼
3. GroupChatManager (uses IAgentComm)
        │
        ▼
4. Worker tools (request_collaboration)
        │
        ▼
5. UI components
```
