/**
 * PriorityQueue Unit Tests
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { PriorityQueue } from "./PriorityQueue.js";

describe("PriorityQueue", () => {
  let queue: PriorityQueue<string>;

  beforeEach(() => {
    queue = new PriorityQueue<string>();
  });

  describe("basic operations", () => {
    it("should start empty", () => {
      expect(queue.isEmpty()).toBe(true);
      expect(queue.size()).toBe(0);
    });

    it("should push and pop a single item", () => {
      queue.push("task1", 0);

      expect(queue.isEmpty()).toBe(false);
      expect(queue.size()).toBe(1);
      expect(queue.pop()).toBe("task1");
      expect(queue.isEmpty()).toBe(true);
    });

    it("should return undefined when popping empty queue", () => {
      expect(queue.pop()).toBeUndefined();
    });

    it("should return undefined when peeking empty queue", () => {
      expect(queue.peek()).toBeUndefined();
    });
  });

  describe("priority ordering", () => {
    it("should pop lower priority numbers first", () => {
      queue.push("low", 10);
      queue.push("high", 1);
      queue.push("medium", 5);

      expect(queue.pop()).toBe("high"); // priority 1
      expect(queue.pop()).toBe("medium"); // priority 5
      expect(queue.pop()).toBe("low"); // priority 10
    });

    it("should handle negative priorities", () => {
      queue.push("normal", 0);
      queue.push("urgent", -1);
      queue.push("critical", -10);

      expect(queue.pop()).toBe("critical"); // priority -10
      expect(queue.pop()).toBe("urgent"); // priority -1
      expect(queue.pop()).toBe("normal"); // priority 0
    });
  });

  describe("FIFO within same priority", () => {
    it("should maintain insertion order for same priority", () => {
      queue.push("first", 0);
      queue.push("second", 0);
      queue.push("third", 0);

      expect(queue.pop()).toBe("first");
      expect(queue.pop()).toBe("second");
      expect(queue.pop()).toBe("third");
    });

    it("should handle mixed priorities with FIFO", () => {
      queue.push("a-normal", 0);
      queue.push("b-high", 1);
      queue.push("c-normal", 0);
      queue.push("d-high", 1);

      // Same priority items should come out in order
      expect(queue.pop()).toBe("a-normal"); // priority 0, first
      expect(queue.pop()).toBe("c-normal"); // priority 0, second
      expect(queue.pop()).toBe("b-high"); // priority 1, first
      expect(queue.pop()).toBe("d-high"); // priority 1, second
    });
  });

  describe("peek", () => {
    it("should return item without removing", () => {
      queue.push("task1", 0);

      expect(queue.peek()).toBe("task1");
      expect(queue.peek()).toBe("task1"); // still there
      expect(queue.size()).toBe(1);
    });

    it("should return highest priority item", () => {
      queue.push("low", 10);
      queue.push("high", 1);

      expect(queue.peek()).toBe("high");
    });
  });

  describe("clear", () => {
    it("should remove all items", () => {
      queue.push("task1", 0);
      queue.push("task2", 1);
      queue.push("task3", 2);

      queue.clear();

      expect(queue.isEmpty()).toBe(true);
      expect(queue.size()).toBe(0);
      expect(queue.pop()).toBeUndefined();
    });
  });

  describe("updatePriority", () => {
    it("should move item up when priority decreases", () => {
      queue.push("low", 10);
      queue.push("medium", 5);
      queue.push("high", 1);

      // Make "low" the highest priority
      const updated = queue.updatePriority("low", 0);

      expect(updated).toBe(true);
      expect(queue.pop()).toBe("low"); // now highest priority
      expect(queue.pop()).toBe("high");
      expect(queue.pop()).toBe("medium");
    });

    it("should move item down when priority increases", () => {
      queue.push("high", 1);
      queue.push("medium", 5);
      queue.push("low", 10);

      // Make "high" the lowest priority
      const updated = queue.updatePriority("high", 20);

      expect(updated).toBe(true);
      expect(queue.pop()).toBe("medium");
      expect(queue.pop()).toBe("low");
      expect(queue.pop()).toBe("high"); // now lowest priority
    });

    it("should return false for non-existent item", () => {
      queue.push("task1", 0);

      const updated = queue.updatePriority("nonexistent", 5);

      expect(updated).toBe(false);
    });

    it("should handle same priority update", () => {
      queue.push("task1", 5);

      const updated = queue.updatePriority("task1", 5);

      expect(updated).toBe(true);
      expect(queue.pop()).toBe("task1");
    });

    it("should maintain heap integrity after multiple updates", () => {
      queue.push("a", 5);
      queue.push("b", 10);
      queue.push("c", 15);
      queue.push("d", 20);

      // Shuffle priorities
      queue.updatePriority("d", 1); // d becomes highest
      queue.updatePriority("a", 25); // a becomes lowest
      queue.updatePriority("c", 8); // c moves up

      expect(queue.pop()).toBe("d"); // 1
      expect(queue.pop()).toBe("c"); // 8
      expect(queue.pop()).toBe("b"); // 10
      expect(queue.pop()).toBe("a"); // 25
    });
  });

  describe("contains", () => {
    it("should return true for existing item", () => {
      queue.push("task1", 0);

      expect(queue.contains("task1")).toBe(true);
    });

    it("should return false for non-existent item", () => {
      expect(queue.contains("nonexistent")).toBe(false);
    });

    it("should return false after item is popped", () => {
      queue.push("task1", 0);
      queue.pop();

      expect(queue.contains("task1")).toBe(false);
    });
  });

  describe("default priority", () => {
    it("should use priority 0 when not specified", () => {
      queue.push("default");
      queue.push("explicit", 0);

      // Both should have same priority, FIFO order
      expect(queue.pop()).toBe("default");
      expect(queue.pop()).toBe("explicit");
    });
  });

  describe("large queue", () => {
    it("should handle many items correctly", () => {
      const items = 100;

      // Add items with random priorities
      for (let i = 0; i < items; i++) {
        queue.push(`task-${i}`, i % 10);
      }

      expect(queue.size()).toBe(items);

      // Pop all and verify priority ordering
      let lastPriority = -Infinity;
      while (!queue.isEmpty()) {
        const item = queue.pop()!;
        const priority = parseInt(item.split("-")[1]!) % 10;
        expect(priority).toBeGreaterThanOrEqual(lastPriority);
        lastPriority = priority;
      }
    });
  });
});
