/**
 * AgentMonitorStore — regressions for the empty-string session id (TASK_2026_295).
 *
 * The backend can emit `sessionId: ''` / `parentSessionId: ''` before the SDK
 * session UUID resolves. `''` is neither nullish nor truthy, so it slipped past
 * `??` fallbacks AND failed `!x` guards, producing four distinct user-visible
 * failures. Every spec here pins one of those failures, not the happy path.
 */

import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { createMockRpcService, rpcSuccess } from '@ptah-extension/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import type {
  AgentProcessInfo,
  AgentProgressEvent,
  AgentStartEvent,
} from '@ptah-extension/shared';
import { AgentMonitorStore } from './agent-monitor.store';

const ACTIVE_SESSION = 'session-active';
const OTHER_SESSION = 'session-other';
const PARENT_TOOL_USE = 'toolu_parent';

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

function processInfo(overrides: Partial<AgentProcessInfo>): AgentProcessInfo {
  return {
    agentId: 'agent-1',
    cli: 'codex',
    task: 'Fix the failing tests',
    status: 'running',
    startedAt: new Date().toISOString(),
    ...overrides,
  } as AgentProcessInfo;
}

function agentStart(sessionId: string): AgentStartEvent {
  return {
    id: 'evt-agent-start',
    eventType: 'agent_start',
    timestamp: 1,
    sessionId,
    toolCallId: PARENT_TOOL_USE,
    agentId: 'adcecb7',
    agentDescription: 'Fix the failing tests',
    teammateName: 'tester',
  } as AgentStartEvent;
}

function agentProgress(sessionId: string): AgentProgressEvent {
  return {
    id: 'evt-agent-progress',
    eventType: 'agent_progress',
    timestamp: 2,
    sessionId,
    parentToolUseId: PARENT_TOOL_USE,
    summary: 'still working',
  } as AgentProgressEvent;
}

