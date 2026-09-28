import { injectable, inject } from 'tsyringe';
import * as path from 'path';
import { TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { getStackProfile, matchesStackProfile } from '@ptah-extension/shared';
import { Framework, ProjectType } from '../types/workspace.types';
import { FileSystemService } from '../services/file-system.service';
import type { DeclaredMembership } from './monorepo-detector.service';
import { discoverMemberDirectories } from './monorepo-member-discovery';

const NODE_TS_PROFILE = getStackProfile('node-ts');
const DOTNET_PROFILE = getStackProfile('dotnet');
const PYTHON_PROFILE = getStackProfile('python');

/**
 * Most member projects inspected per monorepo. Each costs a directory read and
 * up to two manifest reads; the rest are counted and disclosed, never dropped
 * silently.
 */
export const MAX_INSPECTED_PROJECTS = 200;

/** Failed projects named in the composition's failure summary. */
const FAILED_PROJECTS_NAMED = 5;

/**
 * Types a monorepo ROOT never reports: a root manifest aggregates the
 * dependencies of every app, so one of these read off it is a guess about
 * one app presented as the answer for all of them.
 */
const APP_FRAMEWORK_TYPES: ReadonlySet<ProjectType> = new Set([
  ProjectType.React,
  ProjectType.Angular,
  ProjectType.Vue,
  ProjectType.NextJS,
]);

/**
 * Nx executor names → the project type and framework they build, first match
 * wins. Next.js precedes React (a Next.js app is also a React app) and Nuxt
 * precedes Vue for the same reason.
 */
const EXECUTOR_RULES: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly type: ProjectType;
  readonly framework?: Framework;
}> = [
  {
    pattern: /\bnext\b/i,
    type: ProjectType.NextJS,
    framework: Framework.NextJS,
  },
  {
    pattern: /angular/i,
    type: ProjectType.Angular,
    framework: Framework.Angular,
  },
  {
    pattern: /\breact\b|react-native|\bexpo\b/i,
    type: ProjectType.React,
    framework: Framework.React,
  },
  { pattern: /nuxt/i, type: ProjectType.Vue, framework: Framework.Nuxt },
  { pattern: /\bvue\b/i, type: ProjectType.Vue, framework: Framework.Vue },
  {
    pattern: /\bnest(js)?\b/i,
    type: ProjectType.Node,
    framework: Framework.NestJS,
  },
  { pattern: /python|poetry/i, type: ProjectType.Python },
  { pattern: /dotnet/i, type: ProjectType.DotNet },
  { pattern: /rust|cargo/i, type: ProjectType.Rust },
  { pattern: /\bgo\b|nx-go/i, type: ProjectType.Go },
];

/** One member project of a monorepo. */
export interface WorkspaceProject {
  /** `name` of its project.json or package.json, else its directory name. */
  readonly name: string;
  /** Workspace-relative directory, forward slashes (e.g. `apps/web`). */
  readonly path: string;
  /**
   * The language/app type its own files name — never the monorepo root's
   * guess. `unknown` when its only manifest could not be read.
   */
  readonly type: ProjectType;
  /** Its framework (Angular, Express, NestJS, ...), when one is detected. */
  readonly framework?: Framework;
  /** Why its type may be incomplete, e.g. an unreadable manifest. */
  readonly issue?: string;
}

/** A monorepo's root type plus its member projects and their completeness. */
export interface MonorepoComposition {
  /**
   * The root's language-level type: a UI framework read off the root
   * manifest is reported as {@link ProjectType.Node} instead.
   */
  readonly rootType: ProjectType;
  /** What single-app detection says of the root (the pre-monorepo answer). */
  readonly manifestRootType: ProjectType;
  /** Inspected projects, sorted by path; at most {@link MAX_INSPECTED_PROJECTS}. */
  readonly projects: readonly WorkspaceProject[];
  /** Projects found, inspected or not. */
  readonly totalProjects: number;
  /** False when projects were left uninspected or discovery was cut short. */
  readonly complete: boolean;
  /** Everything left out or unreadable, one line each. */
  readonly issues: readonly string[];
}

