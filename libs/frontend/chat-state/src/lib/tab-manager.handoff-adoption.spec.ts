/**
 * TabManagerService — handoff tab adoption (TASK_2026_655).
 *
 * Real TabManagerService + real TabWorkspacePartitionService, so partition
 * placement, persistence and the active-tab signal are the genuine ones.
 */

import { TestBed } from '@angular/core/testing';
import type { SessionHandoffOpenedPayload } from '@ptah-extension/shared';
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
const NEW_TAB = '11111111-1111-4111-8111-111111111111';
const SOURCE_SESSION = '44444444-4444-4444-8444-444444444444';

function payload(
  fromTabId: string,
  overrides: Partial<SessionHandoffOpenedPayload> = {},
): SessionHandoffOpenedPayload {
  return {
    tabId: NEW_TAB,
    fromTabId,
    fromSessionId: null,
    workspaceRoot: WS_A,
    cwd: '/ws/a/packages/api',
    label: 'Continue: API migration',
    displayPrompt: 'Read /ws/a/HANDOFF.md first, then continue.',
    startedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('TabManagerService — handoff tab adoption (TASK_2026_655)', () => {
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

  it('inserts an ordinary streaming tab directly after the source, with the prompt as the first user turn', () => {
    service.switchWorkspace(WS_A);
    const first = service.createTab('first');
    const source = service.createTab('source');
    const last = service.createTab('last');

    expect(service.adoptHandoffTab(payload(source))).toBe('adopted');

    expect(service.tabs().map((t) => t.id)).toEqual([
      first,
      source,
      NEW_TAB,
      last,
    ]);
    expect(service.tabs().map((t) => t.order)).toEqual([0, 1, 2, 3]);

    const tab = service.tabs()[2];
    expect(tab.status).toBe('streaming');
    expect(tab.hasLiveSession).toBe(true);
    expect(tab.claudeSessionId).toBeNull();
    expect(tab.name).toBe('Continue: API migration');
    expect(tab.title).toBe('Continue: API migration');
    expect(tab.titleOrigin).toBe('user');
    expect(tab.messages).toHaveLength(1);
    expect(tab.messages[0].role).toBe('user');
    expect(tab.messages[0].rawContent).toBe(
      'Read /ws/a/HANDOFF.md first, then continue.',
    );
    // A top-level session, not a child: no child banner, no parent link.
    expect(tab.agentOrigin).toBeUndefined();
  });

  it('focuses the new tab when the source is the active tab', () => {
    service.switchWorkspace(WS_A);
    const source = service.createTab('source');
    expect(service.activeTabId()).toBe(source);

    service.adoptHandoffTab(payload(source));

    expect(service.activeTabId()).toBe(NEW_TAB);
  });

  it('does not steal focus when the source is not the active tab', () => {
    service.switchWorkspace(WS_A);
    const source = service.createTab('source');
    const other = service.createTab('other');
    expect(service.activeTabId()).toBe(other);

    service.adoptHandoffTab(payload(source));

    expect(service.activeTabId()).toBe(other);
  });

  it('is idempotent: the same handoff twice is a no-op the second time', () => {
    service.switchWorkspace(WS_A);
    const source = service.createTab('source');
    expect(service.adoptHandoffTab(payload(source))).toBe('adopted');
    const after = service.tabs();

    expect(service.adoptHandoffTab(payload(source, { label: 'renamed' }))).toBe(
      'exists',
    );
    expect(service.tabs()).toBe(after);
  });

  it('adopts nothing when this panel does not hold the source tab', () => {
    service.switchWorkspace(WS_A);
    const unrelated = service.createTab('unrelated');
    const before = service.tabs();

    expect(
      service.adoptHandoffTab(payload('33333333-3333-4333-8333-333333333333')),
    ).toBe('source-absent');
    expect(service.tabs()).toBe(before);
    expect(service.activeTabId()).toBe(unrelated);
    expect(service.findTabByIdAcrossWorkspaces(NEW_TAB)).toBeNull();
  });

  it('finds a resumed source by its session id', () => {
    service.switchWorkspace(WS_A);
    const source = service.createTab('source');
    const last = service.createTab('last');
    service.attachSession(source, SOURCE_SESSION);

    expect(
      service.adoptHandoffTab(
        payload('55555555-5555-4555-8555-555555555555', {
          fromSessionId: SOURCE_SESSION,
        }),
      ),
    ).toBe('adopted');
    expect(service.tabs().map((t) => t.id)).toEqual([source, NEW_TAB, last]);
  });

  it('rejects a new tab id that is not a tab id', () => {
    service.switchWorkspace(WS_A);
    const source = service.createTab('source');

    expect(service.adoptHandoffTab(payload(source, { tabId: 'nope' }))).toBe(
      'invalid',
    );
    expect(service.tabs().map((t) => t.id)).toEqual([source]);
  });

  it('adopts into the source background partition without changing focus', () => {
    service.switchWorkspace(WS_A);
    const source = service.createTab('source');
    const sibling = service.createTab('sibling');
    service.switchWorkspace(WS_B);
    const activeB = service.createTab('b');

    expect(service.adoptHandoffTab(payload(source))).toBe('adopted');

    expect(service.tabs().map((t) => t.id)).toEqual([activeB]);
    expect(service.activeTabId()).toBe(activeB);
    expect(service.getWorkspaceTabs(WS_A).map((t) => t.id)).toEqual([
      source,
      NEW_TAB,
      sibling,
    ]);
  });

  it('works with no active workspace (single tab set)', () => {
    const source = service.createTab('source');

    expect(service.adoptHandoffTab(payload(source))).toBe('adopted');
    expect(service.tabs().map((t) => t.id)).toEqual([source, NEW_TAB]);
    expect(service.activeTabId()).toBe(NEW_TAB);
  });

  it('persists the new tab and the focus change', () => {
    service.switchWorkspace(WS_A);
    const source = service.createTab('source');
    service.adoptHandoffTab(payload(source));
    service.flushPendingSave();

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

    expect(restored.tabs().map((t) => t.id)).toEqual([source, NEW_TAB]);
    expect(restored.activeTabId()).toBe(NEW_TAB);
  });

  describe('announce, then a failed start (markSessionStartFailed)', () => {
    const REASON = 'Handoff session could not start: the SDK is not ready.';

    it('turns the adopted tab idle and not live, with the reason in the transcript', () => {
      service.switchWorkspace(WS_A);
      const source = service.createTab('source');
      service.adoptHandoffTab(payload(source));
      expect(service.activeTabId()).toBe(NEW_TAB);

      expect(service.markSessionStartFailed(NEW_TAB, REASON)).toBe(true);

      const tab = service.tabs().find((t) => t.id === NEW_TAB);
      expect(tab?.status).toBe('loaded');
      expect(tab?.hasLiveSession).toBe(false);
      expect(tab?.claudeSessionId).toBeNull();
      expect(service.isTabStreaming(NEW_TAB)).toBe(false);
      expect(tab?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
      expect(tab?.messages[1].rawContent).toBe(REASON);
      // The tab stays where it was, so the user sees why it is not running.
      expect(service.activeTabId()).toBe(NEW_TAB);
    });

    it('settles a tab adopted into a background partition', () => {
      service.switchWorkspace(WS_A);
      const source = service.createTab('source');
      service.switchWorkspace(WS_B);
      service.createTab('b');
      service.adoptHandoffTab(payload(source));

      expect(service.markSessionStartFailed(NEW_TAB, REASON)).toBe(true);

      const tab = service.getWorkspaceTabs(WS_A).find((t) => t.id === NEW_TAB);
      expect(tab?.status).toBe('loaded');
      expect(tab?.hasLiveSession).toBe(false);
      expect(tab?.messages.at(-1)?.rawContent).toBe(REASON);
    });

    it('leaves a tab whose session started alone', () => {
      service.switchWorkspace(WS_A);
      const source = service.createTab('source');
      service.adoptHandoffTab(payload(source));
      service.attachSession(NEW_TAB, SOURCE_SESSION);
      const before = service.tabs();

      expect(service.markSessionStartFailed(NEW_TAB, REASON)).toBe(false);
      expect(service.tabs()).toBe(before);
    });

    it('leaves an ordinary idle tab and an unknown tab id alone', () => {
      service.switchWorkspace(WS_A);
      const idle = service.createTab('idle');
      const before = service.tabs();

      expect(service.markSessionStartFailed(idle, REASON)).toBe(false);
      expect(service.markSessionStartFailed(NEW_TAB, REASON)).toBe(false);
      expect(service.tabs()).toBe(before);
    });
  });
});
