import { TestBed } from '@angular/core/testing';
import type { TabState } from '@ptah-extension/chat-types';
import { SessionId, type SessionTurnState } from '@ptah-extension/shared';
import { ConfirmationDialogService } from './confirmation-dialog.service';
import { MODEL_REFRESH_CONTROL } from './model-refresh-control';
import { TabManagerService } from './tab-manager.service';
import { TabWorkspacePartitionService } from './tab-workspace-partition.service';

describe('TabManagerService terminal notification pulse', () => {
  let service: TabManagerService;
  const sessionId = SessionId.create();
  const turnState = (
    phase: SessionTurnState['phase'],
    revision: number,
    terminalReason: SessionTurnState['terminalReason'] = null,
  ): SessionTurnState => ({
    phase,
    revision,
    terminalReason,
    backgroundTasks: [],
    sessionCrons: [],
    timestamp: revision,
  });

  beforeEach(() => {
    const partition = {
      initialize: jest.fn(),
      activeWorkspacePath: '/active',
      registerSessionForWorkspace: jest.fn(),
      unregisterSession: jest.fn(),
      findTabBySessionIdAcrossWorkspaces: jest.fn(),
      findTabByIdAcrossWorkspaces: jest.fn(
        (tabId: string, tabs: readonly TabState[]) => {
          const tab = tabs.find((candidate) => candidate.id === tabId);
          return tab ? { tab, workspacePath: '/background' } : null;
        },
      ),
      getStorageKeyForWorkspace: jest.fn().mockReturnValue('ptah.tabs'),
      syncActiveWorkspaceState: jest.fn(),
      switchWorkspace: jest.fn().mockReturnValue(null),
      removeWorkspaceState: jest.fn().mockReturnValue(false),
      getWorkspaceTabs: jest.fn().mockReturnValue([]),
      setBackendEncodedPath: jest.fn(),
      updateBackgroundTab: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        TabManagerService,
        {
          provide: ConfirmationDialogService,
          useValue: { confirm: jest.fn() },
        },
        { provide: TabWorkspacePartitionService, useValue: partition },
        {
          provide: MODEL_REFRESH_CONTROL,
          useValue: { refreshModels: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    });
    service = TestBed.inject(TabManagerService);
  });

  it('emits once for a newer background busy-to-completed edge', () => {
    const tabId = service.createTab('Background task');
    service.attachSession(tabId, sessionId);
    service.applyTurnState(tabId, turnState('generating', 1), sessionId);
    service.applyTurnState(tabId, turnState('idle', 2, 'completed'), sessionId);
    expect(service.terminalTurnPulse()).toMatchObject({
      seq: 1,
      tabId,
      sessionId,
      workspacePath: '/background',
      revision: 2,
      classification: 'success',
    });
    service.applyTurnState(tabId, turnState('idle', 2, 'completed'), sessionId);
    expect(service.terminalTurnPulse()?.seq).toBe(1);
  });

  it.each([
    ['failed', 'completed'],
    ['idle', 'aborted_streaming'],
    ['idle', 'max_turns'],
    ['idle', null],
  ] as const)('classifies %s/%s as error', (phase, reason) => {
    const tabId = service.createTab(String(reason));
    service.attachSession(tabId, sessionId);
    service.applyTurnState(tabId, turnState('generating', 1), sessionId);
    service.applyTurnState(tabId, turnState(phase, 2, reason), sessionId);
    expect(service.terminalTurnPulse()?.classification).toBe('error');
  });

  it('does not complete on background wait or sleep alone', () => {
    const tabId = service.createTab('waiting');
    service.attachSession(tabId, sessionId);
    service.applyTurnState(tabId, turnState('generating', 1), sessionId);
    service.applyTurnState(
      tabId,
      turnState('awaiting-background', 2),
      sessionId,
    );
    service.applyTurnState(tabId, turnState('sleeping', 3), sessionId);
    expect(service.terminalTurnPulse()).toBeNull();
  });

  it('repairs a terminal heal without manufacturing a replay notification', () => {
    const tabId = service.createTab('heal');
    service.attachSession(tabId, sessionId);
    service.applyTurnState(tabId, turnState('generating', 5), sessionId);
    service.applyTurnState(tabId, turnState('idle', 5, 'completed'), sessionId);

    expect(service.tabs().find((tab) => tab.id === tabId)?.status).toBe(
      'loaded',
    );
    expect(service.terminalTurnPulse()).toBeNull();
  });

  it.each(['awaiting-background', 'sleeping'] as const)(
    'emits when %s reaches a newer terminal revision',
    (busyPhase) => {
      const tabId = service.createTab(busyPhase);
      service.attachSession(tabId, sessionId);
      service.applyTurnState(tabId, turnState(busyPhase, 1), sessionId);
      service.applyTurnState(
        tabId,
        turnState('idle', 2, 'completed'),
        sessionId,
      );
      expect(service.terminalTurnPulse()?.classification).toBe('success');
    },
  );
});
