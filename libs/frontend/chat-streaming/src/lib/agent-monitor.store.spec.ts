/**
 * AgentMonitorStore Tests — resolveParentSessionId & Session-Scoped Signals
 *
 * Tests the tab ID → real UUID resolution and session-scoped filtering
 * that ensures agents display in the correct tab's sidebar.
 */

import { TestBed } from '@angular/core/testing';
import {
  AgentMonitorStore,
  subagentUsageView,
  type SubagentRecord,
} from './agent-monitor.store';
import { BackgroundAgentStore } from './background-agent.store';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import {
  createMockRpcService,
  rpcError,
  rpcSuccess,
} from '@ptah-extension/core/testing';
import { signal, computed } from '@angular/core';
import type {
  AgentProgressEvent,
  AgentStatusEvent,
  AgentCompletedEvent,
  AgentStartEvent,
  BackgroundAgentStartedEvent,
  CliSessionReference,
  FlatStreamEventUnion,
  MessageCompleteEvent,
} from '@ptah-extension/shared';
import { calculateMessageCost } from '@ptah-extension/shared';

// Mock TabManagerService with signal-based activeTab
const mockActiveTab = signal<{ claudeSessionId?: string } | null>(null);

const mockTabManager = {
  activeTab: mockActiveTab,
  activeTabSessionId: computed(() => mockActiveTab()?.claudeSessionId ?? null),
  tabs: signal([]),
};

const mockVSCodeService = {
  config: signal({ panelId: '' }),
  postMessage: jest.fn(),
};

