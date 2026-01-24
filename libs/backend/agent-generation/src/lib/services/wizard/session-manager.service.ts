/**
 * WizardSessionManagerService - Session CRUD and Persistence Service
 * TASK_2025_115: Setup Wizard Service Decomposition
 *
 * Responsibility:
 * - Create new wizard sessions
 * - Save session state to workspace storage
 * - Load saved session state
 * - Validate session expiry (24-hour limit)
 * - Clear expired sessions
 *
 * Pattern Source: setup-wizard.service.ts:1591-1756
 * Extracted from: SetupWizardService session management methods
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { v4 as uuidv4 } from 'uuid';
import type * as vscode from 'vscode';
import type {
  WizardSession,
  WizardState,
  WizardStep,
} from '../../types/wizard.types';

/**
 * Service responsible for wizard session lifecycle management.
 *
 * This service handles:
 * - Session creation with unique IDs
 * - Workspace state persistence for resume capability
 * - Session validation and expiry checking
 * - Session restoration from saved state
 *
 * **Session Lifecycle:**
 * 1. User launches wizard -> createSession()
 * 2. User progresses through steps -> session.currentStep updated
 * 3. User cancels with save -> saveSessionState()
 * 4. User relaunches wizard -> loadSavedState() + isSessionValid()
 * 5. Session completed -> clearSessionState()
 *
 * **Persistence Strategy:**
 * - Uses VS Code's workspace state (workspace-specific, not global)
 * - Sessions expire after 24 hours (MAX_SESSION_AGE_MS)
 * - Workspace root validation prevents cross-workspace state leakage
 *
 * @injectable
 */
@injectable()
export class WizardSessionManagerService {
  /**
   * Storage key for wizard session state in VS Code workspace state.
   */
  private readonly SESSION_STATE_KEY = 'wizard-session-state';

