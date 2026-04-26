/**
 * AgentMonitorStore Tests â€” resolveParentSessionId & Session-Scoped Signals
 *
 * Tests the tab ID â†’ real UUID resolution and session-scoped filtering
 * that ensures agents display in the correct tab's sidebar.
 */

import { TestBed } from '@angular/core/testing';
import { AgentMonitorStore } from './agent-monitor.store';
import { TabManagerService } from '@ptah-extension/chat-state';
import { VSCodeService } from '@ptah-extension/core';
import { signal, computed } from '@angular/core';

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

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AgentMonitorStore,
        { provide: TabManagerService, useValue: mockTabManager },
        { provide: VSCodeService, useValue: mockVSCodeService },
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
});
