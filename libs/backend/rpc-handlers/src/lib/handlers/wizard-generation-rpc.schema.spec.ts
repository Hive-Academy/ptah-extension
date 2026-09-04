/**
 * WizardGenerationRpcSchema — unit specs.
 *
 * Surface under test: `./wizard-generation-rpc.schema.ts`, the Zod boundary
 * for `wizard:submit-selection`, `wizard:cancel` and `wizard:retry-item`
 * (TASK_2026_361 Batch 3).
 *
 * Contracts pinned here:
 *   - agent ids are single file-name-safe tokens (they become checkpoint keys
 *     and `<outputDirectory>/<id>.md`), so path traversal is rejected;
 *   - `resume: true` is valid without `selectedAgentIds` (the checkpoint is
 *     the authority);
 *   - `analysisData` that is not a `ProjectAnalysisResult` is DROPPED, not
 *     fatal — `analysisDir` alone fully specifies a run and the CLI's `setup`
 *     command still sends the multi-phase response in that field;
 *   - `formatIssue` names the field without echoing the value.
 */

import 'reflect-metadata';

// ---------------------------------------------------------------------------
// Jest transitive-import guard — the schema imports
// `ProjectAnalysisResultSchema` from `@ptah-extension/agent-generation`, whose
// barrel re-exports `@ptah-extension/workspace-intelligence`, whose
// `TreeSitterParserService` evaluates `import.meta.url` at module top level
// (unparseable under ts-jest's CJS transform). Same guard as the handler specs.
// ---------------------------------------------------------------------------
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  ProjectType: { Node: 'node', General: 'general', Unknown: 'unknown' },
  Framework: {},
  MonorepoType: {},
  FileType: {},
  TreeSitterParserService: class TreeSitterParserServiceStub {},
  WorkspaceAnalyzerService: class WorkspaceAnalyzerServiceStub {},
  ProjectDetectorService: class ProjectDetectorServiceStub {},
  FrameworkDetectorService: class FrameworkDetectorServiceStub {},
  MonorepoDetectorService: class MonorepoDetectorServiceStub {},
}));

import {
  WizardAgentIdSchema,
  WizardCancelParamsSchema,
  WizardRetryItemParamsSchema,
  WizardSubmitSelectionParamsSchema,
  formatIssue,
} from './wizard-generation-rpc.schema';

describe('wizard-generation-rpc.schema', () => {
  describe('WizardAgentIdSchema', () => {
    it.each(['backend-developer', 'code_logic.reviewer', 'a1'])(
      'accepts %s',
      (id) => {
        expect(WizardAgentIdSchema.safeParse(id).success).toBe(true);
      },
    );

    it.each(['', '../evil', 'a/b', 'a\\b', '..', '.hidden', 'a..b', 'x y'])(
      'rejects %j',
      (id) => {
        expect(WizardAgentIdSchema.safeParse(id).success).toBe(false);
      },
    );
  });

  describe('WizardSubmitSelectionParamsSchema', () => {
    it('accepts a fresh selection with optional generation inputs', () => {
      const result = WizardSubmitSelectionParamsSchema.safeParse({
        selectedAgentIds: ['agent-a', 'agent-b'],
        threshold: 60,
        variableOverrides: { PROJECT: 'ptah' },
        model: 'claude-sonnet-4-20250514',
        analysisDir: '/ws/.ptah/analysis/ptah',
      });
      expect(result.success).toBe(true);
      expect(result.data?.selectedAgentIds).toEqual(['agent-a', 'agent-b']);
      expect(result.data?.resume).toBeUndefined();
    });

    it('accepts resume: true without selectedAgentIds', () => {
      const result = WizardSubmitSelectionParamsSchema.safeParse({
        resume: true,
      });
      expect(result.success).toBe(true);
      expect(result.data?.selectedAgentIds).toBeUndefined();
    });

    it('rejects a traversal-y agent id', () => {
      const result = WizardSubmitSelectionParamsSchema.safeParse({
        selectedAgentIds: ['../../etc/passwd'],
      });
      expect(result.success).toBe(false);
    });

    it('rejects a threshold outside 0-100', () => {
      expect(
        WizardSubmitSelectionParamsSchema.safeParse({
          selectedAgentIds: ['a'],
          threshold: 101,
        }).success,
      ).toBe(false);
    });

    it('drops analysisData that is not a ProjectAnalysisResult instead of failing', () => {
      const result = WizardSubmitSelectionParamsSchema.safeParse({
        selectedAgentIds: ['a'],
        // The shape `ptah setup` sends: a MultiPhaseAnalysisResponse.
        analysisData: { isMultiPhase: true, manifest: {}, phaseContents: {} },
      });
      expect(result.success).toBe(true);
      expect(result.data?.analysisData).toBeUndefined();
    });

    it('keeps a well-formed ProjectAnalysisResult', () => {
      const analysisData = {
        projectType: 'monorepo',
        fileCount: 10,
        languages: ['ts'],
        frameworks: ['angular'],
        architecturePatterns: [],
        keyFileLocations: {
          entryPoints: [],
          configs: [],
          testDirectories: [],
          apiRoutes: [],
          components: [],
          services: [],
        },
        existingIssues: {
          errorCount: 0,
          warningCount: 0,
          infoCount: 0,
          errorsByType: {},
          warningsByType: {},
        },
        testCoverage: {
          percentage: 0,
          hasTests: false,
          hasUnitTests: false,
          hasIntegrationTests: false,
          hasE2eTests: false,
        },
      };
      const result = WizardSubmitSelectionParamsSchema.safeParse({
        selectedAgentIds: ['a'],
        analysisData,
      });
      expect(result.success).toBe(true);
      expect(result.data?.analysisData?.projectType).toBe('monorepo');
    });
  });

  describe('WizardCancelParamsSchema', () => {
    it('accepts an empty object and an optional boolean saveProgress', () => {
      expect(WizardCancelParamsSchema.safeParse({}).success).toBe(true);
      expect(
        WizardCancelParamsSchema.safeParse({ saveProgress: false }).success,
      ).toBe(true);
      expect(
        WizardCancelParamsSchema.safeParse({ saveProgress: 'no' }).success,
      ).toBe(false);
    });
  });

  describe('WizardRetryItemParamsSchema', () => {
    it('requires a safe itemId', () => {
      expect(WizardRetryItemParamsSchema.safeParse({}).success).toBe(false);
      expect(
        WizardRetryItemParamsSchema.safeParse({ itemId: '../x' }).success,
      ).toBe(false);
      expect(
        WizardRetryItemParamsSchema.safeParse({ itemId: 'agent-a' }).success,
      ).toBe(true);
    });
  });

  describe('formatIssue', () => {
    it('names the offending field without echoing its value', () => {
      const result = WizardSubmitSelectionParamsSchema.safeParse({
        selectedAgentIds: ['../secret-value'],
      });
      if (result.success) throw new Error('expected a validation failure');
      const message = formatIssue(result.error);
      expect(message).toMatch(/^selectedAgentIds\.0: /);
      expect(message).not.toContain('secret-value');
    });
  });
});
