/**
 * Unit tests for AgentSelectionService
 *
 * Tests that all templates are always selected (intelligence comes from LLM,
 * not hard-coded scoring rules).
 */

import 'reflect-metadata';

// Mock workspace-intelligence to avoid transitive vscode / import.meta dependency
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  ProjectType: {
    Node: 'node',
    React: 'react',
    Python: 'python',
    General: 'general',
  },
  Framework: {
    Express: 'express',
    Angular: 'angular',
    Django: 'django',
    React: 'react',
    NextJS: 'nextjs',
  },
  MonorepoType: {
    Nx: 'nx',
    Lerna: 'lerna',
  },
}));

import { Logger } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import {
  ProjectType,
  Framework,
  MonorepoType,
} from '@ptah-extension/workspace-intelligence';
import { AgentSelectionService } from './agent-selection.service';
import { ITemplateStorageService } from '../interfaces/template-storage.interface';
import {
  AgentTemplate,
  AgentProjectContext,
  ApplicabilityRules,
} from '../types/core.types';

describe('AgentSelectionService', () => {
  let service: AgentSelectionService;
  let mockTemplateStorage: jest.Mocked<ITemplateStorageService>;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    mockTemplateStorage = {
      loadAllTemplates: jest.fn(),
      loadTemplate: jest.fn(),
      getApplicableTemplates: jest.fn(),
    } as unknown as jest.Mocked<ITemplateStorageService>;

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    } as unknown as jest.Mocked<Logger>;

    service = new AgentSelectionService(mockTemplateStorage, mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ========================================
  // Helper Functions
  // ========================================

  function createMockTemplate(
    overrides: Partial<AgentTemplate> = {},
  ): AgentTemplate {
    return {
      id: 'test-template',
      name: 'Test Template',
      version: '1.0.0',
      content: '# Test Template Content',
      applicabilityRules: {
        projectTypes: [],
        frameworks: [],
        monorepoTypes: [],
        minimumRelevanceScore: 50,
        alwaysInclude: false,
      },
      variables: [],
      llmSections: [],
      ...overrides,
    };
  }

  function createMockProjectContext(
    overrides: Partial<AgentProjectContext> = {},
  ): AgentProjectContext {
    return {
      projectType: ProjectType.Node,
      frameworks: [Framework.Express],
      monorepoType: undefined,
      rootPath: '/workspace/test-project',
      relevantFiles: [],
      techStack: {
        languages: ['TypeScript'],
        frameworks: ['Express'],
        buildTools: ['npm'],
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
      ...overrides,
    };
  }

  // ========================================
  // calculateRelevance Tests
  // ========================================

  describe('calculateRelevance', () => {
    it('should always return 100', async () => {
      const template = createMockTemplate();
      const context = createMockProjectContext();

      const result = await service.calculateRelevance(template, context);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe(100);
    });

    it('should return 100 regardless of template applicability rules', async () => {
      const template = createMockTemplate({
        applicabilityRules: {
          projectTypes: [ProjectType.Python],
          frameworks: [Framework.Django],
          monorepoTypes: [MonorepoType.Lerna],
          minimumRelevanceScore: 90,
          alwaysInclude: false,
        },
      });
      const context = createMockProjectContext({
        projectType: ProjectType.Node,
        frameworks: [Framework.Express],
      });

      const result = await service.calculateRelevance(template, context);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe(100);
    });
  });

  // ========================================
  // selectAgents Tests
  // ========================================

  describe('selectAgents', () => {
    it('should select all available templates', async () => {
      const templates: AgentTemplate[] = [
        createMockTemplate({ id: 'agent-1', name: 'Agent 1' }),
        createMockTemplate({ id: 'agent-2', name: 'Agent 2' }),
        createMockTemplate({ id: 'agent-3', name: 'Agent 3' }),
      ];

      mockTemplateStorage.loadAllTemplates.mockResolvedValue(
        Result.ok(templates),
      );

      const context = createMockProjectContext();

      const result = await service.selectAgents(context);

      expect(result.isOk()).toBe(true);
      expect(result.value!.length).toBe(3);
    });

    it('should assign relevanceScore 100 to all templates', async () => {
      const templates: AgentTemplate[] = [
        createMockTemplate({
          id: 'matching',
          applicabilityRules: {
            projectTypes: [ProjectType.Node],
            frameworks: [Framework.Express],
            monorepoTypes: [],
            minimumRelevanceScore: 50,
            alwaysInclude: false,
          },
        }),
        createMockTemplate({
          id: 'non-matching',
          applicabilityRules: {
            projectTypes: [ProjectType.Python],
            frameworks: [Framework.Django],
            monorepoTypes: [MonorepoType.Lerna],
            minimumRelevanceScore: 90,
            alwaysInclude: false,
          },
        }),
      ];

      mockTemplateStorage.loadAllTemplates.mockResolvedValue(
        Result.ok(templates),
      );

      const context = createMockProjectContext({
        projectType: ProjectType.Node,
        frameworks: [Framework.Express],
      });

      const result = await service.selectAgents(context);

      expect(result.isOk()).toBe(true);
      expect(result.value!.length).toBe(2);
      expect(result.value![0].relevanceScore).toBe(100);
      expect(result.value![1].relevanceScore).toBe(100);
    });

    it('should ignore threshold parameter', async () => {
      const templates: AgentTemplate[] = [
        createMockTemplate({ id: 'agent-1' }),
      ];

      mockTemplateStorage.loadAllTemplates.mockResolvedValue(
        Result.ok(templates),
      );

      const context = createMockProjectContext();

      // Even with threshold 100, all templates should be selected
      const result = await service.selectAgents(context, 100);

      expect(result.isOk()).toBe(true);
      expect(result.value!.length).toBe(1);
    });

    it('should handle template storage errors', async () => {
      mockTemplateStorage.loadAllTemplates.mockResolvedValue(
        Result.err(new Error('Storage failure')),
      );

      const context = createMockProjectContext();

      const result = await service.selectAgents(context);

      expect(result.isErr()).toBe(true);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to load templates',
        expect.any(Error),
      );
    });

    it('should return empty array when no templates in storage', async () => {
      mockTemplateStorage.loadAllTemplates.mockResolvedValue(Result.ok([]));

      const context = createMockProjectContext();

      const result = await service.selectAgents(context);

      expect(result.isOk()).toBe(true);
      expect(result.value!).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'No templates available for selection',
      );
    });

    it('should handle unknown project type gracefully', async () => {
      const templates: AgentTemplate[] = [
        createMockTemplate({ id: 'generic' }),
      ];

      mockTemplateStorage.loadAllTemplates.mockResolvedValue(
        Result.ok(templates),
      );

      const context = createMockProjectContext({
        projectType: ProjectType.General,
      });

      const result = await service.selectAgents(context);

      expect(result.isOk()).toBe(true);
      expect(result.value!.length).toBe(1);
    });
  });

  // ========================================
  // Criteria Tests
  // ========================================

  describe('criteria', () => {
    it('should include project type in criteria', async () => {
      const templates = [createMockTemplate({ id: 'test-agent' })];

      mockTemplateStorage.loadAllTemplates.mockResolvedValue(
        Result.ok(templates),
      );

      const context = createMockProjectContext({
        projectType: ProjectType.Node,
      });

      const result = await service.selectAgents(context);

      expect(result.isOk()).toBe(true);
      const criteria = result.value![0].matchedCriteria;
      expect(criteria).toContain(`Project type: ${ProjectType.Node}`);
    });

    it('should include frameworks in criteria', async () => {
      const templates = [createMockTemplate({ id: 'test-agent' })];

      mockTemplateStorage.loadAllTemplates.mockResolvedValue(
        Result.ok(templates),
      );

      const context = createMockProjectContext({
        frameworks: [Framework.Express, Framework.NextJS],
      });

      const result = await service.selectAgents(context);

      expect(result.isOk()).toBe(true);
      const criteria = result.value![0].matchedCriteria;
      expect(criteria.some((c) => c.includes('Frameworks:'))).toBe(true);
    });

    it('should include monorepo type in criteria when present', async () => {
      const templates = [createMockTemplate({ id: 'test-agent' })];

      mockTemplateStorage.loadAllTemplates.mockResolvedValue(
        Result.ok(templates),
      );

      const context = createMockProjectContext({
        monorepoType: MonorepoType.Nx,
      });

      const result = await service.selectAgents(context);

      expect(result.isOk()).toBe(true);
      const criteria = result.value![0].matchedCriteria;
      expect(criteria.some((c) => c.includes('Monorepo:'))).toBe(true);
    });

    it('should include languages in criteria', async () => {
      const templates = [createMockTemplate({ id: 'test-agent' })];

      mockTemplateStorage.loadAllTemplates.mockResolvedValue(
        Result.ok(templates),
      );

      const context = createMockProjectContext({
        techStack: {
          languages: ['TypeScript', 'JavaScript'],
          frameworks: ['Express'],
          buildTools: ['npm'],
          testingFrameworks: ['Jest'],
          packageManager: 'npm',
        },
      });

      const result = await service.selectAgents(context);

      expect(result.isOk()).toBe(true);
      const criteria = result.value![0].matchedCriteria;
      expect(criteria.some((c) => c.includes('Languages:'))).toBe(true);
    });
  });

  // ========================================
  // Logging Tests
  // ========================================

  describe('Logging', () => {
    it('should log selection summary', async () => {
      const templates: AgentTemplate[] = [
        createMockTemplate({ id: 'agent1' }),
        createMockTemplate({ id: 'agent2' }),
      ];

      mockTemplateStorage.loadAllTemplates.mockResolvedValue(
        Result.ok(templates),
      );

      const context = createMockProjectContext();

      await service.selectAgents(context);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Agent selection complete',
        expect.objectContaining({
          totalTemplates: 2,
          selectedCount: 2,
        }),
      );
    });
  });
});
