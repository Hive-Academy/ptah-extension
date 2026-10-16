/**
 * SessionRowActionsService (TASK_2026_679, Batch 3 Task 3.2).
 *
 * The open, rename and delete verbs moved out of the app shell. The two
 * delete tests are migrated from `app-shell.organization.spec.ts` with their
 * titles kept; the shell copies stay until the shell switch-over.
 */
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ConfirmationDialogService,
  TabManagerService,
} from '@ptah-extension/chat-state';
import {
  AppStateManager,
  ClaudeRpcService,
  LoggingService,
  RpcResult,
} from '@ptah-extension/core';
import { SessionId, type ChatSessionSummary } from '@ptah-extension/shared';
import { ChatStore } from '../chat.store';
import { SessionDisplayUtils } from '../session-display-utils.service';
import { SessionOrganizerService } from './session-organizer.service';
import {
  SESSION_NAME_MAX_LENGTH,
  SessionRowActionsService,
} from './session-row-actions.service';

type MutationResult = RpcResult<{ success: boolean; error?: string }>;

function mutation(success: boolean, error?: string): MutationResult {
  return new RpcResult(true, { success, error });
}

function session(id: SessionId, name: string): ChatSessionSummary {
  return {
    id,
    name,
    createdAt: 1,
    lastActivityAt: 2,
    messageCount: 3,
    isActive: false,
  };
}

