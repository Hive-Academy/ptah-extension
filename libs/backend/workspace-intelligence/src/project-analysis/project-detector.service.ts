import { injectable, inject } from 'tsyringe';
import * as path from 'path';
import { TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { getStackProfile, matchesStackProfile } from '@ptah-extension/shared';
import { ProjectType } from '../types/workspace.types';
import { FileSystemService } from '../services/file-system.service';

const NODE_TS_PROFILE = getStackProfile('node-ts');
const DOTNET_PROFILE = getStackProfile('dotnet');
const PYTHON_PROFILE = getStackProfile('python');

/**
 * Detects project type based on workspace configuration files and dependencies.
 *
 * Stacks with a `StackProfile` (Node/TypeScript, .NET, Python) take their
 * filename tests from `STACK_PROFILES` — this service maps a matched profile
 * onto a `ProjectType`, it does not decide what a manifest looks like. Stacks
 * without a profile (Java, Rust, Go, PHP, Ruby) keep their inline tests: Ptah
 * can name them but cannot scaffold or route them, so they have no profile to
 * read from.
 *
 * Supports detection for:
 * - Node.js ecosystems (React, Vue, Angular, Next.js, Express)
 * - Python (registry: pyproject.toml, requirements.txt, setup.py, setup.cfg,
 *   Pipfile, uv.lock, poetry.lock)
 * - Java (Maven, Gradle)
 * - .NET (registry: *.sln, *.slnx, *.csproj, *.fsproj, *.vbproj, global.json,
 *   Directory.Build.props, Directory.Packages.props)
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
 * for (const [path, type] of projectTypes) {
 *   console.log(`${path} is a ${type} project`);
 * }
 * ```
 */
@injectable()
export class ProjectDetectorService {
  constructor(
    @inject(TOKENS.FILE_SYSTEM_SERVICE)
    private readonly fileSystem: FileSystemService,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
  ) {}

  /**
   * Detects project type for all workspace folders.
   *
   * @returns Map of workspace folder path to detected project type
   * @throws Never - returns 'general' for undetectable or errored workspaces
   */
  async detectProjectTypes(): Promise<Map<string, ProjectType>> {
    const workspaceFolders = this.workspaceProvider.getWorkspaceFolders();
    const results = new Map<string, ProjectType>();

    if (workspaceFolders.length === 0) {
      return results;
    }
    for (const folder of workspaceFolders) {
      const projectType = await this.detectProjectType(folder);
      results.set(folder, projectType);
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
   * @param workspacePath - Path of workspace folder to analyze
   * @returns Detected project type (never throws, defaults to 'general')
   */
  async detectProjectType(workspacePath: string): Promise<ProjectType> {
    try {
      const entries = await this.fileSystem.readDirectory(workspacePath);
      const fileNames = new Set(entries.map((entry) => entry.name));
      if (matchesStackProfile(NODE_TS_PROFILE, fileNames)) {
        const nodeType = await this.detectNodeProjectType(workspacePath);
        if (nodeType !== ProjectType.Node) {
          return nodeType; // Specific framework detected
        }
      }
      if (matchesStackProfile(PYTHON_PROFILE, fileNames)) {
        return ProjectType.Python;
      }
      if (fileNames.has('pom.xml')) {
        return ProjectType.Java; // Maven
      }
      if (fileNames.has('build.gradle') || fileNames.has('build.gradle.kts')) {
        return ProjectType.Java; // Gradle
      }
      if (matchesStackProfile(DOTNET_PROFILE, fileNames)) {
        return ProjectType.DotNet;
      }
      if (fileNames.has('Cargo.toml')) {
        return ProjectType.Rust;
      }
      if (fileNames.has('go.mod')) {
        return ProjectType.Go;
      }
      if (fileNames.has('composer.json')) {
        return ProjectType.PHP;
      }
      if (fileNames.has('Gemfile')) {
        return ProjectType.Ruby;
      }
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
      if (matchesStackProfile(NODE_TS_PROFILE, fileNames)) {
        return ProjectType.Node;
      }

      return ProjectType.General;
    } catch (_error) {
      console.warn(
        `Failed to detect project type for ${workspacePath}:`,
        _error instanceof Error ? _error.message : String(_error),
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
   * @param workspacePath - Workspace folder containing package.json
   * @returns Detected Node.js project type
   */
  private async detectNodeProjectType(
    workspacePath: string,
  ): Promise<ProjectType> {
    try {
      const packageJsonPath = path.join(workspacePath, 'package.json');
      const content = await this.fileSystem.readFile(packageJsonPath);
      const packageJson = JSON.parse(content);

      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };
      if (allDeps.next) {
        return ProjectType.NextJS;
      }
      if (allDeps.react) {
        return ProjectType.React;
      }
      if (allDeps['@angular/core'] || allDeps.angular) {
        return ProjectType.Angular;
      }
      if (allDeps.vue) {
        return ProjectType.Vue;
      }
      if (allDeps.express) {
        return ProjectType.Node; // Express is just Node.js backend
      }

      return ProjectType.Node;
    } catch {
      return ProjectType.Node;
    }
  }

  /**
   * Cleanup resources (currently no-op, reserved for future use).
   */
  dispose(): void {}
}
