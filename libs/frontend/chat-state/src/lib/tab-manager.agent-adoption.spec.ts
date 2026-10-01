/**
 * TabManagerService — agent-started child tab adoption (TASK_2026_584).
 *
 * Real TabManagerService + real TabWorkspacePartitionService, so partition
 * placement, persistence and the active-tab signal are the genuine ones.
 */

import { TestBed } from '@angular/core/testing';
import type { AgentSessionOpenedPayload } from '@ptah-extension/shared';
import { ConfirmationDialogService } from './confirmation-dialog.service';
import {
  MODEL_REFRESH_CONTROL,
  type ModelRefreshControl,
} from './model-refresh-control';
import { TabManagerService } from './tab-manager.service';
import { TabWorkspacePartitionService } from './tab-workspace-partition.service';
import { ConversationRegistry } from './conversation-registry.service';
import { TabSessionBinding } from './tab-session-binding.service';

const WS_A = '/ws/a';
const WS_B = '/ws/b';
const CHILD_TAB = '11111111-1111-4111-8111-111111111111';
const CHILD_SESSION = '22222222-2222-4222-8222-222222222222';

function payload(
  parentTabId: string,
  overrides: Partial<AgentSessionOpenedPayload> = {},
): AgentSessionOpenedPayload {
  return {
    tabId: CHILD_TAB,
    sessionId: null,
    parentTabId,
    parentSessionId: null,
    workspaceRoot: WS_A,
    worktreePath: '/ws/a/.worktrees/child',
    branch: 'feat/child',
    label: 'Child: plan the API',
    taskId: 'TASK_1',
    displayPrompt: 'Plan the API',
    startedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('TabManagerService — agent session adoption (TASK_2026_584)', () => {
  let service: TabManagerService;

  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    const modelRefreshMock = {
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
    jest.useRealTimers();
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('live: inserts the child directly after the parent, streaming, with the task as the first user turn', () => {
    service.switchWorkspace(WS_A);
    const first = service.createTab('first');
    const parent = service.createTab('parent');
    const last = service.createTab('last');

    expect(service.adoptAgentSessionTab(payload(parent), 'live')).toBe(
      'adopted',
    );

    const ids = service.tabs().map((t) => t.id);
    expect(ids).toEqual([first, parent, CHILD_TAB, last]);
    expect(service.tabs().map((t) => t.order)).toEqual([0, 1, 2, 3]);

    const child = service.tabs()[2];
    expect(child.status).toBe('streaming');
    expect(child.hasLiveSession).toBe(true);
    expect(child.claudeSessionId).toBeNull();
    expect(child.title).toBe('Child: plan the API');
    expect(child.name).toBe('Child: plan the API');
    expect(child.titleOrigin).toBe('user');
    expect(child.messages).toHaveLength(1);
    expect(child.messages[0].role).toBe('user');
    expect(child.messages[0].rawContent).toBe('Plan the API');
    expect(child.agentOrigin).toEqual({
      parentTabId: parent,
      parentSessionId: null,
      label: 'Child: plan the API',
      branch: 'feat/child',
      worktreePath: '/ws/a/.worktrees/child',
      taskId: 'TASK_1',
      startedAt: 1_700_000_000_000,
    });
  });

  it('does not change the active tab', () => {
    service.switchWorkspace(WS_A);
    const parent = service.createTab('parent');
    const other = service.createTab('other');
    expect(service.activeTabId()).toBe(other);

    service.adoptAgentSessionTab(payload(parent), 'live');

    expect(service.activeTabId()).toBe(other);
  });

  it('is idempotent: the same child twice is a no-op the second time', () => {
    service.switchWorkspace(WS_A);
    const parent = service.createTab('parent');

    expect(service.adoptAgentSessionTab(payload(parent), 'live')).toBe(
      'adopted',
    );
    const after = service.tabs();

    expect(
      service.adoptAgentSessionTab(
        payload(parent, { label: 'renamed' }),
        'late',
      ),
    ).toBe('exists');
    expect(service.tabs()).toBe(after);
  });

  it('adopts nothing when this panel does not hold the parent tab', () => {
    service.switchWorkspace(WS_A);
    service.createTab('unrelated');
    const before = service.tabs();

    expect(
      service.adoptAgentSessionTab(
        payload('33333333-3333-4333-8333-333333333333'),
        'live',
      ),
    ).toBe('parent-absent');
    expect(service.tabs()).toBe(before);
    expect(service.findTabByIdAcrossWorkspaces(CHILD_TAB)).toBeNull();
  });

  it('rejects a child tab id that is not a tab id', () => {
    service.switchWorkspace(WS_A);
    const parent = service.createTab('parent');

    expect(
      service.adoptAgentSessionTab(payload(parent, { tabId: 'nope' }), 'live'),
    ).toBe('invalid');
    expect(service.tabs()).toHaveLength(1);
  });

  it('late: binds the SDK session, status loaded, no messages, not flagged live', () => {
    service.switchWorkspace(WS_A);
    const parent = service.createTab('parent');

    service.adoptAgentSessionTab(
      payload(parent, { sessionId: CHILD_SESSION }),
      'late',
    );

    const child = service.tabs().find((t) => t.id === CHILD_TAB);
    expect(child?.status).toBe('loaded');
    expect(child?.claudeSessionId).toBe(CHILD_SESSION);
    expect(child?.messages).toEqual([]);
    expect(child?.hasLiveSession).toBeUndefined();
    // Reverse index: the sidebar's session lookup finds the adopted tab.
    expect(service.findTabBySessionId(CHILD_SESSION)?.id).toBe(CHILD_TAB);
  });

  it('late without a resolved session id adopts like live', () => {
    service.switchWorkspace(WS_A);
    const parent = service.createTab('parent');

    service.adoptAgentSessionTab(payload(parent), 'late');

    const child = service.tabs().find((t) => t.id === CHILD_TAB);
    expect(child?.status).toBe('streaming');
    expect(child?.messages).toHaveLength(1);
  });

  it('adopts into the parent background partition, not the active tab set', () => {
    service.switchWorkspace(WS_A);
    const parent = service.createTab('parent');
    const sibling = service.createTab('sibling');
    service.switchWorkspace(WS_B);
    const activeB = service.createTab('b');

    expect(service.adoptAgentSessionTab(payload(parent), 'live')).toBe(
      'adopted',
    );

    expect(service.tabs().map((t) => t.id)).toEqual([activeB]);
    expect(service.activeTabId()).toBe(activeB);
    expect(service.getWorkspaceTabs(WS_A).map((t) => t.id)).toEqual([
      parent,
      CHILD_TAB,
      sibling,
    ]);
    expect(service.findTabByIdAcrossWorkspaces(CHILD_TAB)?.workspacePath).toBe(
      WS_A,
    );

    // Switching back shows the child, still without stealing focus.
    service.switchWorkspace(WS_A);
    expect(service.tabs().map((t) => t.id)).toEqual([
      parent,
      CHILD_TAB,
      sibling,
    ]);
    expect(service.activeTabId()).toBe(sibling);
  });

  it('works with no active workspace (single tab set)', () => {
    const parent = service.createTab('parent');

    expect(service.adoptAgentSessionTab(payload(parent), 'live')).toBe(
      'adopted',
    );
    expect(service.tabs().map((t) => t.id)).toEqual([parent, CHILD_TAB]);
  });

  it('agentOrigin survives save and restore', () => {
    service.switchWorkspace(WS_A);
    const parent = service.createTab('parent');
    service.adoptAgentSessionTab(payload(parent), 'live');
    service.flushPendingSave();

    // A fresh panel reading the same storage.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        TabManagerService,
        TabWorkspacePartitionService,
        ConversationRegistry,
        TabSessionBinding,
        ConfirmationDialogService,
        {
          provide: MODEL_REFRESH_CONTROL,
          useValue: { refreshModels: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    });
    const restored = TestBed.inject(TabManagerService);
    restored.switchWorkspace(WS_A);

    const child = restored.tabs().find((t) => t.id === CHILD_TAB);
    expect(child?.agentOrigin?.parentTabId).toBe(parent);
    expect(child?.agentOrigin?.branch).toBe('feat/child');
    // In-flight status never survives a reload.
    expect(child?.status).toBe('loaded');
  });
});
