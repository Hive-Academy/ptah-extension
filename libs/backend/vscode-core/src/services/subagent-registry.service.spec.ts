/**
 * SubagentRegistryService specs — pruneSession.
 *
 * Coverage:
 *   - pruneSession(parentSessionId) removes non-background entries that
 *     match the given parentSessionId.
 *   - Background agents (record.isBackground === true OR status==='background')
 *     are preserved across the compact boundary by design.
 *   - Records belonging to other parent sessions are untouched.
 */

import 'reflect-metadata';

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

describe('SubagentRegistryService.pruneSession (TASK_2026_109 A4 + C4)', () => {
  let service: SubagentRegistryService;
  let logger: jest.Mocked<Logger>;

  beforeEach(() => {
    logger = makeLogger();
    service = new SubagentRegistryService(logger);
  });

  it('removes non-background entries matching parentSessionId; preserves background and other-session entries', () => {
    // Foreground agent on the session being pruned — should be removed.
    service.register({
      toolCallId: 'tc-fg-1',
      sessionId: 'agent-sess-a',
      parentSessionId: 'parent-1',
      agentId: 'a-1',
      agentType: 'frontend-developer',
      startedAt: Date.now(),
    } as never);

    // Background agent on the same session — should be preserved.
    service.markPendingBackground('tc-bg-1');
    service.register({
      toolCallId: 'tc-bg-1',
      sessionId: 'agent-sess-b',
      parentSessionId: 'parent-1',
      agentId: 'a-2',
      agentType: 'long-runner',
      startedAt: Date.now(),
    } as never);

    // Foreground agent on a DIFFERENT session — should be preserved.
    service.register({
      toolCallId: 'tc-fg-2',
      sessionId: 'agent-sess-c',
      parentSessionId: 'parent-2',
      agentId: 'a-3',
      agentType: 'backend-developer',
      startedAt: Date.now(),
    } as never);

    expect(service.size).toBe(3);

    service.pruneSession('parent-1');

    // Foreground entry on parent-1 is gone …
    expect(service.get('tc-fg-1')).toBeNull();
    // … background entry on parent-1 survives …
    expect(service.get('tc-bg-1')).not.toBeNull();
    // … and the unrelated session is untouched.
    expect(service.get('tc-fg-2')).not.toBeNull();
    expect(service.size).toBe(2);
  });

  it('is a no-op when parentSessionId is empty', () => {
    service.register({
      toolCallId: 'tc-x',
      sessionId: 'agent-sess-x',
      parentSessionId: 'parent-1',
      agentId: 'a-x',
      agentType: 'something',
      startedAt: Date.now(),
    } as never);

    service.pruneSession('');
    expect(service.get('tc-x')).not.toBeNull();
  });
});

/**
 * TASK_2026_614 F.5 M1 — an interrupt is activity. Without the stamp an aborted
 * foreground subagent that ran longer than the TTL reads cold while its prompt
 * cache is still warm.
 */
describe('SubagentRegistryService.markAllInterrupted stamps lastActivityAt (F.5 M1)', () => {
  const T0 = 1_700_000_000_000;
  let now: number;
  let nowSpy: jest.SpyInstance<number, []>;
  let service: SubagentRegistryService;

  beforeEach(() => {
    now = T0;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    service = new SubagentRegistryService(makeLogger());
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('stamps the interrupt time on interrupted records and leaves skipped records alone', () => {
    service.register({
      toolCallId: 'tc-fg',
      parentSessionId: 'parent-1',
      agentId: 'a-1',
      agentType: 'backend-developer',
      startedAt: T0,
    });
    service.markPendingBackground('tc-bg');
    service.register({
      toolCallId: 'tc-bg',
      parentSessionId: 'parent-1',
      agentId: 'a-2',
      agentType: 'long-runner',
      startedAt: T0,
    });
    service.register({
      toolCallId: 'tc-other',
      parentSessionId: 'parent-2',
      agentId: 'a-3',
      agentType: 'backend-developer',
      startedAt: T0,
    });

    now = T0 + 10 * 60_000;
    service.markAllInterrupted('parent-1');

    const interrupted = service.get('tc-fg');
    expect(interrupted?.status).toBe('interrupted');
    expect(interrupted?.interruptedAt).toBe(now);
    expect(interrupted?.lastActivityAt).toBe(now);
    expect(service.get('tc-bg')?.lastActivityAt).toBe(T0);
    expect(service.get('tc-other')?.lastActivityAt).toBe(T0);
  });
});

/**
 * TASK_2026_614 F-F — exact agentId lookup used to bind a SubagentStart hook
 * that arrived without a toolUseId. It returns every match so the caller can
 * refuse to guess between several.
 */
describe('SubagentRegistryService.getToolCallIdsByAgentId (F-F)', () => {
  let service: SubagentRegistryService;

  beforeEach(() => {
    service = new SubagentRegistryService(makeLogger());
    const base = { agentType: 'backend-developer', startedAt: Date.now() };
    service.register({
      ...base,
      toolCallId: 'tc-1',
      parentSessionId: 'parent-1',
      agentId: 'abc123',
    });
    service.register({
      ...base,
      toolCallId: 'tc-2',
      parentSessionId: 'parent-2',
      agentId: 'abc123',
    });
    service.register({
      ...base,
      toolCallId: 'tc-3',
      parentSessionId: 'parent-1',
      agentId: 'abc1234',
    });
  });

  it('matches the exact agentId within the given parent session only', () => {
    expect(service.getToolCallIdsByAgentId('abc123', 'parent-1')).toEqual([
      'tc-1',
    ]);
    expect(service.getToolCallIdsByAgentId('abc12', 'parent-1')).toEqual([]);
  });

  it('returns every match in the session so the caller can see ambiguity', () => {
    service.register({
      agentType: 'backend-developer',
      startedAt: Date.now(),
      toolCallId: 'tc-4',
      parentSessionId: 'parent-1',
      agentId: 'abc123',
    });

    expect(
      service.getToolCallIdsByAgentId('abc123', 'parent-1').sort(),
    ).toEqual(['tc-1', 'tc-4']);
  });

  it('returns nothing for a blank agentId or parent session', () => {
    expect(service.getToolCallIdsByAgentId('', 'parent-1')).toEqual([]);
    expect(service.getToolCallIdsByAgentId('abc123', '  ')).toEqual([]);
  });
});
