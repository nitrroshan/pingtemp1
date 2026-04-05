/**
 * StreamBridge — AI SDK fullStream → Socket.IO stream events
 *
 * Iterates `result.fullStream` from AI SDK `streamText()` and emits
 * typed Socket.IO events on the single `stream` channel.
 *
 * Also captures token usage after stream completion for cost tracking.
 *
 * Usage:
 *   const bridge = new StreamBridge(socket, sessionId, taskId, agentId);
 *   await bridge.pipe(result.fullStream);
 */

import type { Server as SocketIOServer } from "socket.io";
import type { StreamPayload, StreamPart } from "../../api/types/streamTypes.js";

export interface StreamBridgeOptions {
  io: SocketIOServer;
  room: string;
  sessionId: string;
  taskId?: string;
  agentId: string;
}

export interface StreamUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export class StreamBridge {
  private usage: StreamUsage | null = null;
  private textIdCounter = 0;
  private reasoningIdCounter = 0;
  private stepIndex = 0;

  constructor(private opts: StreamBridgeOptions) {}

  /**
   * Pipe AI SDK fullStream parts to Socket.IO room.
   * Returns usage stats captured during the stream.
   */
  async pipe(fullStream: AsyncIterable<any>): Promise<StreamUsage | null> {
    const messageId = `msg-${Date.now()}`;

    // Emit stream start
    this.emit({ type: "start", messageId });

    try {
      for await (const part of fullStream) {
        const mapped = this.mapPart(part, messageId);
        if (mapped) {
          this.emit(mapped);
        }
      }

      // Emit finish
      this.emit({
        type: "finish",
        finishReason: "stop",
        usage: this.usage ?? undefined,
      });
    } catch (error: any) {
      this.emit({ type: "error", error: error.message || String(error) });
      this.emit({ type: "abort", reason: error.message });
    }

    return this.usage;
  }

  /**
   * Emit a Ping task notification on the stream channel.
   * Used by OrchestratorService / WorkerPool to inject task lifecycle events.
   */
  emitNotification(part: StreamPart): void {
    this.emit(part);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  private emit(part: StreamPart): void {
    const payload: StreamPayload = {
      sessionId: this.opts.sessionId,
      taskId: this.opts.taskId,
      agentId: this.opts.agentId,
      part,
      timestamp: Date.now(),
    };
    this.opts.io.to(this.opts.room).emit("stream", payload);
  }

  /**
   * Map an AI SDK fullStream part to a StreamPart.
   * Returns null if the part should be skipped.
   */
  private mapPart(sdkPart: any, messageId: string): StreamPart | null {
    const partType: string = sdkPart.type;

    switch (partType) {
      // Text deltas
      case "text-delta": {
        const id = `text-${this.textIdCounter}`;
        return { type: "text-delta", id, delta: sdkPart.textDelta ?? "" };
      }

      // Tool call — streaming args
      case "tool-call-streaming-start": {
        return {
          type: "tool-input-start",
          toolCallId: sdkPart.toolCallId,
          toolName: sdkPart.toolName,
        };
      }

      case "tool-call-delta": {
        return {
          type: "tool-input-delta",
          toolCallId: sdkPart.toolCallId,
          delta: sdkPart.argsTextDelta ?? "",
        };
      }

      // Full tool call available (all args received)
      case "tool-call": {
        return {
          type: "tool-input-available",
          toolCallId: sdkPart.toolCallId,
          toolName: sdkPart.toolName,
          input: sdkPart.args,
        };
      }

      // Tool result
      case "tool-result": {
        return {
          type: "tool-output-available",
          toolCallId: sdkPart.toolCallId,
          toolName: sdkPart.toolName,
          output: sdkPart.result,
        };
      }

      // Reasoning (extended thinking)
      case "reasoning": {
        const id = `reasoning-${this.reasoningIdCounter++}`;
        return { type: "reasoning-delta", id, delta: sdkPart.textDelta ?? sdkPart.reasoning ?? "" };
      }

      // Step boundaries
      case "step-start": {
        return { type: "start-step", stepIndex: this.stepIndex };
      }

      case "step-finish": {
        const idx = this.stepIndex++;
        return {
          type: "finish-step",
          stepIndex: idx,
          finishReason: sdkPart.finishReason ?? "stop",
        };
      }

      // Usage — captured internally, not forwarded to client
      case "usage":
      case "finish-message": {
        if (sdkPart.usage) {
          this.usage = {
            promptTokens: sdkPart.usage.promptTokens ?? 0,
            completionTokens: sdkPart.usage.completionTokens ?? 0,
            totalTokens: sdkPart.usage.totalTokens ?? 0,
          };
        }
        return null;
      }

      // Errors
      case "error": {
        return {
          type: "error",
          error:
            sdkPart.error?.message ||
            sdkPart.error ||
            "Unknown streaming error",
        };
      }

      default:
        // Unknown parts are silently skipped
        return null;
    }
  }
}
