/**
 * Autopilot State Service - Signal-Based Autopilot Configuration State Management
 *
 * Manages autopilot enabled state and permission level with RPC synchronization.
 * Follows AppStateManager signal-based pattern (private _signal, public asReadonly).
 */

import { Injectable, signal, computed, inject } from '@angular/core';
import { ClaudeRpcService } from './claude-rpc.service';
import { MessageHandler } from './message-router.types';
import {
  PermissionLevel,
  PERMISSION_LEVEL_NAMES,
  isPermissionLevel,
  SessionId,
  MESSAGE_TYPES,
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
export class AutopilotStateService implements MessageHandler {
  private readonly rpc = inject(ClaudeRpcService);
  readonly handledMessageTypes = [MESSAGE_TYPES.PLAN_MODE_CHANGED] as const;

  handleMessage(message: { type: string; payload?: unknown }): void {
    const payload = message.payload as { active: boolean } | undefined;
    if (payload) {
      this.setAgentPlanMode(payload.active);
    }
  }
  private readonly _enabled = signal(false);
  private readonly _permissionLevel = signal<PermissionLevel>('ask');
  private readonly _isPending = signal(false);
  private readonly _agentPlanMode = signal(false);
  /**
   * Autopilot enabled state
   * Read-only signal, updates reactively when toggled
   */
  readonly enabled = this._enabled.asReadonly();

  /**
   * Pending state for RPC operations
   * True when an autopilot operation is in progress, prevents concurrent updates
   */
  readonly isPending = this._isPending.asReadonly();

  /**
   * Permission level (ask | auto-edit | yolo | plan)
   * Read-only signal, updates reactively when changed
   */
  readonly permissionLevel = this._permissionLevel.asReadonly();

  /**
   * Agent-initiated plan mode indicator
   * True when the agent has called EnterPlanMode tool
   * This is separate from the user's permission level setting
   */
  readonly agentPlanMode = this._agentPlanMode.asReadonly();

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
    if (this._agentPlanMode()) {
      return 'Plan Mode';
    }

    const enabled = this._enabled();
    const level = this._permissionLevel();
    if (!enabled) {
      return 'Manual';
    }
    return PERMISSION_LEVEL_NAMES[level];
  });

  constructor() {
    this.loadPersistedState();
  }

  /**
   * Toggle autopilot on/off
   *
   * Implements optimistic update pattern with race condition protection:
   * 1. Check if operation already in progress (prevents concurrent updates)
   * 2. Update local signal immediately (UI updates instantly)
   * 3. Persist to backend via RPC
   * 4. Rollback on RPC failure (invert state)
   *
   * When toggling on, uses current permission level.
   * When toggling off, preserves permission level for next enable.
   *
   * @param sessionId - Optional active session ID for live SDK sync
   * @returns Promise that resolves when RPC call completes
   *
   * @example
   * await autopilotState.toggleAutopilot();
   * // UI updates immediately, persists to backend asynchronously
   */
  async toggleAutopilot(sessionId?: SessionId | null): Promise<void> {
    if (this._isPending()) {
      console.warn(
        '[AutopilotStateService] Toggle already in progress, ignoring',
      );
      return;
    }
    this._isPending.set(true);

    try {
      const newState = !this._enabled();
      const previousState = this._enabled();
      this._enabled.set(newState);
      const result = await this.rpc.call('config:autopilot-toggle', {
        enabled: newState,
        permissionLevel: this._permissionLevel(),
        sessionId: sessionId ?? null,
      });

      if (!result.isSuccess()) {
        console.error(
          '[AutopilotStateService] Failed to toggle autopilot:',
          result.error,
        );
        this._enabled.set(previousState);
      }
    } finally {
      this._isPending.set(false);
    }
  }

  /**
   * Set permission level (ask, auto-edit, yolo)
   *
   * Updates permission level and persists to backend with race condition protection.
   * If autopilot is currently enabled, changes take effect immediately.
   * If autopilot is disabled, changes are saved but won't affect CLI until enabled.
   *
   * Implements optimistic update pattern with rollback on failure.
   *
   * @param level - Permission level to set
   * @param sessionId - Optional active session ID for live SDK sync
   * @returns Promise that resolves when RPC call completes
   *
   * @example
   * await autopilotState.setPermissionLevel('auto-edit');
   * // UI updates immediately, persists to backend asynchronously
   */
  async setPermissionLevel(
    level: PermissionLevel,
    sessionId?: SessionId | null,
  ): Promise<void> {
    if (this._isPending()) {
      console.warn(
        '[AutopilotStateService] Update already in progress, ignoring',
      );
      return;
    }
    this._isPending.set(true);

    try {
      const previousLevel = this._permissionLevel();
      this._permissionLevel.set(level);
      const result = await this.rpc.call('config:autopilot-toggle', {
        enabled: this._enabled(),
        permissionLevel: level,
        sessionId: sessionId ?? null,
      });

      if (!result.isSuccess()) {
        console.error(
          '[AutopilotStateService] Failed to set permission level:',
          result.error,
        );
        this._permissionLevel.set(previousLevel);
      }
    } finally {
      this._isPending.set(false);
    }
  }

  /**
   * Set agent-initiated plan mode state
   * Called when the agent uses EnterPlanMode/ExitPlanMode tools
   *
   * @param active - Whether plan mode is active
   */
  setAgentPlanMode(active: boolean): void {
    this._agentPlanMode.set(active);
    console.log(
      `[AutopilotStateService] Agent plan mode: ${
        active ? 'entered' : 'exited'
      }`,
    );
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
    const result = await this.rpc.call('config:autopilot-get', {});

    if (result.isSuccess() && result.data) {
      const { enabled, permissionLevel } = result.data;
      this._enabled.set(enabled);
      if (isPermissionLevel(permissionLevel)) {
        this._permissionLevel.set(permissionLevel);
      } else {
        console.warn(
          `[AutopilotStateService] Backend returned invalid permission level: ${permissionLevel}, using default 'ask'`,
        );
        this._permissionLevel.set('ask');
      }
    } else {
      console.error(
        '[AutopilotStateService] Failed to load persisted state:',
        result.error,
      );
    }
  }
}
