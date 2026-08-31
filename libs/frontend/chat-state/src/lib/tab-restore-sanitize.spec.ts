/**
 * One definition of "restored tab", proved on BOTH readers.
 *
 * There are two paths out of `localStorage` and they had drifted (TASK_2026_327
 * finding 2):
 *
 *   - `TabManagerService.loadTabState()` — the legacy / pre-workspace key.
 *   - `TabWorkspacePartitionService._loadWorkspaceTabsFromStorage()` — the
 *     per-workspace keys, reached through `switchWorkspace`.
 *
 * The workspace reader coerced only `streaming` and `awaiting-background`, so a
 * tab persisted mid-`resuming` or mid-`switching` came back showing a spinner
 * for an SDK query that died with the old page; and it never cleared
 * `queuedContent`/`queuedOptions`, so text the user typed during a turn was
 * auto-sent when the NEXT turn finished — possibly days later, into whatever
 * session the tab had by then.
 *
 * Both now go through `sanitizeRestoredTab`, so these cases are written once
 * and asserted against each reader.
 */

import { TestBed } from '@angular/core/testing';
import type { SessionStatus, TabState } from '@ptah-extension/chat-types';
import { ConfirmationDialogService } from './confirmation-dialog.service';
import { ConversationRegistry } from './conversation-registry.service';
import {
  MODEL_REFRESH_CONTROL,
  type ModelRefreshControl,
} from './model-refresh-control';
import { TabManagerService } from './tab-manager.service';
import { TabSessionBinding } from './tab-session-binding.service';
import { TabWorkspacePartitionService } from './tab-workspace-partition.service';
import {
  PERSISTED_TAB_STATE_VERSION,
  sanitizeRestoredTab,
} from './tab-persistence';

const LEGACY_KEY = 'ptah.tabs';
const WORKSPACE_PATH = '/ws/restore';

/** Every status that names work in flight, and therefore cannot be restored. */
const IN_FLIGHT_STATUSES: readonly SessionStatus[] = [
  'streaming',
  'resuming',
  'switching',
  'awaiting-background',
  'sleeping',
];

/** Statuses that describe a settled tab and must survive a reload untouched. */
const SETTLED_STATUSES: readonly SessionStatus[] = ['fresh', 'draft', 'loaded'];

function storedTab(
  id: string,
  status: SessionStatus,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    name: id,
    title: id,
    order: 0,
    status,
    isDirty: false,
    lastActivityAt: 0,
    claudeSessionId: `sess-${id}`,
    messages: [],
    currentMessageId: null,
    // Everything below is what a tab persisted MID-TURN carries.
    streamingState: { currentMessageId: 'msg-1', messageEventIds: ['msg-1'] },
    queuedContent: 'a message the user typed during the turn',
    queuedOptions: { files: ['/a.ts'], effort: 'high' },
    attachedBinding: { bindingId: 'b-1', platform: 'telegram' },
    lastTurnStateRevision: 12,
    lastTurnStateSessionId: 'sess-old-process',
    ...extra,
  };
}

function writeEnvelope(key: string, tabs: Record<string, unknown>[]): void {
  localStorage.setItem(
    key,
    JSON.stringify({
      version: PERSISTED_TAB_STATE_VERSION,
      activeTabId: tabs[0]?.['id'] ?? null,
      tabs,
    }),
  );
}

