/**
 * AgentMonitorStore Tests â€” resolveParentSessionId & Session-Scoped Signals
 *
 * Tests the tab ID â†’ real UUID resolution and session-scoped filtering
 * that ensures agents display in the correct tab's sidebar.
 */

import { TestBed } from '@angular/core/testing';
import { AgentMonitorStore } from './agent-monitor.store';
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
} from '@ptah-extension/shared';

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
  let rpcMock: ReturnType<typeof createMockRpcService>;

  beforeEach(() => {
    rpcMock = createMockRpcService();
    TestBed.configureTestingModule({
      providers: [
        AgentMonitorStore,
        { provide: TabManagerService, useValue: mockTabManager },
        { provide: VSCodeService, useValue: mockVSCodeService },
        { provide: ClaudeRpcService, useValue: rpcMock },
      ],
    });

    store = TestBed.inject(AgentMonitorStore);
    mockActiveTab.set(null);
  });

  function spawnAgent(
    agentId: string,
    parentSessionId?: string,
    status: 'running' | 'completed' | 'error' = 'running',
  ): void {
    store.onAgentSpawned({
      agentId,
      cli: 'gemini',
      task: `Task for ${agentId}`,
      parentSessionId,
      status: 'running',
      startedAt: Date.now(),
      displayName: 'Gemini',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    if (status !== 'running') {
      store.onAgentExited({
        agentId,
        cli: 'gemini',
        task: `Task for ${agentId}`,
        parentSessionId,
        status,
        startedAt: Date.now(),
        exitCode: status === 'error' ? 1 : 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    }
  }

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

      // Before resolution: agent has tab_abc, active tab expects real-uuid-xyz â†’ no match
      expect(store.activeTabAgents().length).toBe(0);

      // After resolution: agent now has real-uuid-xyz â†’ matches
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

    it('records are independent per parentToolUseId', () => {
      store.onAgentStart(startEvent({ toolCallId: 'toolu_a' }));
      store.onAgentStart(startEvent({ toolCallId: 'toolu_b' }));
      store.onAgentStatus(
        statusEvent({ parentToolUseId: 'toolu_a', status: 'completed' }),
      );
      expect(store.subagents().get('toolu_a')?.status).toBe('completed');
      expect(store.subagents().get('toolu_b')?.status).toBe('running');
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
});
