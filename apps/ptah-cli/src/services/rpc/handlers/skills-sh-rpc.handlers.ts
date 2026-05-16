/**
 * CLI Skills.sh RPC Handlers
 *
 * Re-registration in the CLI app of the Electron-specific
 * SkillsShRpcHandlers. Logic is mirrored verbatim from
 * `apps/ptah-electron/src/services/rpc/handlers/skills-sh-rpc.handlers.ts`
 * because both apps already inject `IWorkspaceProvider` (PLATFORM_TOKENS.WORKSPACE_PROVIDER)
 * and have no other platform coupling — keeping the file local to the CLI app
 * (rather than lifting to shared rpc-handlers) preserves the Electron parity
 * boundary documented in `phase-4-handlers.ts`.
 *
 * Handles:
 * - `skillsSh:search`             — search registry via `npx skills find`
 * - `skillsSh:listInstalled`      — list project + global installed skills
 * - `skillsSh:install`            — install a skill (per project / global scope)
 * - `skillsSh:uninstall`          — remove a skill
 * - `skillsSh:getPopular`         — curated popular skills (CLI-fallback cache)
 * - `skillsSh:detectRecommended`  — workspace-aware recommendations
 *
 * The `static METHODS` tuple matches the Electron handler's registration order
 * and is asserted in the spec parity test.
 */

import { injectable, inject } from 'tsyringe';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type {
  SkillShEntry,
  InstalledSkill,
  SkillDetectionResult,
} from '@ptah-extension/shared';

// ─── Curated Popular Skills (fallback when CLI is unavailable) ───

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

// ─── Technology-to-skill keyword mapping ───

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

const SAFE_SOURCE_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

@injectable()
export class SkillsShRpcHandlers {
  /**
   * Method names registered against the global `RpcHandler`. Order matches
   * `register()`. Asserted in the parity spec to keep CLI and Electron in
   * lockstep.
   */
  static readonly METHODS = [
    'skillsSh:search',
    'skillsSh:listInstalled',
    'skillsSh:install',
    'skillsSh:uninstall',
    'skillsSh:getPopular',
    'skillsSh:detectRecommended',
  ] as const;

  private popularCache: { data: SkillShEntry[]; timestamp: number } | null =
    null;

  private static readonly POPULAR_CACHE_TTL_MS = 10 * 60 * 1000;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
  ) {}

  register(): void {
    this.registerSearch();
    this.registerListInstalled();
    this.registerInstall();
    this.registerUninstall();
    this.registerGetPopular();
    this.registerDetectRecommended();

    this.logger.debug('CLI Skills.sh RPC handlers registered', {
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

        const sanitizedQuery = params.query.replace(/[^a-zA-Z0-9\s\-._/]/g, '');
        if (!sanitizedQuery.trim()) {
          return { skills: [], error: 'Invalid search query' };
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

        // Try CLI for project scope
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

        // Try CLI for global scope
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

        if (params.skillId && !/^[a-zA-Z0-9_.-]+$/.test(params.skillId)) {
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
        // Only install for Claude Code — installing for all agents ('*')
        // pollutes the workspace with 28+ tool-specific directories.
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

        if (!/^[a-zA-Z0-9_.-]+$/.test(params.name)) {
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

  // ─── Helpers ───

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
        try {
          child.kill('SIGTERM');
        } catch {
          // Process may already be dead
        }
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
   * Mirrors the Electron implementation byte-for-byte.
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
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
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
    } catch {
      // Directory doesn't exist
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
      // No package.json
    }

    try {
      await fs.access(path.join(workspaceRoot, 'tsconfig.json'));
      if (!languages.includes('typescript')) languages.push('typescript');
    } catch {
      // No tsconfig.json
    }

    try {
      await fs.access(path.join(workspaceRoot, 'Cargo.toml'));
      languages.push('rust');
    } catch {
      // No Cargo.toml
    }

    try {
      await fs.access(path.join(workspaceRoot, 'go.mod'));
      languages.push('go');
    } catch {
      // No go.mod
    }

    try {
      const dockerFiles = [
        'Dockerfile',
        'docker-compose.yml',
        'docker-compose.yaml',
      ];
      for (const f of dockerFiles) {
        try {
          await fs.access(path.join(workspaceRoot, f));
          if (!tools.includes('docker')) tools.push('docker');
          break;
        } catch {
          // File doesn't exist
        }
      }
    } catch {
      // No Docker files
    }

    try {
      await fs.access(path.join(workspaceRoot, 'nx.json'));
      tools.push('nx');
    } catch {
      // No nx.json
    }

    return { frameworks, languages, tools };
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
    try {
      const installed = await this.getInstalledSkillNames();
      for (const skill of skills) {
        skill.isInstalled =
          installed.has(skill.skillId) ||
          installed.has(skill.name.toLowerCase());
      }
    } catch {
      // Non-critical
    }
    return skills;
  }

  private async getInstalledSkillNames(): Promise<Set<string>> {
    const names = new Set<string>();
    const scanDir = async (dirPath: string) => {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) names.add(entry.name.toLowerCase());
        }
      } catch {
        // Directory doesn't exist
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
