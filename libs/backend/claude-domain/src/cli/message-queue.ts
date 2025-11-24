/**
 * Message Queue - FIFO queue for interactive session messages
 *
 * Responsibilities:
 * - Queue messages when session is busy
 * - Prevent memory exhaustion with max size limit
 * - Simple FIFO ordering
 */

export interface QueuedMessage {
  readonly content: string;
  readonly timestamp: number;
  readonly files?: readonly string[];
}

/**
 * Simple FIFO message queue with backpressure support
 */
export class MessageQueue {
  private queue: QueuedMessage[] = [];
  private readonly maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  /**
   * Add message to queue
   * @throws Error if queue is full
   */
  enqueue(message: QueuedMessage): void {
    if (this.queue.length >= this.maxSize) {
      throw new Error(
        `Message queue full (max ${this.maxSize}). Cannot queue more messages.`
      );
    }
    this.queue.push(message);
  }

  /**
   * Remove and return next message
   * @returns Next message or undefined if empty
   */
  dequeue(): QueuedMessage | undefined {
    return this.queue.shift();
  }

  /**
   * Look at next message without removing it
   * @returns Next message or undefined if empty
   */
  peek(): QueuedMessage | undefined {
    return this.queue[0];
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Get queue size
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Clear all messages
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * Get all queued messages (for debugging)
   */
  getAll(): readonly QueuedMessage[] {
    return [...this.queue];
  }
}
