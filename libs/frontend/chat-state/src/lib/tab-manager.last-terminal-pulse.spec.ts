import { TestBed } from '@angular/core/testing';
import type { TabState } from '@ptah-extension/chat-types';
import { SessionId, type SessionTurnState } from '@ptah-extension/shared';
import { ConfirmationDialogService } from './confirmation-dialog.service';
import { MODEL_REFRESH_CONTROL } from './model-refresh-control';
import { TabManagerService } from './tab-manager.service';
import { TabWorkspacePartitionService } from './tab-workspace-partition.service';

describe('TabManagerService last terminal pulse', () => {
  it('retains the latest tab pulse after the queue is consumed and replaces it on a later turn', () => {
    TestBed.configureTestingModule({
      providers: [
        TabManagerService,
        {
          provide: ConfirmationDialogService,
          useValue: { confirm: jest.fn() },
        },
        {
          provide: TabWorkspacePartitionService,
          useValue: {
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
          },
        },
        {
          provide: MODEL_REFRESH_CONTROL,
          useValue: { refreshModels: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    });
    const service = TestBed.inject(TabManagerService);
    const tabId = service.createTab('Work');
    const sessionId = SessionId.create();
    service.attachSession(tabId, sessionId);
    const state = (
      phase: SessionTurnState['phase'],
      revision: number,
      terminalReason: SessionTurnState['terminalReason'] = null,
    ): SessionTurnState => ({
      phase,
      revision,
      terminalReason,
      lastAssistantMessage: `Reply ${revision}`,
      backgroundTasks: [],
      sessionCrons: [],
      timestamp: revision,
    });
    service.applyTurnState(tabId, state('generating', 1), sessionId);
    service.applyTurnState(tabId, state('idle', 2, 'completed'), sessionId);
    const first = service.lastTerminalPulseByTab().get(tabId);
    expect(first?.seq).toBe(1);
    expect(service.takeTerminalTurnPulses()).toHaveLength(1);
    expect(service.terminalTurnPulses()).toHaveLength(0);
    expect(service.lastTerminalPulseByTab().get(tabId)).toBe(first);

    service.applyTurnState(tabId, state('generating', 3), sessionId);
    service.applyTurnState(tabId, state('idle', 4, 'completed'), sessionId);
    expect(service.lastTerminalPulseByTab().get(tabId)?.seq).toBeGreaterThan(
      first?.seq ?? 0,
    );
  });
});
