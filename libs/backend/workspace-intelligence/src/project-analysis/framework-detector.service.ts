import { injectable } from 'tsyringe';
import * as path from 'path';
import { Framework, ProjectType } from '../types/workspace.types';
import { FileSystemService } from '../services/file-system.service';

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
  constructor(private readonly fileSystem: FileSystemService) {}

  /**
   * Detect framework(s) in a workspace folder.
   * Returns the primary framework or undefined if none detected.
   *
   * @param workspacePath - Path of the workspace folder to analyze
   * @param projectType - Already detected project type (helps narrow detection)
   * @returns Detected framework or undefined
   */
  async detectFramework(
    workspacePath: string,
    projectType: ProjectType
  ): Promise<Framework | undefined> {
    // Only detect frameworks for relevant project types
    if (projectType === ProjectType.General) {
      return undefined;
    }

    try {
      // Check for framework-specific config files first (most reliable)
      const frameworkFromConfig = await this.detectFromConfigFiles(
        workspacePath
      );
      if (frameworkFromConfig) {
        return frameworkFromConfig;
      }

      // Fall back to package.json dependency analysis
      if (
        projectType === ProjectType.Node ||
        projectType === ProjectType.React
      ) {
        return await this.detectFromPackageJson(workspacePath);
      }

      // Python framework detection
      if (projectType === ProjectType.Python) {
        return await this.detectPythonFramework(workspacePath);
      }

      // PHP framework detection
      if (projectType === ProjectType.PHP) {
        return await this.detectPHPFramework(workspacePath);
      }

      // Ruby framework detection
      if (projectType === ProjectType.Ruby) {
        return await this.detectRubyFramework(workspacePath);
      }

      return undefined;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_error) {
      // Graceful error handling - return undefined instead of crashing
      return undefined;
    }
  }

  /**
   * Detect framework from config files (most reliable method).
   */
  private async detectFromConfigFiles(
    workspacePath: string
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
        path.join(workspacePath, file)
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
    workspacePath: string
  ): Promise<Framework | undefined> {
    const packageJsonPath = path.join(workspacePath, 'package.json');
    const exists = await this.fileSystem.exists(packageJsonPath);

    if (!exists) {
      return undefined;
    }

    try {
      const content = await this.fileSystem.readFile(packageJsonPath);
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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_error) {
      // JSON parse error or file read error - return undefined
      return undefined;
    }
  }

  /**
   * Detect Python framework from requirements.txt or project structure.
   */
  private async detectPythonFramework(
    workspacePath: string
  ): Promise<Framework | undefined> {
    // Check for Django-specific files
    const manageExists = await this.fileSystem.exists(
      path.join(workspacePath, 'manage.py')
    );
    if (manageExists) {
      return Framework.Django;
    }

    // Check requirements.txt for framework dependencies
    const requirementsPath = path.join(workspacePath, 'requirements.txt');
    const requirementsExist = await this.fileSystem.exists(requirementsPath);

    if (requirementsExist) {
      try {
        const content = await this.fileSystem.readFile(requirementsPath);
        const lowerContent = content.toLowerCase();

        if (lowerContent.includes('django')) {
          return Framework.Django;
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_error) {
        // Ignore read errors
      }
    }

    return undefined;
  }

  /**
   * Detect PHP framework from composer.json or project structure.
   */
  private async detectPHPFramework(
    workspacePath: string
  ): Promise<Framework | undefined> {
    // Check for Laravel-specific files
    const artisanExists = await this.fileSystem.exists(
      path.join(workspacePath, 'artisan')
    );
    if (artisanExists) {
      return Framework.Laravel;
    }

    // Check composer.json
    const composerPath = path.join(workspacePath, 'composer.json');
    const composerExists = await this.fileSystem.exists(composerPath);

    if (composerExists) {
      try {
        const content = await this.fileSystem.readFile(composerPath);
        const composer = JSON.parse(content) as {
          require?: Record<string, string>;
        };

        if (composer.require && composer.require['laravel/framework']) {
          return Framework.Laravel;
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_error) {
        // Ignore parse errors
      }
    }

    return undefined;
  }

  /**
   * Detect Ruby framework from Gemfile or project structure.
   */
  private async detectRubyFramework(
    workspacePath: string
  ): Promise<Framework | undefined> {
    // Check for Rails-specific files
    const railsAppExists = await this.fileSystem.exists(
      path.join(workspacePath, 'config', 'application.rb')
    );
    if (railsAppExists) {
      return Framework.Rails;
    }

    // Check Gemfile
    const gemfilePath = path.join(workspacePath, 'Gemfile');
    const gemfileExists = await this.fileSystem.exists(gemfilePath);

    if (gemfileExists) {
      try {
        const content = await this.fileSystem.readFile(gemfilePath);
        if (content.includes('rails')) {
          return Framework.Rails;
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_error) {
        // Ignore read errors
      }
    }

    return undefined;
  }

  /**
   * Detect all frameworks in a multi-root workspace.
   * Returns a map of workspace path to detected framework.
   *
   * @param projectTypes - Map of workspace paths to project types
   * @returns Map of workspace paths to detected frameworks
   */
  async detectFrameworks(
    projectTypes: Map<string, ProjectType>
  ): Promise<Map<string, Framework | undefined>> {
    const frameworks = new Map<string, Framework | undefined>();

    for (const [workspacePath, projectType] of projectTypes) {
      const framework = await this.detectFramework(workspacePath, projectType);
      frameworks.set(workspacePath, framework);
    }

    return frameworks;
  }
}
