/**
 * Effort State Service - Signal-Based Reasoning Effort Persistence
 *
 * Manages reasoning effort level selection with VS Code settings persistence.
 * Follows the same pattern as ModelStateService: load from backend on init,
 * save via RPC on change, expose as readonly signal.
 */

import { Injectable, signal, inject } from '@angular/core';
import { EffortSettingsChangeService } from './effort-settings-change.service';
import { ClaudeRpcService } from './claude-rpc.service';
import type { EffortLevel, SessionId } from '@ptah-extension/shared';

@Injectable({ providedIn: 'root' })
export class EffortStateService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly changes = inject(EffortSettingsChangeService);

  /** Current effort level. undefined = SDK default. */
  private readonly _currentEffort = signal<EffortLevel | undefined>(undefined);
  readonly currentEffort = this._currentEffort.asReadonly();

  private readonly _isLoaded = signal(false);
  readonly isLoaded = this._isLoaded.asReadonly();

  /** Bumped by every read: only the newest read may apply. */
  private readGeneration = 0;
  /** Bumped at the start and the end of every write: a read that overlaps a write is dropped. */
  private writeEvents = 0;
  /** A read was dropped by a write that is still pending: read again once the writes finish. */
  private rereadAfterWrites = false;

  constructor() {
    this.loadEffort();
  }

  /**
   * Switch effort level with optimistic update + backend persistence.
   *
   * @param effort - Effort level, or undefined for SDK default
   * @param sessionId - Active session ID for live SDK sync (optional)
   * @returns Whether this write landed: `false` when it failed and the effort was rolled back. A caller must use this,
   *   not a read-back of the effort, which cannot tell a failed write from one whose old value was the same.
   */
  async setEffort(
    effort: EffortLevel | undefined,
    sessionId?: SessionId | null,
  ): Promise<boolean> {
    const finishWrite = this.changes.beginWrite();
    this.writeEvents++;
    const previous = this._currentEffort();
    this._currentEffort.set(effort);

    try {
      const result = await this.rpc.call('config:effort-set', {
        effort,
        sessionId: sessionId ?? null,
      });
      if (!result.isSuccess()) {
        console.error(
          '[EffortStateService] Failed to save effort:',
          result.error,
        );
        this._currentEffort.set(previous);
        return false;
      }
      return true;
    } catch (error: unknown) {
      console.error('[EffortStateService] Error saving effort:', error);
      this._currentEffort.set(previous);
      return false;
    } finally {
      this.writeEvents++;
      finishWrite();
      if (this.rereadAfterWrites && this.changes.pending() === 0) {
        this.rereadAfterWrites = false;
        void this.loadEffort();
      }
    }
  }

  /**
   * Force-refresh the current effort from the backend.
   * Used after auth provider switches — the backend's `ComputedSettingHandle`
   * resolves to the new provider's stored slot, so the UI signal must be
   * re-synced. Mirrors `ModelStateService.refreshModels()`.
   */
  async refreshEffort(): Promise<void> {
    await this.loadEffort();
  }

  private async loadEffort(): Promise<void> {
    const generation = ++this.readGeneration;
    const writeEventsAtStart = this.writeEvents;
    try {
      const result = await this.rpc.call('config:effort-get', {});
      if (generation !== this.readGeneration) return;
      if (
        this.writeEvents !== writeEventsAtStart ||
        this.changes.pending() > 0
      ) {
        // The write's value can target the slot of the provider this read was meant to replace,
        // so do not keep it blindly: read again once no write is pending.
        if (this.changes.pending() > 0) this.rereadAfterWrites = true;
        else void this.loadEffort();
        return;
      }
      if (result.isSuccess() && result.data) {
        this._currentEffort.set(result.data.effort);
      }
    } catch (error: unknown) {
      console.error('[EffortStateService] Error loading effort:', error);
    } finally {
      this._isLoaded.set(true);
    }
  }
}