describe('SessionRowActionsService', () => {
  const TAGGED = SessionId.create();

  let layoutMode: WritableSignal<'single' | 'grid'>;
  let currentSession: WritableSignal<ChatSessionSummary | null>;
  let chatStore: {
    currentSession: WritableSignal<ChatSessionSummary | null>;
    switchSession: jest.Mock;
    updateSessionName: jest.Mock;
    removeSessionFromList: jest.Mock;
    clearCurrentSession: jest.Mock;
  };
  let tabManager: {
    activeWorkspacePath: string | null;
    findTabBySessionId: jest.Mock;
    setNameAndTitle: jest.Mock;
    forgetWorkflowSession: jest.Mock;
    closeTab: jest.Mock;
  };
  let appState: {
    layoutMode: WritableSignal<'single' | 'grid'>;
    requestCanvasSession: jest.Mock;
  };
  let confirmDelete: jest.Mock;
  let renameSession: jest.Mock;
  let deleteSession: jest.Mock;
  let logger: { error: jest.Mock; warn: jest.Mock };
  let organizer: { closeIfShowing: jest.Mock };
  let service: SessionRowActionsService;

  beforeEach(() => {
    layoutMode = signal<'single' | 'grid'>('single');
    currentSession = signal<ChatSessionSummary | null>(null);
    chatStore = {
      currentSession,
      switchSession: jest.fn().mockResolvedValue(undefined),
      updateSessionName: jest.fn(),
      removeSessionFromList: jest.fn(),
      clearCurrentSession: jest.fn(),
    };
    tabManager = {
      activeWorkspacePath: '/work',
      findTabBySessionId: jest.fn(() => null),
      setNameAndTitle: jest.fn(),
      forgetWorkflowSession: jest.fn(),
      closeTab: jest.fn(),
    };
    appState = {
      layoutMode,
      requestCanvasSession: jest.fn().mockResolvedValue(true),
    };
    confirmDelete = jest.fn();
    renameSession = jest.fn();
    deleteSession = jest.fn();
    logger = { error: jest.fn(), warn: jest.fn() };
    organizer = { closeIfShowing: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        { provide: ChatStore, useValue: chatStore },
        { provide: TabManagerService, useValue: tabManager },
        { provide: AppStateManager, useValue: appState },
        {
          provide: ConfirmationDialogService,
          useValue: { confirm: confirmDelete },
        },
        {
          provide: ClaudeRpcService,
          useValue: { renameSession, deleteSession },
        },
        { provide: LoggingService, useValue: logger },
        {
          provide: SessionDisplayUtils,
          useValue: {
            getSessionDisplayName: (s: ChatSessionSummary) => s.name,
          },
        },
        { provide: SessionOrganizerService, useValue: organizer },
      ],
    });
    service = TestBed.inject(SessionRowActionsService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('openSession', () => {
    it('switches to the session tab in single layout and resolves opened', async () => {
      await expect(
        service.openSession({ id: TAGGED, name: 'Tagged' }),
      ).resolves.toBe('opened');

      expect(chatStore.switchSession).toHaveBeenCalledWith(TAGGED);
      expect(appState.requestCanvasSession).not.toHaveBeenCalled();
    });

    it('resolves opened in single layout without awaiting the history load', async () => {
      chatStore.switchSession.mockReturnValueOnce(new Promise(() => undefined));

      await expect(
        service.openSession({ id: TAGGED, name: 'Tagged' }),
      ).resolves.toBe('opened');
    });

    it('asks the canvas for a tile in grid layout and resolves opened', async () => {
      layoutMode.set('grid');

      await expect(
        service.openSession({ id: TAGGED, name: 'Tagged' }),
      ).resolves.toBe('opened');

      expect(appState.requestCanvasSession).toHaveBeenCalledWith(
        TAGGED,
        'Tagged',
      );
      expect(chatStore.switchSession).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('resolves failed and warns when the canvas drops the grid request', async () => {
      layoutMode.set('grid');
      appState.requestCanvasSession.mockResolvedValueOnce(false);

      await expect(
        service.openSession({ id: TAGGED, name: 'Tagged' }),
      ).resolves.toBe('failed');

      expect(logger.warn).toHaveBeenCalledWith(
        'SessionRowActions',
        'Canvas did not open the session',
        { sessionId: TAGGED },
      );
      expect(chatStore.switchSession).not.toHaveBeenCalled();
    });

    it('logs a failed switch', async () => {
      const error = new Error('load failed');
      chatStore.switchSession.mockRejectedValueOnce(error);

      await service.openSession({ id: TAGGED, name: 'Tagged' });
      await Promise.resolve();

      expect(logger.error).toHaveBeenCalledWith(
        'SessionRowActions',
        'Failed to open session',
        error,
      );
    });
  });

  describe('rename', () => {
    it('renames through the RPC and updates the store and the tab', async () => {
      tabManager.findTabBySessionId.mockReturnValue({ id: 'tab-1' });
      renameSession.mockResolvedValueOnce(mutation(true));

      await expect(service.rename(TAGGED, 'Old', '  New name  ')).resolves.toBe(
        'renamed',
      );

      expect(renameSession).toHaveBeenCalledWith(TAGGED, 'New name');
      expect(chatStore.updateSessionName).toHaveBeenCalledWith(
        TAGGED,
        'New name',
      );
      expect(tabManager.findTabBySessionId).toHaveBeenCalledWith(TAGGED);
      expect(tabManager.setNameAndTitle).toHaveBeenCalledWith(
        'tab-1',
        'New name',
        'New name',
      );
    });

    it('renames without a tab when the session has none open', async () => {
      renameSession.mockResolvedValueOnce(mutation(true));

      await expect(service.rename(TAGGED, 'Old', 'New')).resolves.toBe(
        'renamed',
      );
      expect(chatStore.updateSessionName).toHaveBeenCalledWith(TAGGED, 'New');
      expect(tabManager.setNameAndTitle).not.toHaveBeenCalled();
    });

    it.each([
      ['empty', 'Old', ''],
      ['blank', 'Old', '   '],
      ['unchanged', 'Old', 'Old'],
      ['unchanged after trimming', 'Old', '  Old  '],
    ])('sends nothing for an %s name', async (_label, current, requested) => {
      await expect(service.rename(TAGGED, current, requested)).resolves.toBe(
        'unchanged',
      );
      expect(renameSession).not.toHaveBeenCalled();
      expect(chatStore.updateSessionName).not.toHaveBeenCalled();
    });

    it(`cuts a name longer than ${SESSION_NAME_MAX_LENGTH} characters`, async () => {
      expect(SESSION_NAME_MAX_LENGTH).toBe(200);
      renameSession.mockResolvedValueOnce(mutation(true));
      const long = 'x'.repeat(SESSION_NAME_MAX_LENGTH + 50);

      await expect(service.rename(TAGGED, 'Old', long)).resolves.toBe(
        'renamed',
      );

      const sent = 'x'.repeat(SESSION_NAME_MAX_LENGTH);
      expect(renameSession).toHaveBeenCalledWith(TAGGED, sent);
      expect(chatStore.updateSessionName).toHaveBeenCalledWith(TAGGED, sent);
    });

    it('treats a cut name equal to the current one as unchanged', async () => {
      const current = 'y'.repeat(SESSION_NAME_MAX_LENGTH);

      await expect(
        service.rename(TAGGED, current, `${current}tail`),
      ).resolves.toBe('unchanged');
      expect(renameSession).not.toHaveBeenCalled();
    });

    it('logs a rejected rename and changes nothing', async () => {
      tabManager.findTabBySessionId.mockReturnValue({ id: 'tab-1' });
      renameSession.mockResolvedValueOnce(mutation(false, 'locked'));

      await expect(service.rename(TAGGED, 'Old', 'New')).resolves.toBe(
        'failed',
      );

      expect(logger.error).toHaveBeenCalledWith(
        'SessionRowActions',
        'Failed to rename session',
        'locked',
      );
      expect(chatStore.updateSessionName).not.toHaveBeenCalled();
      expect(tabManager.setNameAndTitle).not.toHaveBeenCalled();
    });

    it('logs a transport failure and changes nothing', async () => {
      const error = new Error('transport down');
      renameSession.mockRejectedValueOnce(error);

      await expect(service.rename(TAGGED, 'Old', 'New')).resolves.toBe(
        'failed',
      );

      expect(logger.error).toHaveBeenCalledWith(
        'SessionRowActions',
        'Failed to rename session',
        error,
      );
      expect(chatStore.updateSessionName).not.toHaveBeenCalled();
    });
  });

  describe('deleteSession', () => {
    // Migrated from app-shell.organization.spec.ts (title kept).
    it('forgets workflow mapping only after a successful sidebar delete', async () => {
      const target = session(TAGGED, 'Tagged');
      confirmDelete.mockResolvedValue(true);
      deleteSession.mockResolvedValueOnce(mutation(true));
      await expect(service.deleteSession(target)).resolves.toBe('deleted');
      expect(deleteSession).toHaveBeenCalledWith(TAGGED);
      expect(tabManager.forgetWorkflowSession).toHaveBeenCalledWith(
        TAGGED,
        '/work',
      );
      expect(chatStore.removeSessionFromList).toHaveBeenCalledWith(TAGGED);

      tabManager.forgetWorkflowSession.mockClear();
      deleteSession.mockResolvedValueOnce(mutation(false, 'failed'));
      await expect(service.deleteSession(target)).resolves.toBe('failed');
      expect(tabManager.forgetWorkflowSession).not.toHaveBeenCalled();
    });

    // Migrated from app-shell.organization.spec.ts (title kept).
    it('keeps the deleted row workspace when it changes during confirmation', async () => {
      const target = session(TAGGED, 'Tagged');
      let confirm: (accepted: boolean) => void = () => undefined;
      confirmDelete.mockReturnValueOnce(
        new Promise<boolean>((resolve) => {
          confirm = resolve;
        }),
      );
      deleteSession.mockResolvedValueOnce(mutation(true));

      const pending = service.deleteSession(target);
      tabManager.activeWorkspacePath = '/other';
      confirm(true);
      await pending;
      expect(tabManager.forgetWorkflowSession).toHaveBeenCalledWith(
        TAGGED,
        '/work',
      );
    });

    it('asks with the same confirmation as the sidebar', async () => {
      confirmDelete.mockResolvedValue(false);

      await service.deleteSession(session(TAGGED, 'Tagged'));

      expect(confirmDelete).toHaveBeenCalledWith({
        title: 'Delete Session',
        message:
          'Are you sure you want to delete "Tagged"? This action cannot be undone.',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        confirmStyle: 'error',
      });
    });

    it('sends nothing when the user cancels', async () => {
      confirmDelete.mockResolvedValue(false);

      await expect(
        service.deleteSession(session(TAGGED, 'Tagged')),
      ).resolves.toBe('cancelled');

      expect(deleteSession).not.toHaveBeenCalled();
      expect(chatStore.removeSessionFromList).not.toHaveBeenCalled();
      expect(organizer.closeIfShowing).not.toHaveBeenCalled();
    });

    it('closes the organization editor when it shows the deleted session', async () => {
      confirmDelete.mockResolvedValue(true);
      deleteSession.mockResolvedValueOnce(mutation(true));

      await service.deleteSession(session(TAGGED, 'Tagged'));

      expect(organizer.closeIfShowing).toHaveBeenCalledWith(TAGGED);
    });

    it('clears the current session and closes its tab', async () => {
      const target = session(TAGGED, 'Tagged');
      currentSession.set(target);
      tabManager.findTabBySessionId.mockReturnValue({ id: 'tab-1' });
      confirmDelete.mockResolvedValue(true);
      deleteSession.mockResolvedValueOnce(mutation(true));

      await expect(service.deleteSession(target)).resolves.toBe('deleted');

      expect(chatStore.clearCurrentSession).toHaveBeenCalledTimes(1);
      expect(tabManager.closeTab).toHaveBeenCalledWith('tab-1');
    });

    it('keeps the current session when another one is deleted', async () => {
      currentSession.set(session(SessionId.create(), 'Other'));
      confirmDelete.mockResolvedValue(true);
      deleteSession.mockResolvedValueOnce(mutation(true));

      await service.deleteSession(session(TAGGED, 'Tagged'));

      expect(chatStore.clearCurrentSession).not.toHaveBeenCalled();
      expect(tabManager.closeTab).not.toHaveBeenCalled();
    });

    it('logs a failed delete and leaves the list, tab and editor untouched', async () => {
      const error = new Error('transport down');
      tabManager.findTabBySessionId.mockReturnValue({ id: 'tab-1' });
      confirmDelete.mockResolvedValue(true);
      deleteSession.mockRejectedValueOnce(error);

      await expect(
        service.deleteSession(session(TAGGED, 'Tagged')),
      ).resolves.toBe('failed');

      expect(logger.error).toHaveBeenCalledWith(
        'SessionRowActions',
        'Failed to delete session',
        error,
      );
      expect(chatStore.removeSessionFromList).not.toHaveBeenCalled();
      expect(organizer.closeIfShowing).not.toHaveBeenCalled();
      expect(tabManager.closeTab).not.toHaveBeenCalled();
    });

    it('logs a rejected delete', async () => {
      confirmDelete.mockResolvedValue(true);
      deleteSession.mockResolvedValueOnce(mutation(false, 'locked'));

      await service.deleteSession(session(TAGGED, 'Tagged'));

      expect(logger.error).toHaveBeenCalledWith(
        'SessionRowActions',
        'Failed to delete session',
        'locked',
      );
    });
  });
});
