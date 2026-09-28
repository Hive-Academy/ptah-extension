/**
 * Zod schema tests for `MemoryPurgeBySubjectPatternParamsSchema`.
 *
 * Verifies that the schema accepts valid inputs and rejects invalid ones,
 * including the belt-and-braces `pattern.min(1)` guard and the tightened
 * `workspaceRoot: z.string().min(1)` guard introduced to fix Issue 1 (HIGH).
 */

import {
  MemoryListQuarantinedParamsSchema,
  MemoryPurgeBySubjectPatternParamsSchema,
  MemoryRestoreQuarantinedParamsSchema,
} from './memory-rpc.schema';

describe('MemoryPurgeBySubjectPatternParamsSchema', () => {
  describe('valid inputs', () => {
    it('parses valid substring params', () => {
      const result = MemoryPurgeBySubjectPatternParamsSchema.safeParse({
        pattern: 'node_modules',
        mode: 'substring',
        workspaceRoot: '/home/user/project',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pattern).toBe('node_modules');
        expect(result.data.mode).toBe('substring');
        expect(result.data.workspaceRoot).toBe('/home/user/project');
      }
    });

    it('parses valid like params', () => {
      const result = MemoryPurgeBySubjectPatternParamsSchema.safeParse({
        pattern: '%node_modules%',
        mode: 'like',
        workspaceRoot: 'C:\\Users\\user\\project',
      });
      expect(result.success).toBe(true);
    });

    it('parses with a Windows-style workspaceRoot', () => {
      const result = MemoryPurgeBySubjectPatternParamsSchema.safeParse({
        pattern: 'dist',
        mode: 'substring',
        workspaceRoot: 'C:/projects/my-app',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('invalid inputs', () => {
    it('rejects empty pattern string (min(1) guard)', () => {
      const result = MemoryPurgeBySubjectPatternParamsSchema.safeParse({
        pattern: '',
        mode: 'substring',
        workspaceRoot: '/workspace',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('pattern');
      }
    });

    it('rejects missing workspaceRoot (required after Issue 1 fix)', () => {
      const result = MemoryPurgeBySubjectPatternParamsSchema.safeParse({
        pattern: 'node_modules',
        mode: 'substring',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('workspaceRoot');
      }
    });

    it('rejects workspaceRoot of null', () => {
      const result = MemoryPurgeBySubjectPatternParamsSchema.safeParse({
        pattern: 'node_modules',
        mode: 'substring',
        workspaceRoot: null,
      });
      expect(result.success).toBe(false);
    });

    it('rejects workspaceRoot of empty string (min(1) guard)', () => {
      const result = MemoryPurgeBySubjectPatternParamsSchema.safeParse({
        pattern: 'node_modules',
        mode: 'substring',
        workspaceRoot: '',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('workspaceRoot');
      }
    });

    it('rejects invalid mode value', () => {
      const result = MemoryPurgeBySubjectPatternParamsSchema.safeParse({
        pattern: 'node_modules',
        mode: 'regex',
        workspaceRoot: '/workspace',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('mode');
      }
    });

    it('rejects missing pattern field', () => {
      const result = MemoryPurgeBySubjectPatternParamsSchema.safeParse({
        mode: 'substring',
        workspaceRoot: '/workspace',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing mode field', () => {
      const result = MemoryPurgeBySubjectPatternParamsSchema.safeParse({
        pattern: 'node_modules',
        workspaceRoot: '/workspace',
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('MemoryRestoreQuarantinedParamsSchema', () => {
  describe('valid inputs', () => {
    it('accepts a named workspace with an ids selector', () => {
      const result = MemoryRestoreQuarantinedParamsSchema.safeParse({
        workspaceRoot: '/home/user/project',
        ids: ['m-1', 'm-2'],
      });
      expect(result.success).toBe(true);
    });

    it('accepts an explicit null workspaceRoot (the unscoped rows)', () => {
      const result = MemoryRestoreQuarantinedParamsSchema.safeParse({
        workspaceRoot: null,
        all: true,
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.workspaceRoot).toBeNull();
    });

    it('accepts a rule reason selector', () => {
      const result = MemoryRestoreQuarantinedParamsSchema.safeParse({
        workspaceRoot: 'C:/projects/my-app',
        reason: 'rule:commitlint-scope-facts',
      });
      expect(result.success).toBe(true);
    });

    it('accepts exactly 500 ids', () => {
      const result = MemoryRestoreQuarantinedParamsSchema.safeParse({
        workspaceRoot: '/ws',
        ids: Array.from({ length: 500 }, (_, i) => `m-${i}`),
      });
      expect(result.success).toBe(true);
    });
  });

  describe('invalid inputs', () => {
    it('rejects an omitted workspaceRoot key (never "current", never "all")', () => {
      const result = MemoryRestoreQuarantinedParamsSchema.safeParse({
        all: true,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('workspaceRoot');
      }
    });

    it('rejects an empty-string workspaceRoot', () => {
      const result = MemoryRestoreQuarantinedParamsSchema.safeParse({
        workspaceRoot: '',
        all: true,
      });
      expect(result.success).toBe(false);
    });

    it('rejects zero selectors', () => {
      const result = MemoryRestoreQuarantinedParamsSchema.safeParse({
        workspaceRoot: '/ws',
      });
      expect(result.success).toBe(false);
    });

    it('rejects two selectors', () => {
      const result = MemoryRestoreQuarantinedParamsSchema.safeParse({
        workspaceRoot: '/ws',
        ids: ['m-1'],
        reason: 'rule:commitlint-scope-facts',
      });
      expect(result.success).toBe(false);
    });

    it('rejects all: false (not a selector)', () => {
      const result = MemoryRestoreQuarantinedParamsSchema.safeParse({
        workspaceRoot: '/ws',
        all: false,
      });
      expect(result.success).toBe(false);
    });

    it('rejects an empty ids array', () => {
      const result = MemoryRestoreQuarantinedParamsSchema.safeParse({
        workspaceRoot: '/ws',
        ids: [],
      });
      expect(result.success).toBe(false);
    });

    it('rejects more than 500 ids', () => {
      const result = MemoryRestoreQuarantinedParamsSchema.safeParse({
        workspaceRoot: '/ws',
        ids: Array.from({ length: 501 }, (_, i) => `m-${i}`),
      });
      expect(result.success).toBe(false);
    });

    it.each(['commitlint-scope-facts', 'rule:', 'rule:Upper', 'rule:a b'])(
      'rejects the reason %p',
      (reason) => {
        const result = MemoryRestoreQuarantinedParamsSchema.safeParse({
          workspaceRoot: '/ws',
          reason,
        });
        expect(result.success).toBe(false);
      },
    );
  });
});

describe('MemoryListQuarantinedParamsSchema', () => {
  it('defaults scope to workspace when omitted', () => {
    const result = MemoryListQuarantinedParamsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.scope).toBe('workspace');
  });

  it('accepts null, a string, or an omitted workspaceRoot', () => {
    for (const params of [
      { workspaceRoot: null },
      { workspaceRoot: '/ws' },
      { scope: 'all' },
    ]) {
      expect(MemoryListQuarantinedParamsSchema.safeParse(params).success).toBe(
        true,
      );
    }
  });

  it.each([
    ['an unknown scope', { scope: 'everything' }],
    ['a non-rule reason', { reason: 'anything' }],
    ['a limit of 0', { limit: 0 }],
    ['a limit above 500', { limit: 501 }],
    ['a negative offset', { offset: -1 }],
    ['an empty-string workspaceRoot', { workspaceRoot: '' }],
  ])('rejects %s', (_label, params) => {
    expect(MemoryListQuarantinedParamsSchema.safeParse(params).success).toBe(
      false,
    );
  });
});
