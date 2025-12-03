/**
 * Autopilot State Service - Signal-Based Autopilot Configuration State Management
 * TASK_2025_035: Model selector and autopilot integration
 *
 * Manages autopilot enabled state and permission level with RPC synchronization.
 * Follows AppStateManager signal-based pattern (private _signal, public asReadonly).
 *
 * Pattern source: app-state.service.ts:30-120
 * RPC integration: claude-rpc.service.ts:93-125
 */

import { Injectable, signal, computed, inject } from '@angular/core';
import { ClaudeRpcService, RpcResult } from './claude-rpc.service';
import {
  PermissionLevel,
  PERMISSION_LEVEL_NAMES,
  isPermissionLevel,
} from '@ptah-extension/shared';

/**
 * Autopilot State Service - Signal-based autopilot configuration state
 *
 * Responsibilities:
 * - Maintain autopilot enabled state (boolean)
 * - Maintain permission level (ask | auto-edit | yolo)
 * - Provide readonly signals for reactive UI updates
 * - Sync autopilot state with backend via RPC
 * - Load initial state from backend on construction
 * - Implement optimistic updates with rollback on RPC failure
 *
 * Usage:
 * ```typescript
 * readonly autopilotState = inject(AutopilotStateService);
 *
 * // Read state
 * console.log(autopilotState.enabled()); // false
 * console.log(autopilotState.permissionLevel()); // 'ask'
 * console.log(autopilotState.statusText()); // 'Manual'
 *
 * // Toggle autopilot
 * await autopilotState.toggleAutopilot();
 *
 * // Change permission level
 * await autopilotState.setPermissionLevel('auto-edit');
 * ```
 *
 * Permission Levels:
 * - `ask`: Manual approval for each action (default, safest)
 * - `auto-edit`: Auto-approve Edit and Write tools
 * - `yolo`: Skip ALL permission prompts (DANGEROUS)
 *
 * @example
 * // In component:
 * readonly autopilotState = inject(AutopilotStateService);
 * readonly statusText = this.autopilotState.statusText;
 *
 * // In template:
 * <span>Status: {{ statusText() }}</span>
 * <input type="checkbox" [checked]="autopilotState.enabled()" />
 */
@Injectable({ providedIn: 'root' })
export class AutopilotStateService {
  private readonly rpc = inject(ClaudeRpcService);

  // Private mutable signals
  private readonly _enabled = signal(false);
  private readonly _permissionLevel = signal<PermissionLevel>('ask');

  // Public readonly signals
  /**
   * Autopilot enabled state
   * Read-only signal, updates reactively when toggled
   */
  readonly enabled = this._enabled.asReadonly();

  /**
   * Permission level (ask | auto-edit | yolo)
   * Read-only signal, updates reactively when changed
   */
  readonly permissionLevel = this._permissionLevel.asReadonly();

  /**
   * Status text for UI display
   * Computed signal that derives from enabled + permissionLevel
   *
   * @example
   * enabled: false → 'Manual'
   * enabled: true, level: 'ask' → 'Manual'
   * enabled: true, level: 'auto-edit' → 'Auto-edit'
   * enabled: true, level: 'yolo' → 'Full Auto (YOLO)'
   */
  readonly statusText = computed(() => {
    const enabled = this._enabled();
    const level = this._permissionLevel();

    // If disabled, always show 'Manual'
    if (!enabled) {
      return 'Manual';
    }

    // If enabled, show permission level display name
    return PERMISSION_LEVEL_NAMES[level];
  });

  constructor() {
    // Load persisted state from backend on initialization
    this.loadPersistedState();
  }

  /**
   * Toggle autopilot on/off
   *
   * Implements optimistic update pattern:
   * 1. Update local signal immediately (UI updates instantly)
   * 2. Persist to backend via RPC
   * 3. Rollback on RPC failure (invert state)
   *
   * When toggling on, uses current permission level.
   * When toggling off, preserves permission level for next enable.
   *
   * @returns Promise that resolves when RPC call completes
   *
   * @example
   * await autopilotState.toggleAutopilot();
   * // UI updates immediately, persists to backend asynchronously
   */
  async toggleAutopilot(): Promise<void> {
    const newState = !this._enabled();
    const previousState = this._enabled();

    // Optimistic update (UI updates immediately)
    this._enabled.set(newState);

    // Persist to backend via RPC
    const result: RpcResult<void> = await this.rpc.call<void>(
      'autopilot:toggle',
      {
        enabled: newState,
        permissionLevel: this._permissionLevel(),
      }
    );

    if (!result.isSuccess()) {
      console.error(
        '[AutopilotStateService] Failed to toggle autopilot:',
        result.error
      );
      // Rollback on failure: restore previous state
      this._enabled.set(previousState);
    }
  }

  /**
   * Set permission level (ask, auto-edit, yolo)
   *
   * Updates permission level and persists to backend.
   * If autopilot is currently enabled, changes take effect immediately.
   * If autopilot is disabled, changes are saved but won't affect CLI until enabled.
   *
   * Implements optimistic update pattern with rollback on failure.
   *
   * @param level - Permission level to set
   * @returns Promise that resolves when RPC call completes
   *
   * @example
   * await autopilotState.setPermissionLevel('auto-edit');
   * // UI updates immediately, persists to backend asynchronously
   */
  async setPermissionLevel(level: PermissionLevel): Promise<void> {
    const previousLevel = this._permissionLevel();

    // Optimistic update (UI updates immediately)
    this._permissionLevel.set(level);

    // Persist to backend via RPC
    // Note: We always call autopilot:toggle RPC with current enabled state
    // Backend will persist the new permission level
    const result: RpcResult<void> = await this.rpc.call<void>(
      'autopilot:toggle',
      {
        enabled: this._enabled(),
        permissionLevel: level,
      }
    );

    if (!result.isSuccess()) {
      console.error(
        '[AutopilotStateService] Failed to set permission level:',
        result.error
      );
      // Rollback on failure: restore previous level
      this._permissionLevel.set(previousLevel);
    }
  }

  /**
   * Load persisted state from backend
   *
   * Called on service construction to initialize state from backend configuration.
   * Also called internally if needed to recover from errors.
   *
   * @private
   */
  private async loadPersistedState(): Promise<void> {
    const result: RpcResult<{
      enabled: boolean;
      permissionLevel: PermissionLevel;
    }> = await this.rpc.call<{
      enabled: boolean;
      permissionLevel: PermissionLevel;
    }>('autopilot:get', {});

    if (result.isSuccess() && result.data) {
      const { enabled, permissionLevel } = result.data;

      // Update signals with backend values
      this._enabled.set(enabled);

      // Validate permission level before setting
      if (isPermissionLevel(permissionLevel)) {
        this._permissionLevel.set(permissionLevel);
      } else {
        console.warn(
          `[AutopilotStateService] Backend returned invalid permission level: ${permissionLevel}, using default 'ask'`
        );
        this._permissionLevel.set('ask');
      }
    } else {
      console.error(
        '[AutopilotStateService] Failed to load persisted state:',
        result.error
      );
      // Keep current state (defaults: enabled=false, permissionLevel='ask')
    }
  }
}
