/**
 * ActionBannerService - Shared inline banner for branch/rewind/editor actions.
 *
 * Lifted out of `ChatViewComponent._actionBanner` (S3) so any webview surface —
 * including canvas/tile views and the active chat view — can display the banner.
 *
 * Scoping: each banner carries an optional `tabId`. A `ChatViewComponent` only
 * renders banners whose `tabId` is `null` (global, e.g. "no active session") or
 * matches its own tab id. This prevents a rewind fired on session A from
 * surfacing its success toast on session B's view when both are mounted
 * (canvas/tile mode). The rewind flow activates the rebound tab, so a
 * tab-scoped banner still lands on the surface the user is looking at.
 *
 * Lifecycle: a new banner cancels any prior auto-clear timer, so rapid
 * successive actions show only the most recent message and the timer is
 * always anchored to the latest call.
 */
import { Injectable, signal, computed } from '@angular/core';

export interface ActionBannerState {
  kind: 'error' | 'info' | 'warning';
  message: string;
  /** Tab id this banner is scoped to, or null for a global banner. */
  tabId: string | null;
}

const DEFAULT_DURATION_MS = 4000;
const WARNING_DURATION_MS = 8000;

@Injectable({ providedIn: 'root' })
export class ActionBannerService {
  private readonly _banner = signal<ActionBannerState | null>(null);
  private _timeout: ReturnType<typeof setTimeout> | null = null;

  /** Current banner state (or null if no banner is showing). */
  readonly banner = this._banner.asReadonly();

  /** Convenience computed: error message text, or null if not an error banner. */
  readonly error = computed(() => {
    const b = this._banner();
    return b?.kind === 'error' ? b.message : null;
  });

  /** Convenience computed: info message text, or null if not an info banner. */
  readonly info = computed(() => {
    const b = this._banner();
    return b?.kind === 'info' ? b.message : null;
  });

  /**
   * Convenience computed: warning message text, or null when no warning banner.
   * Warnings stick around longer than info/error (default 8s) because they
   * report partial-success / desync conditions (e.g. "file rollback skipped")
   * that the user must read and decide whether to investigate.
   */
  readonly warning = computed(() => {
    const b = this._banner();
    return b?.kind === 'warning' ? b.message : null;
  });

  /**
   * Show an error-style banner. Auto-clears after `durationMs` (default 4s).
   * Pass `tabId` to scope the banner to a specific tab's surface, or omit it
   * for a global banner shown on every mounted chat view.
   */
  showError(
    message: string,
    tabId: string | null = null,
    durationMs: number = DEFAULT_DURATION_MS,
  ): void {
    this.show({ kind: 'error', message, tabId }, durationMs);
  }

  /** Show an info-style banner. Auto-clears after `durationMs` (default 4s). */
  showInfo(
    message: string,
    tabId: string | null = null,
    durationMs: number = DEFAULT_DURATION_MS,
  ): void {
    this.show({ kind: 'info', message, tabId }, durationMs);
  }

  /**
   * Show a warning-style banner. Used for partial-success or desync states
   * such as "file rollback skipped" — the rewind itself succeeded but the
   * working tree no longer matches the conversation. Auto-clears after a
   * longer interval than info/error (default 8s) so the user has time to
   * read it.
   */
  showWarning(
    message: string,
    tabId: string | null = null,
    durationMs: number = WARNING_DURATION_MS,
  ): void {
    this.show({ kind: 'warning', message, tabId }, durationMs);
  }

  /** Dismiss any active banner immediately and cancel its auto-clear timer. */
  clear(): void {
    if (this._timeout) {
      clearTimeout(this._timeout);
      this._timeout = null;
    }
    this._banner.set(null);
  }

  private show(state: ActionBannerState, durationMs: number): void {
    if (this._timeout) {
      clearTimeout(this._timeout);
      this._timeout = null;
    }
    this._banner.set(state);
    this._timeout = setTimeout(() => {
      this._banner.set(null);
      this._timeout = null;
    }, durationMs);
  }
}
