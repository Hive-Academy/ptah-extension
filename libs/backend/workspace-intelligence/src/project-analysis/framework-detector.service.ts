import { injectable, inject } from 'tsyringe';
import * as vscode from 'vscode';
import { Framework, ProjectType } from '../types/workspace.types';
import { FileSystemService } from '../services/file-system.service';
import { FILE_SYSTEM_SERVICE } from '../di/tokens';

/**
 * Service for detecting web frameworks and backend frameworks in a workspace.
 *
 * Supports:
 * - React, Vue, Angular, Next.js, Nuxt (frontend)
 * - Express, Django, Laravel, Rails (backend)
 *
 * Detection strategy:
 * 1. Check for framework-specific config files (angular.json, next.config.js, etc.)
 * 2. Parse package.json dependencies for framework markers
 * 3. Check for framework-specific directory structures
 */
@injectable()
export class FrameworkDetectorService {
  constructor(
    @inject(FILE_SYSTEM_SERVICE) private readonly fileSystem: FileSystemService
  ) {}

  /**
   * Detect framework(s) in a workspace folder.
   * Returns the primary framework or undefined if none detected.
   *
   * @param workspaceUri - URI of the workspace folder to analyze
   * @param projectType - Already detected project type (helps narrow detection)
   * @returns Detected framework or undefined
   */
  async detectFramework(
    workspaceUri: vscode.Uri,
    projectType: ProjectType
  ): Promise<Framework | undefined> {
    // Only detect frameworks for relevant project types
    if (projectType === ProjectType.General) {
      return undefined;
    }

    try {
      // Check for framework-specific config files first (most reliable)
      const frameworkFromConfig = await this.detectFromConfigFiles(
        workspaceUri
      );
      if (frameworkFromConfig) {
        return frameworkFromConfig;
      }

      // Fall back to package.json dependency analysis
      if (
        projectType === ProjectType.Node ||
        projectType === ProjectType.React
      ) {
        return await this.detectFromPackageJson(workspaceUri);
      }

      // Python framework detection
      if (projectType === ProjectType.Python) {
        return await this.detectPythonFramework(workspaceUri);
      }

      // PHP framework detection
      if (projectType === ProjectType.PHP) {
        return await this.detectPHPFramework(workspaceUri);
      }

      // Ruby framework detection
      if (projectType === ProjectType.Ruby) {
        return await this.detectRubyFramework(workspaceUri);
      }

      return undefined;
    } catch (error) {
      // Graceful error handling - return undefined instead of crashing
      return undefined;
    }
  }

  /**
   * Detect framework from config files (most reliable method).
   */
  private async detectFromConfigFiles(
    workspaceUri: vscode.Uri
  ): Promise<Framework | undefined> {
    const configChecks: Array<{ file: string; framework: Framework }> = [
      { file: 'angular.json', framework: Framework.Angular },
      { file: 'next.config.js', framework: Framework.NextJS },
      { file: 'next.config.mjs', framework: Framework.NextJS },
      { file: 'next.config.ts', framework: Framework.NextJS },
      { file: 'nuxt.config.js', framework: Framework.Nuxt },
      { file: 'nuxt.config.ts', framework: Framework.Nuxt },
    ];

    for (const { file, framework } of configChecks) {
      const exists = await this.fileSystem.exists(
        vscode.Uri.joinPath(workspaceUri, file)
      );
      if (exists) {
        return framework;
      }
    }

    return undefined;
  }

  /**
   * Detect framework from package.json dependencies.
   */
  private async detectFromPackageJson(
    workspaceUri: vscode.Uri
  ): Promise<Framework | undefined> {
    const packageJsonUri = vscode.Uri.joinPath(workspaceUri, 'package.json');
    const exists = await this.fileSystem.exists(packageJsonUri);

    if (!exists) {
      return undefined;
    }

    try {
      const content = await this.fileSystem.readFile(packageJsonUri);
      const packageJson = JSON.parse(content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };

      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      // Check for frameworks in order of specificity (most specific first)
      if (allDeps['next']) {
        return Framework.NextJS;
      }

      if (allDeps['nuxt']) {
        return Framework.Nuxt;
      }

      if (allDeps['@angular/core']) {
        return Framework.Angular;
      }

      if (allDeps['react']) {
        return Framework.React;
      }

      if (allDeps['vue']) {
        return Framework.Vue;
      }

      if (allDeps['express']) {
        return Framework.Express;
      }

      return undefined;
    } catch (error) {
      // JSON parse error or file read error - return undefined
      return undefined;
    }
  }

