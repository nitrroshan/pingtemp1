/**
 * PriorityQueue - Min-heap based priority queue
 *
 * Features:
 * - Lower priority number = higher priority (dequeued first)
 * - FIFO ordering within same priority level
 * - Generic type support
 */

interface HeapEntry<T> {
  priority: number;
  insertOrder: number;
  item: T;
}

export class PriorityQueue<T> {
  private heap: HeapEntry<T>[] = [];
  private counter = 0;
  private itemToIndex: Map<T, number> = new Map();

  /**
   * Add item to queue with given priority
   * @param item - Item to add
   * @param priority - Priority level (lower = higher priority)
   */
  push(item: T, priority: number = 0): void {
    const entry: HeapEntry<T> = {
      priority,
      insertOrder: this.counter++,
      item,
    };
    this.heap.push(entry);
    const index = this.heap.length - 1;
    this.itemToIndex.set(item, index);
    this.bubbleUp(index);
  }

  /**
   * Remove and return highest priority item
   * @returns Item or undefined if queue is empty
   */
  pop(): T | undefined {
    if (this.heap.length === 0) return undefined;

    const min = this.heap[0]!.item;
    this.itemToIndex.delete(min);
    const last = this.heap.pop();

    if (this.heap.length > 0 && last) {
      this.heap[0] = last;
      this.itemToIndex.set(last.item, 0);
      this.sinkDown(0);
    }

    return min;
  }

  /**
   * Update the priority of an existing item
   * @param item - Item to update
   * @param newPriority - New priority level
   * @returns true if item was found and updated, false otherwise
   */
  updatePriority(item: T, newPriority: number): boolean {
    const index = this.itemToIndex.get(item);
    if (index === undefined) return false;

    const oldPriority = this.heap[index]!.priority;
    this.heap[index]!.priority = newPriority;

    // Re-heapify based on priority change direction
    if (newPriority < oldPriority) {
      this.bubbleUp(index);
    } else if (newPriority > oldPriority) {
      this.sinkDown(index);
    }

    return true;
  }

  /**
   * Check if item exists in queue
   * @param item - Item to check
   */
  contains(item: T): boolean {
    return this.itemToIndex.has(item);
  }

  /**
   * Return highest priority item without removing
   * @returns Item or undefined if queue is empty
   */
  peek(): T | undefined {
    return this.heap.length > 0 ? this.heap[0]!.item : undefined;
  }

  /**
   * Get number of items in queue
   */
  size(): number {
    return this.heap.length;
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  /**
   * Remove a specific item from the queue.
   * Returns true if the item was found and removed.
   */
  remove(item: T): boolean {
    const index = this.itemToIndex.get(item);
    if (index === undefined) return false;

    this.itemToIndex.delete(item);

    // If it's the last element, just pop
    if (index === this.heap.length - 1) {
      this.heap.pop();
      return true;
    }

    // Replace with last element and re-heapify
    const last = this.heap.pop()!;
    this.heap[index] = last;
    this.itemToIndex.set(last.item, index);
    this.bubbleUp(index);
    this.sinkDown(index);
    return true;
  }

  /**
   * Clear all items from queue
   */
  clear(): void {
    this.heap = [];
    this.counter = 0;
    this.itemToIndex.clear();
  }

  /**
   * Bubble up element at index to maintain heap property
   */
  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const parent = this.heap[parentIndex]!;
      const current = this.heap[index]!;

      if (this.compare(current, parent) >= 0) break;

      this.swap(index, parentIndex);
      index = parentIndex;
    }
  }

  /**
   * Sink down element at index to maintain heap property
   */
  private sinkDown(index: number): void {
    const length = this.heap.length;

    while (true) {
      const leftIndex = 2 * index + 1;
      const rightIndex = 2 * index + 2;
      let smallest = index;

      if (
        leftIndex < length &&
        this.compare(this.heap[leftIndex]!, this.heap[smallest]!) < 0
      ) {
        smallest = leftIndex;
      }

      if (
        rightIndex < length &&
        this.compare(this.heap[rightIndex]!, this.heap[smallest]!) < 0
      ) {
        smallest = rightIndex;
      }

      if (smallest === index) break;

      this.swap(index, smallest);
      index = smallest;
    }
  }

  /**
   * Compare two heap entries
   * First by priority, then by insert order (FIFO)
   */
  private compare(a: HeapEntry<T>, b: HeapEntry<T>): number {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return a.insertOrder - b.insertOrder;
  }

  /**
   * Swap two elements in heap
   */
  private swap(i: number, j: number): void {
    const itemI = this.heap[i]!.item;
    const itemJ = this.heap[j]!.item;
    [this.heap[i], this.heap[j]] = [this.heap[j]!, this.heap[i]!];
    this.itemToIndex.set(itemI, j);
    this.itemToIndex.set(itemJ, i);
  }
}
