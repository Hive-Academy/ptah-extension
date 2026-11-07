/**
 * The tree-sitter worker client's waiting line: two FIFO lanes, foreground
 * served first, each with its own capacity and a deadline measured from
 * enqueue. A request whose deadline passes while it waits is removed and
 * handed to `onExpired`; it is never sent.
 *
 * Every entry of a lane has the same wait limit, so a lane's deadlines rise
 * from head to tail and only the heads can be due. One timer, armed for the
 * earliest head, covers the whole queue; it is cleared whenever the queue
 * empties.
 */
import type { TreeSitterPriority } from '../tree-sitter-request-options';

export interface LaneLimits {
  /** Requests that may wait in this lane; one more is refused at once. */
  readonly maxQueued: number;
  /** Longest a request may wait in this lane before it is answered with an error. */
  readonly maxWaitMs: number;
}

export type QueueLimits = Readonly<Record<TreeSitterPriority, LaneLimits>>;

interface Waiting<T> {
  readonly item: T;
  readonly enqueuedAt: number;
  readonly deadline: number;
}

/** Foreground first: the order `shift` serves the lanes in. */
const LANE_ORDER: readonly TreeSitterPriority[] = ['foreground', 'background'];

export class DeadlineQueue<T> {
  private readonly lanes: Record<TreeSitterPriority, Waiting<T>[]> = {
    foreground: [],
    background: [],
  };
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly limits: QueueLimits,
    private readonly now: () => number,
    private readonly onExpired: (
      item: T,
      priority: TreeSitterPriority,
      waitedMs: number,
    ) => void,
  ) {}

  /** `false` when `priority`'s lane is full; the item was not queued. */
  push(item: T, priority: TreeSitterPriority): boolean {
    const lane = this.lanes[priority];
    const limits = this.limits[priority];
    if (lane.length >= limits.maxQueued) return false;
    const enqueuedAt = this.now();
    lane.push({ item, enqueuedAt, deadline: enqueuedAt + limits.maxWaitMs });
    this.arm();
    return true;
  }

  /** The next live item, foreground first; expired heads are answered first. */
  shift(): T | undefined {
    this.expireDue();
    for (const priority of LANE_ORDER) {
      const next = this.lanes[priority].shift();
      if (next) {
        this.arm();
        return next.item;
      }
    }
    this.arm();
    return undefined;
  }

  /** Remove and return every waiting item, foreground first. */
  drain(): T[] {
    const items = LANE_ORDER.flatMap((priority) =>
      this.lanes[priority].splice(0).map((waiting) => waiting.item),
    );
    this.arm();
    return items;
  }

  get size(): number {
    return this.lanes.foreground.length + this.lanes.background.length;
  }

  private expireDue(): void {
    const now = this.now();
    for (const priority of LANE_ORDER) {
      const lane = this.lanes[priority];
      while (lane.length > 0 && lane[0].deadline <= now) {
        const expired = lane.shift();
        if (expired) {
          this.onExpired(expired.item, priority, now - expired.enqueuedAt);
        }
      }
    }
  }

  /** One timer at the earliest head deadline, or none when empty. */
  private arm(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    let earliest = Number.POSITIVE_INFINITY;
    for (const priority of LANE_ORDER) {
      const head = this.lanes[priority][0];
      if (head && head.deadline < earliest) earliest = head.deadline;
    }
    if (earliest === Number.POSITIVE_INFINITY) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.expireDue();
        this.arm();
      },
      Math.max(0, earliest - this.now()),
    );
  }
}
