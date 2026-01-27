/**
 * WorkspaceService - Complete business logic for workspace management
 *
 * Migrated from apps/ptah-extension-vscode/src/services/workspace-manager.ts
 * This service provides comprehensive workspace analysis and project detection.
 *
 * Verification trail:
 * - Pattern source: context.service.ts (similar structure)
 * - Uses existing services: ProjectDetectorService, FrameworkDetectorService, DependencyAnalyzerService
 * - Verified decorators: @injectable(), @inject() from tsyringe
 * - Implements complete business logic (no stub methods)
 *
 * @packageDocumentation
 */

import { injectable } from 'tsyringe';
import * as vscode from 'vscode';
import { ProjectDetectorService } from '../project-analysis/project-detector.service';
import { FrameworkDetectorService } from '../project-analysis/framework-detector.service';
import { DependencyAnalyzerService } from '../project-analysis/dependency-analyzer.service';
import { MonorepoDetectorService } from '../project-analysis/monorepo-detector.service';
import { FileSystemService } from '../services/file-system.service';
import { ProjectType, Framework, MonorepoType } from '../types/workspace.types';
import { WorkspaceInfo } from '@ptah-extension/shared';

/**
 * Extended workspace information with analysis results
 */
export interface WorkspaceAnalysisResult {
  /** Basic workspace information */
  info: WorkspaceInfo;
  /** Detected project type */
  projectType: ProjectType;
  /** Detected framework (if any) */
  framework?: Framework;
  /** Whether workspace is a monorepo */
  isMonorepo: boolean;
  /** Monorepo type (if applicable) */
  monorepoType?: MonorepoType;
  /** Project version (from package.json, Cargo.toml, etc.) */
  version?: string;
  /** Project description */
  description?: string;
  /** Production dependencies */
  dependencies: string[];
  /** Development dependencies */
  devDependencies: string[];
  /** Total file count */
  totalFiles: number;
  /** Whether workspace has git repository */
  hasGitRepository: boolean;
}

/**
 * Project information structure for detailed project metadata
 */
export interface ProjectInfo {
  /** Project name */
  name: string;
  /** Project type */
  type: ProjectType;
  /** Workspace path */
  path: string;
  /** Project version */
  version?: string;
  /** Project description */
  description?: string;
  /** Production dependencies */
  dependencies: string[];
  /** Development dependencies */
  devDependencies: string[];
  /** Framework-specific file counts */
  fileStatistics: Record<string, number>;
  /** Total files in project */
  totalFiles: number;
  /** Whether project is a git repository */
  gitRepository: boolean;
}

/**
 * Directory structure representation
 */
export interface DirectoryStructure {
  /** Subdirectories */
  directories: Array<{
    name: string;
    structure: DirectoryStructure | null;
  }>;
  /** Files in this directory */
  files: Array<{
    name: string;
    extension: string;
  }>;
}

/**
 * Workspace analysis with directory structure
 */
export interface WorkspaceStructureAnalysis {
  /** Project type */
  projectType: ProjectType;
  /** Directory structure (limited depth) */
  structure: DirectoryStructure;
  /** Context recommendations based on project type */
  recommendations: string[];
}

/**
 * WorkspaceService - Workspace management and analysis
 *
 * Complete business logic implementation for:
 * - Workspace information tracking
 * - Project type detection
 * - Framework detection
 * - Dependency analysis
 * - Directory structure analysis
 * - Context template recommendations
 *
 * Pattern: Uses existing workspace-intelligence services internally
 * No VS Code API business logic (only event subscriptions)
 *
 * @example
 * ```typescript
 * const workspaceService = container.resolve<WorkspaceService>(TOKENS.WORKSPACE_SERVICE);
 *
 * // Get current workspace analysis
 * const analysis = await workspaceService.getWorkspaceAnalysis();
 * console.log(`Project type: ${analysis.projectType}`);
 *
 * // Get detailed project info
 * const projectInfo = await workspaceService.getProjectInfo();
 * console.log(`Dependencies: ${projectInfo.dependencies.join(', ')}`);
 *
 * // Get recommended context template
 * const template = workspaceService.getRecommendedContextTemplate();
 * console.log(`Use template: ${template}`);
 * ```
 */
