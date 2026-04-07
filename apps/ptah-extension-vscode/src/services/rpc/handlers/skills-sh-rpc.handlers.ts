/**
 * Skills.sh RPC Handlers
 *
 * Handles Skills.sh marketplace RPC methods:
 * - skillsSh:search - Search skills via CLI
 * - skillsSh:listInstalled - List installed skills from filesystem
 * - skillsSh:install - Install a skill
 * - skillsSh:uninstall - Remove a skill
 * - skillsSh:getPopular - Get popular skills (cached)
 * - skillsSh:detectRecommended - Detect workspace technologies and recommend skills
 *
 * TASK_2025_204: Skills.sh Marketplace Integration
 */

import { injectable, inject } from 'tsyringe';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import type {
  SkillShEntry,
  InstalledSkill,
  SkillDetectionResult,
} from '@ptah-extension/shared';

// ─── Curated Popular Skills (fallback when CLI is unavailable) ───

const CURATED_POPULAR_SKILLS: SkillShEntry[] = [
  // Verified: vercel-labs/agent-skills contains: vercel-react-best-practices, web-design-guidelines, vercel-composition-patterns, deploy-to-vercel, vercel-react-native-skills
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
    source: 'vercel-labs/agent-skills',
    skillId: 'vercel-composition-patterns',
    name: 'Composition Patterns',
    description:
      'React composition patterns that scale — compound components, render props, context providers',
    installs: 120000,
    isInstalled: false,
  },
  {
    source: 'vercel-labs/agent-skills',
    skillId: 'deploy-to-vercel',
    name: 'Deploy to Vercel',
    description:
      'Deploy applications and websites to Vercel with preview deployments',
    installs: 95000,
    isInstalled: false,
  },
  // Verified: anthropics/skills contains: frontend-design, claude-api, mcp-builder, pdf, skill-creator, webapp-testing, doc-coauthoring, etc.
  {
    source: 'anthropics/skills',
    skillId: 'frontend-design',
    name: 'Frontend Design',
    description: 'Build polished frontend interfaces with best practices',
    installs: 168700,
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
  {
    source: 'anthropics/skills',
    skillId: 'pdf',
    name: 'PDF',
    description: 'Generate and manipulate PDF documents programmatically',
    installs: 65000,
    isInstalled: false,
  },
  {
    source: 'anthropics/skills',
    skillId: 'doc-coauthoring',
    name: 'Doc Co-authoring',
    description: 'Collaborative technical document writing and editing',
    installs: 55000,
    isInstalled: false,
  },
  {
    source: 'anthropics/skills',
    skillId: 'canvas-design',
    name: 'Canvas Design',
    description: 'Create visual designs and graphics using HTML Canvas',
    installs: 48000,
    isInstalled: false,
  },
  {
    source: 'anthropics/skills',
    skillId: 'pptx',
    name: 'PowerPoint',
    description: 'Generate and edit PowerPoint presentations',
    installs: 42000,
    isInstalled: false,
  },
  {
    source: 'anthropics/skills',
    skillId: 'xlsx',
    name: 'Excel',
    description: 'Create and manipulate Excel spreadsheets',
    installs: 38000,
    isInstalled: false,
  },
  // Other popular repos
  {
    source: 'remotion-dev/skills',
    skillId: 'remotion-best-practices',
    name: 'Remotion Best Practices',
    description: 'Create programmatic videos with the Remotion framework',
    installs: 153100,
    isInstalled: false,
  },
  {
    source: 'vercel-labs/agent-skills',
    skillId: 'vercel-react-native-skills',
    name: 'React Native',
    description:
      'React Native and Expo best practices for building mobile apps',
    installs: 35000,
    isInstalled: false,
  },
  {
    source: 'anthropics/skills',
    skillId: 'theme-factory',
    name: 'Theme Factory',
    description: 'Create and customize UI themes and design tokens',
    installs: 30000,
    isInstalled: false,
  },
  {
    source: 'anthropics/skills',
    skillId: 'web-artifacts-builder',
    name: 'Web Artifacts Builder',
    description: 'Build interactive web artifacts and prototypes',
    installs: 25000,
    isInstalled: false,
  },
  {
    source: 'anthropics/skills',
    skillId: 'internal-comms',
    name: 'Internal Comms',
    description: 'Draft internal communications and announcements',
    installs: 22000,
    isInstalled: false,
  },
  {
    source: 'anthropics/skills',
    skillId: 'slack-gif-creator',
    name: 'Slack GIF Creator',
    description: 'Create animated GIFs for Slack communication',
    installs: 18000,
    isInstalled: false,
  },
];

// ─── Technology-to-skill keyword mapping ───

