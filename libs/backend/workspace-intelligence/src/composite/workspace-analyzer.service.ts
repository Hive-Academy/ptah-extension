/**
 * Workspace Analyzer Service - Composite Facade for Workspace Intelligence
 *
 * ARCHITECTURE: Facade pattern that aggregates all workspace-intelligence services
 * into a single, cohesive API. Replaces the monolithic WorkspaceManager.
 *
 * This service acts as the orchestration layer, delegating to specialized services:
 * - ProjectDetectorService (project type detection)
 * - FrameworkDetectorService (framework detection)
 * - DependencyAnalyzerService (dependency analysis)
 * - WorkspaceService (workspace structure and file tree)
 * - ContextService (context optimization and file search)
 * - WorkspaceIndexerService (file indexing)
 *
 * @packageDocumentation
 */

import { injectable, inject } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IWorkspaceProvider,
  IDisposable,
} from '@ptah-extension/platform-core';
import { ProjectType } from '../types/workspace.types';
import { FileSystemService } from '../services/file-system.service';
import { ProjectDetectorService } from '../project-analysis/project-detector.service';
import { FrameworkDetectorService } from '../project-analysis/framework-detector.service';
import { DependencyAnalyzerService } from '../project-analysis/dependency-analyzer.service';
import {
  WorkspaceService,
  ProjectInfo,
  WorkspaceStructureAnalysis,
} from '../workspace/workspace.service';
import { ContextService } from '../context/context.service';
import { WorkspaceIndexerService } from '../file-indexing/workspace-indexer.service';
import { TreeSitterParserService } from '../ast/tree-sitter-parser.service';
import { AstAnalysisService } from '../ast/ast-analysis.service';
import { CodeInsights } from '../ast/ast-analysis.interfaces';
import { SupportedLanguage } from '../ast/ast.types';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';

/**
 * Workspace information interface (matches old WorkspaceManager)
 */
export interface WorkspaceInfo {
  readonly name: string;
  readonly path: string;
  readonly projectType: string;
  readonly frameworks?: readonly string[];
  readonly hasPackageJson?: boolean;
  readonly hasTsConfig?: boolean;
}

/**
 * Context recommendations for AI interactions
 */
export interface ContextRecommendations {
  readonly recommendedFiles: readonly string[];
  readonly criticalFiles: readonly string[];
  readonly frameworkSpecific: readonly string[];
}

/**
 * Workspace Analyzer Service - Unified facade for workspace intelligence
 *
 * @example
 * ```typescript
 * const analyzer = container.resolve<WorkspaceAnalyzerService>(TOKENS.WORKSPACE_ANALYZER);
 *
 * // Get current workspace info
 * const info = await analyzer.getCurrentWorkspaceInfo();
 *
 * // Detect project type
 * const projectType = await analyzer.detectProjectType('/path/to/workspace');
 *
 * // Analyze workspace structure
 * const analysis = await analyzer.analyzeWorkspaceStructure();
 * ```
 */
@injectable()
export class WorkspaceAnalyzerService implements IDisposable {
  private disposables: IDisposable[] = [];
  private workspaceInfo?: WorkspaceInfo;

  constructor(
    @inject(TOKENS.FILE_SYSTEM_SERVICE)
    private readonly fileSystemService: FileSystemService,
    @inject(TOKENS.PROJECT_DETECTOR_SERVICE)
    private readonly projectDetector: ProjectDetectorService,
    @inject(TOKENS.FRAMEWORK_DETECTOR_SERVICE)
    private readonly frameworkDetector: FrameworkDetectorService,
    @inject(TOKENS.DEPENDENCY_ANALYZER_SERVICE)
    private readonly dependencyAnalyzer: DependencyAnalyzerService,
    @inject(TOKENS.WORKSPACE_SERVICE)
    private readonly workspaceService: WorkspaceService,
    @inject(TOKENS.CONTEXT_SERVICE)
    private readonly contextService: ContextService,
    @inject(TOKENS.WORKSPACE_INDEXER_SERVICE)
    private readonly indexer: WorkspaceIndexerService,
    @inject(TOKENS.TREE_SITTER_PARSER_SERVICE)
    private readonly treeSitterParser: TreeSitterParserService,
    @inject(TOKENS.AST_ANALYSIS_SERVICE)
    private readonly astAnalyzer: AstAnalysisService,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider
  ) {
    this.initialize();
  }

