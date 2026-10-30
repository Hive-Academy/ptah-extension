import { computed, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { provideMarkdown } from 'ngx-markdown';
import {
  ConversationRegistry,
  TabManagerService,
  TabSessionBinding,
} from '@ptah-extension/chat-state';
import {
  AgentMonitorStore,
  PermissionHandlerService,
  agentVisibleInSession,
  type MonitoredAgent,
  type SubagentRecord,
} from '@ptah-extension/chat-streaming';
import * as chatUi from '@ptah-extension/chat-ui';
import {
  createEmptyStreamingState,
  type TabState,
} from '@ptah-extension/chat-types';
import type {
  AskUserQuestionRequest,
  PermissionRequest,
  SessionOrganizationSummary,
} from '@ptah-extension/shared';
import {
  CARD_SUMMARY_SAMPLE_MS,
  CompactSessionCardComponent,
} from './compact-session-card.component';
import { AgentPermissionResponder } from '../../../services/agent-permission-responder';
import { SessionGitStatsStore } from '../../../services/session-git-stats/session-git-stats.store';
import { SessionOrganizationCache } from '../../../services/session-organization/session-organization-cache.store';
import {
  RAIL_TRANSCRIPT_RETENTION,
  SESSION_CARD_ACTIONS,
  SESSION_FORCED_CARD,
} from '../../../tokens/session-context.token';

jest.mock('@ptah-extension/chat-ui', () => {
  const actual = jest.requireActual('@ptah-extension/chat-ui');
  return {
    ...actual,
    summarizeLive: jest.fn(actual.summarizeLive),
    summarizeFinalized: jest.fn(actual.summarizeFinalized),
  };
});

function tab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: 'tab-1',
    title: 'Session',
    status: 'loaded',
    claudeSessionId: 'session-1',
    messages: [],
    streamingState: null,
    sessionStats: null,
    liveModelStats: null,
    ...overrides,
  } as unknown as TabState;
}

function permission(
  overrides: Partial<PermissionRequest> = {},
): PermissionRequest {
  return {
    id: 'permission-1',
    toolName: 'Bash',
    toolInput: {},
    timestamp: 1,
    description: 'Run the verification command?',
    timeoutAt: 0,
    sessionId: 'session-1',
    ...overrides,
  };
}

function question(
  overrides: Partial<AskUserQuestionRequest> = {},
): AskUserQuestionRequest {
  return {
    id: 'question-1',
    toolName: 'AskUserQuestion',
    questions: [
      {
        question: 'Choose a deployment target',
        header: 'Target',
        options: [],
        multiSelect: false,
      },
    ],
    timestamp: 1,
    timeoutAt: 0,
    sessionId: 'session-1',
    ...overrides,
  };
}

