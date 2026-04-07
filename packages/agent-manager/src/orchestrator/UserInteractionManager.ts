/**
 * UserInteractionManager
 *
 * Shared bridge for planner↔user and worker↔user communication.
 * Uses Promise.withResolvers() pattern to block agents until user responds.
 *
 * Lifecycle:
 * 1. Agent calls askQuestion() → returns Promise that blocks
 * 2. Socket handler calls resolveQuestion(id, answer) → Promise resolves
 * 3. Agent resumes with user's answer
 *
 * Timeout: AbortSignal.timeout(300_000) = 5 minutes per question.
 * Disconnect: cancelAll() cleans up all pending questions.
 */

import type { UserQuestion, UserChoice, UserQuestionOption } from "./types/plannerTypes.js";

interface PendingQuestion {
  question: UserQuestion;
  resolve: (choice: UserChoice) => void;
  reject: (reason: any) => void;
  abortController: AbortController;
}

export class UserInteractionManager {
  private pending = new Map<string, PendingQuestion>();
  private questionCounter = 0;
  private defaultTimeoutMs: number;

  /** Callback emitted when a question needs to reach the user (via Socket.IO) */
  onQuestion?: (question: UserQuestion) => void;

  constructor(options?: { defaultTimeoutMs?: number }) {
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? 300_000; // 5 minutes
  }

  /**
   * Ask the user a question. Blocks until user responds or timeout.
   */
  async askQuestion(params: {
    from: "planner" | "worker";
    sourceId: string;
    question: string;
    options?: UserQuestionOption[];
    category?: UserQuestion["category"];
    timeoutMs?: number;
  }): Promise<UserChoice> {
    const id = `q-${++this.questionCounter}-${Date.now()}`;
    const timeoutMs = params.timeoutMs ?? this.defaultTimeoutMs;

    const question: UserQuestion = {
      id,
      from: params.from,
      sourceId: params.sourceId,
      question: params.question,
      options: params.options,
      category: params.category ?? "clarification",
      timestamp: Date.now(),
    };

    const abortController = new AbortController();

    // Using manual promise construction (compatible with all runtimes)
    let resolve!: (choice: UserChoice) => void;
    let reject!: (reason: any) => void;
    const promise = new Promise<UserChoice>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    this.pending.set(id, { question, resolve, reject, abortController });

    // Set up timeout
    const timeoutId = setTimeout(() => {
      if (this.pending.has(id)) {
        this.pending.delete(id);
        resolve({
          questionId: id,
          answer: "(No response — timed out after " + Math.round(timeoutMs / 1000) + "s. Proceeding with best judgment.)",
          timestamp: Date.now(),
        });
      }
    }, timeoutMs);

    // Set up abort signal listener
    abortController.signal.addEventListener("abort", () => {
      clearTimeout(timeoutId);
      if (this.pending.has(id)) {
        this.pending.delete(id);
        reject(new Error("Question cancelled"));
      }
    });

    // Notify the frontend
    this.onQuestion?.(question);

    try {
      const result = await promise;
      clearTimeout(timeoutId);
      return result;
    } finally {
      this.pending.delete(id);
    }
  }

  /**
   * Resolve a pending question with the user's answer.
   * Called by Socket.IO event handler.
   */
  resolveQuestion(questionId: string, answer: string, selectedOptionIndex?: number): boolean {
    const entry = this.pending.get(questionId);
    if (!entry) return false;

    entry.resolve({
      questionId,
      answer,
      selectedOptionIndex,
      timestamp: Date.now(),
    });

    this.pending.delete(questionId);
    return true;
  }

  /**
   * Cancel all pending questions (e.g., on disconnect or shutdown).
   */
  cancelAll(): void {
    for (const [id, entry] of this.pending) {
      entry.abortController.abort("shutdown");
    }
    this.pending.clear();
  }

  /**
   * Cancel a specific pending question.
   */
  cancel(questionId: string): boolean {
    const entry = this.pending.get(questionId);
    if (!entry) return false;
    entry.abortController.abort("cancelled");
    return true;
  }

  /**
   * Check if there are any pending questions.
   */
  hasPending(): boolean {
    return this.pending.size > 0;
  }

  /**
   * Get all pending questions (for UI state recovery).
   */
  getPendingQuestions(): UserQuestion[] {
    return Array.from(this.pending.values()).map((e) => e.question);
  }

  /**
   * Get count of pending questions.
   */
  get pendingCount(): number {
    return this.pending.size;
  }
}