  /**
   * Initialize workspace analyzer
   */
  private initialize(): void {
    // Update workspace info when workspace changes
    const workspaceWatcher = this.workspaceProvider.onDidChangeWorkspaceFolders(
      () => {
        this.updateWorkspaceInfo();
      }
    );

    this.disposables.push(workspaceWatcher);

    // Initial update
    this.updateWorkspaceInfo();
  }

  /**
   * Get current workspace information
   * Delegates to WorkspaceService for core data
   */
  getCurrentWorkspaceInfo(): WorkspaceInfo | undefined {
    return this.workspaceInfo;
  }

  /**
   * Detect project type for a specific workspace path
   * Delegates to ProjectDetectorService
   *
   * @param workspacePath - Path to analyze
   * @returns Project type enum value
   */
  async detectProjectType(workspacePath: string): Promise<ProjectType> {
    return await this.projectDetector.detectProjectType(workspacePath);
  }

  /**
   * Get comprehensive project information
   * Combines data from multiple detection services
   *
   * @returns Project info with type, dependencies, file statistics
   */
  async getProjectInfo(): Promise<ProjectInfo> {
    const projectInfo = await this.workspaceService.getProjectInfo();

    if (!projectInfo) {
      throw new Error('No workspace folder open');
    }

    return projectInfo;
  }

  /**
   * Get recommended context template based on project type
   * Uses framework detection and project analysis
   *
   * @returns Context template string (e.g., 'python', 'react', 'node')
   */
  async getRecommendedContextTemplate(): Promise<string> {
    return this.workspaceService.getRecommendedContextTemplate();
  }

  /**
   * Analyze complete workspace structure
   * Delegates to WorkspaceService for comprehensive analysis
   *
   * @returns Workspace structure analysis with project type and recommendations
   */
  async analyzeWorkspaceStructure(): Promise<WorkspaceStructureAnalysis | null> {
    return await this.workspaceService.analyzeWorkspaceStructure();
  }

  /**
   * Get context recommendations for AI interactions
   * Uses ContextService and file analysis
   *
   * @returns Recommended files for AI context
   */
  async getContextRecommendations(): Promise<ContextRecommendations> {
    const workspacePath = this.workspaceProvider.getWorkspaceRoot();
    if (!workspacePath) {
      return {
        recommendedFiles: [],
        criticalFiles: [],
        frameworkSpecific: [],
      };
    }

    // Get project info for framework-specific recommendations
    const info = await this.getProjectInfo();

    // Build recommendations based on project type
    const criticalFiles = this.getCriticalFiles(info);
    const frameworkSpecific = await this.getFrameworkSpecificFiles();

    // Get additional recommended files from context service
    const contextFiles = await this.contextService.getAllFiles(false, 0, 100);

    return {
      recommendedFiles: contextFiles.map((f) => f.relativePath),
      criticalFiles,
      frameworkSpecific,
    };
  }

  /**
   * Update internal workspace info cache
   */
  private async updateWorkspaceInfo(): Promise<void> {
    const workspacePath = this.workspaceProvider.getWorkspaceRoot();
    if (!workspacePath) {
      this.workspaceInfo = undefined;
      return;
    }

    try {
      const info = await this.getProjectInfo();

      // Detect project types and frameworks for this workspace
      const projectType = await this.projectDetector.detectProjectType(
        workspacePath
      );
      const projectTypesMap = new Map<string, ProjectType>();
      projectTypesMap.set(workspacePath, projectType);

      const frameworksMap = await this.frameworkDetector.detectFrameworks(
        projectTypesMap
      );
      const framework = frameworksMap.get(workspacePath);

      // Check for TypeScript by looking at dependencies or file statistics
      const hasTypeScript =
        info.dependencies.some((dep) => dep === 'typescript') ||
        info.devDependencies.some((dep) => dep === 'typescript') ||
        Object.keys(info.fileStatistics).some((key) => key.includes('.ts'));

      this.workspaceInfo = {
        name: info.name,
        path: info.path,
        projectType: info.type,
        frameworks: framework ? [framework] : [],
        hasPackageJson: info.dependencies.length > 0, // If we have dependencies, package.json exists
        hasTsConfig: hasTypeScript,
      };
    } catch (error) {
      console.error('Failed to update workspace info:', error);
      this.workspaceInfo = undefined;
    }
  }

