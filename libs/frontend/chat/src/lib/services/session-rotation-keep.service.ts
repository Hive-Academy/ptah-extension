import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import {
  TabManagerService,
  type ClosedTabEvent,
} from '@ptah-extension/chat-state';

/**
 * SessionRotationKeepService - "Keep this session" choices (TASK_2026_614 D.5)
 *
 * The session-budget banner is rebuilt on every tab switch, so the choice
 * cannot live in the banner. This root store keeps `sessionId:threshold` keys
 * while a tab holds the session; a reload clears them. Local state, no RPC.
 * Keys of a session no open tab holds any more are dropped when its tab
 * closes or resets, so the set does not grow for the life of the webview.
 */
@Injectable({ providedIn: 'root' })
export class SessionRotationKeepService {
  private readonly tabManager = inject(TabManagerService);
  private readonly _kept = signal<ReadonlySet<string>>(new Set());

  /** Keys the user chose to keep. */
  readonly kept = this._kept.asReadonly();

  constructor() {
    const stopListening = this.tabManager.onTabClosed((event) =>
      this.onTabClosed(event),
    );
    inject(DestroyRef).onDestroy(stopListening);
  }

  private static key(sessionId: string, threshold: number): string {
    return `${sessionId}:${threshold}`;
  }

  isKept(sessionId: string, threshold: number): boolean {
    return this._kept().has(
      SessionRotationKeepService.key(sessionId, threshold),
    );
  }

  keep(sessionId: string, threshold: number): void {
    const key = SessionRotationKeepService.key(sessionId, threshold);
    this._kept.update((kept) => new Set(kept).add(key));
  }

  /** Forget a session's keys once its rotation advisory is gone. */
  forgetSession(sessionId: string): void {
    const prefix = `${sessionId}:`;
    const kept = this._kept();
    if (![...kept].some((key) => key.startsWith(prefix))) return;
    this._kept.set(new Set([...kept].filter((key) => !key.startsWith(prefix))));
  }

  /** A closed or reset tab releases its session unless another open tab still holds it. */
  private onTabClosed({ sessionId }: ClosedTabEvent): void {
    if (sessionId === null) return;
    const stillHeld = this.tabManager
      .tabs()
      .some(
        (tab) =>
          tab.claudeSessionId === sessionId ||
          tab.sessionBudget?.sessionId === sessionId,
      );
    if (!stillHeld) this.forgetSession(sessionId);
  }
}
