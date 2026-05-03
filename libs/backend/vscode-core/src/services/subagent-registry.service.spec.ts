/**
 * SubagentRegistryService specs — pruneSession (TASK_2026_109 A4 + C4).
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