  /**
   * Detect Python framework from requirements.txt or project structure.
   */
  private async detectPythonFramework(
    workspaceUri: vscode.Uri
  ): Promise<Framework | undefined> {
    // Check for Django-specific files
    const manageExists = await this.fileSystem.exists(
      vscode.Uri.joinPath(workspaceUri, 'manage.py')
    );
    if (manageExists) {
      return Framework.Django;
    }

    // Check requirements.txt for framework dependencies
    const requirementsUri = vscode.Uri.joinPath(
      workspaceUri,
      'requirements.txt'
    );
    const requirementsExist = await this.fileSystem.exists(requirementsUri);

    if (requirementsExist) {
      try {
        const content = await this.fileSystem.readFile(requirementsUri);
        const lowerContent = content.toLowerCase();

        if (lowerContent.includes('django')) {
          return Framework.Django;
        }
      } catch (error) {
        // Ignore read errors
      }
    }

    return undefined;
  }

  /**
   * Detect PHP framework from composer.json or project structure.
   */
  private async detectPHPFramework(
    workspaceUri: vscode.Uri
  ): Promise<Framework | undefined> {
    // Check for Laravel-specific files
    const artisanExists = await this.fileSystem.exists(
      vscode.Uri.joinPath(workspaceUri, 'artisan')
    );
    if (artisanExists) {
      return Framework.Laravel;
    }

    // Check composer.json
    const composerUri = vscode.Uri.joinPath(workspaceUri, 'composer.json');
    const composerExists = await this.fileSystem.exists(composerUri);

    if (composerExists) {
      try {
        const content = await this.fileSystem.readFile(composerUri);
        const composer = JSON.parse(content) as {
          require?: Record<string, string>;
        };

        if (composer.require && composer.require['laravel/framework']) {
          return Framework.Laravel;
        }
      } catch (error) {
        // Ignore parse errors
      }
    }

    return undefined;
  }

  /**
   * Detect Ruby framework from Gemfile or project structure.
   */
  private async detectRubyFramework(
    workspaceUri: vscode.Uri
  ): Promise<Framework | undefined> {
    // Check for Rails-specific files
    const railsAppExists = await this.fileSystem.exists(
      vscode.Uri.joinPath(workspaceUri, 'config', 'application.rb')
    );
    if (railsAppExists) {
      return Framework.Rails;
    }

    // Check Gemfile
    const gemfileUri = vscode.Uri.joinPath(workspaceUri, 'Gemfile');
    const gemfileExists = await this.fileSystem.exists(gemfileUri);

    if (gemfileExists) {
      try {
        const content = await this.fileSystem.readFile(gemfileUri);
        if (content.includes('rails')) {
          return Framework.Rails;
        }
      } catch (error) {
        // Ignore read errors
      }
    }

    return undefined;
  }

  /**
   * Detect all frameworks in a multi-root workspace.
   * Returns a map of workspace URI to detected framework.
   *
   * @param projectTypes - Map of workspace URIs to project types
   * @returns Map of workspace URIs to detected frameworks
   */
  async detectFrameworks(
    projectTypes: Map<vscode.Uri, ProjectType>
  ): Promise<Map<vscode.Uri, Framework | undefined>> {
    const frameworks = new Map<vscode.Uri, Framework | undefined>();

    for (const [uri, projectType] of projectTypes) {
      const framework = await this.detectFramework(uri, projectType);
      frameworks.set(uri, framework);
    }

    return frameworks;
  }
}
