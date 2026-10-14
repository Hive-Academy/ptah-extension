/**
 * Autopilot State Service - Signal-Based Autopilot Configuration State Management
 *
 * Manages autopilot enabled state and permission level with RPC synchronization.
 * Follows AppStateManager signal-based pattern (private _signal, public asReadonly).
 */

import { Injectable, signal, computed, inject } from '@angular/core';
import { ClaudeRpcService } from './claude-rpc.service';
import { MessageHandler } from './message-router.types';
import { setIfChanged } from './idempotent-setters';
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
/** The autopilot state one tab shows: enabled + level. */
export interface AutopilotTabState {
  readonly enabled: boolean;
  readonly permissionLevel: PermissionLevel;
}

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
   * Live level of each session a tab has shown, as last read from the host or
   * set by a toggle in that tab (TASK_2026_660). A toggle re-gates only its
   * own tab's session, so the saved default above says nothing about another
   * tab's live session.
   */
  private readonly _sessionLevels = signal<
    ReadonlyMap<SessionId, PermissionLevel>
  >(new Map());
  /** Bumped by every toggle so a host read started earlier cannot undo it. */
  private writeEpoch = 0;
  /**
   * Autopilot enabled state (the saved default for new and resumed sessions)
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
  readonly statusText = computed(() =>
    this.statusTextFor({
      enabled: this._enabled(),
      permissionLevel: this._permissionLevel(),
    }),
  );

  constructor() {
    this.loadPersistedState();
  }

  /**
   * The state a tab shows (TASK_2026_660): its session's live level when the
   * host reported one, else the saved default — what a tab without a live
   * session starts at. Reads signals, so it is reactive inside `computed`.
   */
  stateFor(sessionId: SessionId | null): AutopilotTabState {
    const live = sessionId ? this._sessionLevels().get(sessionId) : undefined;
    if (live === undefined) {
      return {
        enabled: this._enabled(),
        permissionLevel: this._permissionLevel(),
      };
    }
    // A disabled toggle re-gates the session to `ask` (SDK `default`).
    return { enabled: live !== 'ask', permissionLevel: live };
  }

  /** Status text for a tab state; agent plan mode takes precedence. */
  statusTextFor(state: AutopilotTabState): string {
    if (this._agentPlanMode()) {
      return 'Plan Mode';
    }
    if (!state.enabled) {
      return 'Manual';
    }
    return PERMISSION_LEVEL_NAMES[state.permissionLevel];
  }

  /**
   * Read a session's live level from the host. A session that is not live
   * drops its entry: it starts at the saved default when it resumes. A read
   * overtaken by a toggle is discarded, so it cannot undo that toggle.
   */
  async refreshSession(sessionId: SessionId): Promise<void> {
    const epoch = this.writeEpoch;
    const result = await this.rpc.call('config:autopilot-get', { sessionId });
    if (!result.isSuccess() || !result.data || epoch !== this.writeEpoch) {
      return;
    }
    const level = result.data.sessionPermissionLevel;
    if (level === undefined) return;
    this.setSessionLevel(sessionId, isPermissionLevel(level) ? level : null);
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
   * Flips the state the tab shows ({@link stateFor}), not the saved default:
   * the toggle re-gates only this tab's session. When toggling on, uses the
   * saved permission level; when toggling off, preserves it for next enable.
   *
   * @param sessionId - The tab's session, or null when it has none (the toggle
   *   then saves the default only and changes no live session)
   * @returns Promise that resolves when RPC call completes
   *
   * @example
   * await autopilotState.toggleAutopilot();
   * // UI updates immediately, persists to backend asynchronously
   */
  async toggleAutopilot(sessionId?: SessionId | null): Promise<void> {
    const current = this.stateFor(sessionId ?? null);
    await this.persist(
      {
        enabled: !current.enabled,
        permissionLevel: current.enabled
          ? current.permissionLevel
          : this._permissionLevel(),
      },
      sessionId ?? null,
      '[AutopilotStateService] Toggle already in progress, ignoring',
      '[AutopilotStateService] Failed to toggle autopilot:',
    );
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
   * @param sessionId - The tab's session, or null when it has none
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
    await this.persist(
      {
        enabled: this.stateFor(sessionId ?? null).enabled,
        permissionLevel: level,
      },
      sessionId ?? null,
      '[AutopilotStateService] Update already in progress, ignoring',
      '[AutopilotStateService] Failed to set permission level:',
    );
  }

  /**
   * One `config:autopilot-toggle`, applied optimistically and rolled back on
   * failure. The host saves `next` as the default for new sessions and
   * re-gates `sessionId`'s live session (none when null), so both are
   * mirrored here.
   */
  private async persist(
    next: AutopilotTabState,
    sessionId: SessionId | null,
    pendingMessage: string,
    failureMessage: string,
  ): Promise<void> {
    if (this._isPending()) {
      console.warn(pendingMessage);
      return;
    }
    this._isPending.set(true);
    this.writeEpoch++;

    const previousEnabled = this._enabled();
    const previousLevel = this._permissionLevel();
    const previousSessionLevel = sessionId
      ? (this._sessionLevels().get(sessionId) ?? null)
      : null;
    try {
      this._enabled.set(next.enabled);
      this._permissionLevel.set(next.permissionLevel);
      if (sessionId) {
        this.setSessionLevel(
          sessionId,
          next.enabled ? next.permissionLevel : 'ask',
        );
      }
      const result = await this.rpc.call('config:autopilot-toggle', {
        enabled: next.enabled,
        permissionLevel: next.permissionLevel,
        sessionId,
      });

      if (!result.isSuccess()) {
        console.error(failureMessage, result.error);
        this._enabled.set(previousEnabled);
        this._permissionLevel.set(previousLevel);
        if (sessionId) this.setSessionLevel(sessionId, previousSessionLevel);
      }
    } finally {
      this._isPending.set(false);
    }
  }

  /** Record (or, with null, forget) a session's live level. */
  private setSessionLevel(
    sessionId: SessionId,
    level: PermissionLevel | null,
  ): void {
    const current = this._sessionLevels();
    if ((current.get(sessionId) ?? null) === level) return;
    const next = new Map(current);
    if (level === null) next.delete(sessionId);
    else next.set(sessionId, level);
    this._sessionLevels.set(next);
  }

  /**
   * Set agent-initiated plan mode state
   * Called when the agent uses EnterPlanMode/ExitPlanMode tools
   *
   * Idempotent: the backend re-pushes the current plan-mode state on every turn
   * end, so an unconditional set logged (and re-notified) twice per turn for a
   * value that never moved. Only a real transition is worth either.
   *
   * @param active - Whether plan mode is active
   */
  setAgentPlanMode(active: boolean): void {
    if (!setIfChanged(this._agentPlanMode, active)) return;
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
