/**
 * Model State Service - Signal-Based Model Selection State Management
 *
 * Manages Claude model selection state with RPC synchronization.
 * Loads available models dynamically from backend for future extensibility.
 * Follows AppStateManager signal-based pattern (private _signal, public asReadonly).
 */

import { Injectable, signal, computed, inject } from '@angular/core';
import { ClaudeRpcService } from './claude-rpc.service';
import { SessionId, SdkModelInfo } from '@ptah-extension/shared';

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
  private readonly _currentModel = signal<string>(''); // Populated from backend RPC
  private readonly _availableModels = signal<SdkModelInfo[]>([]);
  private readonly _isPending = signal(false);
  private readonly _isLoaded = signal(false);
  /**
   * Current selected model (full API name, e.g., 'claude-sonnet-4-20250514')
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
   * Current model display name for UI rendering (always human-readable)
   * Computed signal that derives from availableModels and currentModel
   *
   * @example
   * currentModel() === 'claude-sonnet-4-20250514' → 'Claude Sonnet 4'
   * currentModel() === 'claude-opus-4-20250514' → 'Claude Opus 4'
   */
  readonly currentModelDisplay = computed(() => {
    const modelId = this._currentModel();
    const models = this._availableModels();
    const model = models.find((m) => m.id === modelId);
    return model?.name ?? modelId;
  });

  /**
   * Provider model hint for the current model (e.g., 'openai/gpt-5.1-codex-max')
   * Returns null when no provider override is active.
   * Used as supplementary info below/beside the friendly display name.
   */
  readonly currentModelProviderHint = computed(() => {
    const modelId = this._currentModel();
    const models = this._availableModels();
    const model = models.find((m) => m.id === modelId);
    return model?.providerModelId ?? null;
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
   * @param model - Model API name to switch to (e.g., 'claude-sonnet-4-20250514')
   * @param sessionId - Optional active session ID for live SDK sync
   * @returns Promise that resolves when RPC call completes
   *
   * @example
   * await modelState.switchModel('claude-sonnet-4-20250514');
   * // UI updates immediately, persists to backend asynchronously
   */
  async switchModel(
    model: string,
    sessionId?: SessionId | null,
  ): Promise<void> {
    if (this._isPending()) {
      console.warn(
        '[ModelStateService] Model switch already in progress, ignoring',
      );
      return;
    }
    this._isPending.set(true);

    try {
      const previousModel = this._currentModel();
      this._currentModel.set(model);
      this.updateSelectionState(model);
      const result = await this.rpc.call('config:model-switch', {
        model,
        sessionId: sessionId ?? null,
      });

      if (!result.isSuccess()) {
        console.error(
          '[ModelStateService] Failed to switch model:',
          result.error,
        );
        this._currentModel.set(previousModel);
        this.updateSelectionState(previousModel);
      }
    } finally {
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
      const result = await this.rpc.call('config:models-list', {});

      if (result.isSuccess() && result.data?.models) {
        const models = result.data.models;
        this._availableModels.set(models);
        const selected = models.find((m) => m.isSelected);
        if (selected) {
          this._currentModel.set(selected.id);
        }

        // Workspace switch re-validation: `_currentModel` is a single global
        // signal, so after switching to a workspace on a DIFFERENT provider the
        // surviving model may no longer be offered by the freshly loaded list.
        // Sending it verbatim makes the backend reject the turn ("Model X is not
        // available for the configured provider"). If the current model is set
        // but absent from the new list, reset it to a valid one. The happy path
        // above (an `isSelected` model IS present) is untouched — that id is in
        // the list, so this check is a no-op there.
        const current = this._currentModel();
        if (current && !models.some((m) => m.id === current)) {
          const fallback =
            selected ?? models.find((m) => m.id === 'default') ?? models[0];
          this._currentModel.set(fallback?.id ?? '');
        }

        this._isLoaded.set(true);
      } else {
        console.error(
          '[ModelStateService] Failed to load models:',
          result.error,
        );
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
  private updateSelectionState(selectedId: string): void {
    const models = this._availableModels();
    this._availableModels.set(
      models.map((m) => ({
        ...m,
        isSelected: m.id === selectedId,
      })),
    );
  }
}