const TECH_SKILL_KEYWORDS: Record<string, string[]> = {
  react: [
    'vercel-react-best-practices',
    'vercel-composition-patterns',
    'frontend-design',
    'web-design-guidelines',
    'webapp-testing',
  ],
  next: [
    'vercel-react-best-practices',
    'web-design-guidelines',
    'deploy-to-vercel',
  ],
  angular: ['frontend-design', 'web-design-guidelines', 'webapp-testing'],
  vue: ['frontend-design', 'web-design-guidelines', 'webapp-testing'],
  express: ['webapp-testing', 'claude-api'],
  nestjs: ['webapp-testing', 'claude-api'],
  prisma: ['webapp-testing'],
  tailwindcss: ['web-design-guidelines', 'frontend-design'],
  typescript: ['webapp-testing', 'frontend-design'],
  'react-native': ['vercel-react-native-skills'],
  remotion: ['remotion-best-practices'],
};

// ─── Source validation regex (security) ───

const SAFE_SOURCE_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

/**
 * RPC handlers for Skills.sh marketplace operations.
 *
 * TASK_2025_204: Skills.sh Marketplace Integration
 *
 * Provides skill discovery, installation, and workspace-aware recommendations
 * via the `npx skills` CLI and local filesystem scanning.
 */
@injectable()
export class SkillsShRpcHandlers {
  private popularCache: { data: SkillShEntry[]; timestamp: number } | null =
    null;

