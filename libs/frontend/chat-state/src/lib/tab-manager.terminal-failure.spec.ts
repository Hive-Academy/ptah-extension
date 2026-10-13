import { TestBed } from '@angular/core/testing';
import { SessionId } from '@ptah-extension/shared';
import { ConfirmationDialogService } from './confirmation-dialog.service';
import {
  MODEL_REFRESH_CONTROL,
  type ModelRefreshControl,
} from './model-refresh-control';
import { TabManagerService } from './tab-manager.service';
import { TabWorkspacePartitionService } from './tab-workspace-partition.service';
import { ConversationRegistry } from './conversation-registry.service';
import { TabSessionBinding } from './tab-session-binding.service';

describe('TabManagerService terminal failure sequence', () => {
  let service: TabManagerService;

  beforeEach(() => {
    localStorage.clear();
    const modelRefreshMock: jest.Mocked<ModelRefreshControl> = {
      refreshModels: jest.fn().mockResolvedValue(undefined),
    } as jest.Mocked<ModelRefreshControl>;
    TestBed.configureTestingModule({
      providers: [
        TabManagerService,
        TabWorkspacePartitionService,
        ConversationRegistry,
        TabSessionBinding,
        ConfirmationDialogService,
        { provide: MODEL_REFRESH_CONTROL, useValue: modelRefreshMock },
      ],
    });
    service = TestBed.inject(TabManagerService);
  });

  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('advances equal-text failures across an optimistic send without a turn state', () => {
    const id = service.createTab('active');
    service.setLastTerminalReason(id, 'completed');
    expect(service.findTabByIdAcrossWorkspaces(id)?.tab.terminalFailureSeq).toBe(1);
    service.markTabStreaming(id);
    service.setLastTerminalReason(id, 'completed');
    expect(service.findTabByIdAcrossWorkspaces(id)?.tab.terminalFailureSeq).toBe(2);
  });

  it('keeps one identity when a failed turn state is followed by the same reason', () => {
    const id = service.createTab('active');
    const sessionId = SessionId.create();
    service.attachSession(id, sessionId);
    service.markStreaming(id);
    service.applyTurnState(id, {
      phase: 'failed',
      revision: 1,
      backgroundTasks: [],
      sessionCrons: [],
      terminalReason: 'api_error',
      timestamp: 1,
    }, sessionId);
    expect(service.findTabByIdAcrossWorkspaces(id)?.tab.terminalFailureSeq).toBe(1);
    service.setLastTerminalReason(id, 'api_error');
    expect(service.findTabByIdAcrossWorkspaces(id)?.tab.terminalFailureSeq).toBe(1);
  });

  it('advances a background tab through the partition writer', () => {
    service.switchWorkspace('/ws/a');
    const id = service.createTab('background');
    service.switchWorkspace('/ws/b');
    service.setLastTerminalReason(id, 'completed');
    expect(service.getWorkspaceTabs('/ws/a').find((tab) => tab.id === id)?.terminalFailureSeq).toBe(1);
    service.markTabStreaming(id);
    service.setLastTerminalReason(id, 'completed');
    expect(service.getWorkspaceTabs('/ws/a').find((tab) => tab.id === id)?.terminalFailureSeq).toBe(2);
    expect(service.tabs().some((tab) => tab.id === id)).toBe(false);
  });
});
