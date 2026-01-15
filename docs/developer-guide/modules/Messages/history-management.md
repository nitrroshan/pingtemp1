# History Management

## Overview
Advanced techniques for managing conversation history, including pruning strategies, summarization, and memory optimization.

## The History Problem

### Token Limits
LLMs have context window limits:
- GPT-4: 8K-128K tokens
- GPT-3.5: 4K-16K tokens

### Cost Impact
```
100-message conversation:
- Input tokens: ~10,000
- Cost per API call: $0.10
- 1000 calls/day: $100/day = $3,000/month
```

### Latency Impact
```
Message Count → Processing Time
10 messages  → 1 second
50 messages  → 3 seconds
100 messages → 8 seconds
200 messages → 20+ seconds
```

## Pruning Strategies

### 1. Simple Truncation

Keep only the N most recent messages.

#### Implementation
```typescript
private readonly MAX_MESSAGES = 20;

private pruneSimple(): void {
  if (this.messages.length <= this.MAX_MESSAGES) return;
  
  // Keep system message + recent messages
  const systemMsg = this.messages[0];
  const recentMessages = this.messages.slice(-(this.MAX_MESSAGES - 1));
  
  this.messages = [systemMsg, ...recentMessages];
  
  logger.info('Messages pruned (simple)', {
    before: this.messages.length + (this.MAX_MESSAGES - 1),
    after: this.messages.length
  });
}
```

#### Pros
- Simple to implement
- Predictable behavior
- Fast execution

#### Cons
- Loses important early context
- May break conversation coherence
- Fixed window size

### 2. Sliding Window

Keep system message + last N user-AI exchanges.

#### Implementation
```typescript
private readonly MAX_EXCHANGES = 10;

private pruneSlidingWindow(): void {
  // Calculate max messages: 1 system + (N exchanges * 2)
  const maxMessages = 1 + (this.MAX_EXCHANGES * 2);
  
  if (this.messages.length <= maxMessages) return;
  
  const systemMsg = this.messages[0];
  
  // Get last N complete exchanges
  const recentMessages = this.messages.slice(-this.MAX_EXCHANGES * 2);
  
  this.messages = [systemMsg, ...recentMessages];
  
  logger.info('Messages pruned (sliding window)', {
    exchanges: this.MAX_EXCHANGES,
    totalMessages: this.messages.length
  });
}
```

#### Pros
- Maintains conversation structure
- Preserves complete exchanges
- Respects user-AI pairs

#### Cons
- Still loses early context
- Fixed exchange count

### 3. Token-Based Pruning

Prune based on actual token count, not message count.

#### Implementation
```typescript
import { encoding_for_model } from 'tiktoken';

private readonly MAX_TOKENS = 4000;

private pruneByTokens(): void {
  const encoder = encoding_for_model('gpt-4');
  
  try {
    // Calculate current token count
    let totalTokens = 0;
    for (const msg of this.messages) {
      totalTokens += encoder.encode(msg.content).length;
    }
    
    if (totalTokens <= this.MAX_TOKENS) return;
    
    // Keep system message
    const systemMsg = this.messages[0];
    const systemTokens = encoder.encode(systemMsg.content).length;
    
    // Add messages from newest to oldest
    const keptMessages: Message[] = [];
    let remainingTokens = this.MAX_TOKENS - systemTokens;
    
    for (let i = this.messages.length - 1; i > 0; i--) {
      const tokens = encoder.encode(this.messages[i].content).length;
      
      if (tokens > remainingTokens) break;
      
      remainingTokens -= tokens;
      keptMessages.unshift(this.messages[i]);
    }
    
    this.messages = [systemMsg, ...keptMessages];
    
    logger.info('Messages pruned (token-based)', {
      keptTokens: this.MAX_TOKENS - remainingTokens,
      keptMessages: this.messages.length
    });
  } finally {
    encoder.free();
  }
}
```

#### Pros
- Accurate token management
- Optimal context usage
- Prevents token limit errors

#### Cons
- Requires tiktoken library
- Slower than count-based
- More complex

### 4. Importance-Based Pruning

Keep important messages, drop less important ones.

