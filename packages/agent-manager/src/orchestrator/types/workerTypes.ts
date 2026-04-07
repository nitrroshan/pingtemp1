/**
 * Worker Types
 *
 * Structured failure reporting for worker agents.
 * Replaces bare error strings with categorized, actionable reports.
 */

/**
 * Error categories for structured failure classification.
 * Determines retry strategy and planner notification severity.
 */
export type ErrorCategory =
  | "llm_error"           // Model returned error or refused
  | "tool_error"          // Tool execution failed
  | "external_service"    // External API/service unavailable
  | "rate_limit"          // Rate limited by provider
  | "timeout"             // Operation timed out
  | "validation_error"    // Input/output validation failed
  | "context_exceeded"    // Context window exceeded
  | "permission_denied"   // Insufficient permissions
  | "cancelled"           // Task was cancelled via AbortSignal
  | "unknown";            // Unclassified error

/**
 * Structured failure report emitted by workers.
 * Used by OrchestratorService to decide: auto-retry, notify planner, or escalate.
 */
export interface WorkerFailureReport {
  taskId: string;
  role: string;
  errorCategory: ErrorCategory;
  message: string;
  /** Whether this error type is safe to auto-retry */
  retriable: boolean;
  /** Description of any partial progress before failure */
  partialProgress?: string;
  /** Resource usage at time of failure */
  resourceUsage?: {
    tokensUsed?: number;
    durationMs?: number;
    toolCallCount?: number;
  };
  /** Number of retry attempts already made */
  attemptNumber: number;
  timestamp: number;
}

/**
 * Classify an error into a structured WorkerFailureReport.
 */
export function classifyError(
  taskId: string,
  role: string,
  error: unknown,
  attemptNumber: number = 1,
): WorkerFailureReport {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMsg = message.toLowerCase();

  let errorCategory: ErrorCategory = "unknown";
  let retriable = false;

  if (lowerMsg.includes("rate limit") || lowerMsg.includes("429") || lowerMsg.includes("too many requests")) {
    errorCategory = "rate_limit";
    retriable = true;
  } else if (lowerMsg.includes("timeout") || lowerMsg.includes("timed out") || lowerMsg.includes("etimedout")) {
    errorCategory = "timeout";
    retriable = true;
  } else if (lowerMsg.includes("abort") || lowerMsg.includes("cancel")) {
    errorCategory = "cancelled";
    retriable = false;
  } else if (lowerMsg.includes("context") && (lowerMsg.includes("length") || lowerMsg.includes("exceed") || lowerMsg.includes("window"))) {
    errorCategory = "context_exceeded";
    retriable = false;
  } else if (lowerMsg.includes("permission") || lowerMsg.includes("forbidden") || lowerMsg.includes("403")) {
    errorCategory = "permission_denied";
    retriable = false;
  } else if (lowerMsg.includes("validation") || lowerMsg.includes("invalid") || lowerMsg.includes("schema")) {
    errorCategory = "validation_error";
    retriable = false;
  } else if (lowerMsg.includes("econnrefused") || lowerMsg.includes("enotfound") || lowerMsg.includes("503") || lowerMsg.includes("502")) {
    errorCategory = "external_service";
    retriable = true;
  } else if (lowerMsg.includes("tool") && lowerMsg.includes("error")) {
    errorCategory = "tool_error";
    retriable = false;
  } else if (lowerMsg.includes("model") || lowerMsg.includes("openai") || lowerMsg.includes("azure") || lowerMsg.includes("500")) {
    errorCategory = "llm_error";
    retriable = true;
  }

  return {
    taskId,
    role,
    errorCategory,
    message,
    retriable,
    attemptNumber,
    timestamp: Date.now(),
  };
}
