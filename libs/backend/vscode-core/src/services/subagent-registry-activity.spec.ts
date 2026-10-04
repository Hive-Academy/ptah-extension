/**
 * SubagentRegistryService specs — `lastActivityAt` stamping (TASK_2026_597 N2).
 *
 * The registry stamps activity on register() and on every update(), including
 * the SubagentStop completion that is ignored during session teardown. Restore
 * and history replay keep a carried value and otherwise leave it unset (cold).
 */

import 'reflect-metadata';

import type {
  AgentStartEvent,
  FlatStreamEventUnion,
  SubagentRecord,
} from '@ptah-extension/shared';
import type { Logger } from '../logging';
import { SubagentRegistryService } from './subagent-registry.service';

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

const T0 = 1_700_000_000_000;

describe('SubagentRegistryService lastActivityAt', () => {
  let service: SubagentRegistryService;
  let now: number;
  let nowSpy: jest.SpyInstance<number, []>;

  beforeEach(() => {
    now = T0;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    service = new SubagentRegistryService(makeLogger());
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  function register(toolCallId = 'tc-1', parentSessionId = 'parent-1'): void {
    service.register({
      toolCallId,
      agentType: 'Explore',
      agentId: `a-${toolCallId}`,
      parentSessionId,
      startedAt: T0,
    });
  }

  it('stamps lastActivityAt on register', () => {
    register();
    expect(service.get('tc-1')?.lastActivityAt).toBe(T0);
  });

  it('overrides a lastActivityAt smuggled onto the registration', () => {
    service.register({
      toolCallId: 'tc-1',
      agentType: 'Explore',
      agentId: 'a-1',
      parentSessionId: 'parent-1',
      startedAt: T0,
      lastActivityAt: 1,
    } as never);
    expect(service.get('tc-1')?.lastActivityAt).toBe(T0);
  });

  it('re-stamps on every update', () => {
    register();
    now = T0 + 1_000;
    service.update('tc-1', { isCliAgent: true });
    expect(service.get('tc-1')?.lastActivityAt).toBe(T0 + 1_000);

    now = T0 + 2_000;
    service.update('tc-1', {
      status: 'background',
      isBackground: true,
      backgroundStartedAt: now,
    });
    expect(service.get('tc-1')?.lastActivityAt).toBe(T0 + 2_000);
  });

  it('stamps the SubagentStop completion that teardown keeps as interrupted', () => {
    register();
    now = T0 + 5_000;
    service.beginSessionTeardown('parent-1');
    try {
      service.markAllInterrupted('parent-1');
      now = T0 + 6_000;
      service.update('tc-1', { status: 'completed' });
    } finally {
      service.endSessionTeardown('parent-1');
    }

    const record = service.get('tc-1');
    expect(record?.status).toBe('interrupted');
    expect(record?.lastActivityAt).toBe(T0 + 6_000);
  });

  it('removes a completed record outside teardown (no stale stamp left)', () => {
    register();
    service.update('tc-1', { status: 'completed' });
    expect(service.get('tc-1')).toBeNull();
  });

  it('does nothing for an unknown toolCallId', () => {
    service.update('tc-missing', { isCliAgent: true });
    expect(service.get('tc-missing')).toBeNull();
  });

  describe('restoreResumableBySession', () => {
    function snapshot(overrides: Partial<SubagentRecord>): SubagentRecord {
      return {
        toolCallId: 'tc-r',
        agentType: 'Plan',
        agentId: 'a-r',
        parentSessionId: 'parent-1',
        status: 'interrupted',
        startedAt: T0,
        interruptedAt: T0,
        ...overrides,
      };
    }

    it('keeps a carried lastActivityAt', () => {
      now = T0 + 60_000;
      service.restoreResumableBySession('parent-1', [
        snapshot({ lastActivityAt: T0 + 10 }),
      ]);
      expect(service.get('tc-r')?.lastActivityAt).toBe(T0 + 10);
    });

    it('leaves lastActivityAt unset when the snapshot has none', () => {
      service.restoreResumableBySession('parent-1', [snapshot({})]);
      const record = service.get('tc-r');
      expect(record).not.toBeNull();
      expect(record?.lastActivityAt).toBeUndefined();
    });
  });

  it('history replay leaves lastActivityAt unset (cold)', () => {
    const start = {
      eventType: 'agent_start',
      toolCallId: 'tc-h',
      agentType: 'Explore',
      agentId: 'a-h',
      sessionId: 'sess-1',
      timestamp: T0,
    } as AgentStartEvent;

    const count = service.registerFromHistoryEvents(
      [start as unknown as FlatStreamEventUnion],
      'parent-1',
    );

    expect(count).toBe(1);
    const record = service.get('tc-h');
    expect(record?.status).toBe('interrupted');
    expect(record?.lastActivityAt).toBeUndefined();
  });
});
