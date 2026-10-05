import { Injectable, signal } from '@angular/core';

/**
 * SessionRotationKeepService - "Keep this session" choices (TASK_2026_614 D.5)
 *
 * The session-budget banner is rebuilt on every tab switch, so the choice
 * cannot live in the banner. This root store keeps `sessionId:threshold` keys
 * for the life of the webview; a reload clears them. Local state, no RPC.
 */
@Injectable({ providedIn: 'root' })
export class SessionRotationKeepService {
  private readonly _kept = signal<ReadonlySet<string>>(new Set());

  /** Keys the user chose to keep. */
  readonly kept = this._kept.asReadonly();

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
}
