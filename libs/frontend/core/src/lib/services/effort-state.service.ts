/**
 * Effort State Service - Signal-Based Reasoning Effort Persistence
 *
 * Manages reasoning effort level selection with VS Code settings persistence.
 * Follows the same pattern as ModelStateService: load from backend on init,
 * save via RPC on change, expose as readonly signal.
 */

import { Injectable, signal, inject } from '@angular/core';
import { ClaudeRpcService } from './claude-rpc.service';
import type { EffortLevel } from '@ptah-extension/shared';

@Injectable({ providedIn: 'root' })
export class EffortStateService {
  private readonly rpc = inject(ClaudeRpcService);

  /** Current effort level. undefined = SDK default. */
  private readonly _currentEffort = signal<EffortLevel | undefined>(undefined);
  readonly currentEffort = this._currentEffort.asReadonly();

  private readonly _isLoaded = signal(false);
  readonly isLoaded = this._isLoaded.asReadonly();

  constructor() {
    this.loadEffort();
  }

  /**
   * Switch effort level with optimistic update + backend persistence.
   */
  async setEffort(effort: EffortLevel | undefined): Promise<void> {
    const previous = this._currentEffort();
    this._currentEffort.set(effort);

    try {
      const result = await this.rpc.call('config:effort-set', { effort });
      if (!result.isSuccess()) {
        console.error(
          '[EffortStateService] Failed to save effort:',
          result.error,
        );
        this._currentEffort.set(previous);
      }
    } catch (error) {
      console.error('[EffortStateService] Error saving effort:', error);
      this._currentEffort.set(previous);
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
    try {
      const result = await this.rpc.call('config:effort-get', {});
      if (result.isSuccess() && result.data) {
        this._currentEffort.set(result.data.effort);
      }
      this._isLoaded.set(true);
    } catch (error) {
      console.error('[EffortStateService] Error loading effort:', error);
      this._isLoaded.set(true);
    }
  }
}
