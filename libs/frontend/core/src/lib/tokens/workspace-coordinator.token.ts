import { InjectionToken } from '@angular/core';
import { SessionId } from '@ptah-extension/shared';

/**
 * Options for confirmation dialog.
 * Extracted here so both the token contract and implementations reference the same type.
 */
export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmStyle?: 'primary' | 'error' | 'warning';
}

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
  /** Coordinate tab and editor state after a workspace switch. */
  switchWorkspace(newPath: string): void;

  /** Clean up tab and editor state for a removed workspace. */
  removeWorkspaceState(workspacePath: string): void;

  /** Get session IDs of actively streaming tabs in a workspace. */
  getStreamingSessionIds(workspacePath: string): SessionId[];

  /** Show a confirmation dialog. Returns true if confirmed. */
  confirm(options: ConfirmDialogOptions): Promise<boolean>;
}

export const WORKSPACE_COORDINATOR = new InjectionToken<IWorkspaceCoordinator>(
  'WORKSPACE_COORDINATOR'
);
