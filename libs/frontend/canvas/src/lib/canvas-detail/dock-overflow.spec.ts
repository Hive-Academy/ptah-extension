import type { SessionAgent } from '@ptah-extension/chat';
import { dockCapacity, planDockOverflow } from './dock-overflow';

describe('inspector roster overflow', () => {
  it.each([300, 360, 400, 480, 560])(
    'retains selection and every menu entry at %ipx',
    (width) => {
      const agents: SessionAgent[] = Array.from({ length: 12 }, (_, i) => ({
        key: i === 0 ? 'orchestrator' : `cli:${i}`,
        kind: i === 0 ? 'orchestrator' : 'cli',
        name: `Agent ${i}`,
        status: 'running',
        cliId: null,
        agentType: null,
        startedAt: null,
        endedAt: null,
        activity: null,
        openRequestIds: [],
      }));
      const { visible, hidden } = planDockOverflow(
        agents,
        'cli:11',
        dockCapacity(width),
      );
      expect(visible.some((agent) => agent.key === 'cli:11')).toBe(true);
      expect(
        new Set([...visible, ...hidden].map((agent) => agent.key)).size,
      ).toBe(12);
      expect(hidden.length).toBeGreaterThan(0);
    },
  );
});
