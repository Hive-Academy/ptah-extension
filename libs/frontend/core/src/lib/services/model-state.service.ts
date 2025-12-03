/**
 * Model State Service - Signal-Based Model Selection State Management
 * TASK_2025_035: Model selector and autopilot integration
 *
 * Manages Claude model selection state (opus, sonnet, haiku) with RPC synchronization.
 * Follows AppStateManager signal-based pattern (private _signal, public asReadonly).
 *
 * Pattern source: app-state.service.ts:30-120
 * RPC integration: claude-rpc.service.ts:93-125
 */

import { Injectable, signal, computed, inject } from '@angular/core';
import { ClaudeRpcService, RpcResult } from './claude-rpc.service';
import {
  ClaudeModel,
  MODEL_DISPLAY_NAMES,
  isSelectableClaudeModel,
} from '@ptah-extension/shared';

/**
 * Type alias for selectable models (excludes 'default')
 */
export type SelectableClaudeModel = Exclude<ClaudeModel, 'default'>;

/**
 * Model State Service - Signal-based model selection state
 *
 * Responsibilities:
 * - Maintain current model selection (opus | sonnet | haiku)
 * - Provide readonly signals for reactive UI updates
 * - Sync model selection with backend via RPC
 * - Load initial state from backend on construction
 * - Implement optimistic updates with rollback on RPC failure
 *
 * Usage:
 * ```typescript
 * readonly modelState = inject(ModelStateService);
 *
 * // Read model
 * console.log(modelState.currentModel()); // 'sonnet'
 * console.log(modelState.currentModelDisplay()); // 'Claude Sonnet 4.0'
 *
 * // Switch model
 * await modelState.switchModel('opus');
 * ```
 *
 * @example
 * // In component:
 * readonly modelState = inject(ModelStateService);
 * readonly modelDisplay = this.modelState.currentModelDisplay;
 *
 * // In template:
 * <span>{{ modelDisplay() }}</span>
 */
@Injectable({ providedIn: 'root' })
export class ModelStateService {
  private readonly rpc = inject(ClaudeRpcService);

  // Private mutable signals
  private readonly _currentModel = signal<SelectableClaudeModel>('sonnet');
  private readonly _availableModels = signal<SelectableClaudeModel[]>([
    'opus',
    'sonnet',
    'haiku',
  ]);
  private readonly _isPending = signal(false);

  // Public readonly signals
  /**
   * Current selected model (opus | sonnet | haiku)
   * Read-only signal, updates reactively when model changes
   */
  readonly currentModel = this._currentModel.asReadonly();

  /**
   * Pending state for RPC operations
   * True when a model switch is in progress, prevents concurrent updates
   */
  readonly isPending = this._isPending.asReadonly();

  /**
   * Available selectable models
   * Read-only signal, currently static list
   */
  readonly availableModels = this._availableModels.asReadonly();

  /**
   * Current model display name for UI rendering
   * Computed signal that derives from currentModel
   *
   * @example
   * currentModel() === 'sonnet' → 'Claude Sonnet 4.0'
   * currentModel() === 'opus' → 'Claude Opus 4.0'
   */
  readonly currentModelDisplay = computed(() => {
    const model = this._currentModel();
    return MODEL_DISPLAY_NAMES[model];
  });

  constructor() {
    // Load persisted model from backend on initialization
    this.loadPersistedModel();
  }

  /**
   * Switch to a different model
   *
   * Implements optimistic update pattern with race condition protection:
   * 1. Check if operation already in progress (prevents concurrent updates)
   * 2. Update local signal immediately (UI updates instantly)
   * 3. Persist to backend via RPC
   * 4. Rollback on RPC failure (reload from backend)
   *
   * @param model - Model to switch to (opus | sonnet | haiku)
   * @returns Promise that resolves when RPC call completes
   *
   * @example
   * await modelState.switchModel('opus');
   * // UI updates immediately, persists to backend asynchronously
   */
  async switchModel(model: SelectableClaudeModel): Promise<void> {
    // QA FIX: Prevent concurrent model switches (race condition protection)
    if (this._isPending()) {
      console.warn(
        '[ModelStateService] Model switch already in progress, ignoring'
      );
      return;
    }

    // Mark operation as in progress
    this._isPending.set(true);

    try {
      // Store previous model for rollback
      const previousModel = this._currentModel();

      // Optimistic update (UI updates immediately)
      this._currentModel.set(model);

      // Persist to backend via RPC
      const result: RpcResult<void> = await this.rpc.call<void>(
        'model:switch',
        {
          model,
        }
      );

      if (!result.isSuccess()) {
        console.error(
          '[ModelStateService] Failed to switch model:',
          result.error
        );
        // QA FIX: Direct rollback to previous value (no RPC call to prevent cascading failures)
        this._currentModel.set(previousModel);
      }
    } finally {
      // Always clear pending state
      this._isPending.set(false);
    }
  }

  /**
   * Load persisted model from backend
   *
   * Called on service construction to initialize state from backend configuration.
   * Also called on RPC failure to rollback optimistic updates.
   *
   * @private
   */
  private async loadPersistedModel(): Promise<void> {
    const result: RpcResult<{ model: ClaudeModel }> = await this.rpc.call<{
      model: ClaudeModel;
    }>('model:get', {});

    if (result.isSuccess() && result.data) {
      const model = result.data.model;

      // Validate model is selectable (exclude 'default')
      if (isSelectableClaudeModel(model)) {
        this._currentModel.set(model);
      } else {
        // Backend returned 'default' or invalid value, use fallback
        console.warn(
          `[ModelStateService] Backend returned non-selectable model: ${model}, using default 'sonnet'`
        );
        this._currentModel.set('sonnet');
      }
    } else {
      console.error(
        '[ModelStateService] Failed to load persisted model:',
        result.error
      );
      // Keep current state (default 'sonnet' if never initialized)
    }
  }
}
