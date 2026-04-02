/**
 * smoothStream — Word-boundary text chunking for UX-friendly streaming
 *
 * Buffers incoming text deltas until a word boundary, then emits.
 * Prevents single-character jitter in the UI.
 *
 * Usage:
 *   const smooth = new SmoothStream();
 *   smooth.push(delta);              // accumulate
 *   const chunk = smooth.flush();    // emit buffered text
 *   smooth.forceFlush();             // flush remaining at stream end
 */

const WORD_BOUNDARY_RE = /[\s,.:;!?)\]}"']/;

export class SmoothStream {
  private buffer = "";

  /**
   * Push a new text delta. Returns a chunk to emit if a word boundary
   * was encountered, otherwise returns null (keep buffering).
   */
  push(delta: string): string | null {
    this.buffer += delta;

    // Find last word boundary in buffer
    const lastBoundary = this.findLastBoundary(this.buffer);
    if (lastBoundary === -1) {
      return null; // No boundary yet
    }

    // Emit everything up to and including the boundary
    const chunk = this.buffer.slice(0, lastBoundary + 1);
    this.buffer = this.buffer.slice(lastBoundary + 1);
    return chunk;
  }

  /**
   * Force flush all remaining buffered content.
   * Call at stream end to drain the buffer.
   */
  forceFlush(): string {
    const remaining = this.buffer;
    this.buffer = "";
    return remaining;
  }

  /**
   * Find the last word boundary position in the text.
   */
  private findLastBoundary(text: string): number {
    for (let i = text.length - 1; i >= 0; i--) {
      if (WORD_BOUNDARY_RE.test(text[i] ?? '')) {
        return i;
      }
    }
    return -1;
  }
}
