/**
 * Skills.sh RPC Handlers
 *
 * Platform-agnostic implementations for Skills.sh marketplace methods:
 * - skillsSh:search - Search skills via CLI
 * - skillsSh:listInstalled - List installed skills from filesystem
 * - skillsSh:install - Install a skill
 * - skillsSh:uninstall - Remove a skill
 * - skillsSh:getPopular - Get popular skills (cached)
 * - skillsSh:detectRecommended - Detect workspace technologies and recommend skills
 *
 * Lifted from
 * `apps/ptah-electron/src/services/rpc/handlers/skills-sh-rpc.handlers.ts` so
 * all three apps (VS Code, Electron, CLI) consume a single copy via
 * `registerAllRpcHandlers()`. The Electron copy was already platform-agnostic
 * (`IWorkspaceProvider` via `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, no `vscode`
 * import), so this is a verbatim consolidation — no behavior change.
 */

import { injectable, inject } from 'tsyringe';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  ISecretStorage,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type {
  SkillShEntry,
  InstalledSkill,
  SkillDetectionResult,
  RpcMethodName,
} from '@ptah-extension/shared';
import {
  SAFE_SOURCE_PATTERN,
  SAFE_SKILL_ID_PATTERN,
  SAFE_SKILL_NAME_PATTERN,
  SECRET_KEY,
  sanitizeSearchQuery,
} from './skills-sh-rpc.schema';
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
    'skillsSh:setApiKey',
    'skillsSh:getApiKeyStatus',
    'skillsSh:deleteApiKey',
  ] as const satisfies readonly RpcMethodName[];

  private popularCache: { data: SkillShEntry[]; timestamp: number } | null =
    null;

  private static readonly POPULAR_CACHE_TTL_MS = 10 * 60 * 1000;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(PLATFORM_TOKENS.SECRET_STORAGE)
    private readonly secretStorage: ISecretStorage,
    @inject(SkillsShApiClient)
    private readonly apiClient: SkillsShApiClient,
  ) {}

  register(): void {
    this.registerSearch();
    this.registerListInstalled();
    this.registerInstall();
    this.registerUninstall();
    this.registerGetPopular();
    this.registerDetectRecommended();
    this.registerSetApiKey();
    this.registerGetApiKeyStatus();
    this.registerDeleteApiKey();

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

        if (await this.apiClient.hasKey()) {
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
        }

        const workspaceRoot = this.getWorkspaceRoot();
        const result = await this.runSkillsCli(
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

  private registerListInstalled(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      { skills: InstalledSkill[] }
    >('skillsSh:listInstalled', async () => {
      try {
        this.logger.debug('RPC: skillsSh:listInstalled called');

        const workspaceRoot = this.getWorkspaceRoot();
        const skills: InstalledSkill[] = [];
        try {
          const projectResult = await this.runSkillsCli(
            ['list', '--json'],
            workspaceRoot,
            10000,
          );
          if (projectResult.exitCode === 0 && projectResult.stdout.trim()) {
            const parsed = JSON.parse(projectResult.stdout) as Array<{
              name: string;
              path: string;
              scope: string;
              agents?: string[];
            }>;
            for (const entry of parsed) {
              skills.push({
                name: entry.name,
                description: '',
                source: entry.name,
                path: entry.path,
                scope: (entry.scope as 'project' | 'global') || 'project',
                agents: entry.agents || [],
              });
            }
          }
        } catch {
          if (workspaceRoot) {
            const projectSkills = await this.scanSkillsDirectory(
              path.join(workspaceRoot, '.claude', 'skills'),
              'project',
            );
            skills.push(...projectSkills);
          }
        }
        try {
          const globalResult = await this.runSkillsCli(
            ['list', '--json', '-g'],
            workspaceRoot,
            10000,
          );
          if (globalResult.exitCode === 0 && globalResult.stdout.trim()) {
            const parsed = JSON.parse(globalResult.stdout) as Array<{
              name: string;
              path: string;
              scope: string;
              agents?: string[];
            }>;
            for (const entry of parsed) {
              skills.push({
                name: entry.name,
                description: '',
                source: entry.name,
                path: entry.path,
                scope: 'global',
                agents: entry.agents || [],
              });
            }
          }
        } catch {
          const globalSkills = await this.scanSkillsDirectory(
            path.join(os.homedir(), '.claude', 'skills'),
            'global',
          );
          skills.push(...globalSkills);
        }

        this.logger.debug('RPC: skillsSh:listInstalled success', {
          totalCount: skills.length,
        });

        return { skills };
      } catch (error) {
        this.logger.error(
          'RPC: skillsSh:listInstalled failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        return { skills: [] };
      }
    });
  }

  private registerInstall(): void {
    this.rpcHandler.registerMethod<
      {
        source: string;
        skillId?: string;
        scope: 'project' | 'global';
        agents?: string[];
      },
      { success: boolean; error?: string }
    >('skillsSh:install', async (params) => {
      try {
        this.logger.debug('RPC: skillsSh:install called', {
          source: params.source,
          skillId: params.skillId,
          scope: params.scope,
        });

        if (!SAFE_SOURCE_PATTERN.test(params.source)) {
          return {
            success: false,
            error: `Invalid source format: "${params.source}". Expected "owner/repo".`,
          };
        }

        if (params.skillId && !SAFE_SKILL_ID_PATTERN.test(params.skillId)) {
          return {
            success: false,
            error: `Invalid skillId format: "${params.skillId}".`,
          };
        }

        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot && params.scope === 'project') {
          return {
            success: false,
            error: 'No workspace folder open for project-scope installation.',
          };
        }

        const args = ['add', params.source];
        if (params.skillId) {
          args.push('--skill', params.skillId);
        }
        args.push('--agent', 'claude-code');
        args.push('-y');
        if (params.scope === 'global') {
          args.push('-g');
        }

        const result = await this.runSkillsCli(
          args,
          workspaceRoot || os.homedir(),
          30000,
        );

        if (result.exitCode !== 0) {
          const errorDetail =
            result.stderr.trim() ||
            result.stdout.trim().split('\n').pop() ||
            `CLI exited with code ${result.exitCode}`;
          return { success: false, error: errorDetail };
        }

        this.popularCache = null;
        this.apiClient.invalidateInstallCaches();
        this.logger.info('RPC: skillsSh:install success', {
          source: params.source,
          scope: params.scope,
        });

        return { success: true };
      } catch (error) {
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

  private registerUninstall(): void {
    this.rpcHandler.registerMethod<
      { name: string; scope: 'project' | 'global' },
      { success: boolean; error?: string }
    >('skillsSh:uninstall', async (params) => {
      try {
        this.logger.debug('RPC: skillsSh:uninstall called', {
          name: params.name,
          scope: params.scope,
        });

        if (!SAFE_SKILL_NAME_PATTERN.test(params.name)) {
          return {
            success: false,
            error: `Invalid skill name format: "${params.name}".`,
          };
        }

        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot && params.scope === 'project') {
          return {
            success: false,
            error: 'No workspace folder open for project-scope uninstall.',
          };
        }

        const args = ['remove', params.name, '--agent', 'claude-code', '-y'];
        if (params.scope === 'global') {
          args.push('-g');
        }

        const result = await this.runSkillsCli(
          args,
          workspaceRoot || os.homedir(),
          15000,
        );

        if (result.exitCode !== 0) {
          const errorDetail =
            result.stderr.trim() ||
            result.stdout.trim().split('\n').pop() ||
            `CLI exited with code ${result.exitCode}`;
          return { success: false, error: errorDetail };
        }

        this.popularCache = null;
        this.apiClient.invalidateInstallCaches();
        this.logger.info('RPC: skillsSh:uninstall success', {
          name: params.name,
          scope: params.scope,
        });

        return { success: true };
      } catch (error) {
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

        if (await this.apiClient.hasKey()) {
          try {
            skills = await this.apiClient.getPopular('hot');
          } catch (error: unknown) {
            const message =
              error instanceof Error ? error.message : String(error);
            this.logger.warn(
              'RPC: skillsSh:getPopular API failed, falling back to CLI',
              { error: message },
            );
          }
        }

        if (skills.length === 0) {
          try {
            const workspaceRoot = this.getWorkspaceRoot() || os.homedir();
            const result = await this.runSkillsCli(
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

          let curatedPool: SkillShEntry[] | null = null;
          if (await this.apiClient.hasKey()) {
            try {
              curatedPool = await this.apiClient.getCurated();
            } catch (error: unknown) {
              const message =
                error instanceof Error ? error.message : String(error);
              this.logger.warn(
                'RPC: skillsSh:detectRecommended API curated failed, falling back to constant',
                { error: message },
              );
            }
          }

          const recommendedSkills = this.matchSkillsToTechnologies(
            detected,
            curatedPool,
          );
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

  private registerGetApiKeyStatus(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      { configured: boolean }
    >('skillsSh:getApiKeyStatus', async () => {
      try {
        const key = await this.secretStorage.get(SECRET_KEY);
        return {
          configured: typeof key === 'string' && key.trim().length > 0,
        };
      } catch (error: unknown) {
        this.logger.error(
          'RPC: skillsSh:getApiKeyStatus failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  }

  private registerSetApiKey(): void {
    this.rpcHandler.registerMethod<{ apiKey: string }, { success: boolean }>(
      'skillsSh:setApiKey',
      async (params) => {
        try {
          if (!params.apiKey || params.apiKey.trim().length === 0) {
            throw new Error('API key cannot be empty');
          }
          await this.secretStorage.store(SECRET_KEY, params.apiKey.trim());
          this.apiClient.invalidateInstallCaches();
          this.logger.info('Skills.sh API key stored');
          return { success: true };
        } catch (error: unknown) {
          this.logger.error(
            'RPC: skillsSh:setApiKey failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          throw error;
        }
      },
    );
  }

  private registerDeleteApiKey(): void {
    this.rpcHandler.registerMethod<Record<string, never>, { success: boolean }>(
      'skillsSh:deleteApiKey',
      async () => {
        try {
          await this.secretStorage.delete(SECRET_KEY);
          this.apiClient.invalidateInstallCaches();
          this.logger.info('Skills.sh API key deleted');
          return { success: true };
        } catch (error: unknown) {
          this.logger.error(
            'RPC: skillsSh:deleteApiKey failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          throw error;
        }
      },
    );
  }

  private runSkillsCli(
    args: string[],
    cwd: string,
    timeout = 15000,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (result: {
        stdout: string;
        stderr: string;
        exitCode: number;
      }) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(result);
        }
      };

      const child = spawn('npx', ['skills', ...args], {
        shell: true,
        cwd: cwd || undefined,
        env: {
          ...process.env,
          FORCE_COLOR: '0',
          NO_COLOR: '1',
        },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');

      child.stdout.on('data', (data: string) => {
        stdout += data;
      });

      child.stderr.on('data', (data: string) => {
        stderr += data;
      });

      child.on('close', (code: number | null) => {
        settle({ stdout, stderr, exitCode: code ?? 1 });
      });

      child.on('error', (error: Error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      });

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        settle({
          stdout,
          stderr: `CLI timed out after ${timeout}ms`,
          exitCode: 124,
        });
      }, timeout);
    });
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

  private async scanSkillsDirectory(
    dirPath: string,
    scope: 'project' | 'global',
  ): Promise<InstalledSkill[]> {
    const skills: InstalledSkill[] = [];

    let entries: Dirent[];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return skills; // Dir missing — treat as empty.
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = path.join(dirPath, entry.name, 'SKILL.md');
      try {
        const content = await fs.readFile(skillMdPath, 'utf8');
        const metadata = this.parseSkillFrontmatter(content);
        skills.push({
          name: metadata.name || entry.name,
          description: metadata.description || '',
          source: metadata.source || entry.name,
          path: path.join(dirPath, entry.name),
          scope,
          agents: [],
        });
      } catch {
        skills.push({
          name: entry.name,
          description: '',
          source: entry.name,
          path: path.join(dirPath, entry.name),
          scope,
          agents: [],
        });
      }
    }
    return skills;
  }

  private parseSkillFrontmatter(content: string): {
    name: string;
    description: string;
    source: string;
  } {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      return { name: '', description: '', source: '' };
    }
    const frontmatter = frontmatterMatch[1];
    const nameMatch = frontmatter.match(/^name:\s*["']?(.+?)["']?\s*$/m);
    const descMatch = frontmatter.match(/^description:\s*["']?(.+?)["']?\s*$/m);
    const sourceMatch = frontmatter.match(/^source:\s*["']?(.+?)["']?\s*$/m);
    return {
      name: nameMatch?.[1]?.trim() ?? '',
      description: descMatch?.[1]?.trim() ?? '',
      source: sourceMatch?.[1]?.trim() ?? '',
    };
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

  private matchSkillsToTechnologies(
    detected: {
      frameworks: string[];
      languages: string[];
      tools: string[];
    },
    pool: SkillShEntry[] | null = null,
  ): SkillShEntry[] {
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

    const source = pool ?? CURATED_POPULAR_SKILLS;
    return source
      .filter((skill) => matchedSkillIds.has(skill.skillId))
      .map((skill) => ({ ...skill }));
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

  private async getInstalledSkillNames(): Promise<Set<string>> {
    const names = new Set<string>();
    const scanDir = async (dirPath: string) => {
      let entries: Dirent[];
      try {
        entries = await fs.readdir(dirPath, { withFileTypes: true });
      } catch {
        return; // Dir missing on first-run users — treat as empty set.
      }
      for (const entry of entries) {
        if (entry.isDirectory()) names.add(entry.name.toLowerCase());
      }
    };

    const workspaceRoot = this.getWorkspaceRoot();
    if (workspaceRoot) {
      await scanDir(path.join(workspaceRoot, '.claude', 'skills'));
    }
    await scanDir(path.join(os.homedir(), '.claude', 'skills'));
    return names;
  }

  private getWorkspaceRoot(): string {
    return this.workspace.getWorkspaceRoot() ?? '';
  }
}