type ManifestRead =
  | { readonly status: 'absent' }
  | { readonly status: 'invalid' }
  | { readonly status: 'ok'; readonly value: Record<string, unknown> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface ProjectTarget {
  readonly name: string;
  readonly executor: string;
}

/** Every `targets.<name>.executor` of a parsed project.json, with its name. */
function projectTargets(projectJson: Record<string, unknown>): ProjectTarget[] {
  const targets = projectJson['targets'];
  if (!isRecord(targets)) {
    return [];
  }
  return Object.entries(targets).flatMap(([name, target]) =>
    isRecord(target) && typeof target['executor'] === 'string'
      ? [{ name, executor: target['executor'] }]
      : [],
  );
}

/**
 * Target names that build or run the application itself, in authority order.
 * Only these decide a project's framework when any of them names one.
 */
const APPLICATION_TARGETS = [
  'build',
  'bundle',
  'serve',
  'start',
  'export',
  'package',
  'build-android',
  'build-ios',
  'run-android',
  'run-ios',
];

/**
 * Executors that run tooling over an app rather than build it (an Angular
 * ESLint builder in a React Native app), whatever their target is called.
 */
const AUXILIARY_EXECUTOR =
  /eslint|lint|jest|vitest|karma|test|storybook|cypress|playwright|prettier|format/i;

/**
 * The executor rule that decides a project's type: a known application target
 * (`build` first, then bundle, serve, ...); only when none of those names a
 * framework, any other target whose executor is not tooling. An unknown target
 * name therefore never outranks a known application target.
 */
function decidingExecutorRule(
  targets: readonly ProjectTarget[],
): (typeof EXECUTOR_RULES)[number] | undefined {
  const ruleFor = (executor: string) =>
    EXECUTOR_RULES.find(({ pattern }) => pattern.test(executor));
  for (const name of APPLICATION_TARGETS) {
    const target = targets.find((candidate) => candidate.name === name);
    const rule = target && ruleFor(target.executor);
    if (rule) return rule;
  }
  for (const target of targets) {
    if (
      APPLICATION_TARGETS.includes(target.name) ||
      AUXILIARY_EXECUTOR.test(target.executor)
    ) {
      continue;
    }
    const rule = ruleFor(target.executor);
    if (rule) return rule;
  }
  return undefined;
}

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
   * 1. Check for framework configuration files (angular.json) — a file-based
   *    framework signal wins over dependency analysis, so an Nx workspace
   *    that also ships React tooling as devDependencies is still reported by
   *    its workspace-level config
   * 2. Check for package.json and analyze dependencies (Node.js ecosystem)
   * 3. Check for language-specific files (Python, Java, Rust, Go, etc.)
   * 4. Check for other framework-specific configuration files
   * 5. Default to 'general' if no specific type detected
   *
   * `nx.json` alone does not decide a type: it signals that a workspace-level
   * config (such as angular.json) names the framework, so it has no branch
   * here and dependency detection does not override it. For a monorepo root
   * the dependency answer is a guess about one app; callers that know the
   * root is a monorepo use {@link detectMonorepoComposition} instead.
   *
   * @param workspacePath - Path of workspace folder to analyze
   * @returns Detected project type (never throws, defaults to 'general')
   */
  async detectProjectType(workspacePath: string): Promise<ProjectType> {
    try {
      const entries = await this.fileSystem.readDirectory(workspacePath);
      const fileNames = new Set(entries.map((entry) => entry.name));
      if (fileNames.has('angular.json')) {
        return ProjectType.Angular;
      }
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
   * Describe a workspace already known to be a monorepo: its root type and
   * each member project, read off that project's own manifests.
   *
   * Call this INSTEAD of trusting {@link detectProjectType} on a monorepo root.
   * Root detection ranks React ahead of Angular in the root dependencies, and
   * an Nx root lists the dependencies of every app — so a workspace with one
   * React tool and ten Angular apps reads as `react`.
   *
   * Members come from the workspace's declared membership (see
   * `discoverMemberDirectories`). At most {@link MAX_INSPECTED_PROJECTS} are
   * inspected; `totalProjects`, `complete` and `issues` always say how many
   * were found and what was left out.
   *
   * @param workspacePath - Monorepo root (already confirmed by
   *   `MonorepoDetectorService.detectMonorepo`)
   * @param membership - Its declared members
   *   (`MonorepoDetectorService.detectDeclaredMembers`)
   * @returns Root type, inspected projects and completeness; never throws
   */
  async detectMonorepoComposition(
    workspacePath: string,
    membership: DeclaredMembership,
  ): Promise<MonorepoComposition> {
    const manifestRootType = await this.detectProjectType(workspacePath);
    const rootType = APP_FRAMEWORK_TYPES.has(manifestRootType)
      ? ProjectType.Node
      : manifestRootType;

    const discovery = await discoverMemberDirectories(
      this.fileSystem,
      workspacePath,
      membership,
    );
    const issues = [...discovery.issues];
    let complete = discovery.complete;
    const totalProjects = discovery.directories.length;
    const inspected = discovery.directories.slice(0, MAX_INSPECTED_PROJECTS);
    if (inspected.length < totalProjects) {
      complete = false;
      issues.push(
        `${totalProjects - inspected.length} of ${totalProjects} projects not inspected (limit ${MAX_INSPECTED_PROJECTS})`,
      );
    }

    const projects: WorkspaceProject[] = [];
    for (const projectPath of inspected) {
      projects.push(
        await this.detectMonorepoProject(workspacePath, projectPath),
      );
    }

    // Stated at composition level so no display limit can hide a failure.
    const failed = projects.filter((project) => project.issue);
    if (failed.length > 0) {
      complete = false;
      const named = failed
        .slice(0, FAILED_PROJECTS_NAMED)
        .map((project) => `${project.path} (${project.issue})`);
      const rest = failed.length - named.length;
      // First, so a display cap on notes can never hide it.
      issues.unshift(
        `${failed.length} project${failed.length === 1 ? '' : 's'} could not be fully inspected: ${named.join(', ')}${rest > 0 ? `, and ${rest} more` : ''}`,
      );
    }

    return {
      rootType,
      manifestRootType,
      projects,
      totalProjects,
      complete,
      issues,
    };
  }

  /**
   * One member project. Always returned: a manifest that exists but cannot be
   * read or parsed yields type `unknown` and an `issue`, never an absent
   * project.
   *
   * Type order: an explicit project.json build executor wins (the `build`
   * target first, then other application targets, never lint/test tooling; it is a
   * declaration, where dependencies are a heuristic an app's tooling can
   * mislead); then whatever the project's own files name; then `node` for a
   * project with any executor (an Nx-built project), else `general`.
   */
  private async detectMonorepoProject(
    workspacePath: string,
    projectPath: string,
  ): Promise<WorkspaceProject> {
    const projectDir = path.join(workspacePath, ...projectPath.split('/'));
    const projectJson = await this.readJsonManifest(
      path.join(projectDir, 'project.json'),
    );
    const packageJson = await this.readJsonManifest(
      path.join(projectDir, 'package.json'),
    );
    const failed = [
      projectJson.status === 'invalid' ? 'project.json' : undefined,
      packageJson.status === 'invalid' ? 'package.json' : undefined,
    ].filter((file): file is string => file !== undefined);
    const issue =
      failed.length > 0
        ? `${failed.join(' and ')} could not be read or parsed`
        : undefined;

    const targets =
      projectJson.status === 'ok' ? projectTargets(projectJson.value) : [];
    const executors = targets.map((target) => target.executor);
    const rule = decidingExecutorRule(targets);

    let type: ProjectType;
    let framework: Framework | undefined;
    if (rule) {
      type = rule.type;
      framework = rule.framework;
    } else {
      const ownType = await this.detectProjectType(projectDir);
      if (
        failed.length > 0 &&
        (ownType === ProjectType.Node || ownType === ProjectType.General)
      ) {
        // The unreadable manifest was the only signal; `node` would be a guess.
        type = ProjectType.Unknown;
      } else if (ownType !== ProjectType.General) {
        type = ownType;
      } else {
        type = executors.length > 0 ? ProjectType.Node : ProjectType.General;
      }
    }

    const declaredName =
      (projectJson.status === 'ok' ? projectJson.value['name'] : undefined) ??
      (packageJson.status === 'ok' ? packageJson.value['name'] : undefined);
    const name =
      typeof declaredName === 'string' && declaredName.length > 0
        ? declaredName
        : path.basename(projectDir);

    return {
      name,
      path: projectPath,
      type,
      ...(framework ? { framework } : {}),
      ...(issue ? { issue } : {}),
    };
  }

  /**
   * A JSON-object manifest: `absent` when the file does not exist, `invalid`
   * when it exists but cannot be read, is not JSON, or is not an object.
   */
  private async readJsonManifest(filePath: string): Promise<ManifestRead> {
    if (!(await this.fileSystem.exists(filePath))) {
      return { status: 'absent' };
    }
    try {
      const parsed: unknown = JSON.parse(
        await this.fileSystem.readFile(filePath),
      );
      return isRecord(parsed)
        ? { status: 'ok', value: parsed }
        : { status: 'invalid' };
    } catch {
      return { status: 'invalid' };
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
