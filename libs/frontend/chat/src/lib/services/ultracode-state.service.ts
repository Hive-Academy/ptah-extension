/**
 * UltracodeStateService — session-scoped "Ultracode" mode.
 *
 * Ultracode couples two behaviours behind a single toggle:
 *   1. Reasoning effort is pinned to `xhigh` while the mode is on, and the
 *      previously-selected effort is restored when it is turned off.
 *   2. Outgoing user messages are stamped with the literal `ultracode` keyword
 *      so the backend SDK plans a workflow per task. Stamping happens in
 *      `MessageSenderService` via {@link applyKeyword}.
 *
 * State is a runtime signal (session-scoped, not persisted) — intentionally
 * simple. Effort itself is persisted through {@link EffortStateService}, so the
 * xhigh switch survives via that existing channel; only the "ultracode is on"
 * flag is ephemeral.
 */

import { Injectable, inject, signal } from '@angular/core';
import { EffortStateService } from '@ptah-extension/core';
import type { EffortLevel } from '@ptah-extension/shared';

@Injectable({ providedIn: 'root' })
export class UltracodeStateService {
  private readonly effortState = inject(EffortStateService);

  /** Keyword the backend detects (on human-origin input) to plan a workflow. */
  static readonly KEYWORD = 'ultracode';

  private readonly _enabled = signal(false);
  /** Whether Ultracode mode is currently active. */
  readonly enabled = this._enabled.asReadonly();

  /**
   * Effort captured at {@link enable} time so {@link disable} can restore it.
   * `undefined` means the user was on the SDK default before enabling.
   */
  private previousEffort: EffortLevel | undefined = undefined;

  /**
   * Turn Ultracode ON: remember the current effort, then pin effort to `xhigh`.
   * Idempotent — a second call while already enabled does not overwrite the
   * stored previous effort (which would otherwise trap the user at xhigh).
   */
  async enable(): Promise<void> {
    if (this._enabled()) return;
    this.previousEffort = this.effortState.currentEffort();
    this._enabled.set(true);
    await this.effortState.setEffort('xhigh');
  }

  /**
   * Turn Ultracode OFF and restore the effort that was active before it was
   * enabled (including the SDK default when that was the prior state).
   */
  async disable(): Promise<void> {
    if (!this._enabled()) return;
    this._enabled.set(false);
    await this.effortState.setEffort(this.previousEffort);
  }

  /** Convenience for checkbox `(change)` handlers. */
  async toggle(next: boolean): Promise<void> {
    return next ? this.enable() : this.disable();
  }

  /**
   * Prefix `content` with the ultracode keyword when the mode is on.
   *
   * - No-op when disabled — outgoing messages are untouched.
   * - Idempotent: content already carrying `ultracode` (as a word) is returned
   *   verbatim, so a queued/retried send is never double-stamped.
   */
  applyKeyword(content: string): string {
    if (!this._enabled()) return content;
    if (/\bultracode\b/i.test(content)) return content;
    return `${UltracodeStateService.KEYWORD}: ${content}`;
  }
}