#### Implementation
```typescript
interface ScoredMessage extends Message {
  importanceScore: number;
}

private pruneByImportance(): void {
  if (this.messages.length <= this.MAX_MESSAGES) return;
  
  // Score each message (except system)
  const scored: ScoredMessage[] = this.messages.slice(1).map(msg => ({
    ...msg,
    importanceScore: this.calculateImportance(msg)
  }));
  
  // Sort by importance
  scored.sort((a, b) => b.importanceScore - a.importanceScore);
  
  // Keep top N messages
  const kept = scored.slice(0, this.MAX_MESSAGES - 1);
  
  // Restore chronological order
  kept.sort((a, b) => 
    this.messages.indexOf(a) - this.messages.indexOf(b)
  );
  
  this.messages = [this.messages[0], ...kept];
  
  logger.info('Messages pruned (importance-based)', {
    avgScore: kept.reduce((sum, m) => sum + m.importanceScore, 0) / kept.length
  });
}

private calculateImportance(msg: Message): number {
  let score = 0;
  
  // Recent messages are more important
  const recency = this.messages.indexOf(msg) / this.messages.length;
  score += recency * 50;
  
  // Longer messages may be more important
  score += Math.min(msg.content.length / 100, 20);
  
  // Messages with code blocks are important
  if (msg.content.includes('```')) {
    score += 30;
  }
  
  // Questions are important
  if (msg.content.includes('?')) {
    score += 10;
  }
  
  // Error mentions are important
  if (/error|fail|issue/i.test(msg.content)) {
    score += 20;
  }
  
  return score;
}
```

#### Pros
- Preserves key information
- Intelligent selection
- Better context quality

#### Cons
- Complex logic
- Subjective scoring
- May miss context

### 5. Hierarchical Pruning

Different retention policies for different time periods.

#### Implementation
```typescript
private pruneHierarchical(): void {
  const now = Date.now();
  
  // Keep all messages from last 5 minutes
  const recent = this.messages.filter(msg => 
    (now - (msg.timestamp || 0)) < 5 * 60 * 1000
  );
  
  // Keep 1 in 3 from last hour
  const lastHour = this.messages.filter(msg => {
    const age = now - (msg.timestamp || 0);
    return age >= 5 * 60 * 1000 && age < 60 * 60 * 1000;
  });
  const sampledHour = lastHour.filter((_, i) => i % 3 === 0);
  
  // Keep 1 in 10 from older
  const older = this.messages.filter(msg =>
    (now - (msg.timestamp || 0)) >= 60 * 60 * 1000
  );
  const sampledOld = older.filter((_, i) => i % 10 === 0);
  
  // Combine
  this.messages = [
    this.messages[0],  // System
    ...sampledOld,
    ...sampledHour,
    ...recent
  ].sort((a, b) => 
    (a.timestamp || 0) - (b.timestamp || 0)
  );
  
  logger.info('Messages pruned (hierarchical)', {
    recent: recent.length,
    hour: sampledHour.length,
    old: sampledOld.length
  });
}
```

#### Pros
- Balances recency and history
- Good for long conversations
- Adaptive retention

#### Cons
- Requires timestamps
- Complex logic
- May have gaps

## Summarization

### When to Summarize
- History exceeds token limit
- Long-running conversations
- Important context must be preserved
- Before archiving

### Basic Summarization

#### Implementation
```typescript
private async summarizeOldMessages(): Promise<void> {
  if (this.messages.length <= 30) return;
  
  const systemMsg = this.messages[0];
  const oldMessages = this.messages.slice(1, -15);  // Oldest to -15
  const recentMessages = this.messages.slice(-15);  // Keep last 15
  
  // Create summary prompt
  const conversation = oldMessages
    .map(m => `${m.role}: ${m.content}`)
    .join('\n');
  
  const summaryPrompt = `Summarize this conversation in 3-5 sentences, 
  preserving key decisions, outcomes, and context:\n\n${conversation}`;
  
  // Get summary from LLM
  const summary = await this.getSummary(summaryPrompt);
  
  // Replace old messages with summary
  this.messages = [
    systemMsg,
    {
      role: 'system',
      content: `Previous conversation summary:\n${summary}`
    },
    ...recentMessages
  ];
  
  logger.info('Messages summarized', {
    originalCount: oldMessages.length,
    newCount: this.messages.length
  });
}

private async getSummary(prompt: string): Promise<string> {
  const model = new ChatOpenAI({
    modelName: 'gpt-4',
    temperature: 0
  });
  
  const response = await model.invoke(prompt);
  return response.content;
}
```

### Structured Summarization

Keep structured information in summary.

#### Implementation
```typescript
interface ConversationSummary {
  topic: string;
  keyDecisions: string[];
  completedTasks: string[];
  pendingIssues: string[];
  codeChanges: string[];
}

private async structuredSummarize(): Promise<void> {
  const oldMessages = this.messages.slice(1, -15);
  
  const summaryPrompt = `Analyze this conversation and provide a structured summary:
  
Conversation:
${oldMessages.map(m => `${m.role}: ${m.content}`).join('\n')}

Return JSON with:
- topic: Main topic/goal
- keyDecisions: Important decisions made
- completedTasks: Tasks that were completed
- pendingIssues: Unresolved issues
- codeChanges: Code modifications made
`;

  const response = await this.getSummary(summaryPrompt);
  const summary: ConversationSummary = JSON.parse(response);
  
  // Create formatted summary message
  const summaryText = `Previous conversation summary:

**Topic:** ${summary.topic}

**Key Decisions:**
${summary.keyDecisions.map(d => `- ${d}`).join('\n')}

**Completed Tasks:**
${summary.completedTasks.map(t => `- ${t}`).join('\n')}

**Pending Issues:**
${summary.pendingIssues.map(i => `- ${i}`).join('\n')}

**Code Changes:**
${summary.codeChanges.map(c => `- ${c}`).join('\n')}
`;

  this.messages = [
    this.messages[0],  // System
    { role: 'system', content: summaryText },
    ...this.messages.slice(-15)
  ];
}
```

### Incremental Summarization

Summarize in chunks as conversation grows.

#### Implementation
```typescript
private summaries: string[] = [];
private lastSummaryIndex = 0;

