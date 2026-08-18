/**
 * Skills.sh RPC Handlers
 *
 * Platform-agnostic implementations for Skills.sh marketplace methods:
 * - skillsSh:search - Search skills via the public skills.sh API (CLI fallback)
 * - skillsSh:listInstalled - List installed skills from filesystem
 * - skillsSh:install - Install a skill
 * - skillsSh:uninstall - Remove a skill
 * - skillsSh:getPopular - Get popular skills (cached)
 * - skillsSh:detectRecommended - Detect workspace technologies and recommend skills
 *
 * Search uses `https://skills.sh/api/search` — the same unauthenticated
 * endpoint the official `skills` CLI consumes. The authenticated `/api/v1/*`
 * API requires Vercel OIDC tokens and is not usable from a desktop client.
 */

import { injectable, inject } from 'tsyringe';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  HARNESS_SYNC_TOKENS,
  type HarnessPropagationService,
} from '@ptah-extension/harness-sync';
import { isSafePathToken } from '@ptah-extension/shared';
import type {
  SkillShEntry,
  InstalledSkill,
  SkillDetectionResult,
  RpcMethodName,
} from '@ptah-extension/shared';
import {
  SkillsShInstallParamsSchema,
  SkillsShUninstallParamsSchema,
  sanitizeSearchQuery,
} from './skills-sh-rpc.schema';
import {
  rejectUnsafeInstallRequest,
  runSkillsCli,
} from '../utils/skills-sh-cli';
import { SkillsShSourceRootService } from '../skills-sh/skills-sh-source-root.service';
import { SkillsShApiClient } from '@ptah-extension/cli-agent-runtime';

const CURATED_POPULAR_SKILLS: SkillShEntry[] = [
  {
    source: 'vercel-labs/agent-skills',
    skillId: 'vercel-react-best-practices',
    name: 'React Best Practices',
    description:
      'React and Next.js performance optimization guidelines from Vercel Engineering',
    installs: 220400,
    isInstalled: false,
  },
  {
    source: 'vercel-labs/agent-skills',
    skillId: 'web-design-guidelines',
    name: 'Web Design Guidelines',
    description:
      'Review UI code for Web Interface Guidelines compliance, accessibility, and UX',
    installs: 174700,
    isInstalled: false,
  },
  {
    source: 'anthropics/skills',
    skillId: 'frontend-design',
    name: 'Frontend Design',
    description: 'Build polished frontend interfaces with best practices',
    installs: 168700,
    isInstalled: false,
  },
  {
    source: 'remotion-dev/skills',
    skillId: 'remotion-best-practices',
    name: 'Remotion Best Practices',
    description: 'Create programmatic videos with the Remotion framework',
    installs: 153100,
    isInstalled: false,
  },
  {
    source: 'anthropics/skills',
    skillId: 'claude-api',
    name: 'Claude API',
    description: 'Build apps with the Claude API and Anthropic SDK',
    installs: 140000,
    isInstalled: false,
  },
  {
    source: 'anthropics/skills',
    skillId: 'mcp-builder',
    name: 'MCP Builder',
    description: 'Build Model Context Protocol servers and tools',
    installs: 110000,
    isInstalled: false,
  },
  {
    source: 'anthropics/skills',
    skillId: 'webapp-testing',
    name: 'Web App Testing',
    description: 'Comprehensive web application testing with best practices',
    installs: 82000,
    isInstalled: false,
  },
  {
    source: 'anthropics/skills',
    skillId: 'skill-creator',
    name: 'Skill Creator',
    description: 'Guide for creating effective agent skills',
    installs: 75000,
    isInstalled: false,
  },
];

const TECH_SKILL_KEYWORDS: Record<string, string[]> = {
  react: [
    'vercel-react-best-practices',
    'frontend-design',
    'web-design-guidelines',
    'webapp-testing',
  ],
  next: ['vercel-react-best-practices', 'web-design-guidelines'],
  angular: ['frontend-design', 'web-design-guidelines', 'webapp-testing'],
  vue: ['frontend-design', 'web-design-guidelines', 'webapp-testing'],
  express: ['webapp-testing', 'claude-api'],
  nestjs: ['webapp-testing', 'claude-api'],
  tailwindcss: ['web-design-guidelines', 'frontend-design'],
  typescript: ['webapp-testing', 'frontend-design'],
  remotion: ['remotion-best-practices'],
};

