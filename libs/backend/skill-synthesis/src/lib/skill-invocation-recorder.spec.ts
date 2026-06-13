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
        contextId: 'fp-9',
        source: 'prompt-expansion',
        succeeded: true,
        isError: false,
        invokedAt: 4242,
      });
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
