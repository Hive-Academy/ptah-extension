import { Injectable, inject } from '@angular/core';
import {
  ConfirmationDialogService,
  TabManagerService,
} from '@ptah-extension/chat-state';
import {
  AppStateManager,
  ClaudeRpcService,
  LoggingService,
} from '@ptah-extension/core';
import type { ChatSessionSummary, SessionId } from '@ptah-extension/shared';
import { ChatStore } from '../chat.store';
import { SessionDisplayUtils } from '../session-display-utils.service';
import { SessionOrganizerService } from './session-organizer.service';

/** Longest session name a rename sends; longer input is cut to this. */
export const SESSION_NAME_MAX_LENGTH = 200;

export type SessionRenameResult = 'renamed' | 'unchanged' | 'failed';
export type SessionDeleteResult = 'deleted' | 'cancelled' | 'failed';

const LOG_CONTEXT = 'SessionRowActions';

/**
 * The three session row verbs (open, rename, delete), shared by the
 * previous-sessions modal rows and the Rail card rename (TASK_2026_679).
 *
 * Each call is independent; the caller guards against a double fire (e.g.
 * Enter followed by blur). A failure is logged and leaves the list, the tab
 * and the name untouched.
 */
@Injectable({ providedIn: 'root' })
export class SessionRowActionsService {
  private readonly chatStore = inject(ChatStore);
  private readonly tabManager = inject(TabManagerService);
  private readonly confirmDialog = inject(ConfirmationDialogService);
  private readonly rpc = inject(ClaudeRpcService);
  private readonly appState = inject(AppStateManager);
  private readonly logger = inject(LoggingService);
  private readonly displayUtils = inject(SessionDisplayUtils);
  private readonly organizer = inject(SessionOrganizerService);

  /**
   * Open a session in the current layout: grid asks the canvas to open or
   * focus its tile, single switches to the session's tab.
   */
  openSession(session: Pick<ChatSessionSummary, 'id' | 'name'>): void {
    if (this.appState.layoutMode() === 'grid') {
      void this.appState.requestCanvasSession(session.id, session.name);
      return;
    }
    this.chatStore.switchSession(session.id).catch((error: unknown) => {
      this.logger.error(LOG_CONTEXT, 'Failed to open session', error);
    });
  }

  /**
   * Rename a session. The name is trimmed and cut to
   * {@link SESSION_NAME_MAX_LENGTH}; an empty or unchanged name sends nothing.
   */
  async rename(
    sessionId: SessionId,
    currentName: string,
    requestedName: string,
  ): Promise<SessionRenameResult> {
    const name = requestedName.trim().slice(0, SESSION_NAME_MAX_LENGTH).trim();
    if (!name || name === (currentName || '')) {
      return 'unchanged';
    }

    try {
      const result = await this.rpc.renameSession(sessionId, name);
      if (result.isSuccess() && result.data.success) {
        this.chatStore.updateSessionName(sessionId, name);
        const tab = this.tabManager.findTabBySessionId(sessionId);
        if (tab) {
          this.tabManager.setNameAndTitle(tab.id, name, name);
        }
        return 'renamed';
      }
      this.logger.error(
        LOG_CONTEXT,
        'Failed to rename session',
        result.error ?? result.data?.error,
      );
      return 'failed';
    } catch (error) {
      this.logger.error(LOG_CONTEXT, 'Failed to rename session', error);
      return 'failed';
    }
  }

  /**
   * Delete a session after the user confirms. The workspace is captured
   * before the confirm, so a workspace switch during it does not move the
   * workflow mapping that is forgotten.
   */
  async deleteSession(
    session: ChatSessionSummary,
  ): Promise<SessionDeleteResult> {
    const sessionName = this.displayUtils.getSessionDisplayName(session);
    const deletedWorkspacePath = this.tabManager.activeWorkspacePath ?? '';
    const confirmed = await this.confirmDialog.confirm({
      title: 'Delete Session',
      message: `Are you sure you want to delete "${sessionName}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      confirmStyle: 'error',
    });
    if (!confirmed) {
      return 'cancelled';
    }

    try {
      const result = await this.rpc.deleteSession(session.id);
      if (!(result.isSuccess() && result.data.success)) {
        this.logger.error(
          LOG_CONTEXT,
          'Failed to delete session',
          result.error ?? result.data?.error,
        );
        return 'failed';
      }
      this.tabManager.forgetWorkflowSession(session.id, deletedWorkspacePath);
      this.chatStore.removeSessionFromList(session.id);
      this.organizer.closeIfShowing(session.id);
      if (this.chatStore.currentSession()?.id === session.id) {
        this.chatStore.clearCurrentSession();
      }
      const tab = this.tabManager.findTabBySessionId(session.id);
      if (tab) {
        this.tabManager.closeTab(tab.id);
      }
      return 'deleted';
    } catch (error) {
      this.logger.error(LOG_CONTEXT, 'Failed to delete session', error);
      return 'failed';
    }
  }
}
