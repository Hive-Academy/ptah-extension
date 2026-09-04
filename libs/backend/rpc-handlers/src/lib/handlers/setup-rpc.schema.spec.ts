/**
 * SetupRpcSchema — unit specs.
 *
 * Surface under test: `./setup-rpc.schema.ts`, the Zod boundary for the
 * `wizard:` query/resume DTOs handled by `SetupRpcHandlers`
 * (TASK_2026_361 Batch 3). `wizard:recommend-agents` is deliberately absent:
 * its raw analysis input is validated by `ProjectAnalysisZodSchema` inside
 * the handler.
 */

import 'reflect-metadata';

import {
  WizardDeepAnalyzeParamsSchema,
  WizardGetResumableRunParamsSchema,
  WizardInstallPackAgentsParamsSchema,
  WizardListAnalysesParamsSchema,
  WizardLoadAnalysisParamsSchema,
} from './setup-rpc.schema';

describe('setup-rpc.schema', () => {
  describe('WizardDeepAnalyzeParamsSchema', () => {
    it('accepts an empty object (backend root, fresh run)', () => {
      const result = WizardDeepAnalyzeParamsSchema.safeParse({});
      expect(result.success).toBe(true);
      expect(result.data).toEqual({});
    });

    it('accepts the typed resume flag alongside model and workspacePath', () => {
      const result = WizardDeepAnalyzeParamsSchema.safeParse({
        model: 'claude-sonnet-4-20250514',
        resume: true,
        workspacePath: '/ws',
      });
      expect(result.success).toBe(true);
      expect(result.data?.resume).toBe(true);
    });

    it('rejects a non-boolean resume flag', () => {
      expect(
        WizardDeepAnalyzeParamsSchema.safeParse({ resume: 'yes' }).success,
      ).toBe(false);
    });

    it('rejects an empty model string', () => {
      expect(
        WizardDeepAnalyzeParamsSchema.safeParse({ model: '' }).success,
      ).toBe(false);
    });
  });

  describe('WizardGetResumableRunParamsSchema', () => {
    it('accepts no parameters and drops unknown keys', () => {
      const result = WizardGetResumableRunParamsSchema.safeParse({
        unexpected: 1,
      });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({});
    });

    it('rejects a non-object', () => {
      expect(WizardGetResumableRunParamsSchema.safeParse('x').success).toBe(
        false,
      );
    });
  });

  describe('WizardListAnalysesParamsSchema', () => {
    it('accepts an optional workspacePath', () => {
      expect(WizardListAnalysesParamsSchema.safeParse({}).success).toBe(true);
      expect(
        WizardListAnalysesParamsSchema.safeParse({ workspacePath: '/ws' })
          .success,
      ).toBe(true);
    });
  });

  describe('WizardLoadAnalysisParamsSchema', () => {
    it('requires a non-empty filename', () => {
      expect(WizardLoadAnalysisParamsSchema.safeParse({}).success).toBe(false);
      expect(
        WizardLoadAnalysisParamsSchema.safeParse({ filename: '' }).success,
      ).toBe(false);
      expect(
        WizardLoadAnalysisParamsSchema.safeParse({ filename: 'slug' }).success,
      ).toBe(true);
    });
  });

  describe('WizardInstallPackAgentsParamsSchema', () => {
    it('requires a source and at least one agent file', () => {
      expect(
        WizardInstallPackAgentsParamsSchema.safeParse({
          source: 'https://example.com/pack',
          agentFiles: [],
        }).success,
      ).toBe(false);
      expect(
        WizardInstallPackAgentsParamsSchema.safeParse({
          source: 'https://example.com/pack',
          agentFiles: ['a.md'],
        }).success,
      ).toBe(true);
    });
  });
});
