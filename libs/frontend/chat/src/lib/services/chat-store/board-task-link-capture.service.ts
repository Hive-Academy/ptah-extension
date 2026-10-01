import { Injectable, inject } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';

/**
 * BoardTaskLinkCaptureService — links a session started from the Tasks board
 * to its task once the backend resolves the session's real id
 * (TASK_2026_580, AC2).
 *
 * {@link TaskPromptBridgeService} registers `(tabId → taskId)` when it opens
 * the tab for a board start. The real SDK session id only exists after the
 * user sends the first message, so the pair waits here until
 * `session:id-resolved` arrives, then becomes one
 * `session:linkTask { role: 'primary', source: 'board-start' }` call.
 *
 * Pending pairs live in webview memory only (lane L10): a reload before the
 * first send loses them, and the user can link the task by hand. The map is
 * capped so tabs that never send cannot grow it without bound; the oldest
 * entry is evicted first. No timer runs.
 */
@Injectable({ providedIn: 'root' })
export class BoardTaskLinkCaptureService {
  private readonly rpc = inject(ClaudeRpcService);

  static readonly MAX_PENDING = 20;

  /** Insertion-ordered, so the first key is always the oldest entry. */
  private readonly pending = new Map<string, string>();

  /** Remember that the session opened in `tabId` belongs to `taskId`. */
  expect(tabId: string, taskId: string): void {
    // Re-registering a tab moves it to the newest position.
    this.pending.delete(tabId);
    this.pending.set(tabId, taskId);
    while (this.pending.size > BoardTaskLinkCaptureService.MAX_PENDING) {
      const oldest = this.pending.keys().next().value;
      if (oldest === undefined) break;
      this.pending.delete(oldest);
    }
  }

  /**
   * Called for every `session:id-resolved`. Tabs without a pending board
   * start are ignored. A refused or failed link is logged and not retried.
   */
  async onSessionIdResolved(
    tabId: string,
    realSessionId: string,
  ): Promise<void> {
    const taskId = this.pending.get(tabId);
    if (taskId === undefined) return;
    this.pending.delete(tabId);

    try {
      const result = await this.rpc.call('session:linkTask', {
        sessionId: realSessionId,
        taskId,
        role: 'primary',
        source: 'board-start',
      });
      if (!result.success) {
        console.warn('[BoardTaskLinkCapture] session:linkTask failed', {
          sessionId: realSessionId,
          taskId,
          error: result.error,
        });
        return;
      }
      if (result.data && !result.data.ok) {
        console.warn('[BoardTaskLinkCapture] session:linkTask refused', {
          sessionId: realSessionId,
          taskId,
          reason: result.data.reason,
        });
      }
    } catch (error: unknown) {
      console.warn('[BoardTaskLinkCapture] session:linkTask threw', {
        sessionId: realSessionId,
        taskId,
        error,
      });
    }
  }
}
