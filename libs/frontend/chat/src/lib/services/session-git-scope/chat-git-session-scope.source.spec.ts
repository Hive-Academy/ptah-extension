import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { TabState } from '@ptah-extension/chat-types';
import { ChatGitSessionScopeSource } from './chat-git-session-scope.source';
import { SessionWorktreeLookup } from './session-worktree-lookup.service';

function tab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: 'tab-1',
    title: 'Fix login',
    name: 'Fix login',
    status: 'loaded',
    messages: [],
    streamingState: null,
    currentMessageId: null,
    claudeSessionId: 'session-1',
    ...overrides,
  } as TabState;
}

describe('ChatGitSessionScopeSource', () => {
  const tabs = signal<TabState[]>([]);
  const activeTabId = signal<string | null>(null);
  const background = new Map<string, { tab: TabState; workspacePath: string }>();
  const organizationWorktrees = signal<ReadonlyMap<string, string>>(new Map());

  const tabManager = {
    tabs: tabs.asReadonly(),
    activeTabId: activeTabId.asReadonly(),
    activeTab: computed(
      () => tabs().find((item) => item.id === activeTabId()) ?? null,
    ),
    findTabByIdAcrossWorkspaces: (tabId: string) => {
      const active = tabs().find((item) => item.id === tabId);
      if (active) return { tab: active, workspacePath: '/ws/active' };
      return background.get(tabId) ?? null;
    },
  };
  const lookup = {
    worktreeFor: (sessionId: string | null) => ({
      known: sessionId === null || !unloadedSessions.has(sessionId),
      worktreePath:
        sessionId === null
          ? null
          : (organizationWorktrees().get(sessionId) ?? null),
    }),
  };
  const unloadedSessions = new Set<string>();

  let source: ChatGitSessionScopeSource;

  beforeEach(() => {
    tabs.set([]);
    activeTabId.set(null);
    background.clear();
    organizationWorktrees.set(new Map());
    unloadedSessions.clear();
    TestBed.configureTestingModule({
      providers: [
        { provide: TabManagerService, useValue: tabManager },
        { provide: SessionWorktreeLookup, useValue: lookup },
      ],
    });
    source = TestBed.inject(ChatGitSessionScopeSource);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('builds a candidate from the tab, its organization row and its partition', () => {
    tabs.set([
      tab({
        agentOrigin: {
          worktreePath: '/wt/agent',
        } as TabState['agentOrigin'],
      }),
    ]);
    organizationWorktrees.set(new Map([['session-1', '/wt/organized']]));
    activeTabId.set('tab-1');

    expect(source.activeSession()).toEqual({
      tabId: 'tab-1',
      sessionId: 'session-1',
      sessionName: 'Fix login',
      organizationWorktreePath: '/wt/organized',
      organizationResolved: true,
      agentOriginWorktreePath: '/wt/agent',
      sessionCwd: '/ws/active',
    });
  });

  it('marks a session whose organization row is not loaded as unresolved', () => {
    unloadedSessions.add('session-1');
    tabs.set([tab()]);
    activeTabId.set('tab-1');

    expect(source.activeSession()).toMatchObject({
      sessionId: 'session-1',
      organizationWorktreePath: null,
      organizationResolved: false,
    });
  });

  it('reacts to an active-tab change', () => {
    tabs.set([tab(), tab({ id: 'tab-2', title: '', claudeSessionId: null })]);
    activeTabId.set('tab-1');
    expect(source.activeSession()?.tabId).toBe('tab-1');

    activeTabId.set('tab-2');

    expect(source.activeSession()).toMatchObject({
      tabId: 'tab-2',
      sessionId: null,
      sessionName: 'New Chat',
      organizationWorktreePath: null,
      organizationResolved: true,
    });
  });

  it('keeps the same candidate object while only unrelated tab fields change', () => {
    tabs.set([tab()]);
    activeTabId.set('tab-1');
    const first = source.activeSession();

    tabs.set([tab({ status: 'streaming' })]);

    expect(source.activeSession()).toBe(first);
  });

  it('lists the open sessions with the active one first', () => {
    tabs.set([tab(), tab({ id: 'tab-2', claudeSessionId: 'session-2' })]);
    activeTabId.set('tab-2');

    expect(source.openSessions().map((item) => item.tabId)).toEqual([
      'tab-2',
      'tab-1',
    ]);
  });

  it('finds a tab of another workspace with its own partition, or null', () => {
    background.set('tab-9', {
      tab: tab({ id: 'tab-9', claudeSessionId: 'session-9' }),
      workspacePath: '/ws/other',
    });

    expect(source.candidateForTab('tab-9')?.sessionCwd).toBe('/ws/other');
    expect(source.candidateForTab('missing')).toBeNull();
  });
});