@injectable()
export class WorkspaceService implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private currentAnalysis?: WorkspaceAnalysisResult;

  constructor(
    private readonly projectDetector: ProjectDetectorService,
    private readonly frameworkDetector: FrameworkDetectorService,
    private readonly dependencyAnalyzer: DependencyAnalyzerService,
    private readonly monorepoDetector: MonorepoDetectorService,
    private readonly fileSystem: FileSystemService
  ) {
    // Initialize workspace analysis on construction
    this.updateWorkspaceAnalysis().catch((error) => {
      console.error('Failed to initialize workspace analysis:', error);
    });

    // Setup event handlers for workspace changes
    this.setupEventHandlers();
  }

  /**
   * Get current workspace analysis result
   *
   * Returns cached analysis or undefined if no workspace is open.
   * Call updateWorkspaceAnalysis() to refresh.
   *
   * @returns Current workspace analysis or undefined
   */
  getCurrentWorkspaceAnalysis(): WorkspaceAnalysisResult | undefined {
    return this.currentAnalysis;
  }

  /**
   * Update workspace analysis (re-analyze workspace)
   *
   * Performs complete workspace analysis:
   * 1. Detect project type
   * 2. Detect framework
   * 3. Analyze dependencies
   * 4. Check for monorepo
   * 5. Count files
   * 6. Check for git repository
   *
   * @returns Updated workspace analysis or undefined if no workspace
   */
  async updateWorkspaceAnalysis(): Promise<
    WorkspaceAnalysisResult | undefined
  > {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
      this.currentAnalysis = undefined;
      console.info('No workspace folder detected');
      return undefined;
    }

    try {
      const workspaceUri = workspaceFolder.uri;

      // Detect project type
      const projectType = await this.projectDetector.detectProjectType(
        workspaceUri
      );

      // Detect framework (if applicable)
      const framework = await this.frameworkDetector.detectFramework(
        workspaceUri,
        projectType
      );

      // Detect monorepo
      const monorepoResult = await this.monorepoDetector.detectMonorepo(
        workspaceUri
      );
      const isMonorepo = monorepoResult.isMonorepo;
      const monorepoType = isMonorepo ? monorepoResult.type : undefined;

      // Analyze dependencies
      const dependencyInfo = await this.dependencyAnalyzer.analyzeDependencies(
        workspaceUri,
        projectType
      );

      // Count files
      const totalFiles = await this.countAllFiles(workspaceUri);

      // Check for git repository
      const gitUri = vscode.Uri.joinPath(workspaceUri, '.git');
      const hasGitRepository = await this.fileSystem.exists(gitUri);

      // Get version and description (project-type specific)
      let version: string | undefined;
      let description: string | undefined;

      if (this.isNodeBasedProject(projectType)) {
        const packageInfo = await this.readPackageJson(workspaceUri);
        version = packageInfo?.version;
        description = packageInfo?.description;
      } else if (projectType === ProjectType.Rust) {
        const cargoInfo = await this.readCargoToml(workspaceUri);
        version = cargoInfo?.version;
        description = cargoInfo?.description;
      }

      // Create analysis result
      this.currentAnalysis = {
        info: {
          name: workspaceFolder.name,
          path: workspaceUri.fsPath,
          type: projectType,
        },
        projectType,
        framework,
        isMonorepo,
        monorepoType,
        version,
        description,
        dependencies: dependencyInfo.dependencies.map((d) => d.name),
        devDependencies: dependencyInfo.devDependencies.map((d) => d.name),
        totalFiles,
        hasGitRepository,
      };

      console.info(
        `Workspace analyzed: ${workspaceFolder.name} (${projectType}${
          framework ? ` - ${framework}` : ''
        })`
      );

      return this.currentAnalysis;
    } catch (error) {
      console.error('Failed to update workspace analysis:', error);
      this.currentAnalysis = undefined;
      return undefined;
    }
  }

  /**
   * Get detailed project information
   *
   * Provides comprehensive project metadata including:
   * - Version and description
   * - Dependency lists
   * - File statistics by extension
   * - Total file count
   * - Git repository status
   *
   * @returns Detailed project info or null if no workspace
   */
  async getProjectInfo(): Promise<ProjectInfo | null> {
    const analysis =
      this.currentAnalysis || (await this.updateWorkspaceAnalysis());

    if (!analysis) {
      return null;
    }

    const workspaceUri = vscode.Uri.file(analysis.info.path);
    const fileStatistics = await this.getFileStatistics(
      workspaceUri,
      analysis.projectType
    );

    return {
      name: analysis.info.name,
      type: analysis.projectType,
      path: analysis.info.path,
      version: analysis.version,
      description: analysis.description,
      dependencies: analysis.dependencies,
      devDependencies: analysis.devDependencies,
      fileStatistics,
      totalFiles: analysis.totalFiles,
      gitRepository: analysis.hasGitRepository,
    };
  }

  /**
   * Get recommended context template based on project type
   *
   * Maps project type to appropriate context template name.
   * Used by context optimization to suggest project-appropriate patterns.
   *
   * @returns Template name (e.g., 'react', 'python', 'general')
   */
  getRecommendedContextTemplate(): string {
    if (!this.currentAnalysis) {
      return 'general';
    }

    // Map project types to context templates
    const templateMap: Record<ProjectType, string> = {
      [ProjectType.React]: 'react',
      [ProjectType.Vue]: 'vue',
      [ProjectType.Angular]: 'angular',
      [ProjectType.NextJS]: 'react', // NextJS uses React
      [ProjectType.Node]: 'node',
      [ProjectType.Python]: 'python',
      [ProjectType.Java]: 'java',
      [ProjectType.Rust]: 'rust',
      [ProjectType.Go]: 'go',
      [ProjectType.DotNet]: 'dotnet',
      [ProjectType.PHP]: 'php',
      [ProjectType.Ruby]: 'ruby',
      [ProjectType.General]: 'general',
      [ProjectType.Unknown]: 'unknown',
    };

    return templateMap[this.currentAnalysis.projectType] || 'general';
  }

  /**
   * Analyze workspace structure with context recommendations
   *
   * Provides:
   * - Project type
   * - Directory structure (limited depth to avoid performance issues)
   * - Context inclusion/exclusion recommendations
   *
   * @returns Workspace structure analysis or null if no workspace
   */
  async analyzeWorkspaceStructure(): Promise<WorkspaceStructureAnalysis | null> {
    const analysis =
      this.currentAnalysis || (await this.updateWorkspaceAnalysis());

    if (!analysis) {
      return null;
    }

    try {
      const workspaceUri = vscode.Uri.file(analysis.info.path);
      const structure = await this.getDirectoryStructure(workspaceUri, 3);
      const recommendations = this.getContextRecommendations(
        analysis.projectType
      );

      return {
        projectType: analysis.projectType,
        structure,
        recommendations,
      };
    } catch (error) {
      console.error('Failed to analyze workspace structure:', error);
      return null;
    }
  }

  /**
   * Get context recommendations based on project type
   *
   * Provides project-specific guidance for:
   * - Which directories to include
   * - Which files to exclude
   * - Best practices for context optimization
   *
   * @param projectType - Detected project type
   * @returns Array of recommendation strings
   */
  private getContextRecommendations(projectType: ProjectType): string[] {
    const recommendations: string[] = [];

    switch (projectType) {
      case ProjectType.React:
      case ProjectType.NextJS:
        recommendations.push(
          'Include src/ directory for main application code',
          'Include package.json for dependencies',
          'Exclude node_modules and build directories',
          'Consider excluding test files if focusing on implementation'
        );
        break;

      case ProjectType.Angular:
        recommendations.push(
          'Include src/app/ for application code',
          'Include angular.json for project configuration',
          'Exclude node_modules and dist directories',
          'Consider including routing configuration'
        );
        break;

      case ProjectType.Vue:
        recommendations.push(
          'Include src/ directory for components and views',
          'Include package.json for dependencies',
          'Exclude node_modules and dist directories',
          'Consider including router configuration'
        );
        break;

      case ProjectType.Python:
        recommendations.push(
          'Include all .py files for source code',
          'Include requirements.txt or pyproject.toml for dependencies',
          'Exclude __pycache__ and virtual environment directories',
          'Consider excluding test files if not needed'
        );
        break;

      case ProjectType.Java:
        recommendations.push(
          'Include src/main/java for source code',
          'Include pom.xml or build.gradle for configuration',
          'Exclude target/ or build/ directories',
          'Consider including only specific packages if project is large'
        );
        break;

      case ProjectType.Rust:
        recommendations.push(
          'Include src/ for source code',
          'Include Cargo.toml for dependencies',
          'Exclude target/ directory',
          'Consider including Cargo.lock for exact dependency versions'
        );
        break;

      case ProjectType.Go:
        recommendations.push(
          'Include all .go files',
          'Include go.mod for dependencies',
          'Exclude vendor/ directory if present',
          'Consider including go.sum for dependency verification'
        );
        break;

      default:
        recommendations.push(
          'Include main source files relevant to your task',
          'Include configuration files (package.json, etc.)',
          'Exclude build artifacts and dependencies',
          'Use token optimization for large projects'
        );
    }

    return recommendations;
  }

  /**
   * Get directory structure recursively
   *
   * Builds a tree structure of directories and files up to maxDepth.
   * Skips common build/dependency directories automatically.
   *
   * @param dirUri - Directory URI to analyze
   * @param maxDepth - Maximum depth to traverse (default 3)
   * @param currentDepth - Current recursion depth
   * @returns Directory structure or empty structure on error
   */
  private async getDirectoryStructure(
    dirUri: vscode.Uri,
    maxDepth = 3,
    currentDepth = 0
  ): Promise<DirectoryStructure> {
    if (currentDepth >= maxDepth) {
      return { directories: [], files: [] };
    }

    try {
      const entries = await this.fileSystem.readDirectory(dirUri);
      const structure: DirectoryStructure = { directories: [], files: [] };

      for (const [name, type] of entries) {
        // Skip directories we should ignore
        if (
          type === vscode.FileType.Directory &&
          this.shouldSkipDirectory(name)
        ) {
          continue;
        }

        if (type === vscode.FileType.Directory) {
          const subUri = vscode.Uri.joinPath(dirUri, name);
          const subStructure = await this.getDirectoryStructure(
            subUri,
            maxDepth,
            currentDepth + 1
          );
          structure.directories.push({
            name,
            structure: subStructure,
          });
        } else if (type === vscode.FileType.File) {
          const extension = this.getFileExtension(name);
          structure.files.push({
            name,
            extension,
          });
        }
      }

      return structure;
    } catch (error) {
      console.warn(`Failed to read directory ${dirUri.fsPath}:`, error);
      return { directories: [], files: [] };
    }
  }

  /**
   * Get file statistics by extension for a project type
   *
   * Counts files by extension relevant to the project type.
   * Example: .py files for Python, .java files for Java, etc.
   *
   * @param workspaceUri - Workspace folder URI
   * @param projectType - Detected project type
   * @returns Map of extension to file count
   */
  private async getFileStatistics(
    workspaceUri: vscode.Uri,
    projectType: ProjectType
  ): Promise<Record<string, number>> {
    const statistics: Record<string, number> = {};

    const extensionsByType: Record<ProjectType, string[]> = {
      [ProjectType.Node]: ['.js', '.ts', '.json'],
      [ProjectType.React]: ['.jsx', '.tsx', '.js', '.ts', '.css', '.scss'],
      [ProjectType.Vue]: ['.vue', '.js', '.ts', '.css', '.scss'],
      [ProjectType.Angular]: ['.ts', '.html', '.css', '.scss'],
      [ProjectType.NextJS]: ['.jsx', '.tsx', '.js', '.ts', '.css', '.scss'],
      [ProjectType.Python]: ['.py'],
      [ProjectType.Java]: ['.java'],
      [ProjectType.Rust]: ['.rs'],
      [ProjectType.Go]: ['.go'],
      [ProjectType.DotNet]: ['.cs', '.fs'],
      [ProjectType.PHP]: ['.php'],
      [ProjectType.Ruby]: ['.rb'],
      [ProjectType.General]: [],
      [ProjectType.Unknown]: [],
    };

    const extensions = extensionsByType[projectType];

    if (extensions.length === 0) {
      return statistics;
    }

    for (const ext of extensions) {
      const count = await this.countFilesByExtension(workspaceUri, [ext]);
      statistics[ext] = count;
    }

    return statistics;
  }

  /**
   * Count all files in workspace (excluding ignored directories)
   *
   * @param dirUri - Directory URI to count
   * @returns Total file count
   */
  private async countAllFiles(dirUri: vscode.Uri): Promise<number> {
    try {
      const entries = await this.fileSystem.readDirectory(dirUri);
      let count = 0;

      for (const [name, type] of entries) {
        if (
          type === vscode.FileType.Directory &&
          !this.shouldSkipDirectory(name)
        ) {
          const subUri = vscode.Uri.joinPath(dirUri, name);
          count += await this.countAllFiles(subUri);
        } else if (type === vscode.FileType.File) {
          count++;
        }
      }

      return count;
    } catch {
      return 0;
    }
  }

  /**
   * Count files by extension in workspace
   *
   * @param dirUri - Directory URI to search
   * @param extensions - File extensions to count (e.g., ['.py', '.js'])
   * @returns Total count of files matching extensions
   */
  private async countFilesByExtension(
    dirUri: vscode.Uri,
    extensions: string[]
  ): Promise<number> {
    try {
      const entries = await this.fileSystem.readDirectory(dirUri);
      let count = 0;

      for (const [name, type] of entries) {
        if (
          type === vscode.FileType.Directory &&
          !this.shouldSkipDirectory(name)
        ) {
          const subUri = vscode.Uri.joinPath(dirUri, name);
          count += await this.countFilesByExtension(subUri, extensions);
        } else if (type === vscode.FileType.File) {
          const ext = this.getFileExtension(name);
          if (extensions.includes(ext)) {
            count++;
          }
        }
      }

      return count;
    } catch {
      return 0;
    }
  }

  /**
   * Read package.json from workspace
   *
   * @param workspaceUri - Workspace folder URI
   * @returns Parsed package.json or undefined on error
   */
  private async readPackageJson(
    workspaceUri: vscode.Uri
  ): Promise<{ version?: string; description?: string } | undefined> {
    try {
      const packageJsonUri = vscode.Uri.joinPath(workspaceUri, 'package.json');
      const content = await this.fileSystem.readFile(packageJsonUri);
      const packageJson = JSON.parse(content);
      return {
        version: packageJson.version,
        description: packageJson.description,
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Read Cargo.toml from workspace (Rust projects)
   *
   * @param workspaceUri - Workspace folder URI
   * @returns Cargo.toml metadata or undefined on error
   */
  private async readCargoToml(
    workspaceUri: vscode.Uri
  ): Promise<{ version?: string; description?: string } | undefined> {
    try {
      const cargoTomlUri = vscode.Uri.joinPath(workspaceUri, 'Cargo.toml');
      const content = await this.fileSystem.readFile(cargoTomlUri);

      // Simple TOML parsing for [package] section
      const packageMatch = content.match(/\[package\]([\s\S]*?)(\[|$)/);
      if (!packageMatch) {
        return undefined;
      }

      const packageSection = packageMatch[1];
      const versionMatch = packageSection.match(/version\s*=\s*"([^"]+)"/);
      const descriptionMatch = packageSection.match(
        /description\s*=\s*"([^"]+)"/
      );

      return {
        version: versionMatch?.[1],
        description: descriptionMatch?.[1],
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Check if project type is Node-based
   *
   * @param projectType - Project type to check
   * @returns True if project uses Node.js/npm
   */
  private isNodeBasedProject(projectType: ProjectType): boolean {
    return [
      ProjectType.Node,
      ProjectType.React,
      ProjectType.Vue,
      ProjectType.Angular,
      ProjectType.NextJS,
    ].includes(projectType);
  }

  /**
   * Check if directory should be skipped during traversal
   *
   * @param name - Directory name
   * @returns True if directory should be skipped
   */
  private shouldSkipDirectory(name: string): boolean {
    const skipDirs = [
      'node_modules',
      '.git',
      '.vscode',
      '.idea',
      'dist',
      'build',
      'out',
      'target',
      '__pycache__',
      '.venv',
      'venv',
      '.next',
      '.nuxt',
      'coverage',
    ];

    return skipDirs.includes(name) || name.startsWith('.');
  }

  /**
   * Get file extension including dot
   *
   * @param filename - File name
   * @returns Extension with dot (e.g., '.ts') or empty string
   */
  private getFileExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    if (lastDot === -1 || lastDot === 0) {
      return '';
    }
    return filename.substring(lastDot).toLowerCase();
  }

  /**
   * Setup event handlers for workspace changes
   *
   * Listens to VS Code workspace change events and triggers re-analysis.
   */
  private setupEventHandlers(): void {
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.updateWorkspaceAnalysis().catch((error) => {
          console.error('Failed to update workspace on folder change:', error);
        });
      })
    );
  }

  /**
   * Dispose service and cleanup resources
   */
  dispose(): void {
    console.info('Disposing WorkspaceService...');
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
