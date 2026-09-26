import { injectable, inject } from 'tsyringe';
import * as path from 'path';
import { TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { getStackProfile, matchesStackGlob } from '@ptah-extension/shared';
import { MonorepoType } from '../types/workspace.types';
import { FileSystemService } from '../services/file-system.service';

/** The registry's solution-file patterns — `*.sln` and `*.slnx`. */
const DOTNET_SOLUTION_GLOBS = getStackProfile('dotnet').detect.globs.filter(
  (pattern) => pattern.endsWith('sln') || pattern.endsWith('slnx'),
);

/**
 * Where a monorepo declares its member projects, as read by
 * {@link MonorepoDetectorService.detectDeclaredMembers}.
 */
export interface DeclaredMembership {
  /**
   * Workspace-relative globs naming member directories (`packages/*`,
   * `apps/**`), in declaration order. A leading `!` excludes.
   */
  readonly patterns: readonly string[];
  /**
   * True for Nx, whose projects are the directories holding a `project.json`
   * wherever they sit, declared or not.
   */
  readonly scanProjectJson: boolean;
  /**
   * False when this monorepo type has no member declaration this service can
   * read (a .NET solution, a Poetry path-dependency root).
   */
  readonly supported: boolean;
  /** Declarations that exist but could not be read or parsed. */
  readonly issues: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringEntries(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : undefined;
}

/** A package.json `workspaces` field: the array form or `{ packages: [...] }`. */
function workspacesFieldPatterns(workspaces: unknown): string[] | undefined {
  if (Array.isArray(workspaces)) {
    return stringEntries(workspaces);
  }
  return isRecord(workspaces)
    ? stringEntries(workspaces['packages'])
    : undefined;
}

/**
 * A YAML line without its comment: a `#` at the start of the line or after
 * whitespace, outside single or double quotes, starts a comment.
 */
function stripYamlComment(line: string): string {
  let quote: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote) {
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();
  return /^(['"]).*\1$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
}

/**
 * The items of a YAML flow sequence body (`'a', "b,c", '{x,y}/*'`): split on
 * commas outside quotes and outside `{...}` brace globs.
 */
function splitFlowItems(body: string): string[] {
  const items: string[] = [];
  let quote: string | undefined;
  let braces = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (quote) {
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '{') {
      braces++;
    } else if (char === '}') {
      braces = Math.max(0, braces - 1);
    } else if (char === ',' && braces === 0) {
      items.push(body.slice(start, i));
      start = i + 1;
    }
  }
  items.push(body.slice(start));
  return items;
}

/** Whether a pnpm-workspace.yaml declares a top-level `packages` key. */
function declaresPnpmPackages(content: string): boolean {
  return content
    .split(/\r?\n/)
    .some((line) => /^packages\s*:/.test(stripYamlComment(line)));
}

/**
 * The `packages` list of a pnpm-workspace.yaml, quotes removed: the block
 * form (`- 'apps/*'` items, comments and blank lines between them allowed) or
 * the flow form (`packages: ['apps/*', "!apps/skip"]`). `undefined` when the
 * key is absent or lists nothing this parser recognises.
 */
function pnpmWorkspacePatterns(content: string): string[] | undefined {
  const lines = content.split(/\r?\n/).map(stripYamlComment);
  const keyIndex = lines.findIndex((line) => /^packages\s*:/.test(line));
  if (keyIndex === -1) {
    return undefined;
  }
  const inline = lines[keyIndex].replace(/^packages\s*:/, '').trim();
  const items: string[] = [];
  if (inline.startsWith('[') && inline.endsWith(']')) {
    items.push(...splitFlowItems(inline.slice(1, -1)).map(unquoteYamlScalar));
  } else {
    for (const line of lines.slice(keyIndex + 1)) {
      if (line.trim() === '') continue;
      // The next top-level key ends the list.
      if (!/^\s/.test(line)) break;
      const item = line.trim();
      if (item.startsWith('-')) {
        items.push(unquoteYamlScalar(item.slice(1)));
      }
    }
  }
  const patterns = items.filter((item) => item.length > 0);
  return patterns.length > 0 ? patterns : undefined;
}

/** `projectFolder` of each rush.json project. */
function rushProjectFolders(projects: unknown): string[] {
  return Array.isArray(projects)
    ? projects
        .map((project) =>
          isRecord(project) ? project['projectFolder'] : undefined,
        )
        .filter((folder): folder is string => typeof folder === 'string')
    : [];
}

/**
 * Project roots of a legacy nx.json / workspace.json `projects` map, whose
 * values are either the root path or `{ root }`.
 */
function nxProjectRoots(projects: unknown): string[] {
  if (!isRecord(projects)) {
    return [];
  }
  return Object.values(projects)
    .map((value) =>
      typeof value === 'string'
        ? value
        : isRecord(value)
          ? value['root']
          : undefined,
    )
    .filter((root): root is string => typeof root === 'string' && root !== '');
}

/**
 * The quoted entries of a TOML inline array such as
 * `members = ["packages/*", "apps/api"]`, or `undefined` when the key is
 * absent or holds no entries — the same "not determinable" signal the
 * JavaScript detectors use, which is why this does not fall back to [].
 */
function tomlArrayEntries(content: string, key: string): string[] | undefined {
  const match = content.match(
    new RegExp(`^\\s*${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm'),
  );
  if (!match) {
    return undefined;
  }
  const entries = (match[1].match(/["'][^"']*["']/g) ?? []).map((entry) =>
    entry.slice(1, -1),
  );
  return entries.length > 0 ? entries : undefined;
}

/**
 * Result of monorepo detection for a workspace.
 */
export interface MonorepoDetectionResult {
  isMonorepo: boolean;
  type: MonorepoType;
  workspaceFiles: string[]; // Config files that indicated monorepo
  packageCount?: number; // Number of packages/projects if detectable
}

/**
 * Service for detecting monorepo configurations across multiple tools.
 *
 * Supports:
 * - Nx (nx.json, workspace.json)
 * - Lerna (lerna.json)
 * - Rush (rush.json)
 * - Turborepo (turbo.json)
 * - pnpm workspaces (pnpm-workspace.yaml)
 * - Yarn workspaces (package.json workspaces field)
 * - .NET solutions (.sln, .slnx)
 * - uv workspaces ([tool.uv.workspace]) and Poetry path-dependency roots
 *
 * The JavaScript tools are probed first and in their original order. That is
 * not incidental: a repo with both `nx.json` and a `.sln` is an Nx workspace
 * that happens to contain .NET projects, and reporting it as a bare solution
 * would lose the tool that actually runs its targets.
 */
@injectable()
export class MonorepoDetectorService {
  constructor(
    @inject(TOKENS.FILE_SYSTEM_SERVICE)
    private readonly fileSystem: FileSystemService,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
  ) {}

  /**
   * Detect monorepo configuration for a workspace folder.
   * Checks for presence of monorepo config files in priority order.
   *
   * @param workspacePath - Path of the workspace folder to analyze
   * @returns Monorepo detection result
   */
  async detectMonorepo(
    workspacePath: string,
  ): Promise<MonorepoDetectionResult> {
    const nxResult = await this.detectNxWorkspace(workspacePath);
    if (nxResult.isMonorepo) {
      return nxResult;
    }
    const rushResult = await this.detectRushWorkspace(workspacePath);
    if (rushResult.isMonorepo) {
      return rushResult;
    }
    const lernaResult = await this.detectLernaWorkspace(workspacePath);
    if (lernaResult.isMonorepo) {
      return lernaResult;
    }
    const turborepoResult = await this.detectTurborepo(workspacePath);
    if (turborepoResult.isMonorepo) {
      return turborepoResult;
    }
    const pnpmResult = await this.detectPnpmWorkspace(workspacePath);
    if (pnpmResult.isMonorepo) {
      return pnpmResult;
    }
    const yarnResult = await this.detectYarnWorkspace(workspacePath);
    if (yarnResult.isMonorepo) {
      return yarnResult;
    }
    const pythonResult = await this.detectPythonWorkspace(workspacePath);
    if (pythonResult.isMonorepo) {
      return pythonResult;
    }
    const dotnetResult = await this.detectDotNetSolution(workspacePath);
    if (dotnetResult.isMonorepo) {
      return dotnetResult;
    }
    return this.noMonorepoResult();
  }

  /**
   * Detect monorepo type for all workspace folders.
   * Returns a map of workspace path to monorepo detection result.
   *
   * @returns Map of workspace folder paths to their monorepo detection results
   */
  async detectMonoreposForWorkspaces(): Promise<
    Map<string, MonorepoDetectionResult>
  > {
    const results = new Map<string, MonorepoDetectionResult>();
    const workspaceFolders = this.workspaceProvider.getWorkspaceFolders();

    if (workspaceFolders.length === 0) {
      return results;
    }

    for (const folder of workspaceFolders) {
      const detection = await this.detectMonorepo(folder);
      results.set(folder, detection);
    }

    return results;
  }

  /**
   * Detect Nx workspace via nx.json or workspace.json.
   */
  private async detectNxWorkspace(
    workspacePath: string,
  ): Promise<MonorepoDetectionResult> {
    const nxJsonPath = path.join(workspacePath, 'nx.json');
    const workspaceJsonPath = path.join(workspacePath, 'workspace.json');

    const nxExists = await this.fileSystem.exists(nxJsonPath);
    const workspaceExists = await this.fileSystem.exists(workspaceJsonPath);

    if (nxExists || workspaceExists) {
      const workspaceFiles: string[] = [];
      if (nxExists) {
        workspaceFiles.push('nx.json');
      }
      if (workspaceExists) {
        workspaceFiles.push('workspace.json');
      }
      let packageCount: number | undefined;
      if (nxExists) {
        const content = await this.fileSystem.readFile(nxJsonPath);
        try {
          const nxJson = JSON.parse(content) as {
            projects?: Record<string, unknown>;
          };
          if (nxJson.projects) {
            packageCount = Object.keys(nxJson.projects).length;
          }
        } catch {
          packageCount = undefined;
        }
      }

      return {
        isMonorepo: true,
        type: MonorepoType.Nx,
        workspaceFiles,
        packageCount,
      };
    }

    return this.noMonorepoResult();
  }

  /**
   * Detect Lerna workspace via lerna.json.
   */
  private async detectLernaWorkspace(
    workspacePath: string,
  ): Promise<MonorepoDetectionResult> {
    const lernaJsonPath = path.join(workspacePath, 'lerna.json');
    const exists = await this.fileSystem.exists(lernaJsonPath);

    if (exists) {
      let packageCount: number | undefined;

      const content = await this.fileSystem.readFile(lernaJsonPath);
      try {
        const lernaJson = JSON.parse(content) as {
          packages?: string[];
          useWorkspaces?: boolean;
        };
        if (lernaJson.useWorkspaces) {
          const packageJsonPath = path.join(workspacePath, 'package.json');
          const packageJsonExists =
            await this.fileSystem.exists(packageJsonPath);
          if (packageJsonExists) {
            const packageContent =
              await this.fileSystem.readFile(packageJsonPath);
            try {
              const packageJson = JSON.parse(packageContent) as {
                workspaces?: unknown;
              };
              packageCount = workspacesFieldPatterns(
                packageJson.workspaces,
              )?.length;
            } catch {
              packageCount = undefined;
            }
          }
        } else if (lernaJson.packages) {
          packageCount = stringEntries(lernaJson.packages)?.length;
        }
      } catch {
        packageCount = undefined;
      }

      return {
        isMonorepo: true,
        type: MonorepoType.Lerna,
        workspaceFiles: ['lerna.json'],
        packageCount,
      };
    }

    return this.noMonorepoResult();
  }

  /**
   * Detect Rush workspace via rush.json.
   */
  private async detectRushWorkspace(
    workspacePath: string,
  ): Promise<MonorepoDetectionResult> {
    const rushJsonPath = path.join(workspacePath, 'rush.json');
    const exists = await this.fileSystem.exists(rushJsonPath);

    if (exists) {
      let packageCount: number | undefined;

      const content = await this.fileSystem.readFile(rushJsonPath);
      try {
        const rushJson = JSON.parse(content) as {
          projects?: Array<{ packageName: string }>;
        };
        if (rushJson.projects) {
          packageCount = rushJson.projects.length;
        }
      } catch {
        packageCount = undefined;
      }

      return {
        isMonorepo: true,
        type: MonorepoType.Rush,
        workspaceFiles: ['rush.json'],
        packageCount,
      };
    }

    return this.noMonorepoResult();
  }

  /**
   * Detect Turborepo via turbo.json.
   */
  private async detectTurborepo(
    workspacePath: string,
  ): Promise<MonorepoDetectionResult> {
    const turboJsonPath = path.join(workspacePath, 'turbo.json');
    const exists = await this.fileSystem.exists(turboJsonPath);

    if (exists) {
      return {
        isMonorepo: true,
        type: MonorepoType.Turborepo,
        workspaceFiles: ['turbo.json'],
      };
    }

    return this.noMonorepoResult();
  }

  /**
   * Detect pnpm workspace via pnpm-workspace.yaml.
   */
  private async detectPnpmWorkspace(
    workspacePath: string,
  ): Promise<MonorepoDetectionResult> {
    const pnpmWorkspacePath = path.join(workspacePath, 'pnpm-workspace.yaml');
    const exists = await this.fileSystem.exists(pnpmWorkspacePath);

    if (exists) {
      const content = await this.fileSystem.readFile(pnpmWorkspacePath);
      const packageCount = pnpmWorkspacePatterns(content)?.length;

      return {
        isMonorepo: true,
        type: MonorepoType.PnpmWorkspaces,
        workspaceFiles: ['pnpm-workspace.yaml'],
        packageCount,
      };
    }

    return this.noMonorepoResult();
  }

  /**
   * Detect Yarn workspace via package.json workspaces field.
   */
  private async detectYarnWorkspace(
    workspacePath: string,
  ): Promise<MonorepoDetectionResult> {
    const packageJsonPath = path.join(workspacePath, 'package.json');
    const exists = await this.fileSystem.exists(packageJsonPath);

    if (exists) {
      const content = await this.fileSystem.readFile(packageJsonPath);
      try {
        const packageJson = JSON.parse(content) as {
          workspaces?: unknown;
        };

        if (packageJson.workspaces) {
          const packageCount = workspacesFieldPatterns(
            packageJson.workspaces,
          )?.length;

          return {
            isMonorepo: true,
            type: MonorepoType.YarnWorkspaces,
            workspaceFiles: ['package.json'],
            packageCount,
          };
        }
      } catch {
        return this.noMonorepoResult();
      }
    }

    return this.noMonorepoResult();
  }

  /**
   * Detect a .NET solution grouping several projects.
   *
   * A solution IS the .NET monorepo unit — before this, a 20-project `.sln`
   * reported `isMonorepo: false` and every downstream consumer treated it as a
   * single app.
   *
   * A solution with one project is not a monorepo, so the project count is the
   * gate rather than a decoration. `.sln` is a line-oriented text format whose
   * project entries each begin `Project("{GUID}")`; `.slnx` is its XML
   * successor with one `<Project Path="..."/>` element per project. Counting
   * those is enough — resolving the referenced projects would mean reading
   * every one of them to answer a yes/no question.
   */
  private async detectDotNetSolution(
    workspacePath: string,
  ): Promise<MonorepoDetectionResult> {
    let entries: Array<{ name: string }>;
    try {
      entries = await this.fileSystem.readDirectory(workspacePath);
    } catch {
      return this.noMonorepoResult();
    }

    const solutionFiles = entries
      .map((entry) => entry.name)
      .filter((name) =>
        DOTNET_SOLUTION_GLOBS.some((pattern) =>
          matchesStackGlob(pattern, name),
        ),
      );

    if (solutionFiles.length === 0) {
      return this.noMonorepoResult();
    }

    let packageCount = 0;
    for (const solutionFile of solutionFiles) {
      try {
        const content = await this.fileSystem.readFile(
          path.join(workspacePath, solutionFile),
        );
        packageCount += solutionFile.toLowerCase().endsWith('.slnx')
          ? (content.match(/<Project\b/g) ?? []).length
          : (content.match(/^Project\(/gm) ?? []).length;
      } catch {
        continue;
      }
    }

    if (packageCount < 2) {
      return this.noMonorepoResult();
    }

    return {
      isMonorepo: true,
      type: MonorepoType.DotNetSolution,
      workspaceFiles: solutionFiles,
      packageCount,
    };
  }

  /**
   * Detect a uv workspace or a Poetry path-dependency root.
   *
   * uv has an explicit `[tool.uv.workspace]` table, so that is exact. Poetry
   * has no workspace concept at all — its monorepo idiom is a root project
   * whose dependencies point at sibling directories with `{ path = "..." }`.
   * Requiring two or more such dependencies keeps a single vendored local
   * package from being mistaken for a monorepo.
   */
  private async detectPythonWorkspace(
    workspacePath: string,
  ): Promise<MonorepoDetectionResult> {
    const pyprojectPath = path.join(workspacePath, 'pyproject.toml');
    if (!(await this.fileSystem.exists(pyprojectPath))) {
      return this.noMonorepoResult();
    }

    let content: string;
    try {
      content = await this.fileSystem.readFile(pyprojectPath);
    } catch {
      return this.noMonorepoResult();
    }

    if (content.includes('[tool.uv.workspace]')) {
      return {
        isMonorepo: true,
        type: MonorepoType.UvWorkspace,
        workspaceFiles: ['pyproject.toml'],
        packageCount: tomlArrayEntries(content, 'members')?.length,
      };
    }

    if (content.includes('[tool.poetry')) {
      const pathDependencies = (content.match(/\bpath\s*=\s*["']/g) ?? [])
        .length;
      if (pathDependencies >= 2) {
        return {
          isMonorepo: true,
          type: MonorepoType.PoetryWorkspace,
          workspaceFiles: ['pyproject.toml'],
          packageCount: pathDependencies,
        };
      }
    }

    return this.noMonorepoResult();
  }

  /**
   * Read where a detected monorepo declares its members, with the same
   * parsers `detectMonorepo` counts packages with.
   *
   * The package-manager declarations (package.json `workspaces`,
   * pnpm-workspace.yaml) are read for every JavaScript monorepo type, because
   * Nx, Lerna and Turborepo workspaces usually delegate membership to them.
   * Each tool then adds its own: Lerna `packages`, Rush `projectFolder`s, the
   * legacy Nx `projects` map; Nx also sets {@link DeclaredMembership.scanProjectJson}.
   *
   * @param workspacePath - The monorepo root
   * @param type - The type `detectMonorepo` reported for it
   * @returns Declared patterns plus any declaration that could not be read;
   *   never throws
   */
  async detectDeclaredMembers(
    workspacePath: string,
    type: MonorepoType,
  ): Promise<DeclaredMembership> {
    const issues: string[] = [];
    const patterns: string[] = [];

    if (
      type === MonorepoType.DotNetSolution ||
      type === MonorepoType.PoetryWorkspace
    ) {
      return { patterns, scanProjectJson: false, supported: false, issues };
    }

    if (type === MonorepoType.UvWorkspace) {
      const pyproject = await this.readDeclaration(
        workspacePath,
        'pyproject.toml',
        issues,
      );
      patterns.push(
        ...((pyproject && tomlArrayEntries(pyproject, 'members')) ?? []),
      );
      return { patterns, scanProjectJson: false, supported: true, issues };
    }

    const packageJson = await this.readJsonDeclaration(
      workspacePath,
      'package.json',
      issues,
    );
    patterns.push(
      ...((isRecord(packageJson) &&
        workspacesFieldPatterns(packageJson['workspaces'])) ||
        []),
    );
    const pnpm = await this.readDeclaration(
      workspacePath,
      'pnpm-workspace.yaml',
      issues,
    );
    if (pnpm !== undefined) {
      const pnpmPatterns = pnpmWorkspacePatterns(pnpm);
      if (pnpmPatterns) {
        patterns.push(...pnpmPatterns);
      } else if (declaresPnpmPackages(pnpm)) {
        // A declared list this parser cannot read must not look like "none".
        issues.push('pnpm-workspace.yaml packages list could not be parsed');
      }
    }

    if (type === MonorepoType.Lerna) {
      const lerna = await this.readJsonDeclaration(
        workspacePath,
        'lerna.json',
        issues,
      );
      patterns.push(
        ...((isRecord(lerna) && stringEntries(lerna['packages'])) || []),
      );
    } else if (type === MonorepoType.Rush) {
      const rush = await this.readJsonDeclaration(
        workspacePath,
        'rush.json',
        issues,
      );
      patterns.push(
        ...rushProjectFolders(isRecord(rush) ? rush['projects'] : undefined),
      );
    } else if (type === MonorepoType.Nx) {
      for (const file of ['nx.json', 'workspace.json']) {
        const config = await this.readJsonDeclaration(
          workspacePath,
          file,
          issues,
        );
        patterns.push(
          ...nxProjectRoots(isRecord(config) ? config['projects'] : undefined),
        );
      }
    }

    return {
      patterns: [...new Set(patterns)],
      scanProjectJson: type === MonorepoType.Nx,
      supported: true,
      issues,
    };
  }

  /**
   * A declaration file's text, `undefined` when it does not exist. A file
   * that exists but cannot be read is recorded in `issues`.
   */
  private async readDeclaration(
    workspacePath: string,
    file: string,
    issues: string[],
  ): Promise<string | undefined> {
    const filePath = path.join(workspacePath, file);
    if (!(await this.fileSystem.exists(filePath))) {
      return undefined;
    }
    try {
      return await this.fileSystem.readFile(filePath);
    } catch {
      // degradation-audit: reported - the unreadable declaration is returned
      // to the caller in `issues` and surfaces in the analysis result.
      issues.push(`${file} could not be read`);
      return undefined;
    }
  }

  /** {@link readDeclaration} parsed as JSON; a parse failure is an issue. */
  private async readJsonDeclaration(
    workspacePath: string,
    file: string,
    issues: string[],
  ): Promise<unknown> {
    const content = await this.readDeclaration(workspacePath, file, issues);
    if (content === undefined) {
      return undefined;
    }
    try {
      return JSON.parse(content) as unknown;
    } catch {
      // degradation-audit: reported - the malformed declaration is returned
      // to the caller in `issues` and surfaces in the analysis result.
      issues.push(`${file} is not valid JSON`);
      return undefined;
    }
  }

  /**
   * Return a "no monorepo detected" result.
   * Uses a sentinel value for the type field to indicate no monorepo.
   */
  private noMonorepoResult(): MonorepoDetectionResult {
    return {
      isMonorepo: false,
      type: '' as MonorepoType, // Empty string indicates no monorepo type
      workspaceFiles: [],
    };
  }
}
