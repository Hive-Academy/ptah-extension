/**
 * HarnessWorkspaceContextService.
 *
 * Owns workspace + plugin discovery for the harness wizard: workspace project
 * detection, the hardcoded 4-agent CLI roster, and skill discovery via
 * `PluginLoaderService`.
 *
 * Language detection reads `STACK_PROFILES` rather than a private manifest
 * list. Before that it probed only `requirements.txt`/`go.mod`/`Cargo.toml`, so
 * a .NET repo reached the agent as `Languages: (none detected)`, while
 * {@link HarnessWorkspaceContextService.isWorkspaceEffectivelyEmpty} knew `.cs`
 * but not `.csproj`/`.sln` and judged a real solution EMPTY — sending the user
 * down the new-project branch on top of existing work. One registry, both bugs.
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
import {
  STACK_PROFILES,
  STACK_SOURCE_EXTENSIONS,
  matchesStackProfile,
} from '@ptah-extension/shared';
import type {
  AvailableAgent,
  HarnessInitializeResponse,
  SkillSummary,
} from '@ptah-extension/shared';

/**
 * Languages Ptah recognises in a workspace but does not have a StackProfile
 * for — it can name them in a prompt, but cannot scaffold or route them.
 *
 * Kept verbatim from the pre-registry probe. Promoting one of these to a full
 * profile means deleting its entry here in the same change; leaving both would
 * report the language twice.
 */
const UNPROFILED_LANGUAGE_MANIFESTS: ReadonlyArray<{
  manifest: string;
  language: string;
}> = [
  { manifest: 'go.mod', language: 'Go' },
  { manifest: 'Cargo.toml', language: 'Rust' },
];

/**
 * Manifests that make a workspace non-empty without belonging to any profile.
 * Same rule as {@link UNPROFILED_LANGUAGE_MANIFESTS}: inherited from the old
 * inline list, and the registry now owns everything else.
 */
const UNPROFILED_MANIFEST_FILES: ReadonlySet<string> = new Set([
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'Gemfile',
]);

/**
 * Source extensions for those same unprofiled languages. Unioned with
 * `STACK_SOURCE_EXTENSIONS` so adding a profile can only ever widen this set,
 * never narrow it.
 */
const EMPTINESS_SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  ...STACK_SOURCE_EXTENSIONS,
  '.go',
  '.rs',
  '.java',
  '.rb',
  '.php',
]);

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
   * Lightweight by design — one directory read plus one `package.json` parse,
   * no full workspace analysis pass. The registry decides which languages a
   * root listing declares; `package.json` is read for its *contents* because it
   * is the only manifest that also drives `frameworks` and `projectType`.
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
    let packageJsonParsed = false;

    const pkgPath = path.join(workspaceRoot, 'package.json');
    try {
      const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      packageJsonParsed = true;

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

    const rootEntries = await this.readRootEntries(workspaceRoot);
    const languages = this.detectLanguages(rootEntries, packageJsonParsed);

    return { projectName, projectType, frameworks, languages };
  }

  /**
   * Name the languages a root listing declares, in registry order.
   *
   * `node-ts` is gated on the `package.json` parse rather than on the file
   * merely existing: a manifest that fails to parse has never counted as a
   * TypeScript workspace, and the framework pass above is the authority on
   * that. Every other profile answers from the listing alone.
   */
  private detectLanguages(
    rootEntries: readonly string[],
    packageJsonParsed: boolean,
  ): string[] {
    const languages: string[] = [];

    for (const profile of STACK_PROFILES) {
      if (profile.id === 'node-ts') {
        if (packageJsonParsed) {
          languages.push(profile.language);
        }
        continue;
      }
      if (matchesStackProfile(profile, rootEntries)) {
        languages.push(profile.language);
      }
    }

    for (const { manifest, language } of UNPROFILED_LANGUAGE_MANIFESTS) {
      if (rootEntries.includes(manifest)) {
        languages.push(language);
      }
    }

    return languages;
  }

  /**
   * Read the workspace root's immediate entries.
   *
   * Returns an empty list rather than throwing: an unreadable root means "we
   * learned nothing", which is the same answer the per-file existence checks
   * this replaced would have given.
   */
  private async readRootEntries(workspaceRoot: string): Promise<string[]> {
    try {
      return await fs.readdir(workspaceRoot);
    } catch (error: unknown) {
      this.logger.debug(
        'Failed to read workspace root for language detection',
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return [];
    }
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

    // Any profile's manifest — including glob-shaped ones like `MyApp.csproj`
    // and `MyApp.sln`, which the old inline list could not express and which is
    // exactly why a solution-only workspace used to read as empty.
    for (const profile of STACK_PROFILES) {
      if (matchesStackProfile(profile, meaningful)) {
        return false;
      }
    }

    for (const entry of meaningful) {
      if (UNPROFILED_MANIFEST_FILES.has(entry)) {
        return false;
      }
      const ext = path.extname(entry).toLowerCase();
      if (EMPTINESS_SOURCE_EXTENSIONS.has(ext)) {
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
        if (EMPTINESS_SOURCE_EXTENSIONS.has(ext)) {
          return false;
        }
      }
    }

    return true;
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
      },
      {
        id: 'copilot',
        name: 'Copilot CLI',
        description:
          'GitHub Copilot CLI agent for code suggestions and pair programming',
        type: 'cli',
        available: true,
      },
      {
        id: 'ptah-cli',
        name: 'Ptah CLI',
        description:
          'Built-in Ptah headless agent for orchestrated multi-agent workflows',
        type: 'subagent',
        available: true,
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
        descriptorId: skill.descriptorId,
        invocationName: skill.invocationName,
        name: skill.displayName,
        description: skill.description,
        source:
          skill.source === 'harness'
            ? ('harness' as const)
            : ('plugin' as const),
        provenance: skill.source,
        sourceId: skill.sourceId,
        invocability: disabledSkillIds.has(skill.skillId)
          ? 'not-invocable'
          : skill.invocability,
        isActive: !disabledSkillIds.has(skill.skillId),
      }));
    } catch (error: unknown) {
      this.logger.debug('Failed to discover skills for harness', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}
