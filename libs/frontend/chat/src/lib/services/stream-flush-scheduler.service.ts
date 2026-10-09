import { DestroyRef, Injectable, inject } from '@angular/core';
import type { ChatStreamSnapshotPayload } from '@ptah-extension/shared';
import { StreamViewportController } from './stream-viewport-controller.service';

type StreamWork = () => void;

/**
 * Coalesces presentation work after transport routing has completed.
 *
 * It intentionally knows no chat event semantics: the existing chat handler
 * supplies the work callback, preserving its resume fence and stream routing.
 */
@Injectable({ providedIn: 'root' })
export class StreamFlushScheduler {
  private static readonly VISIBLE_FLUSH_MS = 50;

  private readonly viewport = inject(StreamViewportController);
  private readonly destroyRef = inject(DestroyRef);
  private readonly queues = new Map<string, StreamWork[]>();
  private readonly focusedQueueKeys = new Set<string>();
  private readonly visibleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly appliedSnapshots = new Map<string, number>();
  private focusedFrame: number | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.dispose());
  }

  enqueue(tabId: string | undefined, work: StreamWork): void {
    const key = tabId ?? '';
    const queue = this.queues.get(key) ?? [];
    queue.push(work);
    this.queues.set(key, queue);

    switch (this.viewport.tierFor(tabId)) {
      case 'focused':
        this.focusedQueueKeys.add(key);
        this.scheduleFocused();
        break;
      case 'visible':
        this.scheduleVisible(key);
        break;
      case 'hidden':
        break;
    }
  }

  enqueueSnapshot(
    snapshot: ChatStreamSnapshotPayload,
    apply: StreamWork,
  ): void {
    const previousSequence = this.appliedSnapshots.get(snapshot.tabId);
    if (previousSequence !== undefined && snapshot.toSequence <= previousSequence) {
      return;
    }
    this.appliedSnapshots.set(snapshot.tabId, snapshot.toSequence);
    this.enqueue(snapshot.tabId, apply);
  }

  private scheduleFocused(): void {
    if (this.focusedFrame !== null) return;
    if (typeof requestAnimationFrame !== 'function') {
      this.focusedFrame = setTimeout(() => this.flushFocused(), 0) as unknown as number;
      return;
    }
    this.focusedFrame = requestAnimationFrame(() => this.flushFocused());
  }

  private flushFocused(): void {
    this.focusedFrame = null;
    const keys = [...this.focusedQueueKeys];
    this.focusedQueueKeys.clear();
    for (const tabId of keys) {
      const queue = this.queues.get(tabId);
      if (!queue) continue;
      this.queues.delete(tabId);
      this.run(queue);
    }
  }

  private scheduleVisible(tabId: string): void {
    if (this.visibleTimers.has(tabId)) return;
    const timer = setTimeout(() => {
      this.visibleTimers.delete(tabId);
      const queue = this.queues.get(tabId);
      if (!queue) return;
      this.queues.delete(tabId);
      this.run(queue);
    }, StreamFlushScheduler.VISIBLE_FLUSH_MS);
    this.visibleTimers.set(tabId, timer);
  }

  private run(queue: readonly StreamWork[]): void {
    for (const work of queue) work();
  }

  private dispose(): void {
    if (this.focusedFrame !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.focusedFrame);
    }
    for (const timer of this.visibleTimers.values()) clearTimeout(timer);
    this.visibleTimers.clear();
    this.queues.clear();
  }
}
