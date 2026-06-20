/**
 * HarnessWorkspaceContextService.
 *
 * Owns workspace + plugin discovery for the harness wizard: workspace project
 * detection (package.json / requirements.txt / go.mod / Cargo.toml), the
 * hardcoded 4-agent CLI roster, and skill discovery via `PluginLoaderService`.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { inject, injectable } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS, PluginLoaderService } from '@ptah-extension/agent-sdk';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type {
  AvailableAgent,
  HarnessInitializeResponse,
  SkillSummary,
} from '@ptah-extension/shared';

@injectable()
export class HarnessWorkspaceContextService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_PLUGIN_LOADER)
    private readonly pluginLoader: PluginLoaderService,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
  ) {}

  /**
   * Require an open workspace folder. Throws if none.
   */
  requireWorkspaceRoot(): string {
    const root = this.workspaceProvider.getWorkspaceRoot();
    if (!root) {
      throw new Error(
        'No workspace folder open. Please open a folder before using the harness wizard.',
      );
    }
    return root;
  }

  /**
   * Resolve workspace context from the current workspace provider.
   * Returns a default context if no workspace is open.
   *
   * Performs lightweight detection by checking for common project indicators
   * (package.json, requirements.txt, go.mod, Cargo.toml) without requiring
   * a full workspace analysis pass.
   */
  async resolveWorkspaceContext(): Promise<
    HarnessInitializeResponse['workspaceContext']
  > {
    const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();

    if (!workspaceRoot) {
      return {
        projectName: 'No workspace',
        projectType: 'unknown',
        frameworks: [],
        languages: [],
      };
    }

    const projectName = path.basename(workspaceRoot);
    let projectType = 'workspace';
    const frameworks: string[] = [];
    const languages: string[] = [];

    const pkgPath = path.join(workspaceRoot, 'package.json');
    try {
      const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      languages.push('TypeScript');

      if (allDeps['@angular/core']) {
        frameworks.push('Angular');
        projectType = 'angular';
      }
      if (allDeps['react']) {
        frameworks.push('React');
        if (projectType === 'workspace') projectType = 'react';
      }
      if (allDeps['next']) {
        frameworks.push('Next.js');
        projectType = 'nextjs';
      }
      if (allDeps['@nestjs/core']) {
        frameworks.push('NestJS');
        if (projectType === 'workspace') projectType = 'nestjs';
      }
      if (allDeps['vue']) {
        frameworks.push('Vue');
        if (projectType === 'workspace') projectType = 'vue';
      }
      if (allDeps['express']) {
        frameworks.push('Express');
      }
      if (allDeps['nx'] || allDeps['@nx/workspace']) {
        projectType = 'nx-monorepo';
      }
    } catch (error: unknown) {
      this.logger.debug('No readable package.json in workspace', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (await this.fileExists(path.join(workspaceRoot, 'requirements.txt'))) {
      languages.push('Python');
    }
    if (await this.fileExists(path.join(workspaceRoot, 'go.mod'))) {
      languages.push('Go');
    }
    if (await this.fileExists(path.join(workspaceRoot, 'Cargo.toml'))) {
      languages.push('Rust');
    }

    return { projectName, projectType, frameworks, languages };
  }

  async isWorkspaceEffectivelyEmpty(): Promise<boolean> {
    const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
    if (!workspaceRoot) {
      return true;
    }

    let entries: string[];
    try {
      entries = await fs.readdir(workspaceRoot);
    } catch (error: unknown) {
      this.logger.debug('Failed to read workspace root for emptiness check', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }

    const meaningful = entries.filter((entry) => !entry.startsWith('.'));
    if (meaningful.length === 0) {
      return true;
    }

    if (meaningful.includes('package.json')) {
      return false;
    }

    const sourceExtensions = [
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.py',
      '.go',
      '.rs',
      '.java',
      '.rb',
      '.cs',
      '.php',
    ];
    const manifestFiles = [
      'requirements.txt',
      'pyproject.toml',
      'go.mod',
      'Cargo.toml',
      'pom.xml',
      'build.gradle',
      'Gemfile',
    ];

    for (const entry of meaningful) {
      if (manifestFiles.includes(entry)) {
        return false;
      }
      const ext = path.extname(entry).toLowerCase();
      if (sourceExtensions.includes(ext)) {
        return false;
      }
    }

    for (const entry of meaningful) {
      const entryPath = path.join(workspaceRoot, entry);
      let isDir = false;
      try {
        isDir = (await fs.stat(entryPath)).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;

      let childEntries: string[];
      try {
        childEntries = await fs.readdir(entryPath);
      } catch {
        continue;
      }
      for (const child of childEntries) {
        const ext = path.extname(child).toLowerCase();
        if (sourceExtensions.includes(ext)) {
          return false;
        }
      }
    }

    return true;
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the list of available CLI agents with availability status.
   *
   * Returns a hardcoded catalog of supported CLI agents. Availability
   * is reported as true since actual CLI detection happens at session
   * start time, not during wizard initialization.
   */
  getAvailableAgents(): AvailableAgent[] {
    return [
      {
        id: 'codex',
        name: 'Codex CLI',
        description: 'OpenAI Codex CLI agent for code completion and editing',
        type: 'cli',
        available: true,
        family: 'codex',
        provider: 'openai',
        installed: true,
      },
      {
        id: 'copilot',
        name: 'Copilot CLI',
        description:
          'GitHub Copilot CLI agent for code suggestions and pair programming',
        type: 'cli',
        available: true,
        family: 'copilot',
        provider: 'github',
        installed: true,
      },
      {
        id: 'ptah-cli',
        name: 'Ptah CLI',
        description:
          'Built-in Ptah headless agent for orchestrated multi-agent workflows',
        type: 'subagent',
        available: true,
        family: 'ptah-cli',
        provider: 'ptah-cli',
        installed: true,
      },
    ];
  }

  /**
   * Discover available skills from enabled plugins.
   *
   * Maps PluginSkillEntry objects from the PluginLoaderService
   * to SkillSummary objects for the harness wizard UI.
   */
  discoverAvailableSkills(): SkillSummary[] {
    try {
      const pluginPaths = this.pluginLoader.resolveCurrentPluginPaths();
      const pluginSkills =
        this.pluginLoader.discoverSkillsForPlugins(pluginPaths);
      const disabledSkillIds = new Set(this.pluginLoader.getDisabledSkillIds());

      return pluginSkills.map((skill) => ({
        id: skill.skillId,
        name: skill.displayName,
        description: skill.description,
        source: skill.pluginId.startsWith('ptah-harness-')
          ? ('harness' as const)
          : ('plugin' as const),
        isActive: !disabledSkillIds.has(skill.skillId),
      }));
    } catch (error) {
      this.logger.debug('Failed to discover skills for harness', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}