  private static readonly POPULAR_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
  ) {}

  /**
   * Register all Skills.sh RPC methods
   */
  register(): void {
    this.registerSearch();
    this.registerListInstalled();
    this.registerInstall();
    this.registerUninstall();
    this.registerGetPopular();
    this.registerDetectRecommended();

    this.logger.debug('Skills.sh RPC handlers registered', {
      methods: [
        'skillsSh:search',
        'skillsSh:listInstalled',
        'skillsSh:install',
        'skillsSh:uninstall',
        'skillsSh:getPopular',
        'skillsSh:detectRecommended',
      ],
    });
  }

  // ─── RPC Method: skillsSh:search ───

  /**
   * Search skills via the `npx skills find` CLI.
   *
   * Spawns a CLI process to search the Skills.sh registry and parses
   * the text output into structured SkillShEntry objects.
   */
  private registerSearch(): void {
    this.rpcHandler.registerMethod<
      { query: string },
      { skills: SkillShEntry[]; error?: string }
    >('skillsSh:search', async (params) => {
      try {
        this.logger.debug('RPC: skillsSh:search called', {
          query: params.query,
        });

        // Sanitize query: allow only alphanumeric, spaces, hyphens, dots, slashes
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

  // ─── RPC Method: skillsSh:listInstalled ───

  /**
   * List installed skills using `npx skills list --json` for both project and global scopes.
   * Falls back to filesystem scanning if the CLI is unavailable.
   */
  private registerListInstalled(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      { skills: InstalledSkill[] }
    >('skillsSh:listInstalled', async () => {
      try {
        this.logger.debug('RPC: skillsSh:listInstalled called');

        const workspaceRoot = this.getWorkspaceRoot();
        const skills: InstalledSkill[] = [];

        // Fetch project-scope skills via CLI
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
          // CLI unavailable, fall back to filesystem scanning
          if (workspaceRoot) {
            const projectSkills = await this.scanSkillsDirectory(
              path.join(workspaceRoot, '.claude', 'skills'),
              'project',
            );
            skills.push(...projectSkills);
          }
        }

        // Fetch global-scope skills via CLI
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
          // CLI unavailable, fall back to filesystem scanning
          const globalSkills = await this.scanSkillsDirectory(
            path.join(os.homedir(), '.claude', 'skills'),
            'global',
          );
          skills.push(...globalSkills);
        }

        this.logger.debug('RPC: skillsSh:listInstalled success', {
          totalCount: skills.length,
          projectCount: skills.filter((s) => s.scope === 'project').length,
          globalCount: skills.filter((s) => s.scope === 'global').length,
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

  // ─── RPC Method: skillsSh:install ───

  /**
   * Install a skill from the Skills.sh registry.
   *
   * SECURITY: Validates the source string to prevent shell injection attacks.
   * Only allows alphanumeric characters, dots, dashes, and underscores in
   * the `owner/repo` format.
   */
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
          agents: params.agents,
        });

        // Security: Validate source format to prevent shell injection
        if (!SAFE_SOURCE_PATTERN.test(params.source)) {
          const error = `Invalid source format: "${params.source}". Expected "owner/repo" with alphanumeric characters only.`;
          this.logger.warn('RPC: skillsSh:install rejected unsafe source', {
            source: params.source,
          });
          return { success: false, error };
        }

        // Validate skillId if provided
        if (params.skillId && !/^[a-zA-Z0-9_.-]+$/.test(params.skillId)) {
          const error = `Invalid skillId format: "${params.skillId}".`;
          this.logger.warn('RPC: skillsSh:install rejected unsafe skillId', {
            skillId: params.skillId,
          });
          return { success: false, error };
        }

        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot && params.scope === 'project') {
          return {
            success: false,
            error: 'No workspace folder open for project-scope installation.',
          };
        }

        // Build install args
        const args = ['add', params.source];
        if (params.skillId) {
          args.push('--skill', params.skillId);
        }
        // --agent: use '*' for all agents, or specific agent names
        // Default to all supported agents when none specified
        args.push('--agent', '*');
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
          // CLI may write errors to stderr or stdout — capture both
          const errorDetail =
            result.stderr.trim() ||
            result.stdout.trim().split('\n').pop() ||
            `CLI exited with code ${result.exitCode}`;
          this.logger.warn('RPC: skillsSh:install CLI failed', {
            exitCode: result.exitCode,
            stderr: result.stderr.substring(0, 500),
            stdout: result.stdout.substring(0, 500),
          });
          return { success: false, error: errorDetail };
        }

        // Invalidate popular cache so isInstalled flags refresh
        this.popularCache = null;

        this.logger.info('RPC: skillsSh:install success', {
          source: params.source,
          skillId: params.skillId,
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

  // ─── RPC Method: skillsSh:uninstall ───

  /**
   * Remove an installed skill.
   */
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

        // Security: Validate name format
        if (!/^[a-zA-Z0-9_.-]+$/.test(params.name)) {
          const error = `Invalid skill name format: "${params.name}".`;
          this.logger.warn('RPC: skillsSh:uninstall rejected unsafe name', {
            name: params.name,
          });
          return { success: false, error };
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
          this.logger.warn('RPC: skillsSh:uninstall CLI failed', {
            exitCode: result.exitCode,
            stderr: result.stderr.substring(0, 500),
            stdout: result.stdout.substring(0, 500),
          });
          return { success: false, error: errorDetail };
        }

        // Invalidate popular cache so isInstalled flags refresh
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

  // ─── RPC Method: skillsSh:getPopular ───

  /**
   * Get popular skills with 10-minute caching.
   *
   * Two-tier strategy:
   * 1. Try fetching from CLI (`npx skills find ""`)
   * 2. Fall back to curated list if CLI is unavailable
   */
  private registerGetPopular(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      { skills: SkillShEntry[] }
    >('skillsSh:getPopular', async () => {
      try {
        this.logger.debug('RPC: skillsSh:getPopular called');

        // Check cache
        if (
          this.popularCache &&
          Date.now() - this.popularCache.timestamp <
            SkillsShRpcHandlers.POPULAR_CACHE_TTL_MS
        ) {
          this.logger.debug('RPC: skillsSh:getPopular returning cached data', {
            count: this.popularCache.data.length,
            ageMs: Date.now() - this.popularCache.timestamp,
          });
          return { skills: this.popularCache.data };
        }

        // Tier 1: Try CLI
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
        } catch (cliError) {
          this.logger.debug(
            'RPC: skillsSh:getPopular CLI unavailable, using curated fallback',
            {
              error:
                cliError instanceof Error ? cliError.message : String(cliError),
            },
          );
        }

        // Tier 2: Fall back to curated list
        if (skills.length === 0) {
          skills = await this.enrichWithInstallStatus(
            CURATED_POPULAR_SKILLS.map((s) => ({ ...s })),
          );
        }

        // Update cache
        this.popularCache = { data: skills, timestamp: Date.now() };

        this.logger.debug('RPC: skillsSh:getPopular success', {
          count: skills.length,
        });

        return { skills };
      } catch (error) {
        this.logger.error(
          'RPC: skillsSh:getPopular failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        // Return curated as ultimate fallback
        return { skills: CURATED_POPULAR_SKILLS };
      }
    });
  }

  // ─── RPC Method: skillsSh:detectRecommended ───

  /**
   * Detect workspace technologies and recommend matching skills.
   *
   * Scans workspace root for config files (package.json, tsconfig.json,
   * Cargo.toml, etc.) to identify frameworks, languages, and tools,
   * then maps them to relevant skills from the curated catalog.
   */
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
            languages: detected.languages,
            tools: detected.tools,
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

  // ─── Helper: Run Skills CLI ───

  /**
   * Execute the `npx skills` CLI with given arguments.
   *
   * Sets FORCE_COLOR=0 and NO_COLOR=1 to suppress ANSI escape codes
   * in the output for reliable text parsing.
   */
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
        if (
          error.message.includes('ETIMEDOUT') ||
          error.message.includes('killed')
        ) {
          settle({
            stdout,
            stderr: `CLI timed out after ${timeout}ms`,
            exitCode: 124,
          });
        } else if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      });

      // Single timeout mechanism
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

  // ─── Helper: Parse Skills CLI Output ───

  /**
   * Parse the text output from `npx skills find` into SkillShEntry objects.
   *
   * Expected CLI output format (lines with skill info):
   *   source/repo  skill-id  Skill Name  Description  12345
   *
   * Falls back to line-by-line heuristic parsing for varying formats.
   */
  private parseSkillsOutput(output: string): SkillShEntry[] {
    const skills: SkillShEntry[] = [];
    const lines = output.split('\n').filter((line) => line.trim().length > 0);

    if (lines.length === 0) return skills;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip header/separator/decorative lines
      if (
        trimmed.startsWith('#') ||
        trimmed.startsWith('-') ||
        trimmed.startsWith('=') ||
        trimmed.startsWith('Found') ||
        trimmed.startsWith('Searching') ||
        trimmed.startsWith('No ') ||
        trimmed.length < 10
      ) {
        continue;
      }

      // Try to parse tab-separated or multi-space-separated fields
      // Expected: source  skillId  name  description  installs
      const parts = trimmed.split(/\t+|\s{2,}/);
      if (parts.length >= 3) {
        const source = parts[0] || '';
        const skillIdOrName = parts[1] || '';

        // Detect if first field looks like an owner/repo source
        if (source.includes('/') && source.split('/').length === 2) {
          const description =
            parts.length >= 4 ? parts.slice(2, -1).join(' ') : parts[2] || '';
          const installsStr = parts[parts.length - 1] || '0';
          const installs = this.parseInstallCount(installsStr);

          skills.push({
            source,
            skillId: skillIdOrName,
            name: this.formatSkillName(skillIdOrName),
            description,
            installs,
            isInstalled: false,
          });
          continue;
        }
      }

      // Fallback: try matching "owner/repo:skill-id - Description (N installs)"
      const match = trimmed.match(
        /^([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)(?::([a-zA-Z0-9_.-]+))?\s*[-–]\s*(.+?)(?:\s*\(([0-9,.kKmM]+)\s*installs?\))?$/,
      );
      if (match) {
        skills.push({
          source: match[1],
          skillId: match[2] || '',
          name: this.formatSkillName(match[2] || match[1].split('/')[1] || ''),
          description: match[3].trim(),
          installs: this.parseInstallCount(match[4] || '0'),
          isInstalled: false,
        });
      }
    }

    if (skills.length === 0 && lines.length > 0) {
      this.logger.warn(
        'RPC: parseSkillsOutput produced 0 results from non-empty CLI output',
        {
          lineCount: lines.length,
          firstLine: lines[0]?.substring(0, 100),
        },
      );
    }

    return skills;
  }

  /**
   * Parse human-readable install counts (e.g., "594.8k", "1.2M", "12,345")
   */
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

  /**
   * Convert a skill slug to a human-readable name.
   * e.g., "react-best-practices" -> "React Best Practices"
   */
  private formatSkillName(slug: string): string {
    return slug
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  // ─── Helper: Scan Skills Directory ───

  /**
   * Scan a skills directory for installed skills by reading SKILL.md files
   * and extracting YAML frontmatter metadata.
   */
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
          // SKILL.md doesn't exist or is unreadable - still list the directory
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
      // Directory doesn't exist - not an error
    }

    return skills;
  }

  /**
   * Parse YAML frontmatter from a SKILL.md file.
   *
   * Extracts `name` and `description` fields from the frontmatter block
   * delimited by `---` markers.
   */
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
    let name = '';
    let description = '';
    let source = '';

    const nameMatch = frontmatter.match(/^name:\s*["']?(.+?)["']?\s*$/m);
    if (nameMatch) {
      name = nameMatch[1].trim();
    }

    const descMatch = frontmatter.match(/^description:\s*["']?(.+?)["']?\s*$/m);
    if (descMatch) {
      description = descMatch[1].trim();
    }

    const sourceMatch = frontmatter.match(/^source:\s*["']?(.+?)["']?\s*$/m);
    if (sourceMatch) {
      source = sourceMatch[1].trim();
    }

    return { name, description, source };
  }

  // ─── Helper: Detect Technologies ───

  /**
   * Detect technologies used in the workspace by scanning configuration files.
   *
   * Checks for:
   * - package.json dependencies (React, Angular, Vue, Next.js, Express, NestJS, etc.)
   * - tsconfig.json (TypeScript)
   * - Cargo.toml (Rust)
   * - go.mod (Go)
   * - requirements.txt / pyproject.toml (Python)
   * - docker-compose.yml / Dockerfile (Docker)
   * - nx.json (Nx monorepo)
   */
  private async detectTechnologies(workspaceRoot: string): Promise<{
    frameworks: string[];
    languages: string[];
    tools: string[];
  }> {
    const frameworks: string[] = [];
    const languages: string[] = [];
    const tools: string[] = [];

    // Check package.json for JavaScript/TypeScript ecosystem
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

      const frameworkChecks: [string, string][] = [
        ['react', 'react'],
        ['@angular/core', 'angular'],
        ['vue', 'vue'],
        ['next', 'next'],
        ['express', 'express'],
        ['@nestjs/core', 'nestjs'],
        ['@prisma/client', 'prisma'],
        ['prisma', 'prisma'],
        ['tailwindcss', 'tailwindcss'],
        ['remotion', 'remotion'],
      ];

      for (const [dep, name] of frameworkChecks) {
        if (dep in allDeps && !frameworks.includes(name)) {
          frameworks.push(name);
        }
      }
    } catch {
      // No package.json
    }

    // Check tsconfig.json
    try {
      await fs.access(path.join(workspaceRoot, 'tsconfig.json'));
      if (!languages.includes('typescript')) {
        languages.push('typescript');
      }
    } catch {
      // No tsconfig.json
    }

    // Check Cargo.toml (Rust)
    try {
      await fs.access(path.join(workspaceRoot, 'Cargo.toml'));
      languages.push('rust');
    } catch {
      // No Cargo.toml
    }

    // Check go.mod (Go)
    try {
      await fs.access(path.join(workspaceRoot, 'go.mod'));
      languages.push('go');
    } catch {
      // No go.mod
    }

    // Check Python indicators
    try {
      const pyFiles = ['requirements.txt', 'pyproject.toml', 'setup.py'];
      for (const pyFile of pyFiles) {
        try {
          await fs.access(path.join(workspaceRoot, pyFile));
          if (!languages.includes('python')) {
            languages.push('python');
          }
          break;
        } catch {
          // File doesn't exist
        }
      }
    } catch {
      // No Python files
    }

    // Check Docker
    try {
      const dockerFiles = [
        'Dockerfile',
        'docker-compose.yml',
        'docker-compose.yaml',
      ];
      for (const dockerFile of dockerFiles) {
        try {
          await fs.access(path.join(workspaceRoot, dockerFile));
          if (!tools.includes('docker')) {
            tools.push('docker');
          }
          break;
        } catch {
          // File doesn't exist
        }
      }
    } catch {
      // No Docker files
    }

    // Check nx.json (Nx monorepo)
    try {
      await fs.access(path.join(workspaceRoot, 'nx.json'));
      tools.push('nx');
    } catch {
      // No nx.json
    }

    return { frameworks, languages, tools };
  }

  // ─── Helper: Match Skills to Technologies ───

  /**
   * Map detected technologies to relevant skills from the curated catalog.
   *
   * Uses the TECH_SKILL_KEYWORDS mapping to find matching skillIds,
   * then returns unique matching SkillShEntry objects.
   */
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

    // Always include general-purpose skills for any detected technology
    if (allTechs.length > 0) {
      matchedSkillIds.add('code-review');
      matchedSkillIds.add('documentation');
      matchedSkillIds.add('debugging');
      matchedSkillIds.add('refactoring');
      matchedSkillIds.add('performance');
      matchedSkillIds.add('security-review');
    }

    return CURATED_POPULAR_SKILLS.filter((skill) =>
      matchedSkillIds.has(skill.skillId),
    ).map((skill) => ({ ...skill }));
  }

  // ─── Helper: Enrich with Install Status ───

  /**
   * Update the isInstalled flag on skills by checking against
   * currently installed skills (both project and global).
   */
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
      // Non-critical - return skills without install status
    }

    return skills;
  }

  /**
   * Get a Set of installed skill names/ids for quick lookup.
   */
  private async getInstalledSkillNames(): Promise<Set<string>> {
    const names = new Set<string>();

    const scanDir = async (dirPath: string) => {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            names.add(entry.name.toLowerCase());
          }
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

  // ─── Helper: Get Workspace Root ───

  /**
   * Get the current workspace root path.
   * Returns the first workspace folder's fsPath, or empty string if none.
   */
  private getWorkspaceRoot(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  }
}
