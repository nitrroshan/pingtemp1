/**
 * @ping/shared — Barrel export.
 *
 * Single entry point for all shared types.
 * Import: `import type { StreamPart, ClientToServerEvents } from '@ping/shared'`
 */

export type {
  ClientToServerEvents,
  ServerToClientEvents,
  SessionStateEvent,
  AgentMessageEvent,
  ProgressEvent,
  AgentOutputEvent,
  GoalStateChangeEvent,
  DiscussionActivityEvent,
  DiscussionMentionEvent,
} from './events.js';

export type {
  StreamPart,
  StreamUsage,
  StreamPayload,
  ChatMessage,
  ErrorResponse,
  ApiError,
} from './messages.js';

export type {
  TaskStatus,
  GoalStatus,
  SessionState,
  SharedTask,
  TaskUpdate,
  PlanSummary,
  GoalSession,
  RestoreResponse,
} from './tasks.js';
