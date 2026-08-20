/**
 * SubagentRegistryService — cross-session isolation (TASK_2026_295).
 *
 * An empty-string session id (`''`) is a third state nothing intends: the
 * branded `SessionId` requires a UUID, and "no session" is `undefined`. Where
 * `''` was minted upstream, the registry's falsiness checks read it as "no
 * filter, apply to all", and its destructive operations matched every record
 * that also carried `''`.
 *
 * Each spec here pins one such leak. They are deliberately paired: for every
 * "empty id must not act on all sessions" assertion there is a sibling
 * asserting the legitimate behaviour still works, so a future guard cannot be
 * "fixed" by making the method inert.
 */

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
    agentType: 'test-agent',
    agentId: 'a1',
    startedAt: Date.now(),
    parentSessionId: 'parent-1',
    ...overrides,
  };
}

describe('SubagentRegistryService — empty session id isolation', () => {
  let service: SubagentRegistryService;
  let logger: jest.Mocked<Logger>;

  beforeEach(() => {
    logger = makeLogger();
    service = new SubagentRegistryService(logger);
  });

  // -------------------------------------------------------------------------
  // getBackgroundAgents — reached from agent:backgroundList
  // -------------------------------------------------------------------------

  describe('getBackgroundAgents', () => {
    function registerBackgroundIn(sessionId: string, toolCallId: string): void {
      service.markPendingBackground(toolCallId);
      service.register(
        makeReg({
          toolCallId,
          parentSessionId: sessionId,
          agentId: toolCallId,
        }),
      );
    }

    it('returns NOTHING for an empty parentSessionId, not every session', () => {
      registerBackgroundIn('session-a', 'tc-a');
      registerBackgroundIn('session-b', 'tc-b');

      // `!parentSessionId` used to be true here, so this returned both
      // records and session B's agents appeared in session A's UI.
      expect(service.getBackgroundAgents('')).toEqual([]);
    });

    it('still returns every background agent when the argument is omitted', () => {
      registerBackgroundIn('session-a', 'tc-a');
      registerBackgroundIn('session-b', 'tc-b');

      expect(service.getBackgroundAgents()).toHaveLength(2);
    });

    it('still filters to exactly one session for a real id', () => {
      registerBackgroundIn('session-a', 'tc-a');
      registerBackgroundIn('session-b', 'tc-b');

      const agents = service.getBackgroundAgents('session-a');
      expect(agents).toHaveLength(1);
      expect(agents[0]?.parentSessionId).toBe('session-a');
    });
  });

  // -------------------------------------------------------------------------
  // removeSupersededInterrupted — scoped by parent session, not agentId alone
  // -------------------------------------------------------------------------

  describe('resume supersede scoping', () => {
    it('does not delete another session’s interrupted record that shares an agentId', () => {
      // agentId is a short SDK hex string, unique only within a session.
      service.register(
        makeReg({
          toolCallId: 'tc-b-old',
          parentSessionId: 'session-b',
          agentId: 'a329b32',
        }),
      );
      service.update('tc-b-old', {
        status: 'interrupted',
        interruptedAt: Date.now(),
      });

      // A resume in session A reusing the same short hex.
      service.register(
        makeReg({
          toolCallId: 'tc-a-new',
          parentSessionId: 'session-a',
          agentId: 'a329b32',
        }),
      );

      expect(service.get('tc-b-old')).not.toBeNull();
      expect(service.get('tc-b-old')?.status).toBe('interrupted');
      // The poison flag must also stay off — it blocks history re-registration.
      expect(service.wasInjected('tc-b-old')).toBe(false);
    });

    it('still supersedes the interrupted record inside the SAME session', () => {
      service.register(
        makeReg({
          toolCallId: 'tc-old',
          parentSessionId: 'session-a',
          agentId: 'a329b32',
        }),
      );
      service.update('tc-old', {
        status: 'interrupted',
        interruptedAt: Date.now(),
      });

      service.register(
        makeReg({
          toolCallId: 'tc-new',
          parentSessionId: 'session-a',
          agentId: 'a329b32',
        }),
      );

      expect(service.get('tc-old')).toBeNull();
      expect(service.wasInjected('tc-old')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // resolveParentSessionId — must not rebrand every ''-parented record
  // -------------------------------------------------------------------------

  describe('resolveParentSessionId', () => {
    it('ignores an empty tabId instead of rewriting every ’’-parented record', () => {
      service.register(makeReg({ toolCallId: 'tc-a', parentSessionId: '' }));
      service.register(makeReg({ toolCallId: 'tc-b', parentSessionId: '' }));

      service.resolveParentSessionId('', 'real-uuid');

      expect(service.get('tc-a')?.parentSessionId).toBe('');
      expect(service.get('tc-b')?.parentSessionId).toBe('');
    });

    it('ignores an empty realSessionId', () => {
      service.register(
        makeReg({ toolCallId: 'tc-a', parentSessionId: 'tab-1' }),
      );

      service.resolveParentSessionId('tab-1', '');

      expect(service.get('tc-a')?.parentSessionId).toBe('tab-1');
    });

    it('still rewrites tab id to real session id for real ids', () => {
      service.register(
        makeReg({ toolCallId: 'tc-a', parentSessionId: 'tab-1' }),
      );

      service.resolveParentSessionId('tab-1', 'real-uuid');

      expect(service.get('tc-a')?.parentSessionId).toBe('real-uuid');
    });
  });

  // -------------------------------------------------------------------------
  // removeBySessionId — pruneSession already guards; this one did not
  // -------------------------------------------------------------------------

  describe('removeBySessionId', () => {
    it('ignores an empty parentSessionId instead of deleting every ’’-parented record', () => {
      service.register(makeReg({ toolCallId: 'tc-a', parentSessionId: '' }));
      service.register(makeReg({ toolCallId: 'tc-b', parentSessionId: '' }));

      service.removeBySessionId('');

      expect(service.get('tc-a')).not.toBeNull();
      expect(service.get('tc-b')).not.toBeNull();
    });

    it('still removes every record for a real session', () => {
      service.register(
        makeReg({ toolCallId: 'tc-a', parentSessionId: 'session-a' }),
      );
      service.register(
        makeReg({ toolCallId: 'tc-b', parentSessionId: 'session-b' }),
      );

      service.removeBySessionId('session-a');

      expect(service.get('tc-a')).toBeNull();
      expect(service.get('tc-b')).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Teardown window — one session's teardown must not protect another's
  // -------------------------------------------------------------------------

  describe('session teardown window', () => {
    function registerInterruptedIn(
      parentSessionId: string,
      toolCallId: string,
    ): void {
      service.register(
        makeReg({ toolCallId, parentSessionId, agentId: toolCallId }),
      );
      service.update(toolCallId, {
        status: 'interrupted',
        interruptedAt: Date.now(),
      });
    }

    it('an empty-id teardown does not protect ’’-parented records from completing', () => {
      registerInterruptedIn('', 'tc-a');

      service.beginSessionTeardown('');
      // Without the guard, '' entered the teardown set and this 'completed'
      // update was ignored — the record stayed 'interrupted' forever and kept
      // being offered for resume long after the agent finished.
      service.update('tc-a', { status: 'completed' });

      expect(service.get('tc-a')).toBeNull();
    });

    it('still protects an interrupted record during a real session teardown', () => {
      registerInterruptedIn('session-a', 'tc-a');

      service.beginSessionTeardown('session-a');
      service.update('tc-a', { status: 'completed' });

      expect(service.get('tc-a')?.status).toBe('interrupted');

      service.endSessionTeardown('session-a');
      service.update('tc-a', { status: 'completed' });
      expect(service.get('tc-a')).toBeNull();
    });

    it('a real session’s teardown does not protect another session’s records', () => {
      registerInterruptedIn('session-a', 'tc-a');
      registerInterruptedIn('session-b', 'tc-b');

      service.beginSessionTeardown('session-a');
      service.update('tc-b', { status: 'completed' });

      expect(service.get('tc-b')).toBeNull();
      expect(service.get('tc-a')?.status).toBe('interrupted');
    });
  });
});
