import { injectable } from 'tsyringe';
import * as vscode from 'vscode';
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
  constructor(private readonly fileSystem: FileSystemService) {}

  /**
   * Detect monorepo configuration for a workspace folder.
   * Checks for presence of monorepo config files in priority order.
   *
   * @param workspaceUri - URI of the workspace folder to analyze
   * @returns Monorepo detection result
   */
  async detectMonorepo(
    workspaceUri: vscode.Uri
  ): Promise<MonorepoDetectionResult> {
    // Check for Nx workspace (highest priority - most opinionated)
    const nxResult = await this.detectNxWorkspace(workspaceUri);
    if (nxResult.isMonorepo) {
      return nxResult;
    }

    // Check for Rush workspace
    const rushResult = await this.detectRushWorkspace(workspaceUri);
    if (rushResult.isMonorepo) {
      return rushResult;
    }

    // Check for Lerna workspace
    const lernaResult = await this.detectLernaWorkspace(workspaceUri);
    if (lernaResult.isMonorepo) {
      return lernaResult;
    }

    // Check for Turborepo
    const turborepoResult = await this.detectTurborepo(workspaceUri);
    if (turborepoResult.isMonorepo) {
      return turborepoResult;
    }

    // Check for pnpm workspaces
    const pnpmResult = await this.detectPnpmWorkspace(workspaceUri);
    if (pnpmResult.isMonorepo) {
      return pnpmResult;
    }

    // Check for Yarn workspaces (lowest priority - least specific)
    const yarnResult = await this.detectYarnWorkspace(workspaceUri);
    if (yarnResult.isMonorepo) {
      return yarnResult;
    }

    // Not a monorepo
    return this.noMonorepoResult();
  }

  /**
   * Detect monorepo type for all workspace folders.
   * Returns a map of workspace URI to monorepo detection result.
   *
   * @returns Map of workspace folder URIs to their monorepo detection results
   */
  async detectMonoreposForWorkspaces(): Promise<
    Map<vscode.Uri, MonorepoDetectionResult>
  > {
    const results = new Map<vscode.Uri, MonorepoDetectionResult>();
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders) {
      return results;
    }

    for (const folder of workspaceFolders) {
      const detection = await this.detectMonorepo(folder.uri);
      results.set(folder.uri, detection);
    }

    return results;
  }

  /**
   * Detect Nx workspace via nx.json or workspace.json.
   */
  private async detectNxWorkspace(
    workspaceUri: vscode.Uri
  ): Promise<MonorepoDetectionResult> {
    const nxJsonUri = vscode.Uri.joinPath(workspaceUri, 'nx.json');
    const workspaceJsonUri = vscode.Uri.joinPath(
      workspaceUri,
      'workspace.json'
    );

    const nxExists = await this.fileSystem.exists(nxJsonUri);
    const workspaceExists = await this.fileSystem.exists(workspaceJsonUri);

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
          const content = await this.fileSystem.readFile(nxJsonUri);
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
    workspaceUri: vscode.Uri
  ): Promise<MonorepoDetectionResult> {
    const lernaJsonUri = vscode.Uri.joinPath(workspaceUri, 'lerna.json');
    const exists = await this.fileSystem.exists(lernaJsonUri);

    if (exists) {
      // Try to extract package count from lerna.json
      let packageCount: number | undefined;
      try {
        const content = await this.fileSystem.readFile(lernaJsonUri);
        const lernaJson = JSON.parse(content) as {
          packages?: string[];
          useWorkspaces?: boolean;
        };

        // If using workspaces, need to check package.json
        if (lernaJson.useWorkspaces) {
          const packageJsonUri = vscode.Uri.joinPath(
            workspaceUri,
            'package.json'
          );
          const packageJsonExists = await this.fileSystem.exists(
            packageJsonUri
          );
          if (packageJsonExists) {
            const packageContent = await this.fileSystem.readFile(
              packageJsonUri
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
    workspaceUri: vscode.Uri
  ): Promise<MonorepoDetectionResult> {
    const rushJsonUri = vscode.Uri.joinPath(workspaceUri, 'rush.json');
    const exists = await this.fileSystem.exists(rushJsonUri);

    if (exists) {
      // Try to count projects from rush.json
      let packageCount: number | undefined;
      try {
        const content = await this.fileSystem.readFile(rushJsonUri);
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
    workspaceUri: vscode.Uri
  ): Promise<MonorepoDetectionResult> {
    const turboJsonUri = vscode.Uri.joinPath(workspaceUri, 'turbo.json');
    const exists = await this.fileSystem.exists(turboJsonUri);

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
    workspaceUri: vscode.Uri
  ): Promise<MonorepoDetectionResult> {
    const pnpmWorkspaceUri = vscode.Uri.joinPath(
      workspaceUri,
      'pnpm-workspace.yaml'
    );
    const exists = await this.fileSystem.exists(pnpmWorkspaceUri);

    if (exists) {
      // Try to count packages from pnpm-workspace.yaml
      let packageCount: number | undefined;
      try {
        const content = await this.fileSystem.readFile(pnpmWorkspaceUri);
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
    workspaceUri: vscode.Uri
  ): Promise<MonorepoDetectionResult> {
    const packageJsonUri = vscode.Uri.joinPath(workspaceUri, 'package.json');
    const exists = await this.fileSystem.exists(packageJsonUri);

    if (exists) {
      try {
        const content = await this.fileSystem.readFile(packageJsonUri);
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