private async incrementalSummarize(): Promise<void> {
  const CHUNK_SIZE = 20;
  const messagesToSummarize = this.messages.slice(
    this.lastSummaryIndex + 1,
    -10  // Don't summarize recent messages
  );
  
  if (messagesToSummarize.length < CHUNK_SIZE) return;
  
  // Summarize this chunk
  const chunkSummary = await this.getSummary(
    messagesToSummarize.map(m => `${m.role}: ${m.content}`).join('\n')
  );
  
  this.summaries.push(chunkSummary);
  this.lastSummaryIndex = this.messages.length - 10;
  
  // Create combined summary message
  const allSummaries = this.summaries.join('\n\n---\n\n');
  
  this.messages = [
    this.messages[0],  // System
    { role: 'system', content: `Conversation history:\n${allSummaries}` },
    ...this.messages.slice(-10)
  ];
  
  logger.info('Incremental summary created', {
    summaryCount: this.summaries.length
  });
}
```

## Hybrid Strategies

Combine multiple approaches.

### Token-Based + Importance
```typescript
private pruneHybrid(): void {
  // First, prune by importance
  this.pruneByImportance();
  
  // Then, check token count
  const tokens = this.countTokens();
  
  if (tokens > this.MAX_TOKENS) {
    // Further prune by tokens
    this.pruneByTokens();
  }
}
```

### Sliding Window + Summarization
```typescript
private async pruneWithSummary(): Promise<void> {
  if (this.messages.length <= 30) {
    return;  // No pruning needed
  }
  
  if (this.messages.length <= 50) {
    // Just use sliding window
    this.pruneSlidingWindow();
  } else {
    // Use summarization for very long conversations
    await this.summarizeOldMessages();
  }
}
```

## Monitoring and Metrics

### Track History Size
```typescript
private logHistoryMetrics(): void {
  const userMessages = this.messages.filter(m => m.role === 'user').length;
  const aiMessages = this.messages.filter(m => m.role === 'ai').length;
  const tokens = this.countTokens();
  
  logger.info('History metrics', {
    totalMessages: this.messages.length,
    userMessages,
    aiMessages,
    tokens,
    estimatedCost: (tokens / 1000) * 0.03  // $0.03 per 1K tokens
  });
}
```

### Alert on Growth
```typescript
private checkHistoryHealth(): void {
  if (this.messages.length > 100) {
    logger.warn('Message history very large', {
      count: this.messages.length
    });
  }
  
  const tokens = this.countTokens();
  if (tokens > 6000) {
    logger.warn('Token count approaching limit', { tokens });
  }
}
```

## Best Practices

### 1. Prune Before Invoke
```typescript
private async callAgent(input: string, thread_id: string): Promise<any> {
  this.pruneMessages();  // Always prune first
  
  this.messages.push({ role: 'user', content: input });
  const response = await this.agent.invoke(...);
  
  return response;
}
```

### 2. Choose Strategy Based on Use Case
```
Short conversations (<30 messages):    No pruning
Medium conversations (30-50):          Sliding window
Long conversations (50-100):           Token-based
Very long (>100):                      Summarization
```

### 3. Preserve System Message
```typescript
// Always keep the system message
const systemMsg = this.messages[0];
// ... prune other messages ...
this.messages = [systemMsg, ...prunedMessages];
```

### 4. Log Pruning Actions
```typescript
logger.info('Messages pruned', {
  before: oldLength,
  after: this.messages.length,
  strategy: 'sliding-window'
});
```

### 5. Test Pruning Logic
```typescript
test('pruning preserves system message', () => {
  const worker = new AgentWorker('test', config);
  const systemMsg = worker['messages'][0];
  
  // Add many messages
  for (let i = 0; i < 100; i++) {
    worker['messages'].push({ role: 'user', content: `msg${i}` });
  }
  
  worker['pruneMessages']();
  
  expect(worker['messages'][0]).toBe(systemMsg);
});
```

## Performance Considerations

### Pruning Overhead
```
Simple truncation:      O(n) - Fast
Sliding window:         O(n) - Fast
Token-based:            O(n*m) - Slower (m = avg message length)
Importance-based:       O(n log n) - Medium (sorting)
Summarization:          O(n) + LLM call - Slow
```

### When to Prune
```
Before each invoke:     Safe, consistent
Every N messages:       Less overhead
On token threshold:     Optimal, more complex
```

## Related Documentation

- [Messages Overview](./README.md)
- [Context Persistence](./context-persistence.md)
- [AgentWorker](../README.md)