describe(CompactSessionCardComponent.name, () => {
  const permissions = signal<readonly PermissionRequest[]>([]);
  const questions = signal<readonly AskUserQuestionRequest[]>([]);
  const agents = signal<MonitoredAgent[]>([]);
  const subagents = signal<ReadonlyMap<string, SubagentRecord>>(new Map());
  const respondSession = jest.fn();
  const respondLane = jest.fn();
  const releaseGit = jest.fn();
  const trackGit = jest.fn(() => releaseGit);
  const gitState = signal<chatUi.CompactGitState>({ kind: 'none' });
  const organizations = signal<ReadonlyMap<string, SessionOrganizationSummary>>(
    new Map(),
  );
  const organizationFor = jest.fn((sessionId: string) =>
    computed(() => organizations().get(sessionId) ?? null),
  );
  const organizationCache = { organizationFor };
  const routingRevision = signal(0);
  const permissionTargets = new Map<string, readonly string[]>();
  const questionTargets = new Map<string, readonly string[]>();
  const tabs = new Map<string, { tab: TabState; workspacePath: string }>();
  const sessions = new Map<string, { tab: TabState; workspacePath: string }>();
  const compaction = signal({
    inFlight: false,
    lastCompactionAt: null,
    trigger: null,
    preTokens: null,
    startedAt: null,
  });
  const marker = signal<{
    summary: string | null;
    preTokens: number | null;
    postTokens: number | null;
    durationMs: number | null;
    completedAt: number;
  } | null>(null);

  const permissionHandler = {
    permissionRequests: permissions.asReadonly(),
    questionRequests: questions.asReadonly(),
    routingTargetRevision: routingRevision.asReadonly(),
    targetTabsFor: (id: string) => permissionTargets.get(id) ?? [],
    questionTargetTabsFor: (id: string) => questionTargets.get(id) ?? [],
  };
  const tabManager = {
    findTabByIdAcrossWorkspaces: (id: string) => tabs.get(id) ?? null,
    findTabBySessionIdAcrossWorkspaces: (id: string) =>
      sessions.get(id) ?? null,
  };
  const sessionBinding = { conversationFor: () => 'conversation-1' };
  const conversations = {
    compactionStateFor: () => compaction(),
    compactionMarkerFor: () => marker(),
  };
  const agentStore = {
    agentsForSession: (sessionId: string) =>
      agents().filter((agent) => agentVisibleInSession(agent.parentSessionId, sessionId)),
    agentsOwnedBySession: (sessionId: string) =>
      agents().filter((agent) => agent.parentSessionId === sessionId),
    subagents,
  };

  beforeEach(() => {
    permissions.set([]);
    questions.set([]);
    agents.set([]);
    subagents.set(new Map());
    respondSession.mockClear();
    respondLane.mockClear();
    trackGit.mockClear();
    releaseGit.mockClear();
    gitState.set({ kind: 'none' });
    organizations.set(new Map());
    organizationFor.mockClear();
    routingRevision.set(0);
    permissionTargets.clear();
    questionTargets.clear();
    tabs.clear();
    sessions.clear();
    compaction.set({
      inFlight: false,
      lastCompactionAt: null,
      trigger: null,
      preTokens: null,
      startedAt: null,
    });
    marker.set(null);
    TestBed.configureTestingModule({
      imports: [CompactSessionCardComponent],
      providers: [
        provideMarkdown(),
        { provide: RAIL_TRANSCRIPT_RETENTION, useValue: false },
        { provide: PermissionHandlerService, useValue: permissionHandler },
        { provide: TabManagerService, useValue: tabManager },
        { provide: TabSessionBinding, useValue: sessionBinding },
        { provide: ConversationRegistry, useValue: conversations },
        { provide: AgentMonitorStore, useValue: agentStore },
        {
          provide: SessionGitStatsStore,
          useValue: { track: trackGit, stateFor: () => gitState() },
        },
        { provide: SessionOrganizationCache, useValue: organizationCache },
        {
          provide: AgentPermissionResponder,
          useValue: { respondSession, respondLane },
        },
      ],
    });
  });

  function render(value = tab()) {
    tabs.set(value.id, { tab: value, workspacePath: 'C:\\work\\ptah' });
    if (value.claudeSessionId) {
      sessions.set(value.claudeSessionId, {
        tab: value,
        workspacePath: 'C:\\work\\ptah',
      });
    }
    const fixture = TestBed.createComponent(CompactSessionCardComponent);
    fixture.componentRef.setInput('tab', value);
    fixture.detectChanges();
    return fixture;
  }

  it('omits repeated title and Full view chrome but keeps status and needs-you count in Canvas', () => {
    TestBed.overrideProvider(RAIL_TRANSCRIPT_RETENTION, { useValue: true });
    const fixture = render(tab({ viewMode: 'compact', title: 'Review changes', messages: [{
      id: 'reply-1', role: 'assistant', timestamp: 1,
      streamingState: {
        id: 'node-1', type: 'text', status: 'complete',
        content: 'The changes are ready to review.', children: [], isCollapsed: false,
      },
    }] }));
    fixture.componentRef.setInput('needsYouCount', 2);
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('[data-testid="compact-session-card"]');
    expect(card.querySelector('[data-testid="compact-session-title"]')).toBeNull();
    expect(card.textContent).not.toContain('Full view');
    expect(card.textContent).toContain('2 needs you');
    expect(card.querySelector('[data-zone="status"]')?.textContent).toContain('Done');
    expect(card.querySelector('ptah-compact-session-activity')?.className).not.toContain('[&_[data-zone=status]]:hidden');
    expect(card.textContent).toContain('The changes are ready to review.');
  });

  it('keeps the empty card status word in the Canvas host', () => {
    TestBed.overrideProvider(RAIL_TRANSCRIPT_RETENTION, { useValue: true });
    const fixture = render(tab({ viewMode: 'compact' }));
    const card = fixture.nativeElement.querySelector('[data-testid="compact-session-card"]');
    expect(card.querySelector('[data-testid="compact-session-empty"]')).not.toBeNull();
    expect(card.querySelector('[data-testid="compact-session-title"]')).toBeNull();
    expect(card.querySelector('[data-testid="compact-session-empty"] .text-xs.font-semibold')?.textContent).toContain('Waiting');
    expect(card.textContent).not.toContain('Full view');
  });

  it('binds todo and git states and releases root tracking on destroy', () => {
    gitState.set({ kind: 'known', additions: 4, deletions: 2, partial: false });
    const fixture = render();
    const activity = fixture.debugElement.query(
      By.directive(chatUi.CompactSessionActivityComponent),
    ).componentInstance as chatUi.CompactSessionActivityComponent;
    expect(trackGit).toHaveBeenCalledWith('C:\\work\\ptah', 'tab-1');
    expect(activity.todos()).toEqual({ kind: 'none' });
    expect(activity.gitStats()).toEqual({
      kind: 'known',
      additions: 4,
      deletions: 2,
      partial: false,
    });
    fixture.destroy();
    expect(releaseGit).toHaveBeenCalledTimes(1);
  });

  function organization(
    overrides: Partial<SessionOrganizationSummary> = {},
  ): SessionOrganizationSummary {
    return {
      priority: 'normal',
      status: 'active',
      pinned: false,
      worktreePath: null,
      branch: null,
      parentSessionId: null,
      forkOfSessionId: null,
      startedBy: 'user',
      tasks: [],
      prLinks: [],
      childCount: 0,
      updatedAt: null,
      todos: null,
      ...overrides,
    };
  }

  describe('organization (TASK_2026_854)', () => {
    function activityOf(fixture: ReturnType<typeof render>) {
      return fixture.debugElement.query(
        By.directive(chatUi.CompactSessionActivityComponent),
      ).componentInstance as chatUi.CompactSessionActivityComponent;
    }

    it('reads the organization of the SDK session id only', () => {
      render(tab({ claudeSessionId: null }));
      expect(organizationFor).not.toHaveBeenCalled();

      render();
      expect(organizationFor).toHaveBeenCalledWith('session-1');
    });

    it('passes the primary linked task to the activity and follows changes', () => {
      organizations.set(
        new Map([
          [
            'session-1',
            organization({
              tasks: [
                {
                  taskId: 'TASK_2026_100',
                  role: 'related',
                  source: 'user',
                  createdAt: 1,
                  missing: false,
                },
                {
                  taskId: 'TASK_2026_854_52e8',
                  role: 'primary',
                  source: 'orchestrate',
                  createdAt: 2,
                  missing: false,
                },
              ],
            }),
          ],
        ]),
      );
      const fixture = render();
      expect(activityOf(fixture).linkedTask()).toEqual({
        taskId: 'TASK_2026_854_52e8',
        missing: false,
      });

      organizations.set(new Map([['session-1', organization()]]));
      fixture.detectChanges();
      expect(activityOf(fixture).linkedTask()).toBeNull();
    });

    it('passes the linked task to the rail card', () => {
      organizations.set(
        new Map([
          [
            'session-1',
            organization({
              tasks: [
                {
                  taskId: 'TASK_2026_001',
                  role: 'primary',
                  source: 'user',
                  createdAt: 1,
                  missing: true,
                },
              ],
            }),
          ],
        ]),
      );
      const fixture = TestBed.createComponent(CompactSessionCardComponent);
      fixture.componentRef.setInput('tab', tab());
      fixture.componentRef.setInput('variant', 'rail');
      fixture.detectChanges();
      const rail = fixture.debugElement.query(
        By.directive(chatUi.CompactRailCardComponent),
      ).componentInstance as chatUi.CompactRailCardComponent;
      expect(rail.linkedTask()).toEqual({
        taskId: 'TASK_2026_001',
        missing: true,
      });
    });

    it('uses the host todo snapshot when the stream reports no todos', () => {
      organizations.set(
        new Map([
          [
            'session-1',
            organization({
              todos: {
                done: 2,
                total: 4,
                inProgress: 'Writing the cache',
                updatedAt: 5,
              },
            }),
          ],
        ]),
      );
      const fixture = render();
      expect(activityOf(fixture).todos()).toEqual({
        kind: 'known',
        done: 2,
        total: 4,
        active: 'Writing the cache',
      });
    });

    it('prefers the live todo state over the host snapshot', () => {
      organizations.set(
        new Map([
          [
            'session-1',
            organization({
              todos: { done: 0, total: 9, inProgress: null, updatedAt: 5 },
            }),
          ],
        ]),
      );
      const fixture = render(
        tab({
          messages: [
            {
              id: 'reply-1',
              role: 'assistant',
              timestamp: 1,
              streamingState: {
                id: 'root',
                type: 'message',
                status: 'complete',
                content: '',
                isCollapsed: false,
                children: [
                  {
                    id: 'todo-1',
                    type: 'tool',
                    status: 'complete',
                    toolName: 'TodoWrite',
                    toolInput: {
                      todos: [
                        {
                          content: 'Only',
                          activeForm: 'Doing only',
                          status: 'completed',
                        },
                      ],
                    },
                    content: '',
                    isCollapsed: false,
                    children: [],
                  },
                ],
              },
            },
          ],
        }),
      );
      expect(activityOf(fixture).todos()).toEqual({
        kind: 'known',
        done: 1,
        total: 1,
        active: null,
      });
    });
  });

  function lane(overrides: Partial<MonitoredAgent> = {}): MonitoredAgent {
    return {
      agentId: 'agent-1',
      cli: 'codex',
      task: 'Build the board',
      status: 'running',
      startedAt: Date.now() - 2000,
      parentSessionId: 'session-1',
      permissionQueue: [],
      ...overrides,
    } as MonitoredAgent;
  }

  it('keeps lane summary identity for unrelated events and changes it for every row field', () => {
    agents.set([lane({ startedAt: 10 })]);
    const fixture = render();
    const first = fixture.componentInstance.laneSummary();
    agents.set([lane({ startedAt: 10 }), lane({ agentId: 'other', parentSessionId: 'other' })]);
    expect(fixture.componentInstance.laneSummary()).toBe(first);
    agents.set([lane({ startedAt: 11 })]);
    const changedStart = fixture.componentInstance.laneSummary();
    expect(changedStart).not.toBe(first);
    expect(changedStart.rows[0].startedAt).toBe(11);
    const record = { parentToolUseId: 'sub-1', parentSessionId: 'session-1', status: 'running', lastEventAt: 1 } as SubagentRecord;
    agents.set([]);
    subagents.set(new Map([['sub-1', record]]));
    const subFirst = fixture.componentInstance.laneSummary();
    subagents.set(new Map([['sub-1', { ...record, status: 'background' }]]));
    const subChanged = fixture.componentInstance.laneSummary();
    expect(subChanged).not.toBe(subFirst);
    expect(subChanged.rows[0].kind).toBe('background');
  });

  it('keeps unowned CLI agents off other Rail cards, including counts and overflow', () => {
    TestBed.overrideProvider(SESSION_CARD_ACTIONS, {
      useValue: { openLane: jest.fn(), openSession: jest.fn() },
    });
    agents.set([
      lane({ agentId: 'unowned', displayName: 'Unowned CLI', parentSessionId: undefined, status: 'failed' }),
      lane({ agentId: 'foreign', displayName: 'Foreign CLI', parentSessionId: 'session-2' }),
      // One fixed start time: rows sort newest first, and Date.now() can tick between calls.
      lane({ agentId: 'owned-1', startedAt: 1_000 }),
      lane({ agentId: 'owned-2', startedAt: 1_000 }),
      lane({ agentId: 'owned-3', startedAt: 1_000 }),
      lane({ agentId: 'owned-4', startedAt: 1_000 }),
    ]);
    const fixture = render();
    fixture.componentRef.setInput('variant', 'rail');
    fixture.detectChanges();
    const summary = fixture.componentInstance.laneSummary();
    expect(summary.total).toBe(4);
    expect(summary.counts).toEqual({ waiting: 0, error: 0, running: 4, done: 0, stopped: 0 });
    expect(summary.rows.map((row) => row.id)).toEqual([
      'cli:owned-1', 'cli:owned-2', 'cli:owned-3',
    ]);
    expect(summary.moreCount).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('button[aria-label^="Open codex output"]')).toHaveLength(3);
    expect(fixture.nativeElement.textContent).toContain('+1 more');
    expect(fixture.nativeElement.textContent).not.toContain('Unowned CLI');
    expect(fixture.nativeElement.textContent).not.toContain('Foreign CLI');

    const other = render(tab({ id: 'tab-2', claudeSessionId: 'session-2' }));
    expect(other.componentInstance.laneSummary().rows.map((row) => row.id))
      .toEqual(['cli:foreign']);
  });

  it('keeps an unresolved CLI agent on an unscoped main-panel compact card', () => {
    agents.set([lane({ agentId: 'unowned', displayName: 'Unowned CLI', parentSessionId: undefined })]);
    const fixture = render();
    expect(fixture.componentInstance.laneSummary().rows.map((row) => row.id))
      .toEqual(['cli:unowned']);
    expect(fixture.nativeElement.textContent).toContain('Unowned CLI');
  });

  it('identifies equal-text terminal failures by terminal failure sequence', () => {
    const fixture = render(tab({ lastTerminalReason: 'api_error', terminalFailureSeq: 1 }));
    expect(fixture.componentInstance.callout()?.requestId).toBe('err:tab-1:1');
    fixture.componentRef.setInput('tab', tab({ lastTerminalReason: 'api_error', terminalFailureSeq: 1 }));
    fixture.detectChanges();
    expect(fixture.componentInstance.callout()?.requestId).toBe('err:tab-1:1');
    fixture.componentRef.setInput('tab', tab({ lastTerminalReason: 'api_error', terminalFailureSeq: 2 }));
    fixture.detectChanges();
    expect(fixture.componentInstance.callout()?.requestId).toBe('err:tab-1:2');
  });

  it('refuses a CLI Allow after its request leaves the queue', () => {
    agents.set([lane({ permissionQueue: [{ requestId: 'cli-1', timestamp: 1, description: 'Allow?' } as MonitoredAgent['permissionQueue'][number]] })]);
    const fixture = render();
    const stale = jest.fn();
    fixture.componentInstance.staleAction.subscribe(stale);
    const shown = fixture.componentInstance.callout() as chatUi.CompactPermissionCallout;
    agents.set([lane()]);
    fixture.componentInstance.respond(shown, 'allow');
    expect(respondLane).not.toHaveBeenCalled();
    expect(stale).toHaveBeenCalledTimes(1);
  });

  it('rejects a replaced session permission and stale shown navigation id', () => {
    permissions.set([permission({ id: 'old' })]);
    const fixture = render();
    const stale = jest.fn();
    const expanded = jest.fn();
    fixture.componentInstance.staleAction.subscribe(stale);
    fixture.componentInstance.expandToFull.subscribe(expanded);
    const shown = fixture.componentInstance.callout() as chatUi.CompactPermissionCallout;
    permissions.set([permission({ id: 'new' })]);
    fixture.componentInstance.respond(shown, 'allow');
    fixture.componentInstance.openRequest(shown);
    fixture.componentInstance.openFullView('old');
    fixture.componentInstance.openLane('orchestrator', 'old');
    expect(respondSession).not.toHaveBeenCalled();
    expect(expanded).not.toHaveBeenCalled();
    expect(stale).toHaveBeenCalledTimes(4);
  });

  it('renders the rail variant with shared state and retains the tile activity', () => {
    const fixture = render();
    expect(fixture.debugElement.query(By.directive(chatUi.CompactSessionActivityComponent))).not.toBeNull();
    fixture.componentRef.setInput('variant', 'rail');
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.directive(chatUi.CompactRailCardComponent))).not.toBeNull();
    expect(fixture.debugElement.query(By.directive(chatUi.CompactSessionActivityComponent))).toBeNull();
    const lanesRequested = jest.fn();
    const expanded = jest.fn();
    fixture.componentInstance.lanesRequested.subscribe(lanesRequested);
    fixture.componentInstance.expandToFull.subscribe(expanded);
    fixture.componentInstance.requestLanes();
    expect(lanesRequested).toHaveBeenCalledTimes(1);
    expect(expanded).toHaveBeenCalledTimes(1);
  });

  it('emits rail state as needs when a permission arrives', () => {
    const fixture = render();
    const states: chatUi.CompactRailState[] = [];
    fixture.componentInstance.railState.subscribe((state) => states.push(state));
    permissions.set([permission()]);
    fixture.detectChanges();
    expect(states).toContain('needs');
  });

  it('routes the shown question to the orchestrator and rejects a replaced id', () => {
    const openLane = jest.fn();
    TestBed.overrideProvider(SESSION_FORCED_CARD, { useValue: signal(true) });
    TestBed.overrideProvider(SESSION_CARD_ACTIONS, { useValue: { openLane, openSession: jest.fn() } });
    questions.set([question({ id: 'old' })]);
    const fixture = render();
    const stale = jest.fn();
    fixture.componentInstance.staleAction.subscribe(stale);
    expect(fixture.componentInstance.callout()?.requestId).toBe('old');
    questions.set([question({ id: 'new' })]);
    fixture.componentInstance.answerQuestion('old');
    expect(stale).toHaveBeenCalledTimes(1);
    expect(openLane).not.toHaveBeenCalled();
    fixture.componentInstance.answerQuestion('new');
    expect(openLane).toHaveBeenCalledTimes(1);
    expect(openLane).toHaveBeenCalledWith('orchestrator');
  });

  it('keeps tile answer opening the full view', () => {
    const fixture = render();
    const expanded = jest.fn();
    fixture.componentInstance.expandToFull.subscribe(expanded);
    questions.set([question()]);
    fixture.detectChanges();
    const answer = fixture.nativeElement.querySelector('[data-testid="cs-callout-question"] button') as HTMLButtonElement;
    answer.click();
    expect(expanded).toHaveBeenCalledTimes(1);
  });

  it('swaps session, CLI and error callouts in priority order', () => {
    agents.set([
      lane({
        permissionQueue: [
          {
            requestId: 'cli-request',
            agentId: 'agent-1',
            kind: 'shell',
            toolName: 'Bash',
            toolArgs: '{}',
            description: 'CLI approval',
            timestamp: 1,
            timeoutAt: 0,
          },
        ],
      }),
    ]);
    permissions.set([permission()]);
    const fixture = render(tab({ lastTerminalReason: 'api_error' }));
    expect(fixture.nativeElement.textContent).toContain(
      'Run the verification command?',
    );
    expect(fixture.nativeElement.textContent).not.toContain('CLI approval');

    permissions.set([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('CLI approval');

    agents.set([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('api error');
    expect(fixture.nativeElement.textContent).toContain('Show output');
    expect(fixture.nativeElement.textContent).not.toContain('Retry');
  });

  const openButton = (root: HTMLElement) =>
    [...root.querySelectorAll<HTMLButtonElement>('[data-testid="cs-callout-permission"] button')]
      .find((button) => button.textContent?.trim() === 'Open') as HTMLButtonElement;
  it('responds with the routed session tab ID and exact CLI IDs', () => {
    const request = permission();
    permissions.set([request]);
    const fixture = render();
    (
      fixture.nativeElement.querySelector(
        '[data-testid="cs-callout-permission"] button',
      ) as HTMLButtonElement
    ).click();
    expect(respondSession).toHaveBeenCalledWith(request, 'allow', 'tab-1', undefined);

    permissions.set([]);
    agents.set([
      lane({
        permissionQueue: [
          {
            requestId: 'cli-request',
            agentId: 'agent-1',
            kind: 'shell',
            toolName: 'Bash',
            toolArgs: '{}',
            description: 'CLI approval',
            timestamp: 1,
            timeoutAt: 0,
          },
        ],
      }),
    ]);
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll(
      '[data-testid="cs-callout-permission"] button',
    ) as NodeListOf<HTMLButtonElement>;
    buttons[1].click();
    expect(respondLane).toHaveBeenCalledWith(
      'agent-1',
      'cli-request',
      'deny',
      'User denied',
    );
  });

  it('forwards Always allow and a denial reason for a session permission', () => {
    const request = permission();
    permissions.set([request]);
    const fixture = render();
    const shown = fixture.componentInstance.callout() as chatUi.CompactPermissionCallout;
    fixture.componentInstance.respond(shown, 'always_allow');
    expect(respondSession).toHaveBeenLastCalledWith(request, 'always_allow', 'tab-1', undefined);
    fixture.componentInstance.respond(shown, 'deny_with_message', 'Use the staging database');
    expect(respondSession).toHaveBeenLastCalledWith(request, 'deny_with_message', 'tab-1', 'Use the staging database');
  });

  it('does not offer a CLI permission whose owner is unresolved', () => {
    agents.set([
      lane({
        parentSessionId: undefined,
        permissionQueue: [
          {
            requestId: 'unowned',
            description: 'Wrong session approval',
          } as MonitoredAgent['permissionQueue'][number],
        ],
      }),
    ]);
    const fixture = render();
    expect(fixture.nativeElement.textContent).not.toContain(
      'Wrong session approval',
    );
  });

  it('ignores a session permission that was resolved before its click', () => {
    const fixture = render();
    fixture.componentInstance.respond(
      {
        kind: 'permission',
        source: 'session',
        requestId: 'already-resolved',
        tabId: 'tab-1',
        text: 'Stale',
      },
      'deny',
    );
    expect(respondSession).not.toHaveBeenCalled();
  });

  it('opens lane output through the token, or expands when absent', () => {
    agents.set([lane()]);
    const fixture = render();
    const expanded = jest.fn();
    fixture.componentInstance.expandToFull.subscribe(expanded);
    (
      fixture.nativeElement.querySelector('[data-lane-id]') as HTMLButtonElement
    ).click();
    expect(expanded).toHaveBeenCalledTimes(1);
    fixture.destroy();

    const openLane = jest.fn();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CompactSessionCardComponent],
      providers: [
        provideMarkdown(),
        { provide: PermissionHandlerService, useValue: permissionHandler },
        { provide: TabManagerService, useValue: tabManager },
        { provide: TabSessionBinding, useValue: sessionBinding },
        { provide: ConversationRegistry, useValue: conversations },
        { provide: AgentMonitorStore, useValue: agentStore },
        {
          provide: SessionGitStatsStore,
          useValue: { track: trackGit, stateFor: () => gitState() },
        },
        { provide: SessionOrganizationCache, useValue: organizationCache },
        {
          provide: AgentPermissionResponder,
          useValue: { respondSession, respondLane },
        },
        {
          provide: SESSION_CARD_ACTIONS,
          useValue: { openLane, openSession: jest.fn() },
        },
      ],
    });
    const withToken = render();
    (
      withToken.nativeElement.querySelector(
        '[data-lane-id]',
      ) as HTMLButtonElement
    ).click();
    expect(openLane).toHaveBeenCalledWith('cli:agent-1');
  });

  it('shows foreground Task sub-agents while running and after completion', () => {
    const record: SubagentRecord = {
      parentToolUseId: 'task-1',
      parentSessionId: 'session-1',
      agentType: 'general-purpose',
      status: 'running',
    };
    subagents.set(new Map([['task-1', record]]));
    const fixture = render();
    expect(fixture.nativeElement.textContent).toContain('general-purpose');
    subagents.set(new Map([['task-1', { ...record, status: 'completed' }]]));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('general-purpose');
    subagents.set(new Map([['task-1', { ...record, parentSessionId: 'other' }]]));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('general-purpose');
  });

  it('routes forced card actions through the host without expanding', () => {
    const openSession = jest.fn();
    const openLane = jest.fn();
    TestBed.overrideProvider(SESSION_FORCED_CARD, { useValue: signal(true) });
    TestBed.overrideProvider(SESSION_CARD_ACTIONS, {
      useValue: { openSession, openLane },
    });
    agents.set([lane()]);
    const fixture = render(tab({ lastTerminalReason: 'api_error' }));
    const expanded = jest.fn();
    fixture.componentInstance.expandToFull.subscribe(expanded);

    fixture.componentInstance.openFullView();
    fixture.componentInstance.openLane('cli:agent-1');
    agents.set([]);
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector(
        '[data-testid="cs-callout-error"] button',
      ) as HTMLButtonElement
    ).click();

    expect(openSession).toHaveBeenCalledTimes(2);
    expect(openLane).toHaveBeenCalledWith('cli:agent-1');
    expect(expanded).not.toHaveBeenCalled();
  });

  it('keeps unforced expand behavior even when host actions exist', () => {
    const openSession = jest.fn();
    TestBed.overrideProvider(SESSION_CARD_ACTIONS, {
      useValue: { openSession, openLane: jest.fn() },
    });
    const fixture = render(tab({ lastTerminalReason: 'api_error' }));
    const expanded = jest.fn();
    fixture.componentInstance.expandToFull.subscribe(expanded);
    (fixture.nativeElement.querySelector('[data-testid="compact-session-card"] button') as HTMLButtonElement).click();
    expect(expanded).toHaveBeenCalledTimes(1);
    expect(openSession).not.toHaveBeenCalled();
  });

  it('runs one elapsed interval only while a lane runs and clears it on destroy', () => {
    jest.useFakeTimers();
    const interval = jest.spyOn(globalThis, 'setInterval');
    const clear = jest.spyOn(globalThis, 'clearInterval');
    try {
      const fixture = render();
      expect(interval).not.toHaveBeenCalled();
      agents.set([lane()]);
      fixture.detectChanges();
      expect(interval).toHaveBeenCalledTimes(1);
      const handle = interval.mock.results[0].value;
      agents.set([]);
      fixture.detectChanges();
      expect(clear).toHaveBeenCalledWith(handle);
      agents.set([lane()]);
      fixture.detectChanges();
      const nextHandle = interval.mock.results[1].value;
      fixture.destroy();
      expect(clear).toHaveBeenCalledWith(nextHandle);
    } finally {
      interval.mockRestore();
      clear.mockRestore();
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('keeps the elapsed interval while streaming without a lane, then clears it', () => {
    jest.useFakeTimers();
    const interval = jest.spyOn(globalThis, 'setInterval');
    const clear = jest.spyOn(globalThis, 'clearInterval');
    try {
      const fixture = render(
        tab({ streamingState: createEmptyStreamingState() }),
      );
      expect(interval).toHaveBeenCalledTimes(1);
      const handle = interval.mock.results[0].value;
      fixture.componentRef.setInput('tab', tab());
      fixture.detectChanges();
      expect(clear).toHaveBeenCalledWith(handle);
      fixture.destroy();
    } finally {
      interval.mockRestore();
      clear.mockRestore();
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('passes available branch, elapsed and context data into the board zones', () => {
    const fixture = render(
      tab({
        agentOrigin: {
          parentTabId: 'parent',
          parentSessionId: null,
          label: 'Child',
          branch: 'feat/canvas',
          worktreePath: 'C:\\work\\child',
          startedAt: Date.now() - 5000,
        },
        liveModelStats: {
          contextKnown: true,
          model: 'model',
          contextUsed: 25,
          contextWindow: 100,
          contextPercent: 25,
        },
      }),
    );
    const sub = fixture.nativeElement.querySelector(
      '[data-zone="sub"]',
    ) as HTMLElement;
    expect(sub.textContent).toContain('feat/canvas');
    expect(sub.textContent).toContain('5s');
    expect(
      fixture.nativeElement.querySelector('[aria-label="Context usage"]')
        ?.textContent,
    ).toContain('25%');
  });

  it('uses router metadata before a mismatched session id', () => {
    const value = tab();
    const request = permission({ sessionId: 'different-session' });
    permissions.set([request]);
    permissionTargets.set(request.id, [value.id]);

    const fixture = render(value);

    expect(fixture.nativeElement.textContent).toContain('Needs input');
    expect(fixture.nativeElement.textContent).toContain(
      'Run the verification command?',
    );
  });

  it('falls back to session id only when no target metadata exists', () => {
    const value = tab();
    permissions.set([permission()]);

    const fixture = render(value);

    expect(fixture.nativeElement.textContent).toContain('Needs input');
  });

  it('omits attached surface-only or stale targets instead of leaking by session id', () => {
    const request = permission();
    permissions.set([request]);
    permissionTargets.set(request.id, ['surface:harness']);

    const fixture = render();

    expect(fixture.nativeElement.textContent).not.toContain('Needs input');
    expect(fixture.nativeElement.textContent).not.toContain(
      request.description,
    );
  });

  it('keeps routed questions in the summary while permission takes the callout', () => {
    const value = tab();
    const older = question({ id: 'older', timestamp: 1 });
    const newer = question({
      id: 'newer',
      timestamp: 2,
      questions: [
        { question: 'Newer', header: 'New', options: [], multiSelect: false },
      ],
    });
    questions.set([newer, older]);
    permissions.set([permission({ timestamp: 0 })]);
    questionTargets.set(older.id, [value.id]);
    questionTargets.set(newer.id, [value.id]);
    permissionTargets.set('permission-1', [value.id]);

    const fixture = render(value);

    expect(fixture.nativeElement.textContent).toContain(
      'Choose a deployment target',
    );
    expect(fixture.nativeElement.textContent).toContain(
      'Run the verification command?',
    );
  });

  it('selects the oldest waiting request across queues and opens its lane', () => {
    const openLane = jest.fn();
    const openSession = jest.fn();
    TestBed.overrideProvider(SESSION_CARD_ACTIONS, {
      useValue: { openLane, openSession },
    });
    permissions.set([permission({ timestamp: 30 })]);
    questions.set([question({ timestamp: 20 })]);
    agents.set([
      lane({
        permissionQueue: [
          {
            requestId: 'cli-oldest',
            agentId: 'agent-1',
            kind: 'shell',
            toolName: 'Bash',
            toolArgs: '{}',
            description: 'Oldest CLI',
            timestamp: 10,
            timeoutAt: 0,
          },
        ],
      }),
    ]);
    const fixture = render();
    const root = fixture.nativeElement as HTMLElement;
    expect(
      root.querySelector('[data-testid="cs-callout-permission"]')?.textContent,
    ).toContain('Oldest CLI');
    expect(
      root.querySelector('[data-testid="cs-callout-permission"]')?.textContent,
    ).toContain('+2 more');
    openButton(root).click();
    expect(openLane).toHaveBeenCalledWith('cli:agent-1');
    expect(openSession).not.toHaveBeenCalled();
  });

  it('routes the oldest session permission Open and question Answer to the Orchestrator', () => {
    const openSession = jest.fn();
    TestBed.overrideProvider(SESSION_FORCED_CARD, { useValue: signal(true) });
    TestBed.overrideProvider(SESSION_CARD_ACTIONS, {
      useValue: { openSession, openLane: jest.fn() },
    });
    permissions.set([permission({ timestamp: 1 })]);
    questions.set([question({ timestamp: 2 })]);
    const fixture = render();
    const root = fixture.nativeElement as HTMLElement;
    expect(
      root.querySelector('[data-testid="cs-callout-permission"]')?.textContent,
    ).toContain('+1 more');
    openButton(root).click();
    expect(openSession).toHaveBeenCalledTimes(1);

    permissions.set([]);
    fixture.detectChanges();
    expect(
      root.querySelector('[data-testid="cs-callout-question"]')?.textContent,
    ).toContain('Choose a deployment target');
    (
      root.querySelector(
        '[data-testid="cs-callout-question"] button',
      ) as HTMLButtonElement
    ).click();
    expect(openSession).toHaveBeenCalledTimes(2);
  });

  it('renders a newly routed blocking prompt within one animation frame', async () => {
    const value = tab();
    const fixture = render(value);
    const request = permission({ sessionId: 'mismatched' });

    permissions.set([request]);
    permissionTargets.set(request.id, [value.id]);
    routingRevision.update((revision) => revision + 1);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(request.description);
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="cs-callout-permission"] button',
      )?.textContent,
    ).toContain('Allow');
  });

  it('projects conversation-scoped compaction and marker data', () => {
    compaction.update((value) => ({
      ...value,
      inFlight: true,
      preTokens: 200,
    }));
    marker.set({
      summary: 'Retained the implementation decisions',
      preTokens: 200,
      postTokens: 80,
      durationMs: 15,
      completedAt: 10,
    });

    const fixture = render(tab({ lastTerminalReason: 'api_error' }));

    expect(fixture.nativeElement.textContent).toContain('Compacting');
  });

  // TASK_2026_533: the card shows the backend session snapshot, the same one
  // the full stats panel shows. It never totals messages or counts tree nodes.
  it('reads tokens, cost and agents from the backend snapshot', () => {
    const fixture = render(
      tab({
        sessionStats: {
          sessionId: 'session-1',
          model: 'claude-opus-4-7',
          totalCost: 38.18,
          tokens: {
            input: 15_200,
            output: 396_700,
            cacheRead: 14_388_100,
            cacheCreation: 100_000,
          },
          tokenCount: 14_900_000,
          messageCount: 0,
          agentSessionCount: 9,
          status: 'ok',
          revision: 2,
        },
      }),
    );
    const metrics = fixture.nativeElement.querySelector(
      '[aria-label="Session metrics"]',
    ).textContent as string;

    expect(metrics).toContain('14.9M tokens');
    expect(metrics).toContain('$38.18');
    expect(metrics).toContain('9 agents');
  });

  it('shows unavailable tokens and cost without a snapshot, never zeros', () => {
    const fixture = render(tab({ sessionStats: null }));
    const metrics = fixture.nativeElement.querySelector(
      '[aria-label="Session metrics"]',
    ).textContent as string;

    expect(metrics).toContain('Tokens —');
    expect(metrics).toContain('Cost —');
    expect(metrics).not.toContain('0 tokens');
    expect(metrics).not.toContain('agents');
  });

  it('shows a settled session title, reply, activity and status', () => {
    const fixture = render(tab({
      title: 'Review changes',
      viewMode: 'compact',
      messages: [{
        id: 'reply-1',
        role: 'assistant',
        timestamp: 1,
        streamingState: {
          id: 'node-1',
          type: 'text',
          status: 'complete',
          content: 'The changes are ready to review.',
          children: [],
          isCollapsed: false,
        },
      }],
    }));
    fixture.componentRef.setInput('needsYouCount', 2);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="compact-session-title"]').textContent).toContain('Review changes');
    expect(fixture.nativeElement.querySelector('[data-zone="status"]').textContent).toContain('Done');
    expect(fixture.nativeElement.textContent).toContain('The changes are ready to review.');
    expect(fixture.nativeElement.querySelector('[data-zone="feed"]').textContent).toContain('EVENTS');
    expect(fixture.nativeElement.querySelector('[data-zone="lanes"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('2 needs you');

    const expanded = jest.fn();
    fixture.componentInstance.expandToFull.subscribe(expanded);
    (fixture.nativeElement.querySelector('[data-testid="compact-session-card"] button') as HTMLButtonElement).click();
    expect(expanded).toHaveBeenCalledTimes(1);
  });

  it('hides empty activity and lanes sections for a compact session with no events', () => {
    const fixture = render(tab({ viewMode: 'compact' }));
    expect(fixture.nativeElement.querySelector('[data-testid="compact-session-empty"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-zone="feed"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-zone="lanes"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Waiting');
  });

  it('uses stable session identity color and owning workspace label', () => {
    const first = render(tab());
    const firstDot = first.nativeElement.querySelector(
      '[data-zone="status"] span',
    );
    const firstColor = firstDot.getAttribute('style');
    expect(first.nativeElement.textContent).toContain('ptah');

    const second = render(tab());
    expect(
      second.nativeElement
        .querySelector('[data-zone="status"] span')
        .getAttribute('style'),
    ).toBe(firstColor);
  });

  it('emits expand and keeps the fixed-height summary-only contract', () => {
    const fixture = render(tab({ lastTerminalReason: 'api_error' }));
    const emitted = jest.fn();
    fixture.componentInstance.expandToFull.subscribe(emitted);

    (
      fixture.nativeElement.querySelector(
        '[data-testid="cs-callout-error"] button',
      ) as HTMLButtonElement
    ).click();

    expect(emitted).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.innerHTML).toContain('h-full');
    expect(fixture.nativeElement.innerHTML).toContain('overflow-hidden');
    expect(fixture.nativeElement.innerHTML).not.toContain('overflow-auto');
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Collapse');
    expect(
      fixture.nativeElement.querySelector('ptah-compact-session-header'),
    ).toBeNull();
  });

  describe('live summary sampler', () => {
    const summarizeLive = jest.mocked(chatUi.summarizeLive);
    const summarizeFinalized = jest.mocked(chatUi.summarizeFinalized);

    function streamingTab(overrides: Partial<TabState> = {}): TabState {
      return tab({
        status: 'streaming',
        streamingState: createEmptyStreamingState(),
        ...overrides,
      });
    }

    function update(
      fixture: ReturnType<typeof render>,
      overrides: Partial<TabState> = {},
    ): void {
      const current = fixture.componentInstance.tab();
      fixture.componentRef.setInput('tab', {
        ...current,
        streamingState: current.streamingState
          ? { ...current.streamingState }
          : null,
        ...overrides,
      });
      fixture.detectChanges();
    }

    function lastLiveContext() {
      return summarizeLive.mock.calls.at(-1)?.[1];
    }

    beforeEach(() => {
      jest.useFakeTimers();
      summarizeLive.mockClear();
      summarizeFinalized.mockClear();
    });

    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    it('exports a 500 ms sample interval', () => {
      expect(CARD_SUMMARY_SAMPLE_MS).toBe(500);
    });

    it('renders the first live event at once', () => {
      const value = streamingTab();
      render(value);

      expect(summarizeLive).toHaveBeenCalledTimes(1);
      expect(summarizeLive.mock.calls[0][0]).toBe(value.streamingState);
    });

    it('summarises 100 stream updates in one second at most three times', () => {
      const fixture = render(streamingTab());

      for (let i = 0; i < 100; i++) {
        update(fixture);
        jest.advanceTimersByTime(10);
        fixture.detectChanges();
      }

      expect(summarizeLive.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(summarizeLive.mock.calls.length).toBeLessThanOrEqual(3);
    });

    it('applies the latest stream state in the trailing sample', () => {
      const fixture = render(streamingTab());
      update(fixture);
      update(fixture);
      const latest = fixture.componentInstance.tab().streamingState;
      expect(summarizeLive).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(CARD_SUMMARY_SAMPLE_MS);
      fixture.detectChanges();

      expect(summarizeLive).toHaveBeenCalledTimes(2);
      expect(summarizeLive.mock.calls[1][0]).toBe(latest);
    });

    it('shows a permission without waiting for the sampler', () => {
      const fixture = render(streamingTab());
      update(fixture);
      const request = permission();
      permissionTargets.set(request.id, ['tab-1']);

      permissions.set([request]);
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain(
        'Run the verification command?',
      );
      expect(lastLiveContext()?.permissions).toEqual([request]);
    });

    it('shows a question without waiting for the sampler', () => {
      const fixture = render(streamingTab());
      update(fixture);
      const request = question();
      questionTargets.set(request.id, ['tab-1']);

      questions.set([request]);
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain(
        'Choose a deployment target',
      );
    });

    it('shows a status change and an error without waiting for the sampler', () => {
      const fixture = render(streamingTab());
      update(fixture);

      update(fixture, { status: 'resuming' });
      expect(lastLiveContext()?.sessionStatus).toBe('resuming');

      update(fixture, { lastTerminalReason: 'api_error' });
      expect(lastLiveContext()?.terminalReason).toBe('api_error');
    });

    it('does not re-summarise a flush that changes nothing but the stream', () => {
      const fixture = render(streamingTab());
      update(fixture);
      update(fixture);

      expect(summarizeLive).toHaveBeenCalledTimes(1);
      expect(summarizeFinalized).not.toHaveBeenCalled();
    });

    it('switches to the finalized summary as soon as the stream ends', () => {
      const fixture = render(streamingTab());
      update(fixture);
      const messages = [] as TabState['messages'];
      summarizeLive.mockClear();

      update(fixture, { status: 'loaded', streamingState: null, messages });

      expect(summarizeFinalized).toHaveBeenCalledTimes(1);
      expect(summarizeFinalized.mock.calls[0][0]).toBe(messages);
      jest.advanceTimersByTime(CARD_SUMMARY_SAMPLE_MS);
      fixture.detectChanges();
      expect(summarizeLive).not.toHaveBeenCalled();
    });

    it('renders the first event of a new stream at once', () => {
      const fixture = render(streamingTab());
      update(fixture, { status: 'loaded', streamingState: null });
      summarizeLive.mockClear();

      const next = createEmptyStreamingState();
      update(fixture, { status: 'streaming', streamingState: next });

      expect(summarizeLive).toHaveBeenCalledTimes(1);
      expect(summarizeLive.mock.calls[0][0]).toBe(next);
    });

    it('clears its pending sample timer on destroy', () => {
      // Child components own timers of their own, so the global timer count
      // is not a reliable signal; follow the card's own timer handle instead.
      const fixture = render(streamingTab());
      const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');
      const clearTimeoutSpy = jest.spyOn(globalThis, 'clearTimeout');
      try {
        update(fixture);
        const index = setTimeoutSpy.mock.calls.findIndex(
          ([, delay]) => delay === CARD_SUMMARY_SAMPLE_MS,
        );
        expect(index).toBeGreaterThanOrEqual(0);
        const handle = setTimeoutSpy.mock.results[index].value;
        summarizeLive.mockClear();

        fixture.destroy();

        expect(clearTimeoutSpy).toHaveBeenCalledWith(handle);
        jest.advanceTimersByTime(CARD_SUMMARY_SAMPLE_MS);
        expect(summarizeLive).not.toHaveBeenCalled();
      } finally {
        setTimeoutSpy.mockRestore();
        clearTimeoutSpy.mockRestore();
      }
    });
  });
});
