import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import { SkillInvocationRecorder } from './skill-invocation-recorder';
import type { SkillCandidateStore } from './skill-candidate.store';
import type { RecordSkillEventInput } from './skill-invocation-recorder';

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

interface StoreHarness {
  store: SkillCandidateStore;
  record: jest.Mock;
}

function makeStore(): StoreHarness {
  const record = jest.fn();
  return {
    record,
    store: {
      recordSkillEvent: record,
    } as unknown as SkillCandidateStore,
  };
}

function input(
  overrides: Partial<RecordSkillEventInput> = {},
): RecordSkillEventInput {
  return {
    slug: 'deep-research',
    sessionId: 's1',
    workspaceRoot: '/ws',
    contextId: 'fp-1',
    succeeded: true,
    invokedAt: 1000,
    source: 'tool-use',
    ...overrides,
  };
}

describe('SkillInvocationRecorder', () => {
  describe('dedup (slug, sessionId, 2s-bucket)', () => {
    it('suppresses a second event in the same 2s bucket', () => {
      const logger = makeLogger();
      const { store, record } = makeStore();
      const recorder = new SkillInvocationRecorder(logger, store);

      recorder.recordSkillEvent(input({ invokedAt: 1000 }));
      recorder.recordSkillEvent(input({ invokedAt: 1999 }));

      expect(record).toHaveBeenCalledTimes(1);
    });

    it('records again when invokedAt crosses into a new 2s bucket', () => {
      const logger = makeLogger();
      const { store, record } = makeStore();
      const recorder = new SkillInvocationRecorder(logger, store);

      recorder.recordSkillEvent(input({ invokedAt: 1000 }));
      recorder.recordSkillEvent(input({ invokedAt: 2000 }));

      expect(record).toHaveBeenCalledTimes(2);
    });

    it('does not dedup across different slugs in the same bucket', () => {
      const logger = makeLogger();
      const { store, record } = makeStore();
      const recorder = new SkillInvocationRecorder(logger, store);

      recorder.recordSkillEvent(input({ slug: 'a', invokedAt: 1000 }));
      recorder.recordSkillEvent(input({ slug: 'b', invokedAt: 1000 }));

      expect(record).toHaveBeenCalledTimes(2);
    });

    it('does not dedup across different sessionIds in the same bucket', () => {
      const logger = makeLogger();
      const { store, record } = makeStore();
      const recorder = new SkillInvocationRecorder(logger, store);

      recorder.recordSkillEvent(input({ sessionId: 's1', invokedAt: 1000 }));
      recorder.recordSkillEvent(input({ sessionId: 's2', invokedAt: 1000 }));

      expect(record).toHaveBeenCalledTimes(2);
    });
  });

  describe('isError derivation', () => {
    it('passes isError=false to the store when succeeded=true', () => {
      const logger = makeLogger();
      const { store, record } = makeStore();
      const recorder = new SkillInvocationRecorder(logger, store);

      recorder.recordSkillEvent(input({ succeeded: true }));

      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({ succeeded: true, isError: false }),
      );
    });

    it('passes isError=true to the store when succeeded=false', () => {
      const logger = makeLogger();
      const { store, record } = makeStore();
      const recorder = new SkillInvocationRecorder(logger, store);

      recorder.recordSkillEvent(input({ succeeded: false }));

      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({ succeeded: false, isError: true }),
      );
    });

    it('maps the recorder API fields onto the store insert shape', () => {
      const logger = makeLogger();
      const { store, record } = makeStore();
      const recorder = new SkillInvocationRecorder(logger, store);

      recorder.recordSkillEvent(
        input({
          slug: 'caveman',
          sessionId: 's9',
          contextId: 'fp-9',
          source: 'prompt-expansion',
          invokedAt: 4242,
        }),
      );

      expect(record).toHaveBeenCalledWith({
        skillSlug: 'caveman',
        sessionId: 's9',
        workspaceRoot: '/ws',
        contextId: 'fp-9',
        source: 'prompt-expansion',
        succeeded: true,
        isError: false,
        invokedAt: 4242,
        metrics: null,
        taskId: null,
      });
    });
  });

  /**
   * CORRECTION C10 — the whole reason this describe block exists.
   *
   * `RecordSkillEventInput` has declared `workspaceRoot: string` since the type
   * shipped, and `recordSkillEvent` built the store payload without it, so the
   * value was discarded on every single call. Nothing failed: the store did not
   * ask for the field and the column did not exist until `0037`. Silent data
   * loss that reads as working code.
   *
   * These assertions are written so they FAIL against the pre-fix recorder: an
   * exact-shape equality above (an omitted key is not equal to a named one),
   * a direct read of the forwarded field, and a DISTINCT value per call so a
   * hard-coded constant would not satisfy them either.
   */
  describe('workspaceRoot forwarding (correction C10)', () => {
    it('forwards workspaceRoot to the store instead of dropping it', () => {
      const logger = makeLogger();
      const { store, record } = makeStore();
      const recorder = new SkillInvocationRecorder(logger, store);

      recorder.recordSkillEvent(
        input({ workspaceRoot: 'D:/projects/ptah-extension' }),
      );

      expect(record).toHaveBeenCalledTimes(1);
      const payload = record.mock.calls[0][0] as Record<string, unknown>;
      expect(payload['workspaceRoot']).toBe('D:/projects/ptah-extension');
      // `in` rather than a truthiness check: an ABSENT key and a key holding
      // `undefined` are the same to `?.`/`??`, and only one of them is the bug.
      expect('workspaceRoot' in payload).toBe(true);
    });

    it('carries a DIFFERENT workspaceRoot per call, so no constant satisfies it', () => {
      const logger = makeLogger();
      const { store, record } = makeStore();
      const recorder = new SkillInvocationRecorder(logger, store);

      recorder.recordSkillEvent(
        input({ workspaceRoot: '/ws/alpha', sessionId: 'a', invokedAt: 1000 }),
      );
      recorder.recordSkillEvent(
        input({ workspaceRoot: '/ws/beta', sessionId: 'b', invokedAt: 1000 }),
      );

      const roots = record.mock.calls.map(
        (c) => (c[0] as { workspaceRoot?: string }).workspaceRoot,
      );
      expect(roots).toEqual(['/ws/alpha', '/ws/beta']);
    });

    it('passes the empty string through rather than turning it into a NULL', () => {
      // `''` is 0034's "deliberately cross-project" value, NOT "unknown". A
      // `input.workspaceRoot || null` forwarding would erase that distinction
      // here, one layer above the column that has to preserve it.
      const logger = makeLogger();
      const { store, record } = makeStore();
      const recorder = new SkillInvocationRecorder(logger, store);

      recorder.recordSkillEvent(input({ workspaceRoot: '' }));

      const payload = record.mock.calls[0][0] as Record<string, unknown>;
      expect(payload['workspaceRoot']).toBe('');
      expect(payload['workspaceRoot']).not.toBeNull();
    });
  });

  describe('guard rails', () => {
    it('does not call the store for an empty slug', () => {
      const logger = makeLogger();
      const { store, record } = makeStore();
      const recorder = new SkillInvocationRecorder(logger, store);

      recorder.recordSkillEvent(input({ slug: '' }));

      expect(record).not.toHaveBeenCalled();
    });

    it('does not call the store for an empty sessionId', () => {
      const logger = makeLogger();
      const { store, record } = makeStore();
      const recorder = new SkillInvocationRecorder(logger, store);

      recorder.recordSkillEvent(input({ sessionId: '' }));

      expect(record).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('swallows a store throw and logs a warning', () => {
      const logger = makeLogger();
      const { store, record } = makeStore();
      record.mockImplementation(() => {
        throw new Error('db locked');
      });
      const recorder = new SkillInvocationRecorder(logger, store);

      expect(() => recorder.recordSkillEvent(input())).not.toThrow();
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        '[skill-synthesis] recordSkillEvent failed',
        expect.objectContaining({ slug: 'deep-research', error: 'db locked' }),
      );
    });
  });

  describe('LRU eviction', () => {
    it('does not crash past the dedup cap of 500 distinct keys', () => {
      const logger = makeLogger();
      const { store, record } = makeStore();
      const recorder = new SkillInvocationRecorder(logger, store);

      expect(() => {
        for (let i = 0; i < 1200; i++) {
          recorder.recordSkillEvent(
            input({ slug: `skill-${i}`, invokedAt: 1000 }),
          );
        }
      }).not.toThrow();
      expect(record).toHaveBeenCalledTimes(1200);
    });
  });
});
