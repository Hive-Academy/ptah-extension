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
import * as vscode from 'vscode';
import { ProjectType } from '../types/workspace.types';
import {
  FILE_SYSTEM_SERVICE,
  PROJECT_DETECTOR_SERVICE,
  FRAMEWORK_DETECTOR_SERVICE,
  DEPENDENCY_ANALYZER_SERVICE,
  WORKSPACE_SERVICE,
  CONTEXT_SERVICE,
  WORKSPACE_INDEXER_SERVICE,
} from '../di/tokens';
import type { FileSystemService } from '../services/file-system.service';
import type { ProjectDetectorService } from '../project-analysis/project-detector.service';
import type { FrameworkDetectorService } from '../project-analysis/framework-detector.service';
import type { DependencyAnalyzerService } from '../project-analysis/dependency-analyzer.service';
import type {
  WorkspaceService,
  ProjectInfo,
  WorkspaceStructureAnalysis,
} from '../workspace/workspace.service';
import type { ContextService } from '../context/context.service';
import type { WorkspaceIndexerService } from '../file-indexing/workspace-indexer.service';

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
export class WorkspaceAnalyzerService implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private workspaceInfo?: WorkspaceInfo;

  constructor(
    @inject(FILE_SYSTEM_SERVICE)
    private readonly fileSystemService: FileSystemService,
    @inject(PROJECT_DETECTOR_SERVICE)
    private readonly projectDetector: ProjectDetectorService,
    @inject(FRAMEWORK_DETECTOR_SERVICE)
    private readonly frameworkDetector: FrameworkDetectorService,
    @inject(DEPENDENCY_ANALYZER_SERVICE)
    private readonly dependencyAnalyzer: DependencyAnalyzerService,
    @inject(WORKSPACE_SERVICE)
    private readonly workspaceService: WorkspaceService,
    @inject(CONTEXT_SERVICE)
    private readonly contextService: ContextService,
    @inject(WORKSPACE_INDEXER_SERVICE)
    private readonly indexer: WorkspaceIndexerService
  ) {
    this.initialize();
  }

  /**
   * Initialize workspace analyzer
   */
  private initialize(): void {
    // Update workspace info when workspace changes
    const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders(
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
    const workspaceUri = vscode.Uri.file(workspacePath);
    return await this.projectDetector.detectProjectType(workspaceUri);
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
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
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
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) {
      this.workspaceInfo = undefined;
      return;
    }

    try {
      const info = await this.getProjectInfo();
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        this.workspaceInfo = undefined;
        return;
      }

      // Detect project types and frameworks for this workspace
      const projectType = await this.projectDetector.detectProjectType(
        workspaceFolder.uri
      );
      const projectTypesMap = new Map<vscode.Uri, ProjectType>();
      projectTypesMap.set(workspaceFolder.uri, projectType);

      const frameworksMap = await this.frameworkDetector.detectFrameworks(
        projectTypesMap
      );
      const framework = frameworksMap.get(workspaceFolder.uri);

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
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return files;
    }

    // Detect project type and frameworks
    const projectType = await this.projectDetector.detectProjectType(
      workspaceFolder.uri
    );
    const projectTypesMap = new Map<vscode.Uri, ProjectType>();
    projectTypesMap.set(workspaceFolder.uri, projectType);

    const frameworksMap = await this.frameworkDetector.detectFrameworks(
      projectTypesMap
    );
    const framework = frameworksMap.get(workspaceFolder.uri);

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
   * Dispose of resources
   */
  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }
}
