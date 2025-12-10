/**
 * Unit tests for AgentSelectionService
 *
 * Tests scoring algorithm, threshold filtering, fallback mechanisms,
 * and edge case handling.
 */

import 'reflect-metadata';
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
    // Mock TemplateStorageService
    mockTemplateStorage = {
      loadAllTemplates: jest.fn(),
      loadTemplate: jest.fn(),
      getApplicableTemplates: jest.fn(),
    } as unknown as jest.Mocked<ITemplateStorageService>;

    // Mock Logger
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    } as unknown as jest.Mocked<Logger>;

    // Create service instance
    service = new AgentSelectionService(mockTemplateStorage, mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ========================================
  // Helper Functions
  // ========================================

  /**
   * Create a mock AgentTemplate with default values.
   */
  function createMockTemplate(
    overrides: Partial<AgentTemplate> = {}
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

  /**
   * Create a mock AgentProjectContext with default values.
   */
  function createMockProjectContext(
    overrides: Partial<AgentProjectContext> = {}
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

  /**
   * Create applicability rules with defaults.
   */
  function createApplicabilityRules(
    overrides: Partial<ApplicabilityRules> = {}
  ): ApplicabilityRules {
    return {
      projectTypes: [],
      frameworks: [],
      monorepoTypes: [],
      minimumRelevanceScore: 50,
      alwaysInclude: false,
      ...overrides,
    };
  }

  // ========================================
  // Scoring Rules Tests
  // ========================================

  describe('calculateRelevance', () => {
    it('should score 100 for always-include templates', async () => {
      const template = createMockTemplate({
        id: 'orchestrate',
        applicabilityRules: createApplicabilityRules({
          alwaysInclude: true,
        }),
      });
      const context = createMockProjectContext();

      const result = await service.calculateRelevance(template, context);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe(100);
    });

    it('should score 40 points for project type match', async () => {
      const template = createMockTemplate({
        applicabilityRules: createApplicabilityRules({
          projectTypes: [ProjectType.Node],
          frameworks: [],
          monorepoTypes: [],
        }),
      });
      const context = createMockProjectContext({
        projectType: ProjectType.Node,
        frameworks: [],
        monorepoType: undefined,
      });

      const result = await service.calculateRelevance(template, context);

      expect(result.isOk()).toBe(true);
      // 40 (project type) + 10 (not monorepo, template agnostic)
      expect(result.value).toBe(50);
    });

    it('should score 10 points per framework match (max 30)', async () => {
      const template = createMockTemplate({
        applicabilityRules: createApplicabilityRules({
          projectTypes: [ProjectType.Node],
          frameworks: [Framework.Express, Framework.NextJS],
        }),
      });
      const context = createMockProjectContext({
        projectType: ProjectType.Node,
        frameworks: [Framework.Express, Framework.NextJS],
        monorepoType: undefined,
      });

      const result = await service.calculateRelevance(template, context);

      expect(result.isOk()).toBe(true);
      // 40 (project) + 20 (2 frameworks) + 10 (not monorepo)
      expect(result.value).toBe(70);
    });

    it('should cap framework score at 30 points', async () => {
      const template = createMockTemplate({
        applicabilityRules: createApplicabilityRules({
          projectTypes: [ProjectType.Node],
          frameworks: [
            Framework.Express,
            Framework.NextJS,
            Framework.Vue,
            Framework.React,
          ],
        }),
      });
      const context = createMockProjectContext({
        projectType: ProjectType.Node,
        frameworks: [
          Framework.Express,
          Framework.NextJS,
          Framework.Vue,
          Framework.React,
        ],
        monorepoType: undefined,
      });

      const result = await service.calculateRelevance(template, context);

      expect(result.isOk()).toBe(true);
      // 40 (project) + 30 (max frameworks) + 10 (not monorepo)
      expect(result.value).toBe(80);
    });

    it('should score 20 points for monorepo type match', async () => {
      const template = createMockTemplate({
        applicabilityRules: createApplicabilityRules({
          projectTypes: [ProjectType.Node],
          frameworks: [],
          monorepoTypes: [MonorepoType.Nx],
        }),
      });
      const context = createMockProjectContext({
        projectType: ProjectType.Node,
        frameworks: [],
        monorepoType: MonorepoType.Nx,
      });

      const result = await service.calculateRelevance(template, context);

      expect(result.isOk()).toBe(true);
      // 40 (project) + 20 (monorepo match)
      expect(result.value).toBe(60);
    });

    it('should score 10 points for monorepo-agnostic templates when not in monorepo', async () => {
      const template = createMockTemplate({
        applicabilityRules: createApplicabilityRules({
          projectTypes: [ProjectType.Node],
          frameworks: [],
          monorepoTypes: [], // Monorepo-agnostic
        }),
      });
      const context = createMockProjectContext({
        projectType: ProjectType.Node,
        frameworks: [],
        monorepoType: undefined, // Not a monorepo
      });

      const result = await service.calculateRelevance(template, context);

      expect(result.isOk()).toBe(true);
      // 40 (project) + 10 (monorepo agnostic, not in monorepo)
      expect(result.value).toBe(50);
    });

    it('should score 0 for no matches', async () => {
      const template = createMockTemplate({
        applicabilityRules: createApplicabilityRules({
          projectTypes: [ProjectType.Python],
          frameworks: [Framework.Django],
          monorepoTypes: [MonorepoType.Lerna],
        }),
      });
      const context = createMockProjectContext({
        projectType: ProjectType.Node,
        frameworks: [Framework.Express],
        monorepoType: undefined,
      });

      const result = await service.calculateRelevance(template, context);

      expect(result.isOk()).toBe(true);
      expect(result.value).toBe(0);
    });

    it('should handle templates with empty projectTypes (match all)', async () => {
      const template = createMockTemplate({
        applicabilityRules: createApplicabilityRules({
          projectTypes: [], // Matches all project types
          frameworks: [],
          monorepoTypes: [],
        }),
      });
      const context = createMockProjectContext({
        projectType: ProjectType.Python,
        frameworks: [],
        monorepoType: undefined,
      });

      const result = await service.calculateRelevance(template, context);

      expect(result.isOk()).toBe(true);
      // 40 (project type match all) + 10 (monorepo agnostic)
      expect(result.value).toBe(50);
    });
  });

  // ========================================
  // Agent Selection Tests
  // ========================================

  describe('selectAgents', () => {
    it('should select agents above threshold', async () => {
      const templates: AgentTemplate[] = [
        createMockTemplate({
          id: 'high-score',
          name: 'High Score',
          applicabilityRules: createApplicabilityRules({
            projectTypes: [ProjectType.Node],
            frameworks: [Framework.Express],
            alwaysInclude: false,
          }),
        }),
        createMockTemplate({
          id: 'low-score',
          name: 'Low Score',
          applicabilityRules: createApplicabilityRules({
            projectTypes: [ProjectType.Python],
            frameworks: [Framework.Django],
            alwaysInclude: false,
          }),
        }),
      ];

      mockTemplateStorage.loadAllTemplates.mockResolvedValue(
        Result.ok(templates)
      );

      const context = createMockProjectContext({
        projectType: ProjectType.Node,
        frameworks: [Framework.Express],
      });

      const result = await service.selectAgents(context, 50);

      expect(result.isOk()).toBe(true);
      expect(result.value!.length).toBe(1);
      expect(result.value![0].template.id).toBe('high-score');
      expect(result.value![0].relevanceScore).toBeGreaterThanOrEqual(50);
    });

    it('should sort results by relevance score descending', async () => {
      const templates: AgentTemplate[] = [
        createMockTemplate({
          id: 'medium',
          applicabilityRules: createApplicabilityRules({
            projectTypes: [ProjectType.Node],
            frameworks: [Framework.Express],
          }),
        }),
        createMockTemplate({
          id: 'high',
          applicabilityRules: createApplicabilityRules({
            projectTypes: [ProjectType.Node],
            frameworks: [Framework.Express, Framework.NextJS],
          }),
        }),
        createMockTemplate({
          id: 'always',
          applicabilityRules: createApplicabilityRules({
            alwaysInclude: true,
          }),
        }),
      ];

      mockTemplateStorage.loadAllTemplates.mockResolvedValue(
        Result.ok(templates)
      );

      const context = createMockProjectContext({
        projectType: ProjectType.Node,
        frameworks: [Framework.Express, Framework.NextJS],
      });

      const result = await service.selectAgents(context, 50);

      expect(result.isOk()).toBe(true);
      expect(result.value!.length).toBe(3);
      // Always-include should be first (score 100)
      expect(result.value![0].template.id).toBe('always');
      expect(result.value![0].relevanceScore).toBe(100);
      // High score should be second (70 points)
      expect(result.value![1].template.id).toBe('high');
      // Medium score should be third (60 points)
      expect(result.value![2].template.id).toBe('medium');
    });

    it('should return top 3 agents when no agents meet threshold', async () => {
      const templates: AgentTemplate[] = [
        createMockTemplate({
          id: 'agent1',
          applicabilityRules: createApplicabilityRules({
            projectTypes: [ProjectType.Python],
          }),
        }),
        createMockTemplate({
          id: 'agent2',
          applicabilityRules: createApplicabilityRules({
            projectTypes: [ProjectType.Java],
          }),
        }),
        createMockTemplate({
          id: 'agent3',
          applicabilityRules: createApplicabilityRules({
            projectTypes: [ProjectType.Rust],
          }),
        }),
        createMockTemplate({
          id: 'agent4',
          applicabilityRules: createApplicabilityRules({
            projectTypes: [ProjectType.Go],
          }),
        }),
      ];

      mockTemplateStorage.loadAllTemplates.mockResolvedValue(
        Result.ok(templates)
      );

      const context = createMockProjectContext({
        projectType: ProjectType.Node, // No match for any template
      });

      const result = await service.selectAgents(context, 90); // High threshold

      expect(result.isOk()).toBe(true);
      expect(result.value!.length).toBe(3); // Top 3 only
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No templates meet threshold')
      );
    });

    it('should fallback to core agents when no templates available', async () => {
      const coreTemplates: AgentTemplate[] = [
        createMockTemplate({ id: 'orchestrate', name: 'Orchestrate' }),
        createMockTemplate({ id: 'team-leader', name: 'Team Leader' }),
        createMockTemplate({
          id: 'backend-developer',
          name: 'Backend Developer',
        }),
        createMockTemplate({ id: 'other-agent', name: 'Other Agent' }),
      ];

      mockTemplateStorage.loadAllTemplates.mockResolvedValue(
        Result.ok(coreTemplates)
      );

      const context = createMockProjectContext({
        projectType: ProjectType.General,
      });

      // Set all templates to score 0 (no matches)
      const templates = coreTemplates.map((t) =>
        createMockTemplate({
          ...t,
          applicabilityRules: createApplicabilityRules({
            projectTypes: [ProjectType.Python], // Won't match Node
            frameworks: [Framework.Django],
          }),
        })
      );

      mockTemplateStorage.loadAllTemplates.mockResolvedValue(
        Result.ok(templates)
      );

      const result = await service.selectAgents(context, 90);

      expect(result.isOk()).toBe(true);
      expect(result.value!.length).toBeGreaterThan(0);
    });

    it('should handle invalid threshold', async () => {
      const context = createMockProjectContext();

      const resultNegative = await service.selectAgents(context, -10);
      expect(resultNegative.isErr()).toBe(true);
      expect(resultNegative.error!.message).toContain('Invalid threshold');

      const resultOver = await service.selectAgents(context, 150);
      expect(resultOver.isErr()).toBe(true);
      expect(resultOver.error!.message).toContain('Invalid threshold');
    });

    it('should handle template storage errors', async () => {
      mockTemplateStorage.loadAllTemplates.mockResolvedValue(
        Result.err(new Error('Storage failure'))
      );

      const context = createMockProjectContext();

      const result = await service.selectAgents(context, 50);

      expect(result.isErr()).toBe(true);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to load templates',
        expect.any(Error)
      );
    });

    it('should return empty array when no templates in storage', async () => {
      mockTemplateStorage.loadAllTemplates.mockResolvedValue(Result.ok([]));

      const context = createMockProjectContext();

      const result = await service.selectAgents(context, 50);

      expect(result.isOk()).toBe(true);
      expect(result.value!).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'No templates available for selection'
      );
    });

    it('should skip templates that fail scoring', async () => {
      const templates: AgentTemplate[] = [
        createMockTemplate({
          id: 'valid',
          applicabilityRules: createApplicabilityRules({
            projectTypes: [ProjectType.Node],
          }),
        }),
        // This will be skipped due to scoring error (simulated in spy)
        createMockTemplate({
          id: 'invalid',
          applicabilityRules: createApplicabilityRules({
            projectTypes: [ProjectType.Node],
          }),
        }),
      ];

      mockTemplateStorage.loadAllTemplates.mockResolvedValue(
        Result.ok(templates)
      );

      // Spy on calculateRelevance to simulate error for 'invalid' template
      jest
        .spyOn(service, 'calculateRelevance')
        .mockImplementation((template, context) => {
          if (template.id === 'invalid') {
            return Promise.resolve(Result.err(new Error('Scoring error')));
          }
          // Call original implementation for others
          return AgentSelectionService.prototype.calculateRelevance.call(
            service,
            template,
            context
          );
        });

      const context = createMockProjectContext({
        projectType: ProjectType.Node,
      });

      const result = await service.selectAgents(context, 40);

      expect(result.isOk()).toBe(true);
      expect(result.value!.length).toBe(1);
      expect(result.value![0].template.id).toBe('valid');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to score template: invalid'),
        expect.any(Error)
      );
    });
  });

  // ========================================
  // Matched Criteria Tests
  // ========================================

  describe('buildMatchedCriteria', () => {
    it('should include always-include flag', async () => {
      const template = createMockTemplate({
        applicabilityRules: createApplicabilityRules({
          alwaysInclude: true,
        }),
      });

      mockTemplateStorage.loadAllTemplates.mockResolvedValue(
        Result.ok([template])
      );

      const context = createMockProjectContext();

      const result = await service.selectAgents(context, 50);

      expect(result.isOk()).toBe(true);
      expect(result.value![0].matchedCriteria).toContain(
        'Always include flag set'
      );
    });

    it('should include project type match', async () => {
      const template = createMockTemplate({
        applicabilityRules: createApplicabilityRules({
          projectTypes: [ProjectType.Node],
        }),
      });

      mockTemplateStorage.loadAllTemplates.mockResolvedValue(
        Result.ok([template])
      );

      const context = createMockProjectContext({
        projectType: ProjectType.Node,
      });

      const result = await service.selectAgents(context, 40);

      expect(result.isOk()).toBe(true);
      expect(result.value![0].matchedCriteria).toContain(
        `Project type matches: ${ProjectType.Node}`
      );
    });

    it('should include framework matches', async () => {
      const template = createMockTemplate({
        applicabilityRules: createApplicabilityRules({
          projectTypes: [ProjectType.Node],
          frameworks: [Framework.Express, Framework.NextJS],
        }),
      });

      mockTemplateStorage.loadAllTemplates.mockResolvedValue(
        Result.ok([template])
      );

      const context = createMockProjectContext({
        projectType: ProjectType.Node,
        frameworks: [Framework.Express, Framework.NextJS],
      });

      const result = await service.selectAgents(context, 50);

      expect(result.isOk()).toBe(true);
      expect(result.value![0].matchedCriteria).toContain(
        `Framework matches: ${Framework.Express}, ${Framework.NextJS}`
      );
    });

    it('should include monorepo type match', async () => {
      const template = createMockTemplate({
        applicabilityRules: createApplicabilityRules({
          projectTypes: [ProjectType.Node],
          monorepoTypes: [MonorepoType.Nx],
        }),
      });

      mockTemplateStorage.loadAllTemplates.mockResolvedValue(
        Result.ok([template])
      );

      const context = createMockProjectContext({
        projectType: ProjectType.Node,
        monorepoType: MonorepoType.Nx,
      });

      const result = await service.selectAgents(context, 50);

      expect(result.isOk()).toBe(true);
      expect(result.value![0].matchedCriteria).toContain(
        `Monorepo type matches: ${MonorepoType.Nx}`
      );
    });

    it('should include relevance category', async () => {
      const highTemplate = createMockTemplate({
        id: 'high',
        applicabilityRules: createApplicabilityRules({
          alwaysInclude: true, // Score: 100
        }),
      });
      const mediumTemplate = createMockTemplate({
        id: 'medium',
        applicabilityRules: createApplicabilityRules({
          projectTypes: [ProjectType.Node],
          frameworks: [Framework.Express], // Score: 60
        }),
      });
      const lowTemplate = createMockTemplate({
        id: 'low',
        applicabilityRules: createApplicabilityRules({
          projectTypes: [ProjectType.Node], // Score: 50
        }),
      });

      mockTemplateStorage.loadAllTemplates.mockResolvedValue(
        Result.ok([highTemplate, mediumTemplate, lowTemplate])
      );

      const context = createMockProjectContext({
        projectType: ProjectType.Node,
        frameworks: [Framework.Express],
      });

      const result = await service.selectAgents(context, 40);

      expect(result.isOk()).toBe(true);

      // High score (100)
      expect(result.value![0].matchedCriteria).toContain(
        'Always include flag set'
      );

      // Medium score (60)
      const mediumResult = result.value!.find(
        (r) => r.template.id === 'medium'
      );
      expect(mediumResult!.matchedCriteria).toContain(
        'Moderately relevant (score >= 50)'
      );

      // Low score (50)
      const lowResult = result.value!.find((r) => r.template.id === 'low');
      expect(lowResult!.matchedCriteria).toContain(
        'Moderately relevant (score >= 50)'
      );
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('should handle unknown project type gracefully', async () => {
      const templates: AgentTemplate[] = [
        createMockTemplate({
          id: 'generic',
          applicabilityRules: createApplicabilityRules({
            projectTypes: [], // Matches all
          }),
        }),
      ];

      mockTemplateStorage.loadAllTemplates.mockResolvedValue(
        Result.ok(templates)
      );

      const context = createMockProjectContext({
        projectType: ProjectType.General, // Unknown/generic
      });

      const result = await service.selectAgents(context, 40);

      expect(result.isOk()).toBe(true);
      expect(result.value!.length).toBeGreaterThan(0);
    });

    it('should handle empty file index', async () => {
      const templates: AgentTemplate[] = [
        createMockTemplate({
          id: 'test',
          applicabilityRules: createApplicabilityRules({
            projectTypes: [ProjectType.Node],
          }),
        }),
      ];

      mockTemplateStorage.loadAllTemplates.mockResolvedValue(
        Result.ok(templates)
      );

      const context = createMockProjectContext({
        projectType: ProjectType.Node,
        relevantFiles: [], // Empty file index
      });

      const result = await service.selectAgents(context, 40);

      expect(result.isOk()).toBe(true);
      expect(result.value!.length).toBeGreaterThan(0);
    });

    it('should handle context with no frameworks', async () => {
      const template = createMockTemplate({
        applicabilityRules: createApplicabilityRules({
          projectTypes: [ProjectType.Node],
          frameworks: [Framework.Express],
        }),
      });

      mockTemplateStorage.loadAllTemplates.mockResolvedValue(
        Result.ok([template])
      );

      const context = createMockProjectContext({
        projectType: ProjectType.Node,
        frameworks: [], // No frameworks detected
      });

      const result = await service.selectAgents(context, 40);

      expect(result.isOk()).toBe(true);
      // Should still match on project type (40 points)
      expect(result.value![0].relevanceScore).toBe(50); // 40 + 10 (not monorepo)
    });

    it('should handle context without monorepo type', async () => {
      const template = createMockTemplate({
        applicabilityRules: createApplicabilityRules({
          projectTypes: [ProjectType.Node],
          monorepoTypes: [MonorepoType.Nx],
        }),
      });

      mockTemplateStorage.loadAllTemplates.mockResolvedValue(
        Result.ok([template])
      );

      const context = createMockProjectContext({
        projectType: ProjectType.Node,
        monorepoType: undefined, // Not a monorepo
      });

      const result = await service.selectAgents(context, 40);

      expect(result.isOk()).toBe(true);
      // Should match on project type only (40 points)
      expect(result.value![0].relevanceScore).toBe(40);
    });
  });

  // ========================================
  // Logging Tests
  // ========================================

  describe('Logging', () => {
    it('should log selection summary', async () => {
      const templates: AgentTemplate[] = [
        createMockTemplate({
          id: 'agent1',
          applicabilityRules: createApplicabilityRules({
            projectTypes: [ProjectType.Node],
          }),
        }),
      ];

      mockTemplateStorage.loadAllTemplates.mockResolvedValue(
        Result.ok(templates)
      );

      const context = createMockProjectContext({
        projectType: ProjectType.Node,
      });

      await service.selectAgents(context, 40);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Agent selection complete',
        expect.objectContaining({
          totalTemplates: 1,
          selectedCount: 1,
          threshold: 40,
        })
      );
    });

    it('should log each selected agent reasoning', async () => {
      const template = createMockTemplate({
        id: 'test-agent',
        name: 'Test Agent',
        applicabilityRules: createApplicabilityRules({
          projectTypes: [ProjectType.Node],
        }),
      });

      mockTemplateStorage.loadAllTemplates.mockResolvedValue(
        Result.ok([template])
      );

      const context = createMockProjectContext({
        projectType: ProjectType.Node,
      });

      await service.selectAgents(context, 40);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Selected agent',
        expect.objectContaining({
          agentId: 'test-agent',
          agentName: 'Test Agent',
          score: expect.any(Number),
          criteria: expect.any(Array),
        })
      );
    });
  });
});
