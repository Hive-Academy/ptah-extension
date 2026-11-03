import { Injectable, inject, signal } from '@angular/core';
import { ClaudeRpcService, type MessageHandler } from '@ptah-extension/core';
import { DISPLAY_WINDOW_PUSH_TYPES } from '@ptah-extension/shared';
import {
  parseWireState,
  type DisplayWindowParsedSnapshot,
} from '../../../services/display-window/display-window-wire';

const INVALID_STATE_TEXT = 'The display state from the main window could not be read.';
const LOAD_FAILED_TEXT = 'Could not load the display from the main window.';

/**
 * The detached Display window's copy of the main renderer's display state
 * (TASK_2026_853_3401, D4). Only the detached window's app config provides
 * it and registers it under `MESSAGE_HANDLERS`; the main renderer never
 * injects it.
 *
 * - `load()` pulls `displayWindow:getState` on boot, so the window needs no
 *   boot-order handshake with the main renderer.
 * - `displayWindow:state` pushes replace the snapshot. IPC delivers pushes in
 *   order and the host caches only the latest, so once a push has arrived an
 *   older `getState` reply that resolves later is ignored.
 * - Every snapshot is validated by `parseWireState` before it reaches view
 *   state; an invalid one keeps the previous snapshot and sets `error`.
 */
@Injectable({ providedIn: 'root' })
export class DisplayWindowStateHandler implements MessageHandler {
  private readonly rpc = inject(ClaudeRpcService);

  readonly handledMessageTypes = [DISPLAY_WINDOW_PUSH_TYPES.state] as const;

  private readonly _snapshot = signal<DisplayWindowParsedSnapshot | null>(null);
  private readonly _error = signal<string | null>(null);
  private readonly _loading = signal(false);
  /** The latest valid snapshot, or `null` before the main window published one. */
  readonly snapshot = this._snapshot.asReadonly();
  /** Why the last snapshot could not be shown, or `null`. */
  readonly error = this._error.asReadonly();
  readonly loading = this._loading.asReadonly();

  /** Arrival order of pushes; a `getState` reply older than a push is dropped. */
  private pushes = 0;

  handleMessage(message: { type: string; payload?: unknown }): void {
    if (message.type !== DISPLAY_WINDOW_PUSH_TYPES.state) return;
    this.pushes += 1;
    const push = this.pushes;
    // A later push supersedes this one even if its parse finishes first.
    void this.accept(message.payload, () => push === this.pushes);
  }

  /** Pulls the host's cached snapshot (boot and Retry). */
  async load(): Promise<void> {
    const pushesAtStart = this.pushes;
    this._loading.set(true);
    try {
      const result = await this.rpc.call('displayWindow:getState', {});
      if (!result.success || result.data === undefined) {
        this._error.set(LOAD_FAILED_TEXT);
        return;
      }
      const state = result.data.state;
      if (state === null) return;
      await this.accept(state, () => this.pushes === pushesAtStart);
    } catch {
      // degradation-audit: reported — the window shows `error` and a Retry.
      this._error.set(LOAD_FAILED_TEXT);
    } finally {
      this._loading.set(false);
    }
  }

  private async accept(raw: unknown, stillCurrent: () => boolean): Promise<void> {
    try {
      const parsed = await parseWireState(raw);
      if (!stillCurrent()) return;
      if (parsed === null) {
        console.warn('[DisplayWindowStateHandler] invalid display window state');
        this._error.set(INVALID_STATE_TEXT);
        return;
      }
      this._error.set(null);
      this._snapshot.set(parsed);
    } catch {
      // degradation-audit: reported — the schema chunk failed to load; the previous snapshot stays.
      this._error.set(LOAD_FAILED_TEXT);
    }
  }
}
