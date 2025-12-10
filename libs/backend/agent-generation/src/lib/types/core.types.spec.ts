/**
 * Type Definition Tests
 *
 * Ensures all core types are properly defined, exported, and usable.
 * These tests verify TypeScript compilation and type safety.
 */
import type {
  AgentTemplate,
  ApplicabilityRules,
  TemplateVariable,
  LlmSection,
  AgentProjectContext,
  TechStackSummary,
  CodeConventions,
  LlmCustomization,
  GeneratedAgent,
  GenerationOptions,
  GenerationSummary,
  ValidationResult,
  ValidationIssue,
} from './core.types';

// Import only type definitions to avoid runtime dependencies
import type {
  ProjectType,
  Framework,
  MonorepoType,
  FileType,
} from '@ptah-extension/workspace-intelligence';

describe('Core Types', () => {
  describe('AgentTemplate', () => {
    it('should define a valid template structure', () => {
      const template: AgentTemplate = {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        content: '# Test Agent\n\n{{projectName}}',
        applicabilityRules: {
          projectTypes: ['node' as ProjectType],
          frameworks: ['express' as Framework],
          monorepoTypes: [],
          minimumRelevanceScore: 70,
          alwaysInclude: false,
        },
        variables: [
          {
            name: 'projectName',
            description: 'Name of the project',
            required: true,
            source: 'project-context',
          },
        ],
        llmSections: [
          {
            id: 'architecture',
            topic: 'Project Architecture',
            prompt: 'Describe the architecture',
            maxTokens: 1000,
          },
        ],
      };

      expect(template.id).toBe('test-agent');
      expect(template.variables).toHaveLength(1);
      expect(template.llmSections).toHaveLength(1);
    });
  });

  describe('ApplicabilityRules', () => {
    it('should allow empty arrays for universal templates', () => {
      const rules: ApplicabilityRules = {
        projectTypes: [],
        frameworks: [],
        monorepoTypes: [],
        minimumRelevanceScore: 50,
        alwaysInclude: true,
      };

      expect(rules.projectTypes).toHaveLength(0);
      expect(rules.alwaysInclude).toBe(true);
    });

    it('should support specific project type targeting', () => {
      const rules: ApplicabilityRules = {
        projectTypes: ['react' as ProjectType, 'angular' as ProjectType],
        frameworks: ['react' as Framework, 'angular' as Framework],
        monorepoTypes: ['nx' as MonorepoType],
        minimumRelevanceScore: 80,
        alwaysInclude: false,
      };

      expect(rules.projectTypes).toContain('react' as ProjectType);
      expect(rules.monorepoTypes).toContain('nx' as MonorepoType);
    });
  });

  describe('TemplateVariable', () => {
    it('should support all variable sources', () => {
      const contextVar: TemplateVariable = {
        name: 'projectType',
        description: 'Type of project',
        required: true,
        source: 'project-context',
      };

      const userVar: TemplateVariable = {
        name: 'authorName',
        description: 'Author name',
        defaultValue: 'Anonymous',
        required: false,
        source: 'user-input',
      };

      const llmVar: TemplateVariable = {
        name: 'description',
        description: 'Generated description',
        required: true,
        source: 'llm-generated',
      };

      expect(contextVar.source).toBe('project-context');
      expect(userVar.source).toBe('user-input');
      expect(llmVar.source).toBe('llm-generated');
    });
  });

  describe('AgentProjectContext', () => {
    it('should define complete project context', () => {
      const context: AgentProjectContext = {
        projectType: 'node' as ProjectType,
        frameworks: ['express' as Framework],
        monorepoType: 'nx' as MonorepoType,
        rootPath: '/workspace/test',
        relevantFiles: [
          {
            path: '/workspace/test/package.json',
            relativePath: 'package.json',
            type: 'config' as FileType,
            size: 1024,
            language: 'json',
            estimatedTokens: 256,
          },
        ],
        techStack: {
          languages: ['TypeScript', 'JavaScript'],
          frameworks: ['Express', 'NestJS'],
          buildTools: ['Nx', 'esbuild'],
          testingFrameworks: ['Jest'],
          packageManager: 'npm',
        },
        codeConventions: {
          indentation: 'spaces',
          indentSize: 2,
          quoteStyle: 'single',
          semicolons: true,
          trailingComma: 'es5',
        },
      };

      expect(context.projectType).toBe('node' as ProjectType);
      expect(context.frameworks).toContain('express' as Framework);
      expect(context.techStack.languages).toContain('TypeScript');
      expect(context.codeConventions.indentSize).toBe(2);
    });
  });

  describe('GeneratedAgent', () => {
    it('should define complete generated agent structure', () => {
      const agent: GeneratedAgent = {
        sourceTemplateId: 'backend-developer',
        sourceTemplateVersion: '1.0.0',
        content: '# Backend Developer\n\nGenerated content...',
        variables: {
          projectName: 'test-project',
          projectType: 'Node.js',
        },
        customizations: [
          {
            sectionId: 'architecture',
            originalPrompt: 'Describe the architecture',
            generatedContent: 'This project uses layered architecture...',
            tokensUsed: 500,
          },
        ],
        generatedAt: new Date(),
        filePath: '.claude/agents/backend-developer.md',
      };

      expect(agent.sourceTemplateId).toBe('backend-developer');
      expect(agent.variables['projectName']).toBe('test-project');
      expect(agent.customizations).toHaveLength(1);
    });
  });

  describe('GenerationOptions', () => {
    it('should define generation configuration', () => {
      const options: GenerationOptions = {
        threshold: 70,
        includeOptional: true,
        autoApprove: false,
        variableOverrides: {
          projectName: 'Custom Name',
        },
      };

      expect(options.threshold).toBe(70);
      expect(options.includeOptional).toBe(true);
      expect(options.autoApprove).toBe(false);
      expect(options.variableOverrides?.['projectName']).toBe('Custom Name');
    });
  });

  describe('GenerationSummary', () => {
    it('should track generation results', () => {
      const summary: GenerationSummary = {
        totalAgents: 5,
        successful: 4,
        failed: 1,
        durationMs: 45000,
        warnings: ['LLM fallback used for section "examples"'],
        agents: [],
      };

      expect(summary.successful).toBe(4);
      expect(summary.failed).toBe(1);
      expect(summary.warnings).toHaveLength(1);
    });
  });

  describe('ValidationResult', () => {
    it('should define validation outcome', () => {
      const result: ValidationResult = {
        isValid: false,
        issues: [
          {
            severity: 'error',
            message: 'Content contains malicious patterns',
            suggestion: 'Remove script tags',
          },
          {
            severity: 'warning',
            message: 'Content may be inaccurate',
          },
          {
            severity: 'info',
            message: 'Consider adding more examples',
          },
        ],
        score: 45,
      };

      expect(result.isValid).toBe(false);
      expect(result.issues).toHaveLength(3);
      expect(result.issues[0].severity).toBe('error');
      expect(result.score).toBe(45);
    });

    it('should allow valid content without issues', () => {
      const result: ValidationResult = {
        isValid: true,
        issues: [],
        score: 95,
      };

      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.score).toBeGreaterThanOrEqual(90);
    });
  });
});
