import 'reflect-metadata';
import { TemplateGeneratorService } from './template-generator.service';
import { Logger } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import { ProjectConfig, ProjectContext } from '../interfaces';

/**
 * IMPORTANT NOTE: This E2E test mocks methods that don't yet exist in WorkspaceAnalyzerService.
 * The methods `getWorkspaceRoot()` and `analyzeWorkspace()` are called by TemplateGeneratorService
 * but are not yet implemented in the actual WorkspaceAnalyzerService class.
 *
 * This is intentional - these tests document the expected E2E workflow for Phase 3.
 */

describe('TemplateGeneratorService - E2E Workflow', () => {
  let service: TemplateGeneratorService;
  let mockOrchestrator: Record<string, jest.Mock>;
  let mockWorkspaceAnalyzer: Record<string, jest.Mock>;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    // Mock orchestrator
    mockOrchestrator = {
      orchestrateGeneration: jest.fn(),
    };

    // Mock workspace analyzer with methods that don't exist yet (TODO Phase 3)
    // These methods are called by TemplateGeneratorService but not yet implemented
    mockWorkspaceAnalyzer = {
      getWorkspaceRoot: jest.fn(),
      analyzeWorkspace: jest.fn(),
      dispose: jest.fn(),
    };

    // Mock logger
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      lifecycle: jest.fn(),
      dispose: jest.fn(),
    } as unknown as jest.Mocked<Logger>;

    // Create service
    service = new TemplateGeneratorService(
      ...[mockOrchestrator, mockWorkspaceAnalyzer, mockLogger] as unknown as ConstructorParameters<typeof TemplateGeneratorService>
    );
  });

  describe('E2E Workflow: Workspace → AST → LLM → Templates', () => {
    it('should execute complete workflow successfully', async () => {
      // Arrange - Mock workspace root
      const workspaceRoot = 'D:\\test\\workspace';
      mockWorkspaceAnalyzer.getWorkspaceRoot.mockResolvedValue(
        Result.ok(workspaceRoot)
      );

      // Mock workspace analysis
      const mockWorkspaceAnalysis = {
        projectType: 'nx-monorepo',
        techStack: ['typescript', 'angular', 'nx'],
        files: ['D:\\test\\workspace\\src\\app.ts'],
        frameworks: ['angular'],
        dependencies: ['@angular/core', '@nx/workspace'],
      };
      mockWorkspaceAnalyzer.analyzeWorkspace.mockResolvedValue(
        Result.ok(mockWorkspaceAnalysis)
      );

      // Mock orchestrator success
      mockOrchestrator.orchestrateGeneration.mockResolvedValue(
        Result.ok(undefined)
      );

      // Act
      const result = await service.generateTemplates();

      // Assert - Workflow executed in correct order
      expect(mockWorkspaceAnalyzer.getWorkspaceRoot).toHaveBeenCalled();
      expect(mockWorkspaceAnalyzer.analyzeWorkspace).toHaveBeenCalled();
      expect(mockOrchestrator.orchestrateGeneration).toHaveBeenCalled();

      // Assert - Orchestrator received correct context
      const orchestratorCall =
        mockOrchestrator.orchestrateGeneration.mock.calls[0];
      const projectContext: ProjectContext = orchestratorCall[0];
      expect(projectContext.projectName).toBe('workspace');
      expect(projectContext['projectType']).toBe('nx-monorepo');
      expect(projectContext['techStack']).toContain('typescript');
      expect(projectContext['techStack']).toContain('angular');

      // Assert - Success result
      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('Templates generated successfully.');

      // Assert - Logging occurred
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Starting template generation')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('completed successfully')
      );
    });

    it('should handle workspace root retrieval failure', async () => {
      // Arrange
      const error = new Error('No workspace folder open');
      mockWorkspaceAnalyzer.getWorkspaceRoot.mockResolvedValue(
        Result.err(error)
      );

      // Act
      const result = await service.generateTemplates();

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Failed to get workspace root');
      expect(mockWorkspaceAnalyzer.analyzeWorkspace).not.toHaveBeenCalled();
      expect(mockOrchestrator.orchestrateGeneration).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should handle workspace analysis failure', async () => {
      // Arrange
      const workspaceRoot = 'D:\\test\\workspace';
      mockWorkspaceAnalyzer.getWorkspaceRoot.mockResolvedValue(
        Result.ok(workspaceRoot)
      );

      const error = new Error('Failed to analyze workspace structure');
      mockWorkspaceAnalyzer.analyzeWorkspace.mockResolvedValue(
        Result.err(error)
      );

      // Act
      const result = await service.generateTemplates();

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Failed to analyze workspace');
      expect(mockOrchestrator.orchestrateGeneration).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should handle template generation failure', async () => {
      // Arrange
      const workspaceRoot = 'D:\\test\\workspace';
      mockWorkspaceAnalyzer.getWorkspaceRoot.mockResolvedValue(
        Result.ok(workspaceRoot)
      );

      const mockWorkspaceAnalysis = {
        projectType: 'node',
        techStack: ['typescript'],
        files: [],
      };
      mockWorkspaceAnalyzer.analyzeWorkspace.mockResolvedValue(
        Result.ok(mockWorkspaceAnalysis)
      );

      const error = new Error('Template generation failed');
      mockOrchestrator.orchestrateGeneration.mockResolvedValue(
        Result.err(error)
      );

      // Act
      const result = await service.generateTemplates();

      // Assert
      expect(result.isErr()).toBe(true);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Template generation failed'),
        error
      );
    });

    it('should pass custom config to orchestrator', async () => {
      // Arrange
      const workspaceRoot = 'D:\\test\\workspace';
      mockWorkspaceAnalyzer.getWorkspaceRoot.mockResolvedValue(
        Result.ok(workspaceRoot)
      );

      const mockWorkspaceAnalysis = {
        projectType: 'react',
        techStack: ['react', 'typescript'],
        files: [],
      };
      mockWorkspaceAnalyzer.analyzeWorkspace.mockResolvedValue(
        Result.ok(mockWorkspaceAnalysis)
      );

      mockOrchestrator.orchestrateGeneration.mockResolvedValue(
        Result.ok(undefined)
      );

      const customConfig: ProjectConfig = {
        name: 'CustomProject',
        description: 'Custom description',
        baseDir: workspaceRoot,
        templateGeneration: {
          outputDir: 'D:\\test\\workspace\\custom-templates',
        },
      };

      // Act
      const result = await service.generateTemplates(customConfig);

      // Assert
      expect(result.isOk()).toBe(true);

      const orchestratorCall =
        mockOrchestrator.orchestrateGeneration.mock.calls[0];
      const passedConfig: ProjectConfig = orchestratorCall[1];
      expect(passedConfig.name).toBe('CustomProject');
      expect(passedConfig.description).toBe('Custom description');
      expect(passedConfig.templateGeneration?.outputDir).toBe(
        'D:\\test\\workspace\\custom-templates'
      );
    });

    it('should use default config when none provided', async () => {
      // Arrange
      const workspaceRoot = 'D:\\test\\workspace';
      mockWorkspaceAnalyzer.getWorkspaceRoot.mockResolvedValue(
        Result.ok(workspaceRoot)
      );

      const mockWorkspaceAnalysis = {
        projectType: 'vue',
        techStack: ['vue', 'typescript'],
        files: [],
      };
      mockWorkspaceAnalyzer.analyzeWorkspace.mockResolvedValue(
        Result.ok(mockWorkspaceAnalysis)
      );

      mockOrchestrator.orchestrateGeneration.mockResolvedValue(
        Result.ok(undefined)
      );

      // Act
      const result = await service.generateTemplates();

      // Assert
      expect(result.isOk()).toBe(true);

      const orchestratorCall =
        mockOrchestrator.orchestrateGeneration.mock.calls[0];
      const passedConfig: ProjectConfig = orchestratorCall[1];
      expect(passedConfig.name).toBe('workspace');
      expect(passedConfig.description).toBe(
        'Auto-generated template documentation'
      );
      expect(passedConfig.baseDir).toBe(workspaceRoot);
    });

    it('should handle unexpected errors gracefully', async () => {
      // Arrange
      mockWorkspaceAnalyzer.getWorkspaceRoot.mockRejectedValue(
        new TypeError('Unexpected error')
      );

      // Act
      const result = await service.generateTemplates();

      // Assert
      expect(result.isErr()).toBe(true);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Unexpected error'),
        expect.any(Error)
      );
    });
  });

  describe('Integration Points Verification', () => {
    it('should verify all integration points are called in sequence', async () => {
      // Arrange
      const callOrder: string[] = [];

      mockWorkspaceAnalyzer.getWorkspaceRoot.mockImplementation(async () => {
        callOrder.push('getWorkspaceRoot');
        return Result.ok('D:\\test\\workspace');
      });

      mockWorkspaceAnalyzer.analyzeWorkspace.mockImplementation(async () => {
        callOrder.push('analyzeWorkspace');
        return Result.ok({ projectType: 'node', techStack: [], files: [] });
      });

      mockOrchestrator.orchestrateGeneration.mockImplementation(async () => {
        callOrder.push('orchestrateGeneration');
        return Result.ok(undefined);
      });

      // Act
      await service.generateTemplates();

      // Assert - Verify execution order
      expect(callOrder).toEqual([
        'getWorkspaceRoot',
        'analyzeWorkspace',
        'orchestrateGeneration',
      ]);
    });

    it('should stop execution at first failure point', async () => {
      // Arrange
      mockWorkspaceAnalyzer.getWorkspaceRoot.mockResolvedValue(
        Result.ok('D:\\test\\workspace')
      );

      // Fail at workspace analysis
      mockWorkspaceAnalyzer.analyzeWorkspace.mockResolvedValue(
        Result.err(new Error('Analysis failed'))
      );

      // Act
      await service.generateTemplates();

      // Assert - Orchestrator never called
      expect(mockOrchestrator.orchestrateGeneration).not.toHaveBeenCalled();
    });
  });

  describe('ProjectContext Building', () => {
    it('should correctly map workspace analysis to project context', async () => {
      // Arrange
      const workspaceRoot = 'D:\\test\\workspace';
      mockWorkspaceAnalyzer.getWorkspaceRoot.mockResolvedValue(
        Result.ok(workspaceRoot)
      );

      const workspaceAnalysis = {
        projectType: 'angular',
        techStack: ['typescript', 'angular', 'rxjs'],
        files: ['src/app.ts', 'src/main.ts'],
        frameworks: ['angular'],
        dependencies: ['@angular/core', '@angular/common'],
        rootDirectory: workspaceRoot,
        fileCount: 42,
      };
      mockWorkspaceAnalyzer.analyzeWorkspace.mockResolvedValue(
        Result.ok(workspaceAnalysis)
      );

      mockOrchestrator.orchestrateGeneration.mockResolvedValue(
        Result.ok(undefined)
      );

      // Act
      await service.generateTemplates();

      // Assert
      const orchestratorCall =
        mockOrchestrator.orchestrateGeneration.mock.calls[0];
      const projectContext: ProjectContext = orchestratorCall[0];

      expect(projectContext.projectName).toBe('workspace');
      expect(projectContext.projectDescription).toBe(
        'Auto-generated template documentation'
      );
      expect(projectContext['projectType']).toBe('angular');
      expect(projectContext['techStack']).toEqual([
        'typescript',
        'angular',
        'rxjs',
      ]);
      expect(projectContext['files']).toEqual(['src/app.ts', 'src/main.ts']);
      expect(projectContext['frameworks']).toEqual(['angular']);
    });
  });

  describe('Error Handling and Logging', () => {
    it('should log all workflow stages', async () => {
      // Arrange
      mockWorkspaceAnalyzer.getWorkspaceRoot.mockResolvedValue(
        Result.ok('D:\\test\\workspace')
      );
      mockWorkspaceAnalyzer.analyzeWorkspace.mockResolvedValue(
        Result.ok({ projectType: 'node', techStack: [], files: [] })
      );
      mockOrchestrator.orchestrateGeneration.mockResolvedValue(
        Result.ok(undefined)
      );

      // Act
      await service.generateTemplates();

      // Assert
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Starting template generation')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('completed successfully')
      );
    });

    it('should log errors with context', async () => {
      // Arrange
      const error = new Error('Workspace analysis failed');
      mockWorkspaceAnalyzer.getWorkspaceRoot.mockResolvedValue(
        Result.ok('D:\\test\\workspace')
      );
      mockWorkspaceAnalyzer.analyzeWorkspace.mockResolvedValue(
        Result.err(error)
      );

      // Act
      await service.generateTemplates();

      // Assert
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to analyze workspace'),
        expect.objectContaining({
          message: expect.stringContaining('Failed to analyze workspace'),
        })
      );
    });
  });
});
