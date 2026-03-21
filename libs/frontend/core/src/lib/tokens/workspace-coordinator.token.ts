import { InjectionToken } from '@angular/core';

/**
 * Contract for workspace coordination across feature libraries.
 *
 * Implemented by WorkspaceCoordinatorService in the chat library, which
 * orchestrates TabManagerService, EditorService, and ConfirmationDialogService
 * during workspace switch/remove operations.
 *
 * This token breaks the circular dependency between core and chat/editor:
 *   core (defines interface) ← chat (provides implementation)
 *   instead of: core → chat (circular)
 */
export interface IWorkspaceCoordinator {
  /**
   * Coordinate all frontend services after a workspace switch.
   * Updates tab state, editor state, etc. for the new workspace.
   */
  switchWorkspace(newPath: string): void;

  /**
   * Clean up frontend state for a removed workspace.
   * Removes tab partitions, editor state, etc.
   */
  removeWorkspaceState(workspacePath: string): void;

  /**
   * Get session IDs of actively streaming tabs in a workspace.
   * Used to warn before closing a workspace with active streams.
   */
  getStreamingSessionIds(workspacePath: string): string[];

  /**
   * Show a confirmation dialog and wait for user response.
   * Returns true if confirmed, false if cancelled.
   */
  confirm(options: {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    confirmStyle?: 'primary' | 'error' | 'warning';
  }): Promise<boolean>;
}

export const WORKSPACE_COORDINATOR = new InjectionToken<IWorkspaceCoordinator>(
  'WORKSPACE_COORDINATOR'
);
