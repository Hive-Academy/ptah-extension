import { injectable } from 'tsyringe';
import * as vscode from 'vscode';
import { ProjectType } from '../types/workspace.types';
import { FileSystemService } from '../services/file-system.service';

/**
 * Detects project type based on workspace configuration files and dependencies.
 *
 * Supports detection for:
 * - Node.js ecosystems (React, Vue, Angular, Next.js, Express)
 * - Python (requirements.txt, pyproject.toml, setup.py)
 * - Java (Maven, Gradle)
 * - .NET (C#/F#)
 * - Rust (Cargo)
 * - Go (go.mod)
 * - PHP (Composer)
 * - Ruby (Bundler)
 * - Build tools (Vite, Webpack, Gatsby, Nuxt)
 *
 * @example
 * ```typescript
 * const detector = container.resolve<ProjectDetectorService>(TOKENS.PROJECT_DETECTOR_SERVICE);
 * const projectTypes = await detector.detectProjectTypes();
 * for (const [uri, type] of projectTypes) {
 *   console.log(`${uri.fsPath} is a ${type} project`);
 * }
 * ```
 */
@injectable()
export class ProjectDetectorService {
  constructor(private readonly fileSystem: FileSystemService) {}

  /**
   * Detects project type for all workspace folders.
   *
   * @returns Map of workspace folder URI to detected project type
   * @throws Never - returns 'general' for undetectable or errored workspaces
   */
  async detectProjectTypes(): Promise<Map<vscode.Uri, ProjectType>> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const results = new Map<vscode.Uri, ProjectType>();

    if (!workspaceFolders || workspaceFolders.length === 0) {
      return results;
    }

    // Detect project type for each workspace folder
    for (const folder of workspaceFolders) {
      const projectType = await this.detectProjectType(folder.uri);
      results.set(folder.uri, projectType);
    }

    return results;
  }

  /**
   * Detects project type for a specific workspace folder.
   *
   * Detection strategy:
   * 1. Check for package.json and analyze dependencies (Node.js ecosystem)
   * 2. Check for language-specific files (Python, Java, Rust, Go, etc.)
   * 3. Check for framework-specific configuration files
   * 4. Default to 'general' if no specific type detected
   *
   * @param workspaceUri - URI of workspace folder to analyze
   * @returns Detected project type (never throws, defaults to 'general')
   */
  async detectProjectType(workspaceUri: vscode.Uri): Promise<ProjectType> {
    try {
      const files = await this.fileSystem.readDirectory(workspaceUri);
      const fileNames = new Set(files.map(([name]) => name));

      // Node.js/JavaScript projects - highest priority
      if (fileNames.has('package.json')) {
        const nodeType = await this.detectNodeProjectType(workspaceUri);
        if (nodeType !== ProjectType.Node) {
          return nodeType; // Specific framework detected
        }
      }

      // Python projects
      if (
        fileNames.has('requirements.txt') ||
        fileNames.has('pyproject.toml') ||
        fileNames.has('setup.py') ||
        fileNames.has('Pipfile')
      ) {
        return ProjectType.Python;
      }

      // Java projects
      if (fileNames.has('pom.xml')) {
        return ProjectType.Java; // Maven
      }
      if (fileNames.has('build.gradle') || fileNames.has('build.gradle.kts')) {
        return ProjectType.Java; // Gradle
      }

      // .NET projects
      if (this.hasDotNetProject(fileNames)) {
        return ProjectType.DotNet;
      }

      // Rust projects
      if (fileNames.has('Cargo.toml')) {
        return ProjectType.Rust;
      }

      // Go projects
      if (fileNames.has('go.mod')) {
        return ProjectType.Go;
      }

      // PHP projects
      if (fileNames.has('composer.json')) {
        return ProjectType.PHP;
      }

      // Ruby projects
      if (fileNames.has('Gemfile')) {
        return ProjectType.Ruby;
      }

      // Framework-specific configuration files
      if (fileNames.has('angular.json')) {
        return ProjectType.Angular;
      }
      if (fileNames.has('nuxt.config.js') || fileNames.has('nuxt.config.ts')) {
        return ProjectType.Vue; // Nuxt is Vue-based
      }
      if (
        fileNames.has('gatsby-config.js') ||
        fileNames.has('gatsby-config.ts')
      ) {
        return ProjectType.React; // Gatsby is React-based
      }
      if (fileNames.has('vite.config.js') || fileNames.has('vite.config.ts')) {
        return ProjectType.Node; // Vite is build tool, not framework
      }
      if (
        fileNames.has('webpack.config.js') ||
        fileNames.has('webpack.config.ts')
      ) {
        return ProjectType.Node; // Webpack is build tool, not framework
      }

      // Default fallback - return package.json project type or general
      if (fileNames.has('package.json')) {
        return ProjectType.Node;
      }

      return ProjectType.General;
    } catch (_error) {
      // Never throw - always return a valid project type
      console.warn(
        `Failed to detect project type for ${workspaceUri.fsPath}:`,
        _error instanceof Error ? _error.message : String(_error)
      );
      return ProjectType.General;
    }
  }

  /**
   * Detects Node.js framework by analyzing package.json dependencies.
   *
   * Priority order:
   * 1. Next.js (React meta-framework)
   * 2. React
   * 3. Angular
   * 4. Vue
   * 5. Express (backend framework)
   * 6. Generic Node.js
   *
   * @param workspaceUri - Workspace folder containing package.json
   * @returns Detected Node.js project type
   */
  private async detectNodeProjectType(
    workspaceUri: vscode.Uri
  ): Promise<ProjectType> {
    try {
      const packageJsonUri = vscode.Uri.joinPath(workspaceUri, 'package.json');
      const content = await this.fileSystem.readFile(packageJsonUri);
      const packageJson = JSON.parse(content);

      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      // Check for Next.js first (it includes React)
      if (allDeps.next) {
        return ProjectType.NextJS;
      }

      // Check for React
      if (allDeps.react) {
        return ProjectType.React;
      }

      // Check for Angular
      if (allDeps['@angular/core'] || allDeps.angular) {
        return ProjectType.Angular;
      }

      // Check for Vue
      if (allDeps.vue) {
        return ProjectType.Vue;
      }

      // Check for Express
      if (allDeps.express) {
        return ProjectType.Node; // Express is just Node.js backend
      }

      return ProjectType.Node;
    } catch {
      // If package.json can't be read or parsed, return generic node
      return ProjectType.Node;
    }
  }

  /**
   * Checks if workspace contains .NET project files.
   *
   * @param fileNames - Set of file names in workspace root
   * @returns True if any .csproj, .fsproj, or .sln file exists
   */
  private hasDotNetProject(fileNames: Set<string>): boolean {
    for (const fileName of fileNames) {
      if (
        fileName.endsWith('.csproj') ||
        fileName.endsWith('.fsproj') ||
        fileName.endsWith('.sln')
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Cleanup resources (currently no-op, reserved for future use).
   */
  dispose(): void {
    // No resources to clean up currently
  }
}