@injectable()
export class SkillsShRpcHandlers {
  static readonly METHODS = [
    'skillsSh:search',
    'skillsSh:listInstalled',
    'skillsSh:install',
    'skillsSh:uninstall',
    'skillsSh:getPopular',
    'skillsSh:detectRecommended',
  ] as const satisfies readonly RpcMethodName[];

  private popularCache: { data: SkillShEntry[]; timestamp: number } | null =
    null;

  private static readonly POPULAR_CACHE_TTL_MS = 10 * 60 * 1000;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(SkillsShApiClient)
    private readonly apiClient: SkillsShApiClient,
    /**
     * The ONE new collaborator for the whole source-root feature. Install,
     * uninstall, list and the legacy sweep are four faces of the same question
     * — what is in `~/.ptah/plugins/ptah-skillssh-*` — so they arrive as one
     * service rather than four, which is the `PluginRpcHandlers` bloat this
     * handler is meant not to repeat.
     */
    @inject(SkillsShSourceRootService)
    private readonly sourceRoots: SkillsShSourceRootService,
    @inject(HARNESS_SYNC_TOKENS.PROPAGATION)
    private readonly harnessPropagation: HarnessPropagationService,
  ) {}

  register(): void {
    this.registerSearch();
    this.registerListInstalled();
    this.registerInstall();
    this.registerUninstall();
    this.registerGetPopular();
    this.registerDetectRecommended();

    this.logger.debug('Skills.sh RPC handlers registered', {
      methods: SkillsShRpcHandlers.METHODS,
    });
  }

  private registerSearch(): void {
    this.rpcHandler.registerMethod<
      { query: string },
      { skills: SkillShEntry[]; error?: string }
    >('skillsSh:search', async (params) => {
      try {
        this.logger.debug('RPC: skillsSh:search called', {
          query: params.query,
        });

        const sanitizedQuery = sanitizeSearchQuery(params.query);
        if (!sanitizedQuery.trim()) {
          return { skills: [], error: 'Invalid search query' };
        }

        try {
          const apiSkills = await this.apiClient.search(sanitizedQuery);
          const enriched = await this.enrichWithInstallStatus(apiSkills);
          return { skills: enriched };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            'RPC: skillsSh:search API failed, falling back to CLI',
            { error: message },
          );
        }

        const workspaceRoot = this.getWorkspaceRoot();
        const result = await runSkillsCli(
          ['find', sanitizedQuery],
          workspaceRoot,
          15000,
        );

        if (result.exitCode !== 0) {
          this.logger.warn('RPC: skillsSh:search CLI returned non-zero', {
            exitCode: result.exitCode,
            stderr: result.stderr.substring(0, 200),
          });
          return {
            skills: [],
            error: `Skills CLI exited with code ${result.exitCode}`,
          };
        }

        const skills = this.parseSkillsOutput(result.stdout);
        this.logger.debug('RPC: skillsSh:search success', {
          resultCount: skills.length,
        });

        return { skills };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          'RPC: skillsSh:search failed',
          error instanceof Error ? error : new Error(errorMessage),
        );
        return { skills: [], error: errorMessage };
      }
    });
  }

  /**
   * List from the SOURCE ROOTS, not from `.claude/skills`.
   *
   * The old implementation asked `npx skills list --json` and fell back to
   * scanning `{ws}/.claude/skills` and `~/.claude/skills`. Both of those are
   * now OUTPUTS — a managed copy lands there and is reaped from there — so
   * either answer conflated "what did the last reconcile write" with "what is
   * installed", and reported any skill from any other source as a skills.sh
   * install.
   */
  private registerListInstalled(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      { skills: InstalledSkill[] }
    >('skillsSh:listInstalled', async () => {
      try {
        const skills = await this.sourceRoots.listInstalled();
        this.logger.debug('RPC: skillsSh:listInstalled success', {
          totalCount: skills.length,
        });
        return { skills };
      } catch (error: unknown) {
        this.logger.error(
          'RPC: skillsSh:listInstalled failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        return { skills: [] };
      }
    });
  }

  /**
   * Land the skill in its source root, then propagate.
   *
   * `propagate` is the ONE entry point every trigger uses, and it is called
   * rather than `reconcile` for the reason harness-sync's CLAUDE.md gives: the
   * desired state is the source layer, so a trigger that just changed a source
   * and then bare-reconciled would publish the PREVIOUS state and report a
   * clean pass.
   *
   * Propagation failure does not fail the install. The bytes are on disk and
   * every host reconciles again at its next activation, so reporting failure
   * here would tell the user nothing was installed when something was.
   */
  private registerInstall(): void {
    this.rpcHandler.registerMethod<
      { source: string; skillId?: string },
      { success: boolean; error?: string }
    >('skillsSh:install', async (params) => {
      try {
        this.logger.debug('RPC: skillsSh:install called', {
          source: params.source,
          skillId: params.skillId,
        });

        // TWO checks, and neither is the other's duplicate. The schema settles
        // SHAPE and the historical allowlists on values that arrive off the
        // wire as `unknown`; `rejectUnsafeInstallRequest` settles the PATH
        // rule, because `SAFE_SOURCE_PATTERN` accepts the literal `../..` and
        // `SAFE_SKILL_ID_PATTERN` accepts `..` — harmless while these were only
        // CLI arguments, not harmless now that they are also directory names.
        //
        // Calling the shared rule rather than restating it is the point: the
        // service re-checks via `skillsShRootId` and `stageSkillsInstall`
        // re-checks right before the spawn, and all three must agree because
        // each guards a call site another caller can reach directly.
        const parsed = SkillsShInstallParamsSchema.safeParse(params);
        if (!parsed.success) {
          return {
            success: false,
            error: `Invalid install request for source "${String(params.source)}".`,
          };
        }

        const rejection = rejectUnsafeInstallRequest(parsed.data);
        if (rejection !== null) {
          return { success: false, error: rejection };
        }

        await this.adoptLegacyInstalls();

        const result = await this.sourceRoots.install({
          source: parsed.data.source,
          skillId: parsed.data.skillId,
        });

        if (!result.success) {
          return { success: false, error: result.error };
        }

        this.invalidateCaches();
        await this.propagate('skillsSh:install');

        this.logger.info('RPC: skillsSh:install success', {
          source: params.source,
          rootId: result.rootId,
          slugs: result.slugs,
        });
        return { success: true };
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          'RPC: skillsSh:install failed',
          error instanceof Error ? error : new Error(errorMessage),
        );
        return { success: false, error: errorMessage };
      }
    });
  }

  /**
   * Remove the skill from its source root, then propagate so the reap sweep
   * clears every target.
   *
   * Deleting the source is what makes the copies stale; only the reconciler can
   * remove them, and only because they are manifest-owned. The old
   * implementation shelled `npx skills remove`, which deleted from
   * `.claude/skills` and left the other five targets untouched.
   */
  private registerUninstall(): void {
    this.rpcHandler.registerMethod<
      { name: string },
      { success: boolean; error?: string }
    >('skillsSh:uninstall', async (params) => {
      try {
        this.logger.debug('RPC: skillsSh:uninstall called', {
          name: params.name,
        });

        // `SAFE_SKILL_NAME_PATTERN` alone accepts the literal `..`, which was
        // harmless while this value only became a CLI argument and is not
        // harmless now that it is joined into a path. `isSafePathToken` is the
        // shared rule that adds that rejection; the schema keeps the original
        // allowlist unchanged underneath it.
        const parsed = SkillsShUninstallParamsSchema.safeParse(params);
        if (!parsed.success || !isSafePathToken(parsed.data.name)) {
          return {
            success: false,
            error: `Invalid skill name format: "${String(params.name)}".`,
          };
        }

        const result = await this.sourceRoots.uninstall(parsed.data.name);
        if (!result.success) {
          return { success: false, error: result.error };
        }

        this.invalidateCaches();
        await this.propagate('skillsSh:uninstall');

        this.logger.info('RPC: skillsSh:uninstall success', {
          name: params.name,
          rootId: result.rootId,
          removedRoot: result.removedRoot,
        });
        return { success: true };
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          'RPC: skillsSh:uninstall failed',
          error instanceof Error ? error : new Error(errorMessage),
        );
        return { success: false, error: errorMessage };
      }
    });
  }

  /** Drop the two caches whose contents encode install state. */
  private invalidateCaches(): void {
    this.popularCache = null;
    this.apiClient.invalidateInstallCaches();
  }

  /**
   * Non-fatal by construction — see `registerInstall`. Mirrors the private
   * helper `PluginRpcHandlers` uses for the same purpose.
   */
  private async propagate(reason: string): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (workspaceRoot === '') return;
    try {
      await this.harnessPropagation.propagate(workspaceRoot, reason);
    } catch (error: unknown) {
      this.logger.warn('Harness propagation failed (non-fatal)', {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Sweep `{ws}/.claude/skills` for skills a previous Ptah installed the old
   * way, once per triggering action.
   *
   * Placed on the install path rather than on activation deliberately: it only
   * runs when the user is already acting on skills.sh, it is idempotent, and it
   * never blocks the action it precedes.
   */
  private async adoptLegacyInstalls(): Promise<void> {
    try {
      const adopted = await this.sourceRoots.adoptLegacyInstalls(
        this.getWorkspaceRoot() || undefined,
      );
      if (adopted > 0) {
        this.logger.info('RPC: skillsSh adopted legacy installs', { adopted });
      }
    } catch (error: unknown) {
      this.logger.warn('RPC: skillsSh legacy adoption failed (non-fatal)', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private registerGetPopular(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      { skills: SkillShEntry[] }
    >('skillsSh:getPopular', async () => {
      try {
        this.logger.debug('RPC: skillsSh:getPopular called');

        if (
          this.popularCache &&
          Date.now() - this.popularCache.timestamp <
            SkillsShRpcHandlers.POPULAR_CACHE_TTL_MS
        ) {
          return { skills: this.popularCache.data };
        }

        let skills: SkillShEntry[] = [];
        try {
          const workspaceRoot = this.getWorkspaceRoot() || os.homedir();
          const result = await runSkillsCli(
            ['find', '""'],
            workspaceRoot,
            15000,
          );

          if (result.exitCode === 0 && result.stdout.trim().length > 0) {
            skills = this.parseSkillsOutput(result.stdout);
          }
        } catch {
          this.logger.debug(
            'RPC: skillsSh:getPopular CLI unavailable, using curated fallback',
          );
        }

        if (skills.length === 0) {
          skills = await this.enrichWithInstallStatus(
            CURATED_POPULAR_SKILLS.map((s) => ({ ...s })),
          );
        }

        this.popularCache = { data: skills, timestamp: Date.now() };
        return { skills };
      } catch (error) {
        this.logger.error(
          'RPC: skillsSh:getPopular failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        return { skills: CURATED_POPULAR_SKILLS };
      }
    });
  }

  private registerDetectRecommended(): void {
    this.rpcHandler.registerMethod<Record<string, never>, SkillDetectionResult>(
      'skillsSh:detectRecommended',
      async () => {
        try {
          this.logger.debug('RPC: skillsSh:detectRecommended called');

          const workspaceRoot = this.getWorkspaceRoot();
          if (!workspaceRoot) {
            return {
              detectedTechnologies: {
                frameworks: [],
                languages: [],
                tools: [],
              },
              recommendedSkills: [],
            };
          }

          const detected = await this.detectTechnologies(workspaceRoot);

          const recommendedSkills = this.matchSkillsToTechnologies(detected);
          const enriched =
            await this.enrichWithInstallStatus(recommendedSkills);

          this.logger.debug('RPC: skillsSh:detectRecommended success', {
            frameworks: detected.frameworks,
            recommendedCount: enriched.length,
          });

          return {
            detectedTechnologies: detected,
            recommendedSkills: enriched,
          };
        } catch (error) {
          this.logger.error(
            'RPC: skillsSh:detectRecommended failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          return {
            detectedTechnologies: {
              frameworks: [],
              languages: [],
              tools: [],
            },
            recommendedSkills: [],
          };
        }
      },
    );
  }

  /**
   * Parse the text output from `npx skills find` into SkillShEntry objects.
   *
   * Actual CLI output format (with ANSI codes):
   *   owner/repo@skill-id  N installs
   *   └ https://skills.sh/owner/repo/skill-id
   *
   * The CLI ignores FORCE_COLOR/NO_COLOR env vars and always outputs ANSI escape codes.
   */
  private parseSkillsOutput(output: string): SkillShEntry[] {
    const skills: SkillShEntry[] = [];

    const stripped = output.replace(
      new RegExp(String.fromCharCode(0x1b) + '\\[[0-9;]*m', 'g'),
      '',
    );
    const lines = stripped.split('\n').filter((line) => line.trim().length > 0);

    if (lines.length === 0) return skills;
    const skillLineRegex =
      /^([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)@([a-zA-Z0-9_.:/-]+)\s+([0-9,.]+[kKmM]?)\s+installs?$/;

    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(skillLineRegex);
      if (match) {
        const source = match[1];
        const skillId = match[2];
        const installs = this.parseInstallCount(match[3]);

        skills.push({
          source,
          skillId,
          name: this.formatSkillName(skillId),
          description: '',
          installs,
          isInstalled: false,
        });
      }
    }

    return skills;
  }

  private parseInstallCount(str: string): number {
    const cleaned = str.replace(/,/g, '').trim().toLowerCase();
    if (cleaned.endsWith('m')) {
      return Math.round(parseFloat(cleaned) * 1_000_000);
    }
    if (cleaned.endsWith('k')) {
      return Math.round(parseFloat(cleaned) * 1_000);
    }
    const parsed = parseInt(cleaned, 10);
    return isNaN(parsed) ? 0 : parsed;
  }

  private formatSkillName(slug: string): string {
    return slug
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private async detectTechnologies(workspaceRoot: string): Promise<{
    frameworks: string[];
    languages: string[];
    tools: string[];
  }> {
    const frameworks: string[] = [];
    const languages: string[] = [];
    const tools: string[] = [];

    try {
      const pkgJsonPath = path.join(workspaceRoot, 'package.json');
      const pkgContent = await fs.readFile(pkgJsonPath, 'utf8');
      const pkg = JSON.parse(pkgContent) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const allDeps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      };
      languages.push('javascript');
      const checks: [string, string][] = [
        ['react', 'react'],
        ['@angular/core', 'angular'],
        ['vue', 'vue'],
        ['next', 'next'],
        ['express', 'express'],
        ['@nestjs/core', 'nestjs'],
        ['tailwindcss', 'tailwindcss'],
        ['remotion', 'remotion'],
      ];
      for (const [dep, name] of checks) {
        if (dep in allDeps && !frameworks.includes(name)) {
          frameworks.push(name);
        }
      }
    } catch {
      // No package.json or unreadable — skip JS framework detection silently.
    }

    if (await this.probeFileExists(path.join(workspaceRoot, 'tsconfig.json'))) {
      if (!languages.includes('typescript')) languages.push('typescript');
    }
    if (await this.probeFileExists(path.join(workspaceRoot, 'Cargo.toml'))) {
      languages.push('rust');
    }
    if (await this.probeFileExists(path.join(workspaceRoot, 'go.mod'))) {
      languages.push('go');
    }

    const dockerFiles = [
      'Dockerfile',
      'docker-compose.yml',
      'docker-compose.yaml',
    ];
    for (const f of dockerFiles) {
      if (await this.probeFileExists(path.join(workspaceRoot, f))) {
        if (!tools.includes('docker')) tools.push('docker');
        break;
      }
    }

    if (await this.probeFileExists(path.join(workspaceRoot, 'nx.json'))) {
      tools.push('nx');
    }

    return { frameworks, languages, tools };
  }

  private async probeFileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private matchSkillsToTechnologies(detected: {
    frameworks: string[];
    languages: string[];
    tools: string[];
  }): SkillShEntry[] {
    const allTechs = [
      ...detected.frameworks,
      ...detected.languages,
      ...detected.tools,
    ];
    const matchedSkillIds = new Set<string>();

    for (const tech of allTechs) {
      const keywords = TECH_SKILL_KEYWORDS[tech.toLowerCase()];
      if (keywords) {
        for (const keyword of keywords) {
          matchedSkillIds.add(keyword);
        }
      }
    }

    return CURATED_POPULAR_SKILLS.filter((skill) =>
      matchedSkillIds.has(skill.skillId),
    ).map((skill) => ({ ...skill }));
  }

  private async enrichWithInstallStatus(
    skills: SkillShEntry[],
  ): Promise<SkillShEntry[]> {
    const installed = await this.getInstalledSkillNames();
    for (const skill of skills) {
      skill.isInstalled =
        installed.has(skill.skillId) || installed.has(skill.name.toLowerCase());
    }
    return skills;
  }

  /**
   * Slugs that are INSTALLED, for the marketplace's per-row Installed badge.
   *
   * Reads the source roots for the same reason `listInstalled` does: a scan of
   * `.claude/skills` counted every skill from every source as a skills.sh
   * install, so a user with a hand-written `.claude/skills/frontend-design`
   * saw the skills.sh entry of that name badged as already installed.
   */
  private async getInstalledSkillNames(): Promise<Set<string>> {
    try {
      return await this.sourceRoots.installedSlugs();
    } catch (error: unknown) {
      this.logger.warn('RPC: skillsSh could not read installed slugs', {
        error: error instanceof Error ? error.message : String(error),
      });
      return new Set<string>();
    }
  }

  private getWorkspaceRoot(): string {
    return this.workspace.getWorkspaceRoot() ?? '';
  }
}
