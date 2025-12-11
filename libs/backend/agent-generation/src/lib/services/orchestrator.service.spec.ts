/**
 * Agent Generation Orchestrator Service Tests
 *
 * Comprehensive test suite covering:
 * - End-to-end workflow (happy path)
 * - Phase failures (all 5 phases)
 * - Partial success scenarios
 * - User overrides
 * - Progress reporting
 *
 * @module @ptah-extension/agent-generation/services/tests
 */

import 'reflect-metadata';
import * as vscode from 'vscode';
import { AgentGenerationOrchestratorService } from './orchestrator.service';
import { IAgentSelectionService } from '../interfaces/agent-selection.interface';
import { ITemplateStorageService } from '../interfaces/template-storage.interface';
import { IContentGenerationService } from '../interfaces/content-generation.interface';
import { IAgentFileWriterService } from '../interfaces/agent-file-writer.interface';
import { VsCodeLmService } from './vscode-lm.service';
import { Logger } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';

// Mock vscode-core
jest.mock('@ptah-extension/vscode-core');

describe('AgentGenerationOrchestratorService', () => {
  let service: AgentGenerationOrchestratorService;
  let mockAgentSelector: jest.Mocked<IAgentSelectionService>;
  let mockTemplateStorage: jest.Mocked<ITemplateStorageService>;
  let mockLlmService: jest.Mocked<VsCodeLmService>;
  let mockContentGenerator: jest.Mocked<IContentGenerationService>;
  let mockFileWriter: jest.Mocked<IAgentFileWriterService>;
  let mockLogger: jest.Mocked<Logger>;

  const mockWorkspaceUri = {
    fsPath: '/test/workspace',
  } as vscode.Uri;

  const mockTemplate = {
    id: 'test-agent',
    name: 'Test Agent',
    version: '1.0.0',
    content: '# Test Agent Content',
    applicabilityRules: {
      projectTypes: [],
      frameworks: [],
      monorepoTypes: [],
      minimumRelevanceScore: 50,
      alwaysInclude: false,
    },
    variables: [],
    llmSections: [
      {
        id: 'test-section',
        topic: 'Test Topic',
        prompt: 'Test prompt',
        maxTokens: 1000,
      },
    ],
  };

  const mockGeneratedAgent = {
    id: 'test-agent',
    name: 'Test Agent',
    content: '# Generated Agent Content',
    path: '.claude/agents/test-agent.md',
    metadata: {
      generatedAt: new Date().toISOString(),
      version: '1.0.0',
    },
  };

  beforeEach(() => {
    // Create mocks
    mockAgentSelector = {
      selectAgents: jest.fn(),
      calculateRelevance: jest.fn(),
    } as unknown as jest.Mocked<IAgentSelectionService>;

    mockTemplateStorage = {
      loadTemplate: jest.fn(),
      loadAllTemplates: jest.fn(),
      getAvailableTemplates: jest.fn(),
    } as unknown as jest.Mocked<ITemplateStorageService>;

    mockLlmService = {
      batchCustomize: jest.fn(),
      customizeSection: jest.fn(),
    } as unknown as jest.Mocked<VsCodeLmService>;

    mockContentGenerator = {
      generateContent: jest.fn(),
      generateLlmSections: jest.fn(),
    } as unknown as jest.Mocked<IContentGenerationService>;

    mockFileWriter = {
      writeAgentsBatch: jest.fn(),
      writeAgent: jest.fn(),
      backupExisting: jest.fn(),
    } as unknown as jest.Mocked<IAgentFileWriterService>;

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as jest.Mocked<Logger>;

    // Create service
    service = new AgentGenerationOrchestratorService(
      mockAgentSelector,
      mockTemplateStorage,
      mockLlmService,
      mockContentGenerator,
      mockFileWriter,
      mockLogger
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('End-to-End Workflow (Happy Path)', () => {
    it('should complete all 5 phases successfully', async () => {
      // Arrange
      mockAgentSelector.selectAgents.mockResolvedValue(
        Result.ok([
          {
            template: mockTemplate,
            relevanceScore: 85,
            matchedCriteria: ['Project type matches'],
          },
        ])
      );

      mockTemplateStorage.loadTemplate.mockResolvedValue(
        Result.ok(mockTemplate)
      );

      mockLlmService.batchCustomize.mockResolvedValue(
        new Map([['test-section', Result.ok('Customized content')]])
      );

      mockContentGenerator.generateContent.mockResolvedValue(
        Result.ok('# Generated content')
      );

      mockFileWriter.writeAgentsBatch.mockResolvedValue(Result.ok([]));

      // Act
      const result = await service.generateAgents({
        workspaceUri: mockWorkspaceUri,
      });

      // Assert
      expect(result.isOk()).toBe(true);
      expect(result.value?.successful).toBe(1);
      expect(result.value?.failed).toBe(0);
      expect(result.value?.agents.length).toBe(1);
      expect(mockAgentSelector.selectAgents).toHaveBeenCalled();
      expect(mockTemplateStorage.loadTemplate).toHaveBeenCalled();
      expect(mockLlmService.batchCustomize).toHaveBeenCalled();
      expect(mockContentGenerator.generateContent).toHaveBeenCalled();
      expect(mockFileWriter.writeAgentsBatch).toHaveBeenCalled();
    });

    it('should invoke progress callback for all phases', async () => {
      // Arrange
      const progressCallback = jest.fn();

      mockAgentSelector.selectAgents.mockResolvedValue(
        Result.ok([
          {
            template: mockTemplate,
            relevanceScore: 85,
            matchedCriteria: [],
          },
        ])
      );

      mockTemplateStorage.loadTemplate.mockResolvedValue(
        Result.ok(mockTemplate)
      );
      mockLlmService.batchCustomize.mockResolvedValue(new Map());
      mockContentGenerator.generateContent.mockResolvedValue(
        Result.ok('# Generated content')
      );
      mockFileWriter.writeAgentsBatch.mockResolvedValue(Result.ok([]));

      // Act
      await service.generateAgents(
        { workspaceUri: mockWorkspaceUri },
        progressCallback
      );

      // Assert
      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'analysis' })
      );
      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'selection' })
      );
      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'customization' })
      );
      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'rendering' })
      );
      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'writing' })
      );
      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'complete', percentComplete: 100 })
      );
    });

    it('should generate accurate summary', async () => {
      // Arrange
      mockAgentSelector.selectAgents.mockResolvedValue(
        Result.ok([
          {
            template: mockTemplate,
            relevanceScore: 85,
            matchedCriteria: [],
          },
        ])
      );

      mockTemplateStorage.loadTemplate.mockResolvedValue(
        Result.ok(mockTemplate)
      );
      mockLlmService.batchCustomize.mockResolvedValue(new Map());
      mockContentGenerator.generateContent.mockResolvedValue(
        Result.ok('# Generated content')
      );
      mockFileWriter.writeAgentsBatch.mockResolvedValue(Result.ok([]));

      // Act
      const result = await service.generateAgents({
        workspaceUri: mockWorkspaceUri,
      });

      // Assert
      expect(result.isOk()).toBe(true);
      const summary = result.value!;
      expect(summary.totalAgents).toBe(1);
      expect(summary.successful).toBe(1);
      expect(summary.failed).toBe(0);
      expect(summary.durationMs).toBeGreaterThan(0);
      expect(Array.isArray(summary.warnings)).toBe(true);
      expect(summary.agents).toHaveLength(1);
    });
  });

  describe('Phase Failures', () => {
    it('should handle selection failure (no agents matched)', async () => {
      // Arrange
      mockAgentSelector.selectAgents.mockResolvedValue(Result.ok([]));

      // Act
      const result = await service.generateAgents({
        workspaceUri: mockWorkspaceUri,
      });

      // Assert
      expect(result.isOk()).toBe(true);
      expect(result.value?.successful).toBe(0);
      expect(result.value?.warnings).toContain(
        'No agents matched selection criteria'
      );
    });

    it('should handle selection service error', async () => {
      // Arrange
      mockAgentSelector.selectAgents.mockResolvedValue(
        Result.err(new Error('Selection service failed'))
      );

      // Act
      const result = await service.generateAgents({
        workspaceUri: mockWorkspaceUri,
      });

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Selection service failed');
    });

    it('should handle customization failure with fallback', async () => {
      // Arrange
      mockAgentSelector.selectAgents.mockResolvedValue(
        Result.ok([
          {
            template: mockTemplate,
            relevanceScore: 85,
            matchedCriteria: [],
          },
        ])
      );

      mockTemplateStorage.loadTemplate.mockResolvedValue(
        Result.ok(mockTemplate)
      );

      // LLM service fails
      mockLlmService.batchCustomize.mockRejectedValue(
        new Error('LLM service unavailable')
      );

      mockContentGenerator.generateContent.mockResolvedValue(
        Result.ok('# Generated content')
      );
      mockFileWriter.writeAgentsBatch.mockResolvedValue(Result.ok([]));

      // Act
      const result = await service.generateAgents({
        workspaceUri: mockWorkspaceUri,
      });

      // Assert
      expect(result.isOk()).toBe(true);
      expect(result.value?.warnings.length).toBeGreaterThan(0);
      expect(result.value?.warnings[0]).toContain('LLM customization failed');
    });

    it('should handle rendering failure', async () => {
      // Arrange
      mockAgentSelector.selectAgents.mockResolvedValue(
        Result.ok([
          {
            template: mockTemplate,
            relevanceScore: 85,
            matchedCriteria: [],
          },
        ])
      );

      mockTemplateStorage.loadTemplate.mockResolvedValue(
        Result.ok(mockTemplate)
      );
      mockLlmService.batchCustomize.mockResolvedValue(new Map());

      // Rendering fails
      mockContentGenerator.generateContent.mockResolvedValue(
        Result.err(new Error('Template rendering failed'))
      );

      // Act
      const result = await service.generateAgents({
        workspaceUri: mockWorkspaceUri,
      });

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain(
        'No agents were successfully rendered'
      );
    });

    it('should handle writing failure', async () => {
      // Arrange
      mockAgentSelector.selectAgents.mockResolvedValue(
        Result.ok([
          {
            template: mockTemplate,
            relevanceScore: 85,
            matchedCriteria: [],
          },
        ])
      );

      mockTemplateStorage.loadTemplate.mockResolvedValue(
        Result.ok(mockTemplate)
      );
      mockLlmService.batchCustomize.mockResolvedValue(new Map());
      mockContentGenerator.generateContent.mockResolvedValue(
        Result.ok('# Generated content')
      );

      // File writing fails
      mockFileWriter.writeAgentsBatch.mockResolvedValue(
        Result.err(new Error('File write permission denied'))
      );

      // Act
      const result = await service.generateAgents({
        workspaceUri: mockWorkspaceUri,
      });

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('File write permission denied');
    });
  });

  describe('User Overrides', () => {
    it('should use user-selected agents instead of automatic selection', async () => {
      // Arrange
      const userOverrides = ['test-agent', 'another-agent'];

      mockTemplateStorage.loadTemplate.mockResolvedValue(
        Result.ok(mockTemplate)
      );
      mockLlmService.batchCustomize.mockResolvedValue(new Map());
      mockContentGenerator.generateContent.mockResolvedValue(
        Result.ok('# Generated content')
      );
      mockFileWriter.writeAgentsBatch.mockResolvedValue(Result.ok([]));

      // Act
      await service.generateAgents({
        workspaceUri: mockWorkspaceUri,
        userOverrides,
      });

      // Assert
      expect(mockAgentSelector.selectAgents).not.toHaveBeenCalled();
      expect(mockTemplateStorage.loadTemplate).toHaveBeenCalledWith(
        'test-agent'
      );
      expect(mockTemplateStorage.loadTemplate).toHaveBeenCalledWith(
        'another-agent'
      );
    });

    it('should apply custom threshold', async () => {
      // Arrange
      mockAgentSelector.selectAgents.mockResolvedValue(Result.ok([]));

      // Act
      await service.generateAgents({
        workspaceUri: mockWorkspaceUri,
        threshold: 80,
      });

      // Assert
      expect(mockAgentSelector.selectAgents).toHaveBeenCalledWith(
        expect.anything(),
        80
      );
    });
  });

  describe('Progress Reporting', () => {
    it('should report progress with correct percentage ranges', async () => {
      // Arrange
      const progressCallback = jest.fn();

      mockAgentSelector.selectAgents.mockResolvedValue(
        Result.ok([
          {
            template: mockTemplate,
            relevanceScore: 85,
            matchedCriteria: [],
          },
        ])
      );

      mockTemplateStorage.loadTemplate.mockResolvedValue(
        Result.ok(mockTemplate)
      );
      mockLlmService.batchCustomize.mockResolvedValue(new Map());
      mockContentGenerator.generateContent.mockResolvedValue(
        Result.ok('# Generated content')
      );
      mockFileWriter.writeAgentsBatch.mockResolvedValue(Result.ok([]));

      // Act
      await service.generateAgents(
        { workspaceUri: mockWorkspaceUri },
        progressCallback
      );

      // Assert - Verify percentage ranges
      const analysisCalls = progressCallback.mock.calls.filter(
        ([progress]) => progress.phase === 'analysis'
      );
      expect(analysisCalls.length).toBeGreaterThan(0);
      analysisCalls.forEach(([progress]) => {
        expect(progress.percentComplete).toBeGreaterThanOrEqual(0);
        expect(progress.percentComplete).toBeLessThanOrEqual(20);
      });

      const selectionCalls = progressCallback.mock.calls.filter(
        ([progress]) => progress.phase === 'selection'
      );
      expect(selectionCalls.length).toBeGreaterThan(0);
      selectionCalls.forEach(([progress]) => {
        expect(progress.percentComplete).toBeGreaterThanOrEqual(20);
        expect(progress.percentComplete).toBeLessThanOrEqual(30);
      });

      const customizationCalls = progressCallback.mock.calls.filter(
        ([progress]) => progress.phase === 'customization'
      );
      customizationCalls.forEach(([progress]) => {
        expect(progress.percentComplete).toBeGreaterThanOrEqual(30);
        expect(progress.percentComplete).toBeLessThanOrEqual(80);
      });
    });

    it('should include agent count in customization progress', async () => {
      // Arrange
      const progressCallback = jest.fn();

      mockAgentSelector.selectAgents.mockResolvedValue(
        Result.ok([
          { template: mockTemplate, relevanceScore: 85, matchedCriteria: [] },
          {
            template: { ...mockTemplate, id: 'agent-2' },
            relevanceScore: 80,
            matchedCriteria: [],
          },
        ])
      );

      mockTemplateStorage.loadTemplate.mockResolvedValue(
        Result.ok(mockTemplate)
      );
      mockLlmService.batchCustomize.mockResolvedValue(new Map());
      mockContentGenerator.generateContent.mockResolvedValue(
        Result.ok('# Generated content')
      );
      mockFileWriter.writeAgentsBatch.mockResolvedValue(Result.ok([]));

      // Act
      await service.generateAgents(
        { workspaceUri: mockWorkspaceUri },
        progressCallback
      );

      // Assert
      const customizationCalls = progressCallback.mock.calls.filter(
        ([progress]) => progress.phase === 'customization'
      );

      const callsWithCounts = customizationCalls.filter(
        ([progress]) => progress.totalAgents !== undefined
      );

      expect(callsWithCounts.length).toBeGreaterThan(0);
      callsWithCounts.forEach(([progress]) => {
        expect(progress.totalAgents).toBe(2);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty workspace gracefully', async () => {
      // Arrange
      mockAgentSelector.selectAgents.mockResolvedValue(Result.ok([]));

      // Act
      const result = await service.generateAgents({
        workspaceUri: mockWorkspaceUri,
      });

      // Assert
      expect(result.isOk()).toBe(true);
      expect(result.value?.successful).toBe(0);
    });

    it('should handle multiple agents with mixed success', async () => {
      // Arrange
      const agent1 = { ...mockTemplate, id: 'agent-1' };
      const agent2 = { ...mockTemplate, id: 'agent-2' };

      mockAgentSelector.selectAgents.mockResolvedValue(
        Result.ok([
          { template: agent1, relevanceScore: 85, matchedCriteria: [] },
          { template: agent2, relevanceScore: 80, matchedCriteria: [] },
        ])
      );

      mockTemplateStorage.loadTemplate
        .mockResolvedValueOnce(Result.ok(agent1))
        .mockResolvedValueOnce(Result.ok(agent2));

      mockLlmService.batchCustomize.mockResolvedValue(new Map());

      // Agent 1 succeeds, Agent 2 fails
      mockContentGenerator.generateContent
        .mockResolvedValueOnce(Result.ok('# Generated content'))
        .mockResolvedValueOnce(Result.err(new Error('Render failed')));

      mockFileWriter.writeAgentsBatch.mockResolvedValue(Result.ok([]));

      // Act
      const result = await service.generateAgents({
        workspaceUri: mockWorkspaceUri,
      });

      // Assert
      expect(result.isOk()).toBe(true);
      expect(result.value?.successful).toBe(1);
      expect(result.value?.agents).toHaveLength(1);
    });
  });
});