describe('AgentMonitorStore — empty-string session ids', () => {
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
    mockActiveTab.set({ claudeSessionId: ACTIVE_SESSION });
  });

  describe('steering an interrupted subagent (the reported symptom)', () => {
    it('sendMessageToAgent falls back to the active tab when the record carries an empty owner', async () => {
      rpcMock.call.mockResolvedValueOnce(rpcSuccess({ ok: true } as const));

      // Callers hand us `SubagentRecord.parentSessionId` verbatim. `''` used to
      // survive the `??` and then fail the `!sid` guard, so the user saw
      // "No active session — cannot send message to subagent".
      const sent = await store.sendMessageToAgent(
        PARENT_TOOL_USE,
        'keep going',
        '',
      );

      expect(sent).toBe(true);
      expect(store.subagentRpcError()).toBeNull();
      expect(rpcMock.call).toHaveBeenCalledWith('subagent:send-message', {
        sessionId: ACTIVE_SESSION,
        parentToolUseId: PARENT_TOOL_USE,
        text: 'keep going',
      });
    });

    it('stopAgent falls back to the active tab when the record carries an empty owner', async () => {
      rpcMock.call.mockResolvedValueOnce(rpcSuccess({ ok: true } as const));

      await store.stopAgent('task-9', '');

      expect(store.subagentRpcError()).toBeNull();
      expect(rpcMock.call).toHaveBeenCalledWith('subagent:stop', {
        sessionId: ACTIVE_SESSION,
        taskId: 'task-9',
      });
    });

    it('backgroundAgent falls back to the active tab when the record carries an empty owner', async () => {
      rpcMock.call.mockResolvedValueOnce(
        rpcSuccess({ backgrounded: true } as const),
      );

      const ok = await store.backgroundAgent('', PARENT_TOOL_USE);

      expect(ok).toBe(true);
      expect(rpcMock.call).toHaveBeenCalledWith('subagent:background', {
        sessionId: ACTIVE_SESSION,
        toolUseId: PARENT_TOOL_USE,
      });
    });

    it('still refuses when there is genuinely no session anywhere', async () => {
      mockActiveTab.set(null);

      const sent = await store.sendMessageToAgent(PARENT_TOOL_USE, 'hi', '');

      expect(sent).toBe(false);
      expect(store.subagentRpcError()?.method).toBe('subagent:send-message');
      expect(rpcMock.call).not.toHaveBeenCalled();
    });
  });

  describe('resuming an interrupted CLI agent', () => {
    it('replaces the interrupted card instead of duplicating it when the old card has no owner', () => {
      store.onAgentSpawned(
        processInfo({
          agentId: 'agent-old',
          cliSessionId: 'cli-session-1',
          parentSessionId: '',
        }),
      );
      store.onAgentExited(
        processInfo({
          agentId: 'agent-old',
          cliSessionId: 'cli-session-1',
          parentSessionId: '',
          status: 'interrupted',
        }),
      );

      // The resume spawn carries the real UUID the interrupted card never got.
      store.onAgentSpawned(
        processInfo({
          agentId: 'agent-new',
          cliSessionId: 'cli-session-1',
          parentSessionId: ACTIVE_SESSION,
        }),
      );

      const ids = store.agents().map((a) => a.agentId);
      expect(ids).toEqual(['agent-new']);
      expect(store.agents()[0].parentSessionId).toBe(ACTIVE_SESSION);
      expect(
        store.isAgentResumed(
          undefined,
          undefined,
          'Fix the failing tests',
          ACTIVE_SESSION,
        ),
      ).toBe(true);
    });

    it('replaces the interrupted card when the RESUME spawn is the one with no owner', () => {
      store.onAgentSpawned(
        processInfo({
          agentId: 'agent-old',
          cliSessionId: 'cli-session-2',
          parentSessionId: ACTIVE_SESSION,
        }),
      );
      store.onAgentExited(
        processInfo({
          agentId: 'agent-old',
          cliSessionId: 'cli-session-2',
          parentSessionId: ACTIVE_SESSION,
          status: 'interrupted',
        }),
      );

      store.onAgentSpawned(
        processInfo({
          agentId: 'agent-new',
          cliSessionId: 'cli-session-2',
          parentSessionId: '',
        }),
      );

      expect(store.agents().map((a) => a.agentId)).toEqual(['agent-new']);
      // The known owner survives the ownerless respawn.
      expect(store.agents()[0].parentSessionId).toBe(ACTIVE_SESSION);
    });

    it('does NOT replace a card whose owner is known and different', () => {
      store.onAgentSpawned(
        processInfo({
          agentId: 'agent-old',
          cliSessionId: 'cli-session-3',
          parentSessionId: OTHER_SESSION,
        }),
      );
      store.onAgentExited(
        processInfo({
          agentId: 'agent-old',
          cliSessionId: 'cli-session-3',
          parentSessionId: OTHER_SESSION,
          status: 'interrupted',
        }),
      );

      store.onAgentSpawned(
        processInfo({
          agentId: 'agent-new',
          cliSessionId: 'cli-session-3',
          parentSessionId: ACTIVE_SESSION,
        }),
      );

      expect(
        store
          .agents()
          .map((a) => a.agentId)
          .sort(),
      ).toEqual(['agent-new', 'agent-old']);
    });
  });

  describe('a late empty event never erases a captured owner', () => {
    it('keeps the subagent record owner when a later event arrives with an empty sessionId', () => {
      store.onAgentStart(agentStart(ACTIVE_SESSION));
      expect(store.getSubagent(PARENT_TOOL_USE)?.parentSessionId).toBe(
        ACTIVE_SESSION,
      );

      store.onAgentProgress(agentProgress(''));

      // `'' ?? existing` yields `''`, which retroactively broke steer/stop and
      // the transcript affordance for an agent that had been working fine.
      expect(store.getSubagent(PARENT_TOOL_USE)?.parentSessionId).toBe(
        ACTIVE_SESSION,
      );
    });

    it('never stores the empty string as a monitored agent owner', () => {
      store.onAgentSpawned(processInfo({ parentSessionId: '' }));
      expect(store.agents()[0].parentSessionId).toBeUndefined();
    });

    it('adopts the owner from the exit payload when the spawn had none', () => {
      store.onAgentSpawned(processInfo({ parentSessionId: '' }));
      store.onAgentExited(
        processInfo({ parentSessionId: ACTIVE_SESSION, status: 'completed' }),
      );
      expect(store.agents()[0].parentSessionId).toBe(ACTIVE_SESSION);
    });
  });

  describe('the four scoping predicates agree', () => {
    beforeEach(() => {
      store.onAgentSpawned(
        processInfo({ agentId: 'ownerless', parentSessionId: '' }),
      );
      store.onAgentSpawned(
        processInfo({ agentId: 'mine', parentSessionId: ACTIVE_SESSION }),
      );
      store.onAgentSpawned(
        processInfo({ agentId: 'theirs', parentSessionId: OTHER_SESSION }),
      );
    });

    it('shows an unattributed agent in BOTH the active-tab view and the per-session view', () => {
      expect(
        store
          .activeTabAgents()
          .map((a) => a.agentId)
          .sort(),
      ).toEqual(['mine', 'ownerless']);
      // Used to be strict `===`, so the same agent rendered in every tab by one
      // view and in no tab by the other.
      expect(
        store
          .agentsForSession(ACTIVE_SESSION)
          .map((a) => a.agentId)
          .sort(),
      ).toEqual(['mine', 'ownerless']);
    });

    it('hides a foreign-session agent from both views', () => {
      expect(store.activeTabAgents().map((a) => a.agentId)).not.toContain(
        'theirs',
      );
      expect(
        store.agentsForSession(ACTIVE_SESSION).map((a) => a.agentId),
      ).not.toContain('theirs');
    });

    it('applies the same rule to both workflow-subagent selectors', () => {
      const withRun = (toolUseId: string, sessionId: string): AgentStartEvent =>
        ({
          ...agentStart(sessionId),
          toolCallId: toolUseId,
          workflowRunId: 'run-1',
        }) as AgentStartEvent;

      store.onAgentStart(withRun('toolu_ownerless', ''));
      store.onAgentStart(withRun('toolu_mine', ACTIVE_SESSION));
      store.onAgentStart(withRun('toolu_theirs', OTHER_SESSION));

      const activeIds = store
        .activeWorkflowSubagents()
        .map((r) => r.parentToolUseId)
        .sort();
      const scopedIds = store
        .workflowSubagentsForSession(ACTIVE_SESSION)
        .map((r) => r.parentToolUseId)
        .sort();

      expect(activeIds).toEqual(['toolu_mine', 'toolu_ownerless']);
      expect(scopedIds).toEqual(activeIds);
    });
  });

  describe('the resumed-agent badge is session-scoped', () => {
    it('does not badge another session`s identically described agent as Resumed', () => {
      store.onAgentSpawned(
        processInfo({
          agentId: 'agent-old',
          cliSessionId: 'cli-session-4',
          parentSessionId: OTHER_SESSION,
        }),
      );
      store.onAgentExited(
        processInfo({
          agentId: 'agent-old',
          cliSessionId: 'cli-session-4',
          parentSessionId: OTHER_SESSION,
          status: 'interrupted',
        }),
      );
      store.onAgentSpawned(
        processInfo({
          agentId: 'agent-new',
          cliSessionId: 'cli-session-4',
          parentSessionId: OTHER_SESSION,
        }),
      );

      // The read used to be `key.endsWith('::' + task)`, throwing the session
      // prefix away — every session showed "Resumed" for this description.
      expect(
        store.isAgentResumed(
          undefined,
          undefined,
          'Fix the failing tests',
          ACTIVE_SESSION,
        ),
      ).toBe(false);
      expect(
        store.isAgentResumed(
          undefined,
          undefined,
          'Fix the failing tests',
          OTHER_SESSION,
        ),
      ).toBe(true);
    });

    it('bounds the resumed-node-id set so it cannot grow forever', () => {
      const ids = Array.from({ length: 600 }, (_, i) => `node-${i}`);
      store.markAgentNodesResumed(ids);

      expect(store.isAgentResumed('node-0', undefined, 'x')).toBe(false);
      expect(store.isAgentResumed('node-599', undefined, 'x')).toBe(true);
    });
  });
});