  /**
   * Maximum session age in milliseconds (24 hours).
   * Sessions older than this are considered expired.
   */
  private readonly MAX_SESSION_AGE_MS = 24 * 60 * 60 * 1000;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly context: vscode.ExtensionContext
  ) {
    this.logger.debug('[WizardSessionManager] Service initialized', {
      sessionStateKey: this.SESSION_STATE_KEY,
      maxSessionAgeHours: this.MAX_SESSION_AGE_MS / (60 * 60 * 1000),
    });
  }

  /**
   * Create a new wizard session.
   *
   * Generates a unique session with UUID v4 identifier and initializes
   * the session state at the 'welcome' step.
   *
   * @param workspaceRoot - Absolute path to workspace root
   * @returns New wizard session object
   *
   * @example
   * ```typescript
   * const session = sessionManager.createSession('/path/to/workspace');
   * // Returns: { id: 'uuid-123', workspaceRoot: '/path/to/workspace', currentStep: 'welcome', ... }
   * ```
   */
  createSession(workspaceRoot: string): WizardSession {
    const session: WizardSession = {
      id: uuidv4(),
      workspaceRoot,
      currentStep: 'welcome',
      startedAt: new Date(),
    };

    this.logger.info('[WizardSessionManager] Created new wizard session', {
      sessionId: session.id,
      workspaceRoot,
    });

    return session;
  }

  /**
   * Save wizard session state for resume capability.
   *
   * **Workspace State Persistence:**
   * This method persists wizard progress using VS Code's workspace state API,
   * enabling users to resume interrupted setup sessions.
   *
   * **What Data is Persisted:**
   * - Session ID (unique identifier)
   * - Current wizard step (welcome, scan, analysis, select, generate, complete)
   * - Workspace root path (validates session belongs to current workspace)
   * - Last activity timestamp (for session expiry validation)
   * - Project context (detected project type, frameworks, tech stack)
   * - Selected agent IDs (user's agent selection for generation)
   *
   * **Storage Location:**
   * - Stored in VS Code's workspace state (workspace-specific, not global)
   * - Key: 'wizard-session-state'
   * - Persists across VS Code restarts (until workspace is deleted)
   * - Isolated per workspace (different workspaces have independent sessions)
   *
   * @param session - Wizard session to save
   *
   * @example
   * ```typescript
   * await sessionManager.saveSessionState(currentSession);
   * // Session saved to workspace state for later resume
   * ```
   */
  async saveSessionState(session: WizardSession): Promise<void> {
    const state: WizardState = {
      sessionId: session.id,
      currentStep: session.currentStep,
      workspaceRoot: session.workspaceRoot,
      lastActivity: new Date(),
      projectContext: session.projectContext,
      selectedAgentIds: session.selectedAgentIds,
    };

    // Save to workspace state (persists across VS Code restarts)
    await this.context.workspaceState.update(this.SESSION_STATE_KEY, state);

    this.logger.debug('[WizardSessionManager] Saved wizard session state', {
      sessionId: session.id,
      step: session.currentStep,
      hasProjectContext: !!session.projectContext,
      hasSelectedAgents: !!session.selectedAgentIds,
    });
  }

  /**
   * Load saved wizard session state for a workspace.
   *
   * **Workspace State Retrieval:**
   * Retrieves previously saved wizard session state from VS Code workspace storage.
   * Validates that the saved state belongs to the current workspace before returning.
   *
   * **Workspace Isolation:**
   * - Each workspace has its own saved state (isolated storage)
   * - Opening wizard in different workspace will NOT load other workspace's state
   * - Workspace root path validation prevents cross-workspace state leakage
   *
   * **Return Behavior:**
   * - Returns saved state if exists AND workspace matches
   * - Returns undefined if no saved state exists
   * - Returns undefined if saved state is for different workspace
   *
   * @param workspaceRoot - Workspace root to load state for
   * @returns Saved wizard state, or undefined if none exists
   *
   * @example
   * ```typescript
   * const savedState = await sessionManager.loadSavedState(workspaceUri.fsPath);
   * if (savedState && sessionManager.isSessionValid(savedState)) {
   *   // Offer resume option in UI
   * }
   * ```
   */
  async loadSavedState(
    workspaceRoot: string
  ): Promise<WizardState | undefined> {
    const state = this.context.workspaceState.get<WizardState>(
      this.SESSION_STATE_KEY
    );

    if (!state) {
      this.logger.debug('[WizardSessionManager] No saved session state found');
      return undefined;
    }

    // Validate workspace matches (case-sensitive comparison)
    if (state.workspaceRoot !== workspaceRoot) {
      this.logger.warn(
        '[WizardSessionManager] Saved session workspace mismatch, ignoring',
        {
          savedWorkspace: state.workspaceRoot,
          currentWorkspace: workspaceRoot,
        }
      );
      return undefined;
    }

    this.logger.debug('[WizardSessionManager] Loaded saved wizard state', {
      sessionId: state.sessionId,
      step: state.currentStep,
    });

    return state;
  }

  /**
   * Validate wizard session state is still valid (not expired).
   *
   * **Session Expiry Policy:**
   * - Sessions expire after 24 hours (MAX_SESSION_AGE_MS = 24 * 60 * 60 * 1000)
   * - Expiry is based on last activity timestamp (saved during cancelWizard)
   * - Expired sessions cannot be resumed (user must start fresh wizard)
   *
   * **Why 24 Hours?**
   * - Balances user convenience (resume next day) with data staleness
   * - Prevents resuming with outdated workspace analysis
   * - Reduces risk of corrupted state from workspace changes
   *
   * **Date Deserialization:**
   * VS Code's workspaceState.get() returns Date objects as strings (JSON deserialization).
   * This method handles both Date and string lastActivity values.
   *
   * @param state - Wizard state to validate
   * @returns True if session is valid and can be resumed
   *
   * @example
   * ```typescript
   * if (!sessionManager.isSessionValid(savedState)) {
   *   // Clear expired state
   *   await sessionManager.clearSessionState();
   *   // User must start fresh wizard
   * }
   * ```
   */
  isSessionValid(state: WizardState): boolean {
    // Handle Date deserialization from JSON
    // workspaceState.get() returns lastActivity as string, not Date object
    const lastActivityDate =
      state.lastActivity instanceof Date
        ? state.lastActivity
        : new Date(state.lastActivity);

    // Check session age
    const ageMs = Date.now() - lastActivityDate.getTime();
    if (ageMs > this.MAX_SESSION_AGE_MS) {
      this.logger.warn('[WizardSessionManager] Wizard session expired', {
        sessionId: state.sessionId,
        ageHours: Math.round(ageMs / (60 * 60 * 1000)),
        maxAgeHours: this.MAX_SESSION_AGE_MS / (60 * 60 * 1000),
      });
      return false;
    }

    // Session is valid
    this.logger.debug('[WizardSessionManager] Session is valid', {
      sessionId: state.sessionId,
      ageHours: Math.round(ageMs / (60 * 60 * 1000)),
    });
    return true;
  }

  /**
   * Clear saved session state from workspace storage.
   *
   * Call this method when:
   * - Wizard completes successfully (session no longer needed)
   * - User explicitly chooses not to resume
   * - Session validation fails (expired or corrupted)
   *
   * @example
   * ```typescript
   * // On wizard completion
   * await sessionManager.clearSessionState();
   * ```
   */
  async clearSessionState(): Promise<void> {
    await this.context.workspaceState.update(this.SESSION_STATE_KEY, undefined);

    this.logger.debug('[WizardSessionManager] Cleared session state');
  }

  /**
   * Restore a WizardSession from saved WizardState.
   *
   * Converts the minimal persisted state back to a full session object
   * for use with the wizard flow.
   *
   * @param state - Saved wizard state to restore from
   * @returns Restored wizard session
   *
   * @example
   * ```typescript
   * const savedState = await sessionManager.loadSavedState(workspaceRoot);
   * if (savedState && sessionManager.isSessionValid(savedState)) {
   *   const session = sessionManager.restoreSession(savedState);
   *   // Continue wizard from restored session
   * }
   * ```
   */
  restoreSession(state: WizardState): WizardSession {
    // Handle Date deserialization for lastActivity
    const lastActivityDate =
      state.lastActivity instanceof Date
        ? state.lastActivity
        : new Date(state.lastActivity);

    const session: WizardSession = {
      id: state.sessionId,
      workspaceRoot: state.workspaceRoot,
      currentStep: state.currentStep,
      startedAt: lastActivityDate, // Use last activity as approximate start time
      projectContext: state.projectContext,
      selectedAgentIds: state.selectedAgentIds,
    };

    this.logger.info('[WizardSessionManager] Restored wizard session', {
      sessionId: session.id,
      step: session.currentStep,
      hasProjectContext: !!session.projectContext,
      hasSelectedAgents: !!session.selectedAgentIds,
    });

    return session;
  }

  /**
   * Update session's current step.
   *
   * Utility method to update the step in place and optionally persist.
   *
   * @param session - Session to update
   * @param step - New current step
   * @param persist - Whether to persist the change immediately (default: false)
   * @returns Updated session (same reference)
   *
   * @example
   * ```typescript
   * sessionManager.updateStep(session, 'review');
   * // Or with immediate persistence:
   * await sessionManager.updateStep(session, 'review', true);
   * ```
   */
  async updateStep(
    session: WizardSession,
    step: WizardStep,
    persist: boolean = false
  ): Promise<WizardSession> {
    const previousStep = session.currentStep;
    session.currentStep = step;

    this.logger.debug('[WizardSessionManager] Updated session step', {
      sessionId: session.id,
      previousStep,
      newStep: step,
      willPersist: persist,
    });

    if (persist) {
      await this.saveSessionState(session);
    }

    return session;
  }

  /**
   * Check if there is any saved state for the current workspace.
   *
   * Quick check without loading the full state.
   *
   * @returns True if saved state exists
   */
  hasSavedState(): boolean {
    return (
      this.context.workspaceState.get(this.SESSION_STATE_KEY) !== undefined
    );
  }
}
