import 'reflect-metadata';

import type { Logger } from '../../logging';
import { SubagentRegistryService } from '../subagent-registry.service';
import type { SubagentRegistration } from '../subagent-registry.service';
import {
  SubagentStateStore,
  TTL_MS,
  CLEANUP_INTERVAL_MS,
} from './subagent-state-store';

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function makeReg(
  overrides: Partial<SubagentRegistration> = {},
): SubagentRegistration {
  return {
    toolCallId: 'tc-default',
    agentType: 'test-agent',
    agentId: 'a1',
    startedAt: Date.now(),
    parentSessionId: 'parent-1',
    ...overrides,
  };
}

describe('SubagentStateStore pendingTaskIds', () => {
  let logger: jest.Mocked<Logger>;
  let store: SubagentStateStore;
  let service: SubagentRegistryService;

  beforeEach(() => {
    logger = makeLogger();
    store = new SubagentStateStore(logger);
    service = new SubagentRegistryService(logger);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('buffers a taskId when setTaskId fires before register, then merges it on register', () => {
    service.setTaskId('tc-early', 'task-early');
    service.register(makeReg({ toolCallId: 'tc-early' }));

    const record = service.get('tc-early');
    expect(record).not.toBeNull();
    expect(record?.taskId).toBe('task-early');
    expect(service.findByTaskId('task-early')?.toolCallId).toBe('tc-early');

    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Record not found, cannot set taskId'),
      expect.objectContaining({
        toolCallId: 'tc-early',
        taskId: 'task-early',
        buffered: true,
      }),
    );
  });

  it('consumes a pending taskId once — a second register gets no taskId', () => {
    service.setTaskId('tc-once', 'task-once');
    service.register(makeReg({ toolCallId: 'tc-once' }));

    expect(service.get('tc-once')?.taskId).toBe('task-once');

    service.register(makeReg({ toolCallId: 'tc-once' }));

    expect(service.get('tc-once')?.taskId).toBeUndefined();
    expect(service.findByTaskId('task-once')).toBeUndefined();
  });

  it('registration.taskId wins over a buffered taskId', () => {
    service.setTaskId('tc-wins', 'buffered-task');
    service.register(
      makeReg({ toolCallId: 'tc-wins', taskId: 'explicit-task' }),
    );

    const record = service.get('tc-wins');
    expect(record?.taskId).toBe('explicit-task');
    expect(service.findByTaskId('explicit-task')?.toolCallId).toBe('tc-wins');
    expect(service.findByTaskId('buffered-task')).toBeUndefined();
  });

  it('evicts a pending taskId older than TTL_MS during lazyCleanup', () => {
    jest.useFakeTimers();
    const base = 1_000_000;
    jest.setSystemTime(base);

    store.markPendingTaskId('tc-stale', 'stale-task');
    jest.setSystemTime(base + TTL_MS + CLEANUP_INTERVAL_MS + 1);

    store.lazyCleanup();

    expect(store.consumePendingTaskId('tc-stale')).toBeUndefined();
  });

  it('writes taskId directly when register fires before setTaskId and buffers nothing', () => {
    service.register(makeReg({ toolCallId: 'tc-normal' }));
    service.setTaskId('tc-normal', 'task-normal');

    const record = service.get('tc-normal');
    expect(record?.taskId).toBe('task-normal');
    expect(service.findByTaskId('task-normal')?.toolCallId).toBe('tc-normal');

    expect(logger.debug).not.toHaveBeenCalledWith(
      expect.stringContaining('Record not found, cannot set taskId'),
      expect.anything(),
    );
  });
});