describe('AgentMonitorStore', () => {
  let store: AgentMonitorStore;
  let backgroundAgentStore: BackgroundAgentStore;
  let rpcMock: ReturnType<typeof createMockRpcService>;

  beforeEach(() => {
    rpcMock = createMockRpcService();
    TestBed.configureTestingModule({
      providers: [
        AgentMonitorStore,
        BackgroundAgentStore,
        { provide: TabManagerService, useValue: mockTabManager },
        { provide: VSCodeService, useValue: mockVSCodeService },
        { provide: ClaudeRpcService, useValue: rpcMock },
      ],
    });

    store = TestBed.inject(AgentMonitorStore);
    backgroundAgentStore = TestBed.inject(BackgroundAgentStore);
    mockActiveTab.set(null);
  });

  function spawnAgent(
    agentId: string,
    parentSessionId?: string,
    status: 'running' | 'completed' | 'error' = 'running',
  ): void {
    store.onAgentSpawned({
      agentId,
      cli: 'codex',
      task: `Task for ${agentId}`,
      parentSessionId,
      status: 'running',
      startedAt: Date.now(),
      displayName: 'Codex',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    if (status !== 'running') {
      store.onAgentExited({
        agentId,
        cli: 'codex',
        task: `Task for ${agentId}`,
        parentSessionId,
        status,
        startedAt: Date.now(),
        exitCode: status === 'error' ? 1 : 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    }
  }

  describe('appendCliOutputPage (persisted output paging)', () => {
    const SESSION = 'sess-paged';
    const segment = (content: string) => ({
      tag: 'segment' as const,
      value: { type: 'text' as const, content },
    });
    const event = (id: string) => ({
      tag: 'streamEvent' as const,
      value: {
        id,
        eventType: 'text_delta',
        sessionId: SESSION,
        messageId: 'm1',
        delta: id,
        timestamp: 1,
      } as unknown as FlatStreamEventUnion,
    });
    const page1 = [segment('one'), event('e1')];
    const page2 = [segment('two'), event('e2')];

    function restoreLeanCard(): void {
      store.loadCliSessions(
        [
          {
            agentId: 'a1',
            cli: 'codex',
            task: 'paged',
            startedAt: '2026-09-01T00:00:00.000Z',
            status: 'completed',
          } as unknown as CliSessionReference,
        ],
        SESSION,
      );
    }

    const card = () => store.agents().find((a) => a.agentId === 'a1');

    it('ignores pages replayed by a restarted load, so output is never duplicated', () => {
      restoreLeanCard();
      const first = { requestCursor: undefined, nextCursor: '2', done: false };
      const last = { requestCursor: '2', nextCursor: undefined, done: true };

      store.appendCliOutputPage(SESSION, 'a1', page1, first);
      expect(store.cliOutputProgress(SESSION, 'a1')).toEqual({
        cursor: '2',
        done: false,
      });
      // A binding change restarted the load from the beginning mid-flight.
      store.appendCliOutputPage(SESSION, 'a1', page1, first);
      store.appendCliOutputPage(SESSION, 'a1', page2, last);
      store.appendCliOutputPage(SESSION, 'a1', page1, first);
      store.appendCliOutputPage(SESSION, 'a1', page2, last);

      expect(card()?.segments.map((s) => s.content)).toEqual(['one', 'two']);
      expect(card()?.streamEvents.map((e) => e.id)).toEqual(['e1', 'e2']);
      expect(store.cliOutputProgress(SESSION, 'a1')).toEqual({
        cursor: undefined,
        done: true,
      });
    });

    it('starts a card rebuilt by loadCliSessions over from the first page', () => {
      restoreLeanCard();
      store.appendCliOutputPage(SESSION, 'a1', page1, {
        requestCursor: undefined,
        nextCursor: '2',
        done: false,
      });

      restoreLeanCard();

      expect(store.cliOutputProgress(SESSION, 'a1')).toEqual({
        cursor: undefined,
        done: false,
      });
      store.appendCliOutputPage(SESSION, 'a1', page1, {
        requestCursor: undefined,
        nextCursor: '2',
        done: false,
      });
      expect(card()?.segments.map((s) => s.content)).toEqual(['one']);
    });

    it('reports no progress for an absent card', () => {
      expect(store.cliOutputProgress(SESSION, 'missing')).toBeNull();
    });

    it('demands output only for an expanded restored card whose history is not done', () => {
      restoreLeanCard();
      expect(store.cliOutputDemand()).toEqual([]);

      store.toggleAgentExpanded('a1');
      expect(store.cliOutputDemand()).toEqual([
        { sessionId: SESSION, agentId: 'a1' },
      ]);

      store.appendCliOutputPage(SESSION, 'a1', page1, {
        requestCursor: undefined,
        nextCursor: undefined,
        done: true,
      });
      expect(store.cliOutputDemand()).toEqual([]);
    });

    it('never demands output for a live card or a card restored with inline output', () => {
      spawnAgent('live', SESSION);
      store.loadCliSessions(
        [
          {
            agentId: 'inline',
            cli: 'codex',
            task: 'hydrated',
            startedAt: '2026-09-01T00:00:00.000Z',
            status: 'completed',
            segments: [{ type: 'text', content: 'kept' }],
          } as unknown as CliSessionReference,
        ],
        SESSION,
      );
      store.toggleAgentExpanded('inline');

      expect(store.agents().find((a) => a.agentId === 'live')?.expanded).toBe(
        true,
      );
      expect(store.cliOutputDemand()).toEqual([]);
    });

    it('keeps the demand identity across output that does not change membership', () => {
      restoreLeanCard();
      store.toggleAgentExpanded('a1');
      const before = store.cliOutputDemand();

      store.appendCliOutputPage(SESSION, 'a1', page1, {
        requestCursor: undefined,
        nextCursor: '2',
        done: false,
      });

      expect(store.cliOutputDemand()).toBe(before);
    });

    it('resets a card history to the first page and demands it again', () => {
      restoreLeanCard();
      store.toggleAgentExpanded('a1');
      store.appendCliOutputPage(SESSION, 'a1', page1, {
        requestCursor: undefined,
        nextCursor: undefined,
        done: true,
      });
      const revision = card()?.streamRevision ?? 0;
      expect(store.cliOutputDemand()).toEqual([]);

      store.resetCliOutputHistory(SESSION, 'a1');

      expect(card()?.segments).toEqual([]);
      expect(card()?.streamEvents).toEqual([]);
      expect(card()?.streamRevision).toBe(revision + 1);
      expect(store.cliOutputProgress(SESSION, 'a1')).toEqual({
        cursor: undefined,
        done: false,
      });
      expect(store.cliOutputDemand()).toEqual([
        { sessionId: SESSION, agentId: 'a1' },
      ]);
    });

    it('leaves other sessions untouched on reset', () => {
      restoreLeanCard();
      store.appendCliOutputPage(SESSION, 'a1', page1, {
        requestCursor: undefined,
        nextCursor: '2',
        done: false,
      });
      const before = card();

      store.resetCliOutputHistory('sess-other', 'a1');

      expect(card()).toBe(before);
    });
  });

  describe('resolveParentSessionId', () => {
    it('should update agents with matching tab ID to real session UUID', () => {
      spawnAgent('agent-1', 'tab_abc');
      spawnAgent('agent-2', 'tab_abc');

      store.resolveParentSessionId('tab_abc', 'real-uuid-xyz');

      const agents = store.agents();
      expect(agents.every((a) => a.parentSessionId === 'real-uuid-xyz')).toBe(
        true,
      );
    });

    it('should not affect agents with different parentSessionId', () => {
      spawnAgent('agent-1', 'tab_abc');
      spawnAgent('agent-2', 'tab_other');

      store.resolveParentSessionId('tab_abc', 'real-uuid-xyz');

      const agents = store.agents();
      const agent1 = agents.find((a) => a.agentId === 'agent-1');
      const agent2 = agents.find((a) => a.agentId === 'agent-2');

      expect(agent1?.parentSessionId).toBe('real-uuid-xyz');
      expect(agent2?.parentSessionId).toBe('tab_other');
    });

    it('should be a no-op when no agents match the tab ID', () => {
      spawnAgent('agent-1', 'tab_other');

      const _agentsBefore = store.agents();
      store.resolveParentSessionId('tab_nonexistent', 'real-uuid-xyz');
      const agentsAfter = store.agents();

      expect(agentsAfter[0].parentSessionId).toBe('tab_other');
    });

    it('should handle agents with no parentSessionId gracefully', () => {
      spawnAgent('agent-1', undefined);

      store.resolveParentSessionId('tab_abc', 'real-uuid-xyz');

      const agents = store.agents();
      expect(agents[0].parentSessionId).toBeUndefined();
    });

    it('rekeys SDK subagent records stamped with the tab id, and only those', () => {
      store.onAgentProgress({
        eventType: 'agent_progress',
        id: 'p-1',
        timestamp: 1,
        sessionId: 'tab_abc',
        parentToolUseId: 'toolu_mine',
        taskId: 't-1',
        description: 'Investigate',
        totalTokens: 1,
        toolUses: 0,
        durationMs: 1,
      } as AgentProgressEvent);
      store.onAgentProgress({
        eventType: 'agent_progress',
        id: 'p-2',
        timestamp: 1,
        sessionId: 'tab_other',
        parentToolUseId: 'toolu_theirs',
        taskId: 't-2',
        description: 'Other',
        totalTokens: 1,
        toolUses: 0,
        durationMs: 1,
      } as AgentProgressEvent);

      store.resolveParentSessionId('tab_abc', 'real-uuid-xyz');

      expect(store.getSubagent('toolu_mine')?.parentSessionId).toBe(
        'real-uuid-xyz',
      );
      expect(store.getSubagent('toolu_theirs')?.parentSessionId).toBe(
        'tab_other',
      );
    });
  });

  describe('requestPanelOpen', () => {
    it('publishes a monotonic request stamped with the requesting tab', () => {
      expect(store.panelOpenRequest()).toEqual({ seq: 0, tabId: null });

      store.requestPanelOpen('tab-1');
      expect(store.panelOpenRequest()).toEqual({ seq: 1, tabId: 'tab-1' });

      store.requestPanelOpen();
      expect(store.panelOpenRequest()).toEqual({ seq: 2, tabId: null });
      expect(store.panelOpen()).toBe(true);
    });
  });

  describe('subagent agentId capture', () => {
    const base = {
      parentToolUseId: 'toolu_wf',
      taskId: 't-wf',
      sessionId: 'sess-1',
      timestamp: 1,
    };

    it('takes the agentId from whichever lifecycle event first carries it and never drops it', () => {
      store.onAgentStart({
        ...base,
        eventType: 'agent_start',
        id: 'a',
        toolCallId: 'toolu_wf',
        agentType: 'workflow-subagent',
        source: 'complete',
      } as AgentStartEvent);
      expect(store.getSubagent('toolu_wf')?.agentId).toBeUndefined();

      store.onAgentProgress({
        ...base,
        eventType: 'agent_progress',
        id: 'p',
        description: 'Investigate',
        totalTokens: 10,
        toolUses: 1,
        durationMs: 5,
        agentId: 'a01fea2eb1b977576',
      } as AgentProgressEvent);
      expect(store.getSubagent('toolu_wf')?.agentId).toBe('a01fea2eb1b977576');

      store.onAgentStatus({
        ...base,
        eventType: 'agent_status',
        id: 's',
        status: 'running',
      } as AgentStatusEvent);
      store.onAgentCompleted({
        ...base,
        eventType: 'agent_completed',
        id: 'c',
        status: 'completed',
        summary: 'ok',
        outputFile: '/tmp/x',
      } as AgentCompletedEvent);
      expect(store.getSubagent('toolu_wf')?.agentId).toBe('a01fea2eb1b977576');
    });
  });

  describe('onBackgroundAgentStarted (identity merge)', () => {
    const T = 'toolu_bg_named';
    const S = 'sess-bg';

    function start(overrides: Partial<AgentStartEvent> = {}): AgentStartEvent {
      return {
        eventType: 'agent_start',
        id: 'bg-start',
        timestamp: 1,
        sessionId: S,
        toolCallId: T,
        agentType: 'reviewer',
        source: 'hook',
        ...overrides,
      } as AgentStartEvent;
    }

    function bgStarted(
      overrides: Partial<BackgroundAgentStartedEvent> = {},
    ): BackgroundAgentStartedEvent {
      return {
        eventType: 'background_agent_started',
        id: 'bg-started',
        timestamp: 2,
        sessionId: S,
        toolCallId: T,
        agentType: 'reviewer',
        agentId: 'a1b2c3',
        teammateName: 'reviewer-pr2',
        source: 'hook',
        ...overrides,
      } as BackgroundAgentStartedEvent;
    }

    it('fills agentId, teammateName and parentSessionId on an existing record without changing status', () => {
      store.onAgentStart(start());
      expect(store.getSubagent(T)?.agentId).toBeUndefined();
      const statusBefore = store.getSubagent(T)?.status;

      store.onBackgroundAgentStarted(bgStarted());

      const rec = store.getSubagent(T);
      expect(rec?.agentId).toBe('a1b2c3');
      expect(rec?.teammateName).toBe('reviewer-pr2');
      expect(rec?.parentSessionId).toBe(S);
      expect(rec?.status).toBe(statusBefore);
    });

    it('fills parentSessionId when the record has none yet', () => {
      store.onAgentStart(start({ sessionId: '' }));
      expect(store.getSubagent(T)?.parentSessionId).toBeUndefined();

      store.onBackgroundAgentStarted(bgStarted());

      expect(store.getSubagent(T)?.parentSessionId).toBe(S);
    });

    it('never replaces fields the record already has', () => {
      store.onAgentStart(
        start({ agentId: 'orig-id', teammateName: 'orig-name' }),
      );

      store.onBackgroundAgentStarted(bgStarted({ sessionId: 'other-session' }));

      const rec = store.getSubagent(T);
      expect(rec?.agentId).toBe('orig-id');
      expect(rec?.teammateName).toBe('orig-name');
      expect(rec?.parentSessionId).toBe(S);
    });

    it('does not create a record on its own', () => {
      store.onBackgroundAgentStarted(bgStarted());
      expect(store.getSubagent(T)).toBeUndefined();
    });

    it('applies an identity that arrived before agent_start once the record is created', () => {
      store.onBackgroundAgentStarted(bgStarted());
      store.onAgentStart(start({ sessionId: '' }));

      const rec = store.getSubagent(T);
      expect(rec?.agentId).toBe('a1b2c3');
      expect(rec?.teammateName).toBe('reviewer-pr2');
      expect(rec?.parentSessionId).toBe(S);
      expect(rec?.status).toBe('running');
    });
  });

  describe('activeTabAgents (session-scoped filtering)', () => {
    it('should show all agents when no active tab session', () => {
      spawnAgent('agent-1', 'session-a');
      spawnAgent('agent-2', 'session-b');
      mockActiveTab.set(null);

      expect(store.activeTabAgents().length).toBe(2);
    });

    it('should show all agents when active tab has no claudeSessionId', () => {
      spawnAgent('agent-1', 'session-a');
      spawnAgent('agent-2', 'session-b');
      mockActiveTab.set({ claudeSessionId: undefined });

      expect(store.activeTabAgents().length).toBe(2);
    });

    it('should filter to only matching session agents', () => {
      spawnAgent('agent-1', 'session-a');
      spawnAgent('agent-2', 'session-b');
      spawnAgent('agent-3', 'session-a');

      mockActiveTab.set({ claudeSessionId: 'session-a' });

      const filtered = store.activeTabAgents();
      expect(filtered.length).toBe(2);
      expect(filtered.every((a) => a.parentSessionId === 'session-a')).toBe(
        true,
      );
    });

    it('should include agents with no parentSessionId in all tabs', () => {
      spawnAgent('agent-1', 'session-a');
      spawnAgent('agent-orphan', undefined);

      mockActiveTab.set({ claudeSessionId: 'session-a' });

      const filtered = store.activeTabAgents();
      expect(filtered.length).toBe(2);
    });

    it('should update when parentSessionId is resolved from tab ID to UUID', () => {
      spawnAgent('agent-1', 'tab_abc');
      mockActiveTab.set({ claudeSessionId: 'real-uuid-xyz' });

      // Before resolution: agent has tab_abc, active tab expects real-uuid-xyz → no match
      expect(store.activeTabAgents().length).toBe(0);

      // After resolution: agent now has real-uuid-xyz → matches
      store.resolveParentSessionId('tab_abc', 'real-uuid-xyz');
      expect(store.activeTabAgents().length).toBe(1);
    });
  });

  describe('session-scoped computed signals', () => {
    it('hasActiveTabRunningAgents should only consider active tab agents', () => {
      spawnAgent('agent-1', 'session-a', 'running');
      spawnAgent('agent-2', 'session-b', 'completed');

      mockActiveTab.set({ claudeSessionId: 'session-b' });

      // session-b only has a completed agent
      expect(store.hasActiveTabRunningAgents()).toBe(false);

      mockActiveTab.set({ claudeSessionId: 'session-a' });

      // session-a has a running agent
      expect(store.hasActiveTabRunningAgents()).toBe(true);
    });

    it('activeTabAgentCount should reflect filtered count', () => {
      spawnAgent('agent-1', 'session-a');
      spawnAgent('agent-2', 'session-a');
      spawnAgent('agent-3', 'session-b');

      mockActiveTab.set({ claudeSessionId: 'session-a' });
      expect(store.activeTabAgentCount()).toBe(2);

      mockActiveTab.set({ claudeSessionId: 'session-b' });
      expect(store.activeTabAgentCount()).toBe(1);
    });

    it('activeTabPendingPermissions should scope to active tab', () => {
      spawnAgent('agent-1', 'session-a');
      spawnAgent('agent-2', 'session-b');

      // Add permission to agent in session-b
      store.onPermissionRequest({
        requestId: 'perm-1',
        agentId: 'agent-2',
        kind: 'write',
        toolName: 'edit',
        toolArgs: '{}',
        description: 'Allow file write',
        timestamp: Date.now(),
        timeoutAt: 0,
      });

      mockActiveTab.set({ claudeSessionId: 'session-a' });
      expect(store.activeTabPendingPermissions().length).toBe(0);

      mockActiveTab.set({ claudeSessionId: 'session-b' });
      expect(store.activeTabPendingPermissions().length).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // SDK task_* per-subagent records
  // ─────────────────────────────────────────────────────────────────────
  describe('Phase 3 — SDK subagent records', () => {
    const PARENT = 'toolu_parent_abc';
    const TASK = 'task_xyz';

    function startEvent(
      overrides: Partial<AgentStartEvent> = {},
    ): AgentStartEvent {
      return {
        eventType: 'agent_start',
        id: 'agent-start-1',
        timestamp: 1,
        toolCallId: PARENT,
        agentType: 'Explore',
        agentDescription: 'Explore the repo',
        agentId: 'short-1',
        source: 'hook',
        taskId: TASK,
        ...overrides,
      } as AgentStartEvent;
    }

    function progressEvent(
      overrides: Partial<AgentProgressEvent> = {},
    ): AgentProgressEvent {
      return {
        eventType: 'agent_progress',
        id: 'p-1',
        timestamp: 2,
        parentToolUseId: PARENT,
        taskId: TASK,
        description: 'Searching files',
        summary: 'Looking at src/',
        lastToolName: 'Glob',
        totalTokens: 1234,
        toolUses: 3,
        durationMs: 1500,
        ...overrides,
      } as AgentProgressEvent;
    }

    function statusEvent(
      overrides: Partial<AgentStatusEvent> = {},
    ): AgentStatusEvent {
      return {
        eventType: 'agent_status',
        id: 's-1',
        timestamp: 3,
        parentToolUseId: PARENT,
        taskId: TASK,
        status: 'running',
        description: 'Working',
        ...overrides,
      } as AgentStatusEvent;
    }

    function completedEvent(
      overrides: Partial<AgentCompletedEvent> = {},
    ): AgentCompletedEvent {
      return {
        eventType: 'agent_completed',
        id: 'c-1',
        timestamp: 4,
        parentToolUseId: PARENT,
        taskId: TASK,
        status: 'completed',
        summary: 'Done',
        outputFile: '/tmp/out.json',
        totalTokens: 4321,
        toolUses: 7,
        durationMs: 9000,
        ...overrides,
      } as AgentCompletedEvent;
    }

    it('agent_start populates a record with running status and taskId', () => {
      store.onAgentStart(startEvent());
      const rec = store.subagents().get(PARENT);
      expect(rec).toBeDefined();
      expect(rec?.status).toBe('running');
      expect(rec?.taskId).toBe(TASK);
      expect(rec?.description).toBe('Explore the repo');
    });

    it('agent_progress merges summary, lastToolName and stats', () => {
      store.onAgentStart(startEvent());
      store.onAgentProgress(progressEvent());
      const rec = store.subagents().get(PARENT);
      expect(rec?.latestSummary).toBe('Looking at src/');
      expect(rec?.lastToolName).toBe('Glob');
      expect(rec?.totalTokens).toBe(1234);
      expect(rec?.toolUses).toBe(3);
      expect(rec?.durationMs).toBe(1500);
      // Status not downgraded by progress event
      expect(rec?.status).toBe('running');
    });

    it('agent_status updates lifecycle status and errorMessage', () => {
      store.onAgentStart(startEvent());
      store.onAgentStatus(
        statusEvent({ status: 'failed', errorMessage: 'boom' }),
      );
      const rec = store.subagents().get(PARENT);
      expect(rec?.status).toBe('failed');
      expect(rec?.errorMessage).toBe('boom');
    });

    it('agent_completed sets terminal status, outputFile and final stats', () => {
      store.onAgentStart(startEvent());
      store.onAgentCompleted(completedEvent({ status: 'stopped' }));
      const rec = store.subagents().get(PARENT);
      expect(rec?.status).toBe('stopped');
      expect(rec?.outputFile).toBe('/tmp/out.json');
      expect(rec?.totalTokens).toBe(4321);
      expect(rec?.latestSummary).toBe('Done');
    });

    it('captures the owning session id from the event onto the record', () => {
      store.onAgentStart(startEvent({ sessionId: 'sess-owner' }));
      expect(store.subagents().get(PARENT)?.parentSessionId).toBe('sess-owner');
      // Later events refresh it; a null-ish event preserves the prior value.
      store.onAgentProgress(progressEvent({ sessionId: 'sess-owner-2' }));
      expect(store.subagents().get(PARENT)?.parentSessionId).toBe(
        'sess-owner-2',
      );
    });

    it('agentId captured on agent_start survives onAgentProgress/onAgentStatus/onAgentCompleted/onTaskToolResult merges', () => {
      // agentId (the SDK short-hex id) is ONLY carried by agent_start — the
      // sibling events never repeat it, so onAgentProgress/onAgentStatus/
      // onAgentCompleted must preserve the existing value (`agentId: existing?.agentId`)
      // rather than clobbering it with undefined. This is the id required to
      // read the subagent's transcript via subagent:transcript.
      store.onAgentStart(startEvent({ agentId: 'short-abc123' }));
      expect(store.subagents().get(PARENT)?.agentId).toBe('short-abc123');

      store.onAgentProgress(progressEvent());
      expect(store.subagents().get(PARENT)?.agentId).toBe('short-abc123');

      store.onAgentStatus(statusEvent());
      expect(store.subagents().get(PARENT)?.agentId).toBe('short-abc123');

      store.onAgentCompleted(completedEvent());
      expect(store.subagents().get(PARENT)?.agentId).toBe('short-abc123');

      store.onTaskToolResult(PARENT, false);
      expect(store.subagents().get(PARENT)?.agentId).toBe('short-abc123');
    });

    it('records are independent per parentToolUseId', () => {
      store.onAgentStart(startEvent({ toolCallId: 'toolu_a' }));
      store.onAgentStart(startEvent({ toolCallId: 'toolu_b' }));
      store.onAgentStatus(
        statusEvent({ parentToolUseId: 'toolu_a', status: 'completed' }),
      );
      expect(store.subagents().get('toolu_a')?.status).toBe('completed');
      expect(store.subagents().get('toolu_b')?.status).toBe('running');
    });

    describe('onTaskToolResult (foreground completion from Task tool_result)', () => {
      it('transitions running → completed', () => {
        store.onAgentStart(startEvent());
        store.onTaskToolResult(PARENT, false);
        expect(store.subagents().get(PARENT)?.status).toBe('completed');
      });

      it('transitions running → failed when the tool_result is an error', () => {
        store.onAgentStart(startEvent());
        store.onTaskToolResult(PARENT, true);
        expect(store.subagents().get(PARENT)?.status).toBe('failed');
      });

      it('does NOT override a terminal status from a real agent_completed', () => {
        store.onAgentStart(startEvent());
        store.onAgentCompleted(completedEvent({ status: 'completed' }));
        // A late tool_result with isError must not flip completed → failed.
        store.onTaskToolResult(PARENT, true);
        expect(store.subagents().get(PARENT)?.status).toBe('completed');
      });

      it('is a no-op for an unknown toolCallId (not a Task spawn)', () => {
        store.onTaskToolResult('toolu_unknown', false);
        expect(store.subagents().get('toolu_unknown')).toBeUndefined();
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Workflow run grouping fields (workflowRunId / workflowName)
  // ─────────────────────────────────────────────────────────────────────
  describe('workflow run fields', () => {
    it('copies workflowRunId/workflowName from spawn info onto the MonitoredAgent', () => {
      store.onAgentSpawned({
        agentId: 'wf-agent',
        cli: 'ptah-cli',
        task: 'build step',
        status: 'running',
        startedAt: Date.now(),
        workflowRunId: 'run-1',
        workflowName: 'Release Build',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const agent = store.agents().find((a) => a.agentId === 'wf-agent');
      expect(agent?.workflowRunId).toBe('run-1');
      expect(agent?.workflowName).toBe('Release Build');
    });

    it('leaves workflow fields undefined for ordinary (non-workflow) agents', () => {
      store.onAgentSpawned({
        agentId: 'plain-agent',
        cli: 'codex',
        task: 'do a thing',
        status: 'running',
        startedAt: Date.now(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const agent = store.agents().find((a) => a.agentId === 'plain-agent');
      expect(agent?.workflowRunId).toBeUndefined();
      expect(agent?.workflowName).toBeUndefined();
    });

    it('copies workflowRunId/workflowName from agent_start onto the SubagentRecord', () => {
      store.onAgentStart({
        eventType: 'agent_start',
        id: 'a',
        timestamp: 1,
        toolCallId: 'toolu_wf',
        agentType: 'Explore',
        agentDescription: 'explore',
        agentId: 'short-wf',
        source: 'hook',
        workflowRunId: 'run-9',
        workflowName: 'Migration',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const rec = store.subagents().get('toolu_wf');
      expect(rec?.workflowRunId).toBe('run-9');
      expect(rec?.workflowName).toBe('Migration');
    });

    it('preserves workflow fields across progress/completed merges', () => {
      store.onAgentStart({
        eventType: 'agent_start',
        id: 'a',
        timestamp: 1,
        toolCallId: 'toolu_wf2',
        agentType: 'Explore',
        agentDescription: 'explore',
        agentId: 'short-wf2',
        source: 'hook',
        workflowRunId: 'run-keep',
        workflowName: 'Keep Me',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      // A later progress event WITHOUT the workflow fields must not clobber them.
      store.onAgentProgress({
        eventType: 'agent_progress',
        id: 'p',
        timestamp: 2,
        parentToolUseId: 'toolu_wf2',
        summary: 'progressing',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const rec = store.subagents().get('toolu_wf2');
      expect(rec?.workflowRunId).toBe('run-keep');
      expect(rec?.workflowName).toBe('Keep Me');
    });

    function startWorkflowSubagent(
      toolCallId: string,
      workflowRunId: string,
      sessionId?: string,
    ): void {
      store.onAgentStart({
        eventType: 'agent_start',
        id: `id-${toolCallId}`,
        timestamp: 1,
        toolCallId,
        agentType: 'Explore',
        agentDescription: 'explore',
        agentId: `short-${toolCallId}`,
        source: 'hook',
        sessionId,
        workflowRunId,
        workflowName: 'WF',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    }

    it('activeWorkflowSubagents returns only records carrying a workflowRunId', () => {
      startWorkflowSubagent('toolu_wf_a', 'run-1');
      // A non-workflow subagent must be excluded.
      store.onAgentStart({
        eventType: 'agent_start',
        id: 'id-plain',
        timestamp: 1,
        toolCallId: 'toolu_plain',
        agentType: 'Explore',
        agentDescription: 'explore',
        agentId: 'short-plain',
        source: 'hook',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      mockActiveTab.set(null);
      const workflow = store.activeWorkflowSubagents();
      expect(workflow.map((r) => r.parentToolUseId)).toEqual(['toolu_wf_a']);
    });

    it('activeWorkflowSubagents scopes by active session (records w/o session shown)', () => {
      startWorkflowSubagent('toolu_owned', 'run-1', 'sess-A');
      startWorkflowSubagent('toolu_other', 'run-2', 'sess-B');
      startWorkflowSubagent('toolu_global', 'run-3'); // no session → shown in all

      mockActiveTab.set({ claudeSessionId: 'sess-A' });
      const ids = store
        .activeWorkflowSubagents()
        .map((r) => r.parentToolUseId)
        .sort();
      expect(ids).toEqual(['toolu_global', 'toolu_owned']);
    });

    it('workflowSubagentsForSession filters by exact parentSessionId', () => {
      startWorkflowSubagent('toolu_a', 'run-1', 'sess-A');
      startWorkflowSubagent('toolu_b', 'run-2', 'sess-B');

      expect(
        store
          .workflowSubagentsForSession('sess-A')
          .map((r) => r.parentToolUseId),
      ).toEqual(['toolu_a']);
    });

    it.each([
      ['empty string', ''],
      ['null', null],
      ['undefined', undefined],
    ])(
      'workflowSubagentsForSession returns nothing for an unresolved scope (%s)',
      (_label, sid) => {
        startWorkflowSubagent('toolu_a', 'run-1', 'sess-A');
        startWorkflowSubagent('toolu_b', 'run-2', 'sess-B');

        // A scoped surface that has not resolved its session claims no agents —
        // the same rule `agentVisibleInSession` applies for the tray and the
        // resume banner. It must NOT degrade into "show everything".
        expect(store.workflowSubagentsForSession(sid)).toEqual([]);
      },
    );

    describe('activeSessionSubagents', () => {
      function startPlainSubagent(
        toolCallId: string,
        status: SubagentRecord['status'] = 'running',
        sessionId?: string,
      ): void {
        store.onAgentStart({
          eventType: 'agent_start',
          id: `id-${toolCallId}`,
          timestamp: 1,
          toolCallId,
          agentType: 'Explore',
          agentDescription: 'explore',
          agentId: `short-${toolCallId}`,
          source: 'hook',
          sessionId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        if (status !== 'running') {
          store.onAgentStatus({
            eventType: 'agent_status',
            id: `status-${toolCallId}`,
            timestamp: 2,
            parentToolUseId: toolCallId,
            status,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any);
        }
      }

      function markTaskBackgrounded(toolCallId: string, sessionId?: string): void {
        backgroundAgentStore.onStarted({
          toolCallId,
          agentId: `background-${toolCallId}`,
          agentType: 'Explore',
          agentDescription: 'explore',
          sessionId,
          timestamp: 2,
        } as BackgroundAgentStartedEvent);
      }

      it('excludes foreground subagents and workflow subagents', () => {
        startPlainSubagent('toolu_plain_1', 'running');
        startWorkflowSubagent('toolu_wf_1', 'run-1');

        mockActiveTab.set(null);
        const subs = store.activeSessionSubagents();
        expect(subs).toEqual([]);
      });

      it('includes a record whose status is background', () => {
        startPlainSubagent('toolu_background', 'background');
        mockActiveTab.set(null);
        const ids = store
          .activeSessionSubagents()
          .map((r) => r.parentToolUseId);
        expect(ids).toEqual(['toolu_background']);
      });

      it.each<SubagentRecord['status']>([
        'running',
        'pending',
        'paused',
      ])('excludes foreground status: %s', (status) => {
        startPlainSubagent(`toolu_foreground_${status}`, status);
        mockActiveTab.set(null);
        const ids = store
          .activeSessionSubagents()
          .map((r) => r.parentToolUseId);
        expect(ids).not.toContain(`toolu_foreground_${status}`);
      });

      it('includes a running record once its Task tool call is backgrounded reactively', () => {
        startPlainSubagent('toolu_backgrounded', 'running');
        expect(store.activeSessionSubagents()).toEqual([]);

        markTaskBackgrounded('toolu_backgrounded', 'sess-A');

        expect(store.activeSessionSubagents().map((r) => r.parentToolUseId)).toEqual([
          'toolu_backgrounded',
        ]);
      });

      it('excludes a completed record even while its Task tool call remains backgrounded', () => {
        startPlainSubagent('toolu_completed_background', 'completed', 'sess-A');
        backgroundAgentStore.onStarted({
          toolCallId: 'toolu_completed_background',
          agentId: 'completed-background-agent',
          agentType: 'Explore',
          agentDescription: 'explore',
          sessionId: 'sess-A',
          timestamp: 2,
        } as BackgroundAgentStartedEvent);

        mockActiveTab.set({ claudeSessionId: 'sess-A' });

        expect(store.activeSessionSubagents()).toEqual([]);
        expect(store.sessionSubagentsForSession('sess-A')).toEqual([]);
      });

      it('scopes by active session and shows unowned subagents in all sessions', () => {
        startPlainSubagent('toolu_sess_a', 'running', 'sess-A');
        startPlainSubagent('toolu_sess_b', 'running', 'sess-B');
        startPlainSubagent('toolu_unowned', 'running');
        markTaskBackgrounded('toolu_sess_a', 'sess-A');
        markTaskBackgrounded('toolu_sess_b', 'sess-B');
        markTaskBackgrounded('toolu_unowned');

        mockActiveTab.set({ claudeSessionId: 'sess-A' });
        const ids = store
          .activeSessionSubagents()
          .map((r) => r.parentToolUseId)
          .sort();
        expect(ids).toEqual(['toolu_sess_a', 'toolu_unowned']);
      });

      it('sessionSubagentsForSession filters by exact sessionId and handles unresolved scope', () => {
        startPlainSubagent('toolu_a', 'running', 'sess-A');
        startPlainSubagent('toolu_b', 'running', 'sess-B');
        markTaskBackgrounded('toolu_a', 'sess-A');
        markTaskBackgrounded('toolu_b', 'sess-B');

        expect(
          store
            .sessionSubagentsForSession('sess-A')
            .map((r) => r.parentToolUseId),
        ).toEqual(['toolu_a']);

        expect(store.sessionSubagentsForSession('')).toEqual([]);
        expect(store.sessionSubagentsForSession(null)).toEqual([]);
        expect(store.sessionSubagentsForSession(undefined)).toEqual([]);
      });
    });
  });

  describe('Phase 3 — bidirectional messaging actions', () => {
    const PARENT = 'toolu_parent_abc';
    const TASK = 'task_xyz';
    const SESSION = 'session-active';

    beforeEach(() => {
      mockActiveTab.set({ claudeSessionId: SESSION });
      store.onAgentStart({
        eventType: 'agent_start',
        id: 'a',
        timestamp: 1,
        toolCallId: PARENT,
        agentType: 'Explore',
        agentDescription: 'Explore',
        agentId: 'short-1',
        source: 'hook',
        taskId: TASK,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    });

    it('sendMessageToAgent dispatches subagent:send-message RPC with active session', async () => {
      rpcMock.call.mockResolvedValueOnce(rpcSuccess({ ok: true } as const));
      await store.sendMessageToAgent(PARENT, 'hello');
      expect(rpcMock.call).toHaveBeenCalledWith('subagent:send-message', {
        sessionId: SESSION,
        parentToolUseId: PARENT,
        text: 'hello',
      });
      expect(store.subagentRpcError()).toBeNull();
    });

    it('sendMessageToAgent surfaces error on RPC failure', async () => {
      rpcMock.call.mockResolvedValueOnce(rpcError('nope'));
      await store.sendMessageToAgent(PARENT, 'hello');
      const err = store.subagentRpcError();
      expect(err?.method).toBe('subagent:send-message');
      expect(err?.message).toBe('nope');
    });

    it('stopAgent dispatches subagent:stop with the supplied taskId', async () => {
      rpcMock.call.mockResolvedValueOnce(rpcSuccess({ ok: true } as const));
      await store.stopAgent(TASK);
      expect(rpcMock.call).toHaveBeenCalledWith('subagent:stop', {
        sessionId: SESSION,
        taskId: TASK,
      });
    });

    it('sendMessageToAgent targets an explicit owning session over the active tab', async () => {
      rpcMock.call.mockResolvedValueOnce(rpcSuccess({ ok: true } as const));
      await store.sendMessageToAgent(PARENT, 'hi', 'sess-owner');
      expect(rpcMock.call).toHaveBeenCalledWith('subagent:send-message', {
        sessionId: 'sess-owner',
        parentToolUseId: PARENT,
        text: 'hi',
      });
    });

    it('stopAgent targets an explicit owning session over the active tab', async () => {
      rpcMock.call.mockResolvedValueOnce(rpcSuccess({ ok: true } as const));
      await store.stopAgent(TASK, 'sess-owner');
      expect(rpcMock.call).toHaveBeenCalledWith('subagent:stop', {
        sessionId: 'sess-owner',
        taskId: TASK,
      });
    });

    it('backgroundAgent dispatches subagent:background for the given session', async () => {
      rpcMock.call.mockResolvedValueOnce(
        rpcSuccess({ backgrounded: true } as const),
      );
      const ok = await store.backgroundAgent('sess-owner', PARENT);
      expect(rpcMock.call).toHaveBeenCalledWith('subagent:background', {
        sessionId: 'sess-owner',
        toolUseId: PARENT,
      });
      expect(ok).toBe(true);
    });

    it('interruptSession dispatches subagent:interrupt for the active session', async () => {
      rpcMock.call.mockResolvedValueOnce(rpcSuccess({ ok: true } as const));
      await store.interruptSession();
      expect(rpcMock.call).toHaveBeenCalledWith('subagent:interrupt', {
        sessionId: SESSION,
      });
    });

    it('sendMessageToAgent fails fast when there is no active session', async () => {
      mockActiveTab.set(null);
      await store.sendMessageToAgent(PARENT, 'hello');
      expect(rpcMock.call).not.toHaveBeenCalled();
      expect(store.subagentRpcError()?.method).toBe('subagent:send-message');
    });

    it('does NOT mutate per-record status optimistically — SDK events drive UI', async () => {
      rpcMock.call.mockResolvedValueOnce(rpcSuccess({ ok: true } as const));
      const before = store.subagents().get(PARENT)?.status;
      await store.stopAgent(TASK);
      const after = store.subagents().get(PARENT)?.status;
      expect(after).toBe(before); // unchanged — waits for agent_completed
    });
  });

  describe('continueAgent', () => {
    it('calls agent:continue with agentId + message and maps success', async () => {
      rpcMock.call.mockResolvedValueOnce(rpcSuccess({ success: true }));

      const result = await store.continueAgent('agent-1', 'do more');

      expect(rpcMock.call).toHaveBeenCalledWith('agent:continue', {
        agentId: 'agent-1',
        message: 'do more',
      });
      expect(result).toEqual({ ok: true, code: undefined });
    });

    it('reports a refusal as ok=false, carrying its typed code', async () => {
      // The handler answers a refusal as a transport SUCCESS whose payload says
      // `success: false`. Reading only the envelope reports every refusal as a
      // sent message, and the caller clears the user's draft over a follow-up
      // that never reached the agent.
      rpcMock.call.mockResolvedValueOnce(
        rpcSuccess({ success: false, code: 'busy' }),
      );

      const result = await store.continueAgent('agent-1', 'do more');

      expect(result.ok).toBe(false);
      expect(result.code).toBe('busy');
    });

    it('reports ok=false when the RPC itself fails', async () => {
      rpcMock.call.mockResolvedValueOnce(rpcError<unknown>('boom'));

      const result = await store.continueAgent('agent-1', 'do more');

      expect(result.ok).toBe(false);
      expect(result.code).toBeUndefined();
    });
  });

  describe('agent:spawned re-open idempotency', () => {
    function spawnWith(overrides: Record<string, unknown>): void {
      store.onAgentSpawned({
        agentId: 'agent-x',
        cli: 'codex',
        task: 'Task for agent-x',
        status: 'running',
        startedAt: Date.now(),
        displayName: 'Codex',
        ...overrides,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    }

    it('flips an existing completed agent back to running without duplicating the card', () => {
      spawnWith({ supportsContinuation: true });
      store.onAgentExited({
        agentId: 'agent-x',
        cli: 'codex',
        task: 'Task for agent-x',
        status: 'completed',
        startedAt: Date.now(),
        exitCode: 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const completed = store.agents().find((a) => a.agentId === 'agent-x');
      expect(completed?.status).toBe('completed');
      expect(completed?.completedAt).toBeDefined();

      spawnWith({ status: 'running', supportsContinuation: true });

      const cards = store.agents().filter((a) => a.agentId === 'agent-x');
      expect(cards.length).toBe(1);
      expect(cards[0].status).toBe('running');
      expect(cards[0].completedAt).toBeUndefined();
      expect(cards[0].exitCode).toBeUndefined();
    });

    it('preserves supportsContinuation across spawn → exit', () => {
      spawnWith({ supportsContinuation: true });
      store.onAgentExited({
        agentId: 'agent-x',
        cli: 'codex',
        task: 'Task for agent-x',
        status: 'completed',
        startedAt: Date.now(),
        exitCode: 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const card = store.agents().find((a) => a.agentId === 'agent-x');
      expect(card?.supportsContinuation).toBe(true);
    });

    it('marks the card expired when the backend drops the record, and un-marks it on re-open', () => {
      spawnWith({ supportsContinuation: true });

      store.onAgentExpired('agent-x');
      expect(
        store.agents().find((a) => a.agentId === 'agent-x')
          ?.continuationExpired,
      ).toBe(true);

      // The backend is tracking the id again — the sweep is undone, not sticky.
      spawnWith({ status: 'running', supportsContinuation: true });
      expect(
        store.agents().find((a) => a.agentId === 'agent-x')
          ?.continuationExpired,
      ).toBe(false);
    });

    it('ignores an expiry for an id it has no card for', () => {
      spawnWith({ supportsContinuation: true });
      const before = store.agents();

      store.onAgentExpired('never-seen');

      expect(store.agents()).toBe(before);
    });
  });

  describe('resumeAgentWithMessage', () => {
    const expired = {
      agentId: 'agent-x',
      cli: 'codex' as const,
      task: 'the original task',
      cliSessionId: 'session-9',
      parentSessionId: 'parent-1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    it('resumes the session with the follow-up as the run task', async () => {
      rpcMock.call.mockResolvedValueOnce(
        rpcSuccess({ success: true, agentId: 'agent-y' }),
      );

      const result = await store.resumeAgentWithMessage(expired, 'do more');

      expect(rpcMock.call).toHaveBeenCalledWith('agent:resumeCliSession', {
        cliSessionId: 'session-9',
        cli: 'codex',
        // The follow-up IS the resumed run's task — history comes from the
        // session id, not from re-sending the original prompt.
        task: 'do more',
        parentSessionId: 'parent-1',
        ptahCliId: undefined,
        previousAgentId: 'agent-x',
      });
      expect(result.ok).toBe(true);
    });

    it('refuses without a session id rather than spawning a contextless agent', async () => {
      const result = await store.resumeAgentWithMessage(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { ...expired, cliSessionId: undefined } as any,
        'do more',
      );

      expect(rpcMock.call).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      expect(result.error).toContain('no session to resume');
    });

    it('surfaces a handler-level failure verbatim', async () => {
      rpcMock.call.mockResolvedValueOnce(
        rpcSuccess({ success: false, error: 'no such session file' }),
      );

      const result = await store.resumeAgentWithMessage(expired, 'do more');

      expect(result).toEqual({ ok: false, error: 'no such session file' });
    });
  });

  describe('N6 per-agent usage, context and cache data', () => {
    const PARENT = 'toolu_usage_1';
    const NOW = 1_000_000_000;

    function start(timestamp = NOW - 10_000): void {
      store.onAgentStart({
        eventType: 'agent_start',
        id: 'start-usage',
        timestamp,
        toolCallId: PARENT,
        agentType: 'Explore',
        agentDescription: 'Explore',
        agentId: 'short-usage',
        source: 'hook',
      } as AgentStartEvent);
    }

    function complete(
      messageId: string,
      tokenUsage: Record<string, number> | undefined,
      overrides: Partial<MessageCompleteEvent> = {},
    ): MessageCompleteEvent {
      return {
        id: `mc-${messageId}`,
        eventType: 'message_complete',
        timestamp: NOW - 5_000,
        sessionId: 'sess-usage',
        messageId,
        source: 'complete',
        parentToolUseId: PARENT,
        model: 'gpt-4o',
        tokenUsage,
        ...overrides,
      } as MessageCompleteEvent;
    }

    function view(now = NOW) {
      const record = store.getSubagent(PARENT);
      if (!record) throw new Error('record missing');
      return subagentUsageView(record, now);
    }

    function answerQuery(subagent: Record<string, unknown> | null): void {
      rpcMock.call.mockResolvedValueOnce(
        rpcSuccess({
          subagents: subagent ? [{ toolCallId: PARENT, ...subagent }] : [],
        } as never),
      );
    }

    it('gives every CLI lane card "not reported" cache data and no context size', () => {
      spawnAgent('lane-1', 'sess-lanes');
      store.loadCliSessions(
        [
          {
            agentId: 'lane-2',
            cli: 'codex',
            task: 'restored',
            startedAt: '2026-09-01T00:00:00.000Z',
            status: 'completed',
          } as unknown as CliSessionReference,
        ],
        'sess-lanes',
      );

      for (const id of ['lane-1', 'lane-2']) {
        const lane = store.agentsById().get(id);
        expect(lane?.cacheState).toBe('unknown');
        expect(lane?.cacheReported).toBe(false);
        expect(lane?.contextTokens).toBeUndefined();
      }
    });

    it('sums usage per message and sizes the context from the last request', () => {
      start();
      store.onSubagentMessageComplete(
        complete('m1', {
          input: 2,
          output: 20,
          cacheRead: 0,
          cacheCreation: 40_000,
        }),
      );
      store.onSubagentMessageComplete(
        complete('m2', {
          input: 3,
          output: 30,
          cacheRead: 40_000,
          cacheCreation: 500,
        }),
      );

      const v = view();
      expect(v.contextTokens).toBe(3 + 40_000 + 500);
      expect(v.cacheReported).toBe(true);
      expect(v.usage).toEqual({
        cacheRead: 40_000,
        cacheWrite: 40_500,
        output: 50,
      });
      expect(v.estimatedCostUsd).toBe(
        calculateMessageCost('gpt-4o', {
          input: 5,
          output: 50,
          cacheHit: 40_000,
          cacheCreation: 40_500,
        }),
      );
      expect(typeof v.estimatedCostUsd).toBe('number');
    });

    it('uses the backend contextTokens when present, ignoring the local sum', () => {
      start();
      store.onSubagentMessageComplete(
        complete('m1', {
          input: 3,
          output: 30,
          cacheRead: 40_000,
          cacheCreation: 500,
          contextTokens: 12_345,
        }),
      );

      expect(view().contextTokens).toBe(12_345);
    });

    it('uses the backend contextTokens even when cache fields are absent', () => {
      start();
      store.onSubagentMessageComplete(
        complete('m1', { input: 3, output: 30, contextTokens: 777 }),
      );

      expect(view().contextTokens).toBe(777);
    });

    it('falls back to the local sum when a later event lacks contextTokens', () => {
      start();
      store.onSubagentMessageComplete(
        complete('m1', {
          input: 1,
          output: 1,
          cacheRead: 1,
          cacheCreation: 1,
          contextTokens: 9_999,
        }),
      );
      store.onSubagentMessageComplete(
        complete('m2', {
          input: 3,
          output: 30,
          cacheRead: 40_000,
          cacheCreation: 500,
        }),
      );

      expect(view().contextTokens).toBe(3 + 40_000 + 500);
    });

    it('replaces a repeated report of the same message instead of adding it again', () => {
      start();
      store.onSubagentMessageComplete(
        complete('m1', {
          input: 2,
          output: 5,
          cacheRead: 10,
          cacheCreation: 1,
        }),
      );
      store.onSubagentMessageComplete(
        complete('m1', {
          input: 2,
          output: 9,
          cacheRead: 10,
          cacheCreation: 1,
        }),
      );

      expect(view().usage).toEqual({ cacheRead: 10, cacheWrite: 1, output: 9 });
    });

    it('keeps cache tokens and context undefined, never 0, when no message reports them', () => {
      start();
      store.onSubagentMessageComplete(complete('m1', { input: 7, output: 3 }));

      const v = view();
      expect(v.cacheReported).toBe(false);
      expect(v.contextTokens).toBeUndefined();
      expect(v.usage).toEqual({
        cacheRead: undefined,
        cacheWrite: undefined,
        output: 3,
      });
    });

    it('reports no usage and no estimate before any message reports usage', () => {
      start();
      store.onSubagentMessageComplete(
        complete('m1', undefined, { source: 'stream' }),
      );

      const v = view();
      expect(v.usage).toBeUndefined();
      expect(v.estimatedCostUsd).toBeUndefined();
      expect(v.cacheReported).toBe(false);
    });

    it('returns a null estimate for an unpriced model', () => {
      start();
      store.onSubagentMessageComplete(
        complete(
          'm1',
          { input: 1, output: 1, cacheRead: 1, cacheCreation: 1 },
          { model: 'unpriced-model-n6' },
        ),
      );
      expect(view().estimatedCostUsd).toBeNull();
    });

    it('ignores malformed usage numbers from the host', () => {
      start();
      store.onSubagentMessageComplete(
        complete('m1', { input: Number.NaN, output: 1 }),
      );
      store.onSubagentMessageComplete(
        complete('m2', { input: 1, output: 1, cacheRead: -5 }),
      );
      expect(view().usage).toEqual({
        cacheRead: undefined,
        cacheWrite: undefined,
        output: 1,
      });
    });

    it('applies usage reported before the subagent record existed', () => {
      store.onSubagentMessageComplete(
        complete('m1', { input: 1, output: 4, cacheRead: 2, cacheCreation: 3 }),
      );
      expect(store.getSubagent(PARENT)).toBeUndefined();

      start();
      expect(view().usage).toEqual({ cacheRead: 2, cacheWrite: 3, output: 4 });
    });

    it('ignores a main-session message', () => {
      start();
      store.onSubagentMessageComplete(
        complete('m1', { input: 1, output: 1 }, { parentToolUseId: undefined }),
      );
      expect(view().usage).toBeUndefined();
    });

    it('shows cache state "unknown" until the effective TTL is known', () => {
      start();
      const v = view();
      expect(v.cacheState).toBe('unknown');
      expect(v.effectiveTtl).toBeUndefined();
      expect(v.idleMs).toBeUndefined();
    });

    it('loads the TTL with one subagent query and measures warm/cold from the last event', async () => {
      start(NOW - 10_000);
      store.onSubagentMessageComplete(
        complete(
          'm1',
          { input: 1, output: 1 },
          { timestamp: NOW - 4 * 60_000 },
        ),
      );
      answerQuery({
        cacheInfo: { cacheState: 'cold', effectiveTtl: '5m', idleMs: 0 },
      });

      await store.loadSubagentCacheInfo(PARENT);

      expect(rpcMock.call).toHaveBeenCalledTimes(1);
      expect(rpcMock.call).toHaveBeenCalledWith('chat:subagent-query', {
        toolCallId: PARENT,
      });
      // The latest activity is the agent_start at NOW - 10 s.
      expect(view()).toMatchObject({
        cacheState: 'warm',
        effectiveTtl: '5m',
        idleMs: 10_000,
      });
      expect(view(NOW - 10_000 + 5 * 60_000).cacheState).toBe('cold');
    });

    it('moves the activity time forward to the host lastActivityAt', async () => {
      start(NOW - 30 * 60_000);
      answerQuery({
        lastActivityAt: NOW - 1_000,
        cacheInfo: { cacheState: 'warm', effectiveTtl: '1h', idleMs: 1_000 },
      });

      await store.loadSubagentCacheInfo(PARENT);

      expect(view()).toMatchObject({
        cacheState: 'warm',
        idleMs: 1_000,
        effectiveTtl: '1h',
      });
    });

    it('treats a record with no activity as cold with an unknown idle time', async () => {
      start(Number.NaN);
      answerQuery({
        cacheInfo: { cacheState: 'cold', effectiveTtl: '5m', idleMs: 0 },
      });

      await store.loadSubagentCacheInfo(PARENT);

      const v = view();
      expect(v.cacheState).toBe('cold');
      expect(v.idleMs).toBeUndefined();
    });

    it('stays "unknown" when the query fails, misses, or carries no valid cacheInfo', async () => {
      start();
      rpcMock.call.mockResolvedValueOnce(rpcError('boom'));
      await store.loadSubagentCacheInfo(PARENT);
      answerQuery(null);
      await store.loadSubagentCacheInfo(PARENT);
      answerQuery({});
      await store.loadSubagentCacheInfo(PARENT);
      answerQuery({
        cacheInfo: { cacheState: 'warm', effectiveTtl: '2h', idleMs: 0 },
      });
      await store.loadSubagentCacheInfo(PARENT);

      expect(view().cacheState).toBe('unknown');
    });

    it('keeps usage, TTL and activity across later lifecycle events', async () => {
      start(NOW - 10_000);
      store.onSubagentMessageComplete(
        complete('m1', { input: 1, output: 2, cacheRead: 3, cacheCreation: 4 }),
      );
      answerQuery({
        cacheInfo: { cacheState: 'warm', effectiveTtl: '5m', idleMs: 0 },
      });
      await store.loadSubagentCacheInfo(PARENT);

      store.onAgentProgress({
        eventType: 'agent_progress',
        id: 'p',
        timestamp: NOW - 1_000,
        parentToolUseId: PARENT,
      } as AgentProgressEvent);
      store.onAgentStatus({
        eventType: 'agent_status',
        id: 's',
        timestamp: NOW - 2_000,
        parentToolUseId: PARENT,
        status: 'running',
      } as AgentStatusEvent);
      store.onAgentCompleted({
        eventType: 'agent_completed',
        id: 'c',
        timestamp: NOW - 500,
        parentToolUseId: PARENT,
        status: 'completed',
      } as AgentCompletedEvent);

      const record = store.getSubagent(PARENT);
      expect(record?.lastEventAt).toBe(NOW - 500);
      expect(record?.cacheTtl).toBe('5m');
      expect(view().usage).toEqual({ cacheRead: 3, cacheWrite: 4, output: 2 });
    });
  });
});
