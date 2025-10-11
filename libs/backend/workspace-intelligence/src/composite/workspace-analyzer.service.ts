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
  WorkspaceAnalysisResult,
  ProjectInfo,
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
   * Detect project type for a workspace path
   * Delegates to ProjectDetectorService
   *
   * @param workspacePath - Path to analyze
   * @returns Project type string (e.g., 'vscode-extension', 'react-app', 'angular-app')
   */
  async detectProjectType(workspacePath: string): Promise<string> {
    const detected = await this.projectDetector.detectProjectType(
      workspacePath
    );
    return detected.type;
  }

  /**
   * Get comprehensive project information
   * Combines data from multiple detection services
   *
   * @returns Project info with type, frameworks, dependencies
   */
  async getProjectInfo(): Promise<ProjectInfo> {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) {
      throw new Error('No workspace folder open');
    }

    // Get analysis from WorkspaceService
    const analysis = await this.workspaceService.analyzeWorkspace(
      workspacePath
    );

    return {
      name: analysis.name,
      type: analysis.type,
      path: workspacePath,
      frameworks: analysis.frameworks,
      buildSystem: analysis.buildSystem,
      packageManager: analysis.packageManager,
      hasTypeScript: analysis.hasTypeScript,
      isMonorepo: analysis.isMonorepo,
      rootFiles: analysis.rootFiles,
    };
  }

  /**
   * Get recommended context template based on project type
   * Uses framework detection and project analysis
   *
   * @returns Context template string (e.g., 'typescript-react', 'angular-nx')
   */
  async getRecommendedContextTemplate(): Promise<string> {
    const info = await this.getProjectInfo();

    // Build template from project type and frameworks
    const parts: string[] = [];

    if (info.hasTypeScript) {
      parts.push('typescript');
    }

    if (info.frameworks.length > 0) {
      parts.push(info.frameworks[0].toLowerCase());
    } else {
      parts.push(info.type.toLowerCase());
    }

    if (info.isMonorepo) {
      parts.push('monorepo');
    }

    return parts.join('-');
  }

  /**
   * Analyze complete workspace structure
   * Delegates to WorkspaceService for comprehensive analysis
   *
   * @returns Workspace analysis with file counts, structure, and metadata
   */
  async analyzeWorkspaceStructure(): Promise<WorkspaceAnalysisResult> {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) {
      throw new Error('No workspace folder open');
    }

    return await this.workspaceService.analyzeWorkspace(workspacePath);
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
    const frameworkSpecific = this.getFrameworkSpecificFiles(info);

    // Get additional recommended files from context service
    const contextFiles = await this.contextService.getAllFiles(workspacePath, {
      includePatterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
      excludePatterns: ['**/node_modules/**', '**/dist/**'],
      maxFiles: 50,
    });

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
      this.workspaceInfo = {
        name: info.name,
        path: info.path,
        projectType: info.type,
        frameworks: info.frameworks,
        hasPackageJson: info.rootFiles.includes('package.json'),
        hasTsConfig: info.hasTypeScript,
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
    const critical: string[] = ['README.md', 'package.json'];

    if (info.hasTypeScript) {
      critical.push('tsconfig.json');
    }

    if (info.type === 'vscode-extension') {
      critical.push('package.json', 'tsconfig.json', 'src/extension.ts');
    } else if (info.type === 'react-app') {
      critical.push('src/App.tsx', 'src/index.tsx');
    } else if (info.type === 'angular-app') {
      critical.push('angular.json', 'src/main.ts');
    } else if (info.type === 'nx-workspace') {
      critical.push('nx.json', 'workspace.json');
    }

    return critical;
  }

  /**
   * Get framework-specific files
   */
  private getFrameworkSpecificFiles(info: ProjectInfo): string[] {
    const files: string[] = [];

    for (const framework of info.frameworks) {
      switch (framework.toLowerCase()) {
        case 'react':
          files.push('src/**/*.tsx', 'src/**/*.jsx');
          break;
        case 'angular':
          files.push('src/**/*.component.ts', 'src/**/*.service.ts');
          break;
        case 'vue':
          files.push('src/**/*.vue');
          break;
        case 'next.js':
          files.push('pages/**/*.tsx', 'app/**/*.tsx');
          break;
        case 'nest.js':
          files.push('src/**/*.controller.ts', 'src/**/*.service.ts');
          break;
      }
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
