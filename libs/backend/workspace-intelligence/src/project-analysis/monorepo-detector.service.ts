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
                workspaces?: string[];
              };
              if (packageJson.workspaces) {
                packageCount = packageJson.workspaces.length;
              }
            } catch {
              packageCount = undefined;
            }
          }
        } else if (lernaJson.packages) {
          packageCount = lernaJson.packages.length;
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
      let packageCount: number | undefined;

      const content = await this.fileSystem.readFile(pnpmWorkspacePath);
      const packagesMatch = content.match(/packages:\s*\n((?:\s+-\s+.+\n?)+)/);
      if (packagesMatch) {
        const packageLines = packagesMatch[1].trim().split('\n');
        packageCount = packageLines.filter((line) =>
          line.trim().startsWith('-'),
        ).length;
      }

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
          workspaces?: string[] | { packages?: string[] };
        };

        if (packageJson.workspaces) {
          let packageCount: number | undefined;
          if (Array.isArray(packageJson.workspaces)) {
            packageCount = packageJson.workspaces.length;
          } else if (packageJson.workspaces.packages) {
            packageCount = packageJson.workspaces.packages.length;
          }

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
        packageCount: this.countTomlArrayEntries(content, 'members'),
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
   * Count the quoted entries of a TOML inline array such as
   * `members = ["packages/*", "apps/api"]`.
   *
   * Returns `undefined` when the key is absent or holds no entries — the same
   * "count not determinable" signal the JavaScript detectors already use, which
   * is why this does not fall back to 0.
   */
  private countTomlArrayEntries(
    content: string,
    key: string,
  ): number | undefined {
    const match = content.match(
      new RegExp(`^\\s*${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm'),
    );
    if (!match) {
      return undefined;
    }
    const count = (match[1].match(/["'][^"']*["']/g) ?? []).length;
    return count > 0 ? count : undefined;
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
