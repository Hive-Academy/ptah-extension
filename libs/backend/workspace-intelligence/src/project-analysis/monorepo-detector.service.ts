import { injectable, inject } from 'tsyringe';
import * as path from 'path';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { MonorepoType } from '../types/workspace.types';
import { FileSystemService } from '../services/file-system.service';

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
 */
@injectable()
export class MonorepoDetectorService {
  constructor(
    private readonly fileSystem: FileSystemService,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider
  ) {}

  /**
   * Detect monorepo configuration for a workspace folder.
   * Checks for presence of monorepo config files in priority order.
   *
   * @param workspacePath - Path of the workspace folder to analyze
   * @returns Monorepo detection result
   */
  async detectMonorepo(
    workspacePath: string
  ): Promise<MonorepoDetectionResult> {
    // Check for Nx workspace (highest priority - most opinionated)
    const nxResult = await this.detectNxWorkspace(workspacePath);
    if (nxResult.isMonorepo) {
      return nxResult;
    }

    // Check for Rush workspace
    const rushResult = await this.detectRushWorkspace(workspacePath);
    if (rushResult.isMonorepo) {
      return rushResult;
    }

    // Check for Lerna workspace
    const lernaResult = await this.detectLernaWorkspace(workspacePath);
    if (lernaResult.isMonorepo) {
      return lernaResult;
    }

    // Check for Turborepo
    const turborepoResult = await this.detectTurborepo(workspacePath);
    if (turborepoResult.isMonorepo) {
      return turborepoResult;
    }

    // Check for pnpm workspaces
    const pnpmResult = await this.detectPnpmWorkspace(workspacePath);
    if (pnpmResult.isMonorepo) {
      return pnpmResult;
    }

    // Check for Yarn workspaces (lowest priority - least specific)
    const yarnResult = await this.detectYarnWorkspace(workspacePath);
    if (yarnResult.isMonorepo) {
      return yarnResult;
    }

    // Not a monorepo
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
    workspacePath: string
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

      // Try to count projects from nx.json
      let packageCount: number | undefined;
      if (nxExists) {
        try {
          const content = await this.fileSystem.readFile(nxJsonPath);
          const nxJson = JSON.parse(content) as {
            projects?: Record<string, unknown>;
          };
          if (nxJson.projects) {
            packageCount = Object.keys(nxJson.projects).length;
          }
        } catch {
          // Ignore parse errors
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
    workspacePath: string
  ): Promise<MonorepoDetectionResult> {
    const lernaJsonPath = path.join(workspacePath, 'lerna.json');
    const exists = await this.fileSystem.exists(lernaJsonPath);

    if (exists) {
      // Try to extract package count from lerna.json
      let packageCount: number | undefined;
      try {
        const content = await this.fileSystem.readFile(lernaJsonPath);
        const lernaJson = JSON.parse(content) as {
          packages?: string[];
          useWorkspaces?: boolean;
        };

        // If using workspaces, need to check package.json
        if (lernaJson.useWorkspaces) {
          const packageJsonPath = path.join(workspacePath, 'package.json');
          const packageJsonExists = await this.fileSystem.exists(
            packageJsonPath
          );
          if (packageJsonExists) {
            const packageContent = await this.fileSystem.readFile(
              packageJsonPath
            );
            const packageJson = JSON.parse(packageContent) as {
              workspaces?: string[];
            };
            if (packageJson.workspaces) {
              packageCount = packageJson.workspaces.length;
            }
          }
        } else if (lernaJson.packages) {
          packageCount = lernaJson.packages.length;
        }
      } catch {
        // Ignore parse errors
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
    workspacePath: string
  ): Promise<MonorepoDetectionResult> {
    const rushJsonPath = path.join(workspacePath, 'rush.json');
    const exists = await this.fileSystem.exists(rushJsonPath);

    if (exists) {
      // Try to count projects from rush.json
      let packageCount: number | undefined;
      try {
        const content = await this.fileSystem.readFile(rushJsonPath);
        const rushJson = JSON.parse(content) as {
          projects?: Array<{ packageName: string }>;
        };
        if (rushJson.projects) {
          packageCount = rushJson.projects.length;
        }
      } catch {
        // Ignore parse errors
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
    workspacePath: string
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
    workspacePath: string
  ): Promise<MonorepoDetectionResult> {
    const pnpmWorkspacePath = path.join(workspacePath, 'pnpm-workspace.yaml');
    const exists = await this.fileSystem.exists(pnpmWorkspacePath);

    if (exists) {
      // Try to count packages from pnpm-workspace.yaml
      let packageCount: number | undefined;
      try {
        const content = await this.fileSystem.readFile(pnpmWorkspacePath);
        // Simple YAML parsing for packages array
        const packagesMatch = content.match(
          /packages:\s*\n((?:\s+-\s+.+\n?)+)/
        );
        if (packagesMatch) {
          const packageLines = packagesMatch[1].trim().split('\n');
          packageCount = packageLines.filter((line) =>
            line.trim().startsWith('-')
          ).length;
        }
      } catch {
        // Ignore parse errors
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
    workspacePath: string
  ): Promise<MonorepoDetectionResult> {
    const packageJsonPath = path.join(workspacePath, 'package.json');
    const exists = await this.fileSystem.exists(packageJsonPath);

    if (exists) {
      try {
        const content = await this.fileSystem.readFile(packageJsonPath);
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
        // Ignore parse errors
      }
    }

    return this.noMonorepoResult();
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
