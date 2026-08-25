import { injectable, inject } from 'tsyringe';
import * as path from 'path';
import { TOKENS } from '@ptah-extension/vscode-core';
import { getStackProfile, matchesStackGlob } from '@ptah-extension/shared';
import { Framework, ProjectType } from '../types/workspace.types';
import { FileSystemService } from '../services/file-system.service';

/**
 * The registry's .NET project-file patterns, so this service does not keep a
 * second copy of "what a .NET project file is called".
 */
const DOTNET_PROJECT_GLOBS = getStackProfile('dotnet').detect.globs.filter(
  (pattern) => pattern.endsWith('proj'),
);

/**
 * Service for detecting web frameworks and backend frameworks in a workspace.
 *
 * Supports:
 * - React, Vue, Angular, Next.js, Nuxt (frontend)
 * - Express, Django, Flask, FastAPI, Laravel, Rails (backend)
 * - ASP.NET Core, Blazor, .NET Worker (.NET)
 *
 * Detection strategy:
 * 1. Check for framework-specific config files (angular.json, next.config.js, etc.)
 * 2. Parse package.json dependencies for framework markers
 * 3. Check for framework-specific directory structures
 */
@injectable()
export class FrameworkDetectorService {
  constructor(
    @inject(TOKENS.FILE_SYSTEM_SERVICE)
    private readonly fileSystem: FileSystemService,
  ) {}

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
    projectType: ProjectType,
  ): Promise<Framework | undefined> {
    if (projectType === ProjectType.General) {
      return undefined;
    }

    try {
      const frameworkFromConfig =
        await this.detectFromConfigFiles(workspacePath);
      if (frameworkFromConfig) {
        return frameworkFromConfig;
      }
      if (
        projectType === ProjectType.Node ||
        projectType === ProjectType.React
      ) {
        return await this.detectFromPackageJson(workspacePath);
      }
      if (projectType === ProjectType.Python) {
        return await this.detectPythonFramework(workspacePath);
      }
      if (projectType === ProjectType.DotNet) {
        return await this.detectDotNetFramework(workspacePath);
      }
      if (projectType === ProjectType.PHP) {
        return await this.detectPHPFramework(workspacePath);
      }
      if (projectType === ProjectType.Ruby) {
        return await this.detectRubyFramework(workspacePath);
      }

      return undefined;
    } catch (_error) {
      return undefined;
    }
  }

  /**
   * Detect framework from config files (most reliable method).
   */
  private async detectFromConfigFiles(
    workspacePath: string,
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
        path.join(workspacePath, file),
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
    workspacePath: string,
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
    } catch (_error) {
      return undefined;
    }
  }

  /**
   * Detect Python framework from its dependency manifests or project structure.
   *
   * `Framework.Flask` and `Framework.FastAPI` were declared but unreachable —
   * only Django was ever returned, and only from `requirements.txt`. Both
   * manifests are now read, because a Poetry or uv project declares its
   * dependencies in `pyproject.toml` and has no `requirements.txt` at all.
   *
   * Django keeps first claim, unchanged: `manage.py` is the strongest signal
   * there is, and a project depending on both Django and FastAPI is a Django
   * project with an API bolt-on far more often than the reverse.
   */
  private async detectPythonFramework(
    workspacePath: string,
  ): Promise<Framework | undefined> {
    const manageExists = await this.fileSystem.exists(
      path.join(workspacePath, 'manage.py'),
    );
    if (manageExists) {
      return Framework.Django;
    }

    const declared = await this.readPythonDependencyText(workspacePath);
    if (!declared) {
      return undefined;
    }

    if (declared.includes('django')) {
      return Framework.Django;
    }
    if (declared.includes('fastapi')) {
      return Framework.FastAPI;
    }
    if (declared.includes('flask')) {
      return Framework.Flask;
    }

    return undefined;
  }

  /**
   * Concatenate the Python dependency manifests that exist, lowercased.
   *
   * Substring matching rather than a TOML/requirements parse is deliberate: the
   * question is only "is this framework named anywhere in the dependency
   * declarations", and pulling in a TOML parser to answer it would buy
   * precision this service never uses. Returns `undefined` when neither
   * manifest is readable, so the caller can distinguish "no framework" from
   * "nothing to read".
   */
  private async readPythonDependencyText(
    workspacePath: string,
  ): Promise<string | undefined> {
    const manifests = ['requirements.txt', 'pyproject.toml'];
    const parts: string[] = [];

    for (const manifest of manifests) {
      const manifestPath = path.join(workspacePath, manifest);
      if (!(await this.fileSystem.exists(manifestPath))) {
        continue;
      }
      try {
        parts.push(
          (await this.fileSystem.readFile(manifestPath)).toLowerCase(),
        );
      } catch {
        // An unreadable manifest contributes nothing; the other may still.
        continue;
      }
    }

    return parts.length > 0 ? parts.join('\n') : undefined;
  }

  /**
   * Detect the .NET application model from the root's project files.
   *
   * Two signals, in order of authority:
   *   1. The project SDK — `Microsoft.NET.Sdk.Web` and `Microsoft.NET.Sdk.Worker`
   *      are declarations of intent that MSBuild itself acts on.
   *   2. `PackageReference` entries, which is the only way to spot Blazor: a
   *      Blazor app is an `Sdk="Microsoft.NET.Sdk.Web"` project plus the
   *      Components packages.
   *
   * Blazor is checked before ASP.NET Core because it is the narrower claim —
   * every Blazor Server/WebAssembly-hosted app is also a Web SDK project, so
   * testing the SDK first would make `Framework.Blazor` unreachable, which is
   * exactly the bug that left `Flask`/`FastAPI` dead in this file.
   */
  private async detectDotNetFramework(
    workspacePath: string,
  ): Promise<Framework | undefined> {
    const projectFiles = await this.findDotNetProjectFiles(workspacePath);
    if (projectFiles.length === 0) {
      return undefined;
    }

    let sawWebSdk = false;
    let sawWorkerSdk = false;

    for (const projectFile of projectFiles) {
      let content: string;
      try {
        content = await this.fileSystem.readFile(projectFile);
      } catch {
        continue;
      }
      const lower = content.toLowerCase();

      if (
        lower.includes('microsoft.aspnetcore.components.webassembly') ||
        lower.includes('microsoft.aspnetcore.components.web')
      ) {
        return Framework.Blazor;
      }
      if (lower.includes('sdk="microsoft.net.sdk.web"')) {
        sawWebSdk = true;
      }
      if (lower.includes('sdk="microsoft.net.sdk.worker"')) {
        sawWorkerSdk = true;
      }
      if (lower.includes('microsoft.extensions.hosting')) {
        sawWorkerSdk = true;
      }
      if (lower.includes('microsoft.aspnetcore.')) {
        sawWebSdk = true;
      }
    }

    if (sawWebSdk) {
      return Framework.AspNetCore;
    }
    if (sawWorkerSdk) {
      return Framework.DotNetWorker;
    }

    return undefined;
  }

  /**
   * Absolute paths of the root's .NET project files, from the registry's globs
   * rather than a second private list of extensions.
   */
  private async findDotNetProjectFiles(
    workspacePath: string,
  ): Promise<string[]> {
    let entries: Array<{ name: string }>;
    try {
      entries = await this.fileSystem.readDirectory(workspacePath);
    } catch {
      return [];
    }

    return entries
      .filter((entry) =>
        DOTNET_PROJECT_GLOBS.some((pattern) =>
          matchesStackGlob(pattern, entry.name),
        ),
      )
      .map((entry) => path.join(workspacePath, entry.name));
  }

  /**
   * Detect PHP framework from composer.json or project structure.
   */
  private async detectPHPFramework(
    workspacePath: string,
  ): Promise<Framework | undefined> {
    const artisanExists = await this.fileSystem.exists(
      path.join(workspacePath, 'artisan'),
    );
    if (artisanExists) {
      return Framework.Laravel;
    }
    const composerPath = path.join(workspacePath, 'composer.json');
    const composerExists = await this.fileSystem.exists(composerPath);

    if (composerExists) {
      const content = await this.fileSystem.readFile(composerPath);
      const composer = JSON.parse(content) as {
        require?: Record<string, string>;
      };

      if (composer.require && composer.require['laravel/framework']) {
        return Framework.Laravel;
      }
    }

    return undefined;
  }

  /**
   * Detect Ruby framework from Gemfile or project structure.
   */
  private async detectRubyFramework(
    workspacePath: string,
  ): Promise<Framework | undefined> {
    const railsAppExists = await this.fileSystem.exists(
      path.join(workspacePath, 'config', 'application.rb'),
    );
    if (railsAppExists) {
      return Framework.Rails;
    }
    const gemfilePath = path.join(workspacePath, 'Gemfile');
    const gemfileExists = await this.fileSystem.exists(gemfilePath);

    if (gemfileExists) {
      const content = await this.fileSystem.readFile(gemfilePath);
      if (content.includes('rails')) {
        return Framework.Rails;
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
    projectTypes: Map<string, ProjectType>,
  ): Promise<Map<string, Framework | undefined>> {
    const frameworks = new Map<string, Framework | undefined>();

    for (const [workspacePath, projectType] of projectTypes) {
      const framework = await this.detectFramework(workspacePath, projectType);
      frameworks.set(workspacePath, framework);
    }

    return frameworks;
  }
}