  /**
   * Get critical files for a project type
   */
  private getCriticalFiles(info: ProjectInfo): string[] {
    const critical: string[] = ['README.md'];

    // Add package.json if we have dependencies (indicates it exists)
    if (info.dependencies.length > 0 || info.devDependencies.length > 0) {
      critical.push('package.json');
    }

    // Check for TypeScript by looking at dependencies
    const hasTypeScript =
      info.dependencies.some((dep) => dep === 'typescript') ||
      info.devDependencies.some((dep) => dep === 'typescript');

    if (hasTypeScript) {
      critical.push('tsconfig.json');
    }

    // Use ProjectType enum values
    if (info.type === ProjectType.Node) {
      critical.push('package.json', 'tsconfig.json');
    } else if (info.type === ProjectType.React) {
      critical.push('src/App.tsx', 'src/index.tsx');
    } else if (info.type === ProjectType.Angular) {
      critical.push('angular.json', 'src/main.ts');
    } else if (info.type === ProjectType.NextJS) {
      critical.push('next.config.js', 'pages/_app.tsx');
    }

    return critical;
  }

  /**
   * Get framework-specific files
   * Note: This method needs workspace URI to detect frameworks
   */
  private async getFrameworkSpecificFiles(): Promise<string[]> {
    const files: string[] = [];

    // Get frameworks from framework detector
    const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
    if (!workspaceRoot) {
      return files;
    }

    // Detect project type and frameworks
    const projectType = await this.projectDetector.detectProjectType(
      workspaceRoot
    );
    const projectTypesMap = new Map<string, ProjectType>();
    projectTypesMap.set(workspaceRoot, projectType);

    const frameworksMap = await this.frameworkDetector.detectFrameworks(
      projectTypesMap
    );
    const framework = frameworksMap.get(workspaceRoot);

    if (!framework) {
      return files;
    }

    switch (framework) {
      case 'react':
        files.push('src/**/*.tsx', 'src/**/*.jsx');
        break;
      case 'angular':
        files.push('src/**/*.component.ts', 'src/**/*.service.ts');
        break;
      case 'vue':
        files.push('src/**/*.vue');
        break;
      case 'nextjs':
        files.push('pages/**/*.tsx', 'app/**/*.tsx');
        break;
      case 'express':
        files.push('src/**/*.controller.ts', 'src/**/*.service.ts');
        break;
    }

    return files;
  }

  /**
   * Extracts code insights from a TypeScript/JavaScript file using query-based AST analysis.
   *
   * Uses AstAnalysisService.analyzeSource() which leverages tree-sitter's native query
   * pattern matching to extract functions, classes, imports, and exports directly from
   * source code. This is the preferred path as it avoids intermediate AST node conversion.
   *
   * @param filePath - Absolute path to TypeScript/JavaScript file
   * @returns Code insights (functions, classes, imports, exports) or null on failure
   *
   * @example
   * ```typescript
   * const insights = await analyzer.extractCodeInsights('/path/to/file.ts');
   * if (insights) {
   *   console.log(`Found ${insights.functions.length} functions`);
   *   console.log(`Found ${insights.classes.length} classes`);
   *   console.log(`Found ${insights.imports.length} imports`);
   * }
   * ```
   */
  async extractCodeInsights(filePath: string): Promise<CodeInsights | null> {
    try {
      // Read file content
      const content = await this.fileSystemService.readFile(filePath);

      // Detect language from extension
      const language: SupportedLanguage =
        filePath.endsWith('.ts') || filePath.endsWith('.tsx')
          ? 'typescript'
          : 'javascript';

      this.logger.debug(
        `Extracting code insights from ${filePath} (language: ${language})`
      );

      // Analyze source directly using query-based extraction
      const insightsResult = this.astAnalyzer.analyzeSource(
        content,
        language,
        filePath
      );

      if (insightsResult.isErr()) {
        this.logger.error(
          `AST analysis failed for ${filePath}`,
          insightsResult.error ?? new Error('Unknown analysis error')
        );
        return null;
      }

      this.logger.debug(`Code insights extracted successfully for ${filePath}`);
      return insightsResult.value ?? null;
    } catch (error) {
      this.logger.error(
        `Error extracting code insights from ${filePath}:`,
        error instanceof Error ? error : new Error(String(error))
      );
      return null;
    }
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }
}