describe('restored tabs — one sanitize, both readers', () => {
  let tabManager: TabManagerService;
  let partition: TabWorkspacePartitionService;

  beforeEach(() => {
    localStorage.clear();

    const modelRefresh: jest.Mocked<ModelRefreshControl> = {
      refreshModels: jest.fn().mockResolvedValue(undefined),
    } as jest.Mocked<ModelRefreshControl>;

    TestBed.configureTestingModule({
      providers: [
        TabManagerService,
        TabWorkspacePartitionService,
        ConversationRegistry,
        TabSessionBinding,
        ConfirmationDialogService,
        { provide: MODEL_REFRESH_CONTROL, useValue: modelRefresh },
      ],
    });

    tabManager = TestBed.inject(TabManagerService);
    partition = TestBed.inject(TabWorkspacePartitionService);
  });

  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  /**
   * The two readers, behind one signature. Each writes the envelope to the key
   * that reader owns, runs it, and returns the tabs the app ended up with.
   */
  const readers: ReadonlyArray<{
    readonly name: string;
    readonly restore: (tabs: Record<string, unknown>[]) => readonly TabState[];
  }> = [
    {
      name: 'TabManagerService.loadTabState (legacy key)',
      restore: (tabs) => {
        writeEnvelope(LEGACY_KEY, tabs);
        tabManager.loadTabState();
        return tabManager.tabs();
      },
    },
    {
      name: 'TabWorkspacePartitionService (workspace key)',
      restore: (tabs) => {
        writeEnvelope(
          partition.getStorageKeyForWorkspace(WORKSPACE_PATH),
          tabs,
        );
        tabManager.switchWorkspace(WORKSPACE_PATH);
        return tabManager.tabs();
      },
    },
  ];

  describe.each(readers)('$name', ({ restore }) => {
    it.each(IN_FLIGHT_STATUSES)(
      'coerces "%s" to loaded — the process that owned it is gone',
      (status) => {
        const [tab] = restore([storedTab('tab-1', status)]);
        expect(tab.status).toBe('loaded');
      },
    );

    it.each(SETTLED_STATUSES)('leaves "%s" alone', (status) => {
      const [tab] = restore([storedTab('tab-1', status)]);
      expect(tab.status).toBe(status);
    });

    it('nulls streamingState — the live event model died with the old page', () => {
      const [tab] = restore([storedTab('tab-1', 'streaming')]);
      expect(tab.streamingState).toBeNull();
    });

    it('nulls attachedBinding — a restored tab is never attached to a gateway', () => {
      const [tab] = restore([storedTab('tab-1', 'streaming')]);
      expect(tab.attachedBinding).toBeNull();
    });

    it('drops queuedContent and queuedOptions — there is no turn left to flush them after', () => {
      const [tab] = restore([storedTab('tab-1', 'streaming')]);
      expect(tab.queuedContent).toBeNull();
      expect(tab.queuedOptions).toBeNull();
    });

    it('drops lastTurnStateRevision — the backend counter belongs to the old process (TASK_2026_360)', () => {
      const [tab] = restore([storedTab('tab-1', 'sleeping')]);
      expect(tab.lastTurnStateRevision).toBeUndefined();
    });

    it('drops lastTurnStateSessionId with the revision it qualifies (TASK_2026_360 review F1)', () => {
      const [tab] = restore([storedTab('tab-1', 'sleeping')]);
      expect(tab.lastTurnStateSessionId).toBeUndefined();
    });

    it('keeps everything else verbatim', () => {
      const [tab] = restore([
        storedTab('tab-1', 'streaming', {
          name: 'Refactor the parser',
          title: 'Refactor the parser',
          order: 3,
          messages: [{ id: 'm1', role: 'assistant' }],
        }),
      ]);

      expect(tab.id).toBe('tab-1');
      expect(tab.name).toBe('Refactor the parser');
      expect(tab.order).toBe(3);
      expect(tab.claudeSessionId).toBe('sess-tab-1');
      expect(tab.messages).toHaveLength(1);
    });

    it('sanitizes every tab in the set, not just the first', () => {
      const tabs = restore([
        storedTab('tab-1', 'loaded'),
        storedTab('tab-2', 'resuming'),
        storedTab('tab-3', 'switching'),
      ]);

      expect(tabs.map((tab) => tab.status)).toEqual([
        'loaded',
        'loaded',
        'loaded',
      ]);
      expect(tabs.every((tab) => tab.queuedContent === null)).toBe(true);
      expect(tabs.every((tab) => tab.attachedBinding === null)).toBe(true);
    });
  });

  it('does not mutate the object it was handed', () => {
    const stored = storedTab('tab-1', 'streaming') as unknown as TabState;
    const sanitized = sanitizeRestoredTab(stored);

    expect(sanitized).not.toBe(stored);
    expect(stored.status).toBe('streaming');
    expect(stored.queuedContent).toBe(
      'a message the user typed during the turn',
    );
  });
});
