/**
 * Model State Service - Signal-Based Model Selection State Management
 * TASK_2025_035: Model selector and autopilot integration
 *
 * Manages Claude model selection state with RPC synchronization.
 * Loads available models dynamically from backend for future extensibility.
 * Follows AppStateManager signal-based pattern (private _signal, public asReadonly).
 *
 * Pattern source: app-state.service.ts:30-120
 * RPC integration: claude-rpc.service.ts:93-125
 */

import { Injectable, signal, computed, inject } from '@angular/core';
import { ClaudeRpcService, RpcResult } from './claude-rpc.service';
import {
  ClaudeModel,
  ModelInfo,
  AVAILABLE_MODELS,
  isSelectableClaudeModel,
  SessionId,
} from '@ptah-extension/shared';

/**
 * Type alias for selectable models (excludes 'default')
 */
export type SelectableClaudeModel = Exclude<ClaudeModel, 'default'>;

/**
 * Extended ModelInfo with selection state
 */
export interface ModelInfoWithSelection extends ModelInfo {
  isSelected: boolean;
}

/**
 * Model State Service - Signal-based model selection state
 *
 * Responsibilities:
 * - Maintain current model selection (opus | sonnet | haiku)
 * - Load available models from backend (dynamic, not hardcoded)
 * - Provide readonly signals for reactive UI updates
 * - Sync model selection with backend via RPC
 * - Implement optimistic updates with rollback on RPC failure
 *
 * Usage:
 * ```typescript
 * readonly modelState = inject(ModelStateService);
 *
 * // Read model
 * console.log(modelState.currentModel()); // 'sonnet'
 * console.log(modelState.currentModelDisplay()); // 'Sonnet 4.5'
 *
 * // Get available models with metadata
 * console.log(modelState.availableModels()); // [{id, name, description, isSelected}]
 *
 * // Switch model
 * await modelState.switchModel('opus');
 * ```
 */
@Injectable({ providedIn: 'root' })
export class ModelStateService {
  private readonly rpc = inject(ClaudeRpcService);

  // Private mutable signals
  private readonly _currentModel = signal<SelectableClaudeModel>('sonnet');
  private readonly _availableModels = signal<ModelInfoWithSelection[]>(
    // Initialize with static list, will be updated from RPC
    AVAILABLE_MODELS.map((m) => ({
      ...m,
      isSelected: m.id === 'sonnet',
    }))
  );
  private readonly _isPending = signal(false);
  private readonly _isLoaded = signal(false);

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
   * Whether initial load from backend is complete
   */
  readonly isLoaded = this._isLoaded.asReadonly();

  /**
   * Available models with full metadata and selection state
   * Loaded from backend for dynamic updates when new models are available
   */
  readonly availableModels = this._availableModels.asReadonly();

  /**
   * Current model display name for UI rendering
   * Computed signal that derives from availableModels and currentModel
   *
   * @example
   * currentModel() === 'sonnet' → 'Sonnet 4.5'
   * currentModel() === 'opus' → 'Opus 4.5'
   */
  readonly currentModelDisplay = computed(() => {
    const modelId = this._currentModel();
    const models = this._availableModels();
    const model = models.find((m) => m.id === modelId);
    return model?.name ?? modelId;
  });

  /**
   * Current model info object (full metadata)
   */
  readonly currentModelInfo = computed(() => {
    const modelId = this._currentModel();
    const models = this._availableModels();
    return models.find((m) => m.id === modelId);
  });

  constructor() {
    // Load models and selection from backend on initialization
    this.loadModels();
  }

  /**
   * Switch to a different model
   *
   * Implements optimistic update pattern with race condition protection:
   * 1. Check if operation already in progress (prevents concurrent updates)
   * 2. Update local signal immediately (UI updates instantly)
   * 3. Persist to backend via RPC
   * 4. Rollback on RPC failure (restore previous state)
   *
   * @param model - Model to switch to (opus | sonnet | haiku)
   * @param sessionId - Optional active session ID for live SDK sync
   * @returns Promise that resolves when RPC call completes
   *
   * @example
   * await modelState.switchModel('opus');
   * // UI updates immediately, persists to backend asynchronously
   */
  async switchModel(
    model: SelectableClaudeModel,
    sessionId?: SessionId | null
  ): Promise<void> {
    // Prevent concurrent model switches (race condition protection)
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
      this.updateSelectionState(model);

      // Persist to backend via RPC (with sessionId for live SDK sync)
      const result: RpcResult<{ model: ClaudeModel }> = await this.rpc.call<{
        model: ClaudeModel;
      }>('config:model-switch', { model, sessionId: sessionId ?? null });

      if (!result.isSuccess()) {
        console.error(
          '[ModelStateService] Failed to switch model:',
          result.error
        );
        // Rollback to previous value
        this._currentModel.set(previousModel);
        this.updateSelectionState(previousModel);
      }
    } finally {
      // Always clear pending state
      this._isPending.set(false);
    }
  }

  /**
   * Reload models from backend
   * Useful after configuration changes or to refresh the list
   */
  async refreshModels(): Promise<void> {
    await this.loadModels();
  }

  /**
   * Load available models and current selection from backend
   *
   * @private
   */
  private async loadModels(): Promise<void> {
    try {
      const result: RpcResult<{ models: ModelInfoWithSelection[] }> =
        await this.rpc.call<{ models: ModelInfoWithSelection[] }>(
          'config:models-list',
          {}
        );

      if (result.isSuccess() && result.data?.models) {
        const models = result.data.models;
        this._availableModels.set(models);

        // Find and set the selected model
        const selected = models.find((m) => m.isSelected);
        if (selected && isSelectableClaudeModel(selected.id)) {
          this._currentModel.set(selected.id);
        }

        this._isLoaded.set(true);
      } else {
        console.error(
          '[ModelStateService] Failed to load models:',
          result.error
        );
        // Keep fallback static list
        this._isLoaded.set(true);
      }
    } catch (error) {
      console.error('[ModelStateService] Error loading models:', error);
      this._isLoaded.set(true);
    }
  }

  /**
   * Update isSelected state in availableModels
   *
   * @private
   */
  private updateSelectionState(selectedId: SelectableClaudeModel): void {
    const models = this._availableModels();
    this._availableModels.set(
      models.map((m) => ({
        ...m,
        isSelected: m.id === selectedId,
      }))
    );
  }
}
