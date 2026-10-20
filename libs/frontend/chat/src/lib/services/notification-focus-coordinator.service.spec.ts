import { TestBed } from '@angular/core/testing';
import { AppStateManager } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
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
  const requestCanvasTab = jest.fn();
  const findByTab = jest.fn();
  const findBySession = jest.fn();
  const switchTab = jest.fn();
  const openSessionTab = jest.fn();
  let coordinator: NotificationFocusCoordinator;

  beforeEach(() => {
    order.length = 0;
    requestCanvasFocus.mockReset().mockImplementation(async () => {
      order.push('canvas');
      return { success: true, outcome: 'focused' };
    });
    requestCanvasTab.mockReset().mockImplementation(async () => {
      order.push('tab');
      return true;
    });
    findByTab
      .mockReset()
      .mockReturnValue({ tab, workspacePath: '/workspace/a' });
    findBySession
      .mockReset()
      .mockReturnValue({ tab, workspacePath: '/workspace/a' });
    switchTab.mockReset();
    openSessionTab.mockReset();
    TestBed.configureTestingModule({
      providers: [
        NotificationFocusCoordinator,
        {
          provide: AppStateManager,
          useValue: {
            setCurrentView: () => order.push('view'),
            requestCanvasFocus,
            requestCanvasTab,
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
            openSessionTab,
          },
        },
      ],
    });
    coordinator = TestBed.inject(NotificationFocusCoordinator);
  });

  it('switches workspace before setting view and acknowledged canvas focus', async () => {
    await expect(coordinator.focus(target)).resolves.toEqual({
      success: true,
      outcome: 'focused',
    });
    expect(order).toEqual(['workspace', 'view', 'canvas']);
  });

  it('opens an unpartitioned owner by tab id without switching away from its active set', async () => {
    findByTab.mockReturnValue({ tab: { id: 'tab-1', claudeSessionId: null }, workspacePath: null });
    findBySession.mockReturnValue(null);
    await expect(coordinator.focus({ ...target, workspacePath: '' })).resolves.toEqual({
      success: true, outcome: 'focused',
    });
    expect(requestCanvasTab).toHaveBeenCalledWith('tab-1', null, undefined, true, { timeoutMs: 5000 });
    expect(requestCanvasFocus).not.toHaveBeenCalled();
    expect(order).toEqual(['view', 'tab']);
  });

  it('reports an unpartitioned canvas tab refusal as missing', async () => {
    findByTab.mockReturnValue({ tab, workspacePath: null });
    requestCanvasTab.mockResolvedValue(false);
    await expect(coordinator.focus({ ...target, workspacePath: '' })).resolves.toEqual({
      success: false, outcome: 'missing',
    });
    expect(requestCanvasTab).toHaveBeenCalledWith('tab-1', null, undefined, true, { timeoutMs: 5000 });
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
    expect(order).toEqual(['workspace', 'view', 'canvas']);
  });

  it('returns cap-reached and switches no tab when the canvas cap is reached', async () => {
    requestCanvasFocus.mockResolvedValue({
      success: false,
      outcome: 'cap-reached',
    });
    await expect(coordinator.focus(target)).resolves.toEqual({
      success: false,
      outcome: 'cap-reached',
    });
    expect(order).toEqual(['workspace', 'view']);
    expect(switchTab).not.toHaveBeenCalled();
    expect(openSessionTab).not.toHaveBeenCalled();
  });

  it('serializes rapid competing activations', async () => {
    const first = coordinator.focus(target);
    const second = coordinator.focus({ ...target, tabId: 'tab-2' });
    await Promise.all([first, second]);
    expect(order).toEqual([
      'workspace',
      'view',
      'canvas',
      'workspace',
      'view',
      'canvas',
    ]);
  });
});
