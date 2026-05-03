/**
 * ActionBannerService - Shared inline banner for branch/rewind/editor actions.
 *
 * Lifted out of `ChatViewComponent._actionBanner` (S3) so any webview surface —
 * including canvas/tile views and the active chat view — can display the banner
 * regardless of which originating tile fired the action. Without this, in
 * canvas/tile mode the banner used to render on the originating tile rather
 * than where the user is currently looking.
 *
 * Lifecycle: a new banner cancels any prior auto-clear timer, so rapid
 * successive actions show only the most recent message and the timer is
 * always anchored to the latest call.
 */
import { Injectable, signal, computed } from '@angular/core';

export interface ActionBannerState {
  kind: 'error' | 'info';
  message: string;
}

const DEFAULT_DURATION_MS = 4000;

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

  /** Show an error-style banner. Auto-clears after `durationMs` (default 4s). */
  showError(message: string, durationMs: number = DEFAULT_DURATION_MS): void {
    this.show({ kind: 'error', message }, durationMs);
  }

  /** Show an info-style banner. Auto-clears after `durationMs` (default 4s). */
  showInfo(message: string, durationMs: number = DEFAULT_DURATION_MS): void {
    this.show({ kind: 'info', message }, durationMs);
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
