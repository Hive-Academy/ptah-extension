/**
 * Zod schema tests for `MemoryPurgeBySubjectPatternParamsSchema` (TASK_2026_119 Batch 5).
 *
 * Verifies that the schema accepts valid inputs and rejects invalid ones,
 * including the belt-and-braces `pattern.min(1)` guard and the tightened
 * `workspaceRoot: z.string().min(1)` guard introduced to fix Issue 1 (HIGH).
 */

import { MemoryPurgeBySubjectPatternParamsSchema } from './memory-rpc.schema';

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
