import 'reflect-metadata';

import type { Logger } from '../logging';
import { SubagentRegistryService } from './subagent-registry.service';
import type { SubagentRegistration } from './subagent-registry.service';

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
    sessionId: 'sess-1',
    agentType: 'test-agent',
    agentId: 'a1',
    startedAt: Date.now(),
    parentSessionId: 'parent-1',
    ...overrides,
  };
}

describe('SubagentRegistryService — extended methods', () => {
  let service: SubagentRegistryService;
  let logger: jest.Mocked<Logger>;

  beforeEach(() => {
    logger = makeLogger();
    service = new SubagentRegistryService(logger);
  });

  describe('register', () => {
    it('registers a new foreground subagent with status=running', () => {
      service.register(makeReg({ toolCallId: 'tc-fg' }));

      const record = service.get('tc-fg');
      expect(record).not.toBeNull();
      expect(record?.status).toBe('running');
      expect(record?.isBackground).toBeUndefined();
    });

    it('registers a background subagent when markPendingBackground was called first', () => {
      service.markPendingBackground('tc-bg');
      service.register(makeReg({ toolCallId: 'tc-bg' }));

      const record = service.get('tc-bg');
      expect(record?.status).toBe('background');
      expect(record?.isBackground).toBe(true);
      expect(record?.backgroundStartedAt).toBeGreaterThan(0);
    });
  });

  describe('update', () => {
    it('updates status from running to interrupted', () => {
      service.register(makeReg({ toolCallId: 'tc-u' }));
      service.update('tc-u', { status: 'interrupted', interruptedAt: 1000 });

      const record = service.get('tc-u');
      expect(record?.status).toBe('interrupted');
      expect(record?.interruptedAt).toBe(1000);
    });

    it('removes record when status is completed', () => {
      service.register(makeReg({ toolCallId: 'tc-done' }));
      service.update('tc-done', { status: 'completed' });

      expect(service.get('tc-done')).toBeNull();
    });

    it('removes record when status is background_completed', () => {
      service.register(makeReg({ toolCallId: 'tc-bgdone' }));
      service.update('tc-bgdone', { status: 'background_completed' });

      expect(service.get('tc-bgdone')).toBeNull();
    });

    it('is a no-op when toolCallId is not found', () => {
      expect(() =>
        service.update('tc-missing', { status: 'interrupted' }),
      ).not.toThrow();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('not found by toolCallId'),
        expect.anything(),
      );
    });

    it('updates isBackground, isCliAgent, outputFilePath, backgroundStartedAt, completedAt', () => {
      service.register(makeReg({ toolCallId: 'tc-fields' }));
      service.update('tc-fields', {
        isBackground: true,
        isCliAgent: true,
        outputFilePath: '/tmp/out.txt',
        backgroundStartedAt: 42,
        completedAt: 99,
      });

      const record = service.get('tc-fields') as unknown as Record<
        string,
        unknown
      >;
      expect(record?.['isBackground']).toBe(true);
      expect(record?.['isCliAgent']).toBe(true);
      expect(record?.['outputFilePath']).toBe('/tmp/out.txt');
      expect(record?.['backgroundStartedAt']).toBe(42);
      expect(record?.['completedAt']).toBe(99);
    });
  });

  describe('get', () => {
    it('returns null for unknown toolCallId', () => {
      expect(service.get('tc-nonexistent')).toBeNull();
    });

    it('returns and deletes expired records', () => {
      service.register(makeReg({ toolCallId: 'tc-old', startedAt: 0 }));
      const record = service.get('tc-old');
      expect(record).toBeNull();
      expect(service.size).toBe(0);
    });
  });

  describe('findByTaskId', () => {
    it('returns the record matching taskId', () => {
      service.register(makeReg({ toolCallId: 'tc-task' }));
      service.setTaskId('tc-task', 'sdk-task-123');

      const found = service.findByTaskId('sdk-task-123');
      expect(found?.toolCallId).toBe('tc-task');
    });

    it('returns undefined when no record has that taskId', () => {
      expect(service.findByTaskId('nonexistent-task')).toBeUndefined();
    });
  });

  describe('setTaskId', () => {
    it('associates taskId with an existing record', () => {
      service.register(makeReg({ toolCallId: 'tc-st' }));
      service.setTaskId('tc-st', 'my-task-id');

      const record = service.findByTaskId('my-task-id');
      expect(record).toBeDefined();
    });

    it('logs and returns when toolCallId not found', () => {
      service.setTaskId('tc-absent', 'tid');
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Record not found, cannot set taskId'),
        expect.anything(),
      );
    });
  });

  describe('getResumable', () => {
    it('returns only interrupted, non-expired records', () => {
      service.register(makeReg({ toolCallId: 'tc-running' }));
      service.register(
        makeReg({ toolCallId: 'tc-int', startedAt: Date.now() }),
      );
      service.update('tc-int', {
        status: 'interrupted',
        interruptedAt: Date.now(),
      });

      const resumable = service.getResumable();
      expect(resumable.map((r) => r.toolCallId)).not.toContain('tc-running');
      expect(resumable.map((r) => r.toolCallId)).toContain('tc-int');
    });
  });

  describe('getResumableBySession', () => {
    it('filters resumable records by parentSessionId', () => {
      service.register(
        makeReg({
          toolCallId: 'tc-a',
          parentSessionId: 'sess-a',
          startedAt: Date.now(),
        }),
      );
      service.register(
        makeReg({
          toolCallId: 'tc-b',
          parentSessionId: 'sess-b',
          startedAt: Date.now(),
        }),
      );
      service.update('tc-a', { status: 'interrupted' });
      service.update('tc-b', { status: 'interrupted' });

      const forA = service.getResumableBySession('sess-a');
      expect(forA).toHaveLength(1);
      expect(forA[0].toolCallId).toBe('tc-a');
    });
  });

  describe('getRunningBySession', () => {
    it('returns running non-background agents for a session', () => {
      service.register(
        makeReg({ toolCallId: 'tc-r1', parentSessionId: 'sess-run' }),
      );
      service.markPendingBackground('tc-bg');
      service.register(
        makeReg({ toolCallId: 'tc-bg', parentSessionId: 'sess-run' }),
      );

      const running = service.getRunningBySession('sess-run');
      expect(running.map((r) => r.toolCallId)).toContain('tc-r1');
      expect(running.map((r) => r.toolCallId)).not.toContain('tc-bg');
    });

    it('excludes agents from other sessions', () => {
      service.register(
        makeReg({ toolCallId: 'tc-other', parentSessionId: 'other-sess' }),
      );
      const running = service.getRunningBySession('sess-run');
      expect(running).toHaveLength(0);
    });
  });

  describe('getBackgroundAgents', () => {
    it('returns background agents for a specific session', () => {
      service.markPendingBackground('tc-bg1');
      service.register(
        makeReg({ toolCallId: 'tc-bg1', parentSessionId: 'sess-1' }),
      );
      service.markPendingBackground('tc-bg2');
      service.register(
        makeReg({ toolCallId: 'tc-bg2', parentSessionId: 'sess-2' }),
      );

      const bg = service.getBackgroundAgents('sess-1');
      expect(bg).toHaveLength(1);
      expect(bg[0].toolCallId).toBe('tc-bg1');
    });

    it('returns all background agents when no session filter given', () => {
      service.markPendingBackground('tc-bg1');
      service.register(
        makeReg({ toolCallId: 'tc-bg1', parentSessionId: 'sess-1' }),
      );
      service.markPendingBackground('tc-bg2');
      service.register(
        makeReg({ toolCallId: 'tc-bg2', parentSessionId: 'sess-2' }),
      );

      const bg = service.getBackgroundAgents();
      expect(bg).toHaveLength(2);
    });
  });

  describe('markAllInterrupted', () => {
    it('marks running non-background, non-cli agents as interrupted', () => {
      service.register(
        makeReg({ toolCallId: 'tc-fg', parentSessionId: 'sess-abort' }),
      );
      service.markPendingBackground('tc-bg');
      service.register(
        makeReg({ toolCallId: 'tc-bg', parentSessionId: 'sess-abort' }),
      );

      service.markAllInterrupted('sess-abort');

      const fg = service.get('tc-fg');
      expect(fg?.status).toBe('interrupted');

      const bg = service.get('tc-bg');
      expect(bg?.status).toBe('background');
    });

    it('does not affect agents from other sessions', () => {
      service.register(
        makeReg({ toolCallId: 'tc-other', parentSessionId: 'other-sess' }),
      );
      service.markAllInterrupted('sess-abort');

      expect(service.get('tc-other')?.status).toBe('running');
    });
  });

  describe('resolveParentSessionId', () => {
    it('rewrites parentSessionId from tabId to realSessionId', () => {
      service.register(
        makeReg({ toolCallId: 'tc-resolve', parentSessionId: 'tab-id-123' }),
      );
      service.resolveParentSessionId('tab-id-123', 'real-uuid-456');

      const record = service.get('tc-resolve');
      expect(record?.parentSessionId).toBe('real-uuid-456');
    });

    it('is a no-op when no records match tabId', () => {
      expect(() =>
        service.resolveParentSessionId('no-such-tab', 'real-uuid'),
      ).not.toThrow();
    });
  });

  describe('getToolCallIdByAgentId', () => {
    it('returns toolCallId for a running agent by agentId', () => {
      service.register(
        makeReg({ toolCallId: 'tc-lookup', agentId: 'agent-xyz' }),
      );

      const result = service.getToolCallIdByAgentId('agent-xyz');
      expect(result).toBe('tc-lookup');
    });

    it('returns fallback toolCallId for non-running match', () => {
      service.register(
        makeReg({
          toolCallId: 'tc-int',
          agentId: 'agent-fallback',
          startedAt: Date.now(),
        }),
      );
      service.update('tc-int', { status: 'interrupted' });

      const result = service.getToolCallIdByAgentId('agent-fallback');
      expect(result).toBe('tc-int');
    });

    it('returns null when agentId is not found', () => {
      expect(service.getToolCallIdByAgentId('nonexistent')).toBeNull();
    });
  });

  describe('remove', () => {
    it('removes a registered agent', () => {
      service.register(makeReg({ toolCallId: 'tc-rm' }));
      service.remove('tc-rm');
      expect(service.get('tc-rm')).toBeNull();
    });

    it('is a no-op for unknown toolCallId', () => {
      expect(() => service.remove('tc-missing')).not.toThrow();
    });
  });

  describe('removeBySessionId', () => {
    it('removes all agents for a session', () => {
      service.register(
        makeReg({ toolCallId: 'tc-s1', parentSessionId: 'sess-del' }),
      );
      service.register(
        makeReg({ toolCallId: 'tc-s2', parentSessionId: 'sess-del' }),
      );
      service.register(
        makeReg({ toolCallId: 'tc-other', parentSessionId: 'other' }),
      );

      service.removeBySessionId('sess-del');

      expect(service.get('tc-s1')).toBeNull();
      expect(service.get('tc-s2')).toBeNull();
      expect(service.get('tc-other')).not.toBeNull();
    });
  });

  describe('markAsInjected and wasInjected', () => {
    it('markAsInjected + wasInjected round-trip', () => {
      expect(service.wasInjected('tc-inj')).toBe(false);
      service.markAsInjected('tc-inj');
      expect(service.wasInjected('tc-inj')).toBe(true);
    });
  });

  describe('clear', () => {
    it('empties the registry', () => {
      service.register(makeReg({ toolCallId: 'tc-1' }));
      service.register(makeReg({ toolCallId: 'tc-2' }));
      service.clear();
      expect(service.size).toBe(0);
    });
  });
});
