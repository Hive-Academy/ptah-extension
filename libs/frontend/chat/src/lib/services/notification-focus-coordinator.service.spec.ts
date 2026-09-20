import { TestBed } from '@angular/core/testing';
import { AppStateManager } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ChatStore } from './chat.store';
import { WorkspaceCoordinatorService } from './workspace-coordinator.service';
import { NotificationFocusCoordinator } from './notification-focus-coordinator.service';

describe('NotificationFocusCoordinator', () => {
  const target = {
    workspacePath: '/workspace/a',
    tabId: 'tab-1',
    sessionId: 'session-1',
  };
  const closedSessionTarget = {
    workspacePath: '/workspace/a',
    tabId: 'closed-tab',
    sessionId: '00000000-0000-4000-8000-000000000001',
  };
  const tab = { id: 'tab-1', claudeSessionId: 'session-1' };
  const order: string[] = [];
  const requestCanvasFocus = jest.fn();
  const findByTab = jest.fn();
  const findBySession = jest.fn();
  const switchTab = jest.fn();
  let coordinator: NotificationFocusCoordinator;

  beforeEach(() => {
    order.length = 0;
    requestCanvasFocus.mockReset().mockImplementation(async () => {
      order.push('canvas');
      return { success: true, outcome: 'focused' };
    });
    findByTab
      .mockReset()
      .mockReturnValue({ tab, workspacePath: '/workspace/a' });
    findBySession
      .mockReset()
      .mockReturnValue({ tab, workspacePath: '/workspace/a' });
    switchTab.mockReset();
    TestBed.configureTestingModule({
      providers: [
        NotificationFocusCoordinator,
        {
          provide: AppStateManager,
          useValue: {
            setCurrentView: () => order.push('view'),
            setLayoutMode: (mode: string) => order.push(`layout:${mode}`),
            requestCanvasFocus,
          },
        },
        {
          provide: WorkspaceCoordinatorService,
          useValue: { switchWorkspace: async () => order.push('workspace') },
        },
        {
          provide: TabManagerService,
          useValue: {
            findTabByIdAcrossWorkspaces: findByTab,
            findTabBySessionIdAcrossWorkspaces: findBySession,
            switchTab,
            openSessionTab: jest.fn(),
          },
        },
        { provide: ChatStore, useValue: { switchSession: jest.fn() } },
      ],
    });
    coordinator = TestBed.inject(NotificationFocusCoordinator);
  });

  it('switches workspace before setting view, grid, and acknowledged canvas focus', async () => {
    await expect(coordinator.focus(target)).resolves.toEqual({
      success: true,
      outcome: 'focused',
    });
    expect(order).toEqual(['workspace', 'view', 'layout:grid', 'canvas']);
  });

  it('returns missing before navigation when the target no longer resolves', async () => {
    findByTab.mockReturnValue(null);
    findBySession.mockReturnValue(null);
    await expect(coordinator.focus(target)).resolves.toEqual({
      success: false,
      outcome: 'missing',
    });
    expect(order).toEqual([]);
  });

  it('lets a valid closed session continue so the canvas can reopen it', async () => {
    findByTab.mockReturnValue(null);
    findBySession.mockReturnValue(null);

    await expect(coordinator.focus(closedSessionTarget)).resolves.toEqual({
      success: true,
      outcome: 'focused',
    });
    expect(requestCanvasFocus).toHaveBeenCalledWith({
      ...closedSessionTarget,
      tabId: undefined,
    });
    expect(order).toEqual(['workspace', 'view', 'layout:grid', 'canvas']);
  });

  it('falls back to the full single view when the canvas cap is reached', async () => {
    requestCanvasFocus.mockResolvedValue({
      success: false,
      outcome: 'cap-reached',
    });
    await expect(coordinator.focus(target)).resolves.toEqual({
      success: true,
      outcome: 'cap-reached',
    });
    expect(order).toContain('layout:single');
    expect(switchTab).toHaveBeenCalledWith('tab-1');
  });

  it('serializes rapid competing activations', async () => {
    const first = coordinator.focus(target);
    const second = coordinator.focus({ ...target, tabId: 'tab-2' });
    await Promise.all([first, second]);
    expect(order).toEqual([
      'workspace',
      'view',
      'layout:grid',
      'canvas',
      'workspace',
      'view',
      'layout:grid',
      'canvas',
    ]);
  });
});
