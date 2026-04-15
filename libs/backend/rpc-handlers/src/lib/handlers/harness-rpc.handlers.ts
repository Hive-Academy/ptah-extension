/**
 * Harness RPC Handlers
 *
 * Handles harness setup builder RPC methods:
 * - harness:initialize - Return workspace context, agents, skills, presets
 * - harness:suggest-config - AI-powered config suggestion from persona
 * - harness:search-skills - Search available skills by query
 * - harness:create-skill - Create a new custom skill file
 * - harness:discover-mcp - Discover available MCP servers
 * - harness:generate-prompt - Generate a system prompt
 * - harness:generate-claude-md - Generate CLAUDE.md content
 * - harness:apply - Apply harness config to workspace
 * - harness:save-preset - Save config as named preset
 * - harness:load-presets - List saved presets
 * - harness:chat - Step-contextual AI chat
 *
 * The harness builder configures agents, skills, system prompts,
 * MCP servers, and CLAUDE.md generation for a workspace.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { injectable, inject } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  PluginLoaderService,
  SkillJunctionService,
} from '@ptah-extension/agent-sdk';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type {
  HarnessInitializeParams,
  HarnessInitializeResponse,
  HarnessSuggestConfigParams,
  HarnessSuggestConfigResponse,
  HarnessSearchSkillsParams,
  HarnessSearchSkillsResponse,
  HarnessCreateSkillParams,
  HarnessCreateSkillResponse,
  HarnessDiscoverMcpParams,
  HarnessDiscoverMcpResponse,
  HarnessGeneratePromptParams,
  HarnessGeneratePromptResponse,
  HarnessGenerateClaudeMdParams,
  HarnessGenerateClaudeMdResponse,
  HarnessApplyParams,
  HarnessApplyResponse,
  HarnessSavePresetParams,
  HarnessSavePresetResponse,
  HarnessLoadPresetsParams,
  HarnessLoadPresetsResponse,
  HarnessChatParams,
  HarnessChatResponse,
  AvailableAgent,
  SkillSummary,
  HarnessPreset,
  HarnessConfig,
  AgentOverride,
  HarnessWizardStep,
} from '@ptah-extension/shared';

/** Directory name under ~/.ptah/ for harness presets */
const HARNESSES_DIR = 'harnesses';

/** ~/.ptah base directory */
function getPtahHome(): string {
  return path.join(os.homedir(), '.ptah');
}

/** Harness presets directory */
function getHarnessesDir(): string {
  return path.join(getPtahHome(), HARNESSES_DIR);
}

/**
 * RPC handlers for harness setup builder operations.
 *
 * Exposes the full harness wizard workflow to the frontend:
 * initialization, AI suggestions, skill management, prompt generation,
 * CLAUDE.md generation, config application, and preset persistence.
 */
@injectable()
export class HarnessRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(SDK_TOKENS.SDK_PLUGIN_LOADER)
    private readonly pluginLoader: PluginLoaderService,
    @inject(SDK_TOKENS.SDK_SKILL_JUNCTION)
    private readonly skillJunction: SkillJunctionService,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
  ) {}

  /**
   * Register all harness RPC methods
   */
  register(): void {
    this.registerInitialize();
    this.registerSuggestConfig();
    this.registerSearchSkills();
    this.registerCreateSkill();
    this.registerDiscoverMcp();
    this.registerGeneratePrompt();
    this.registerGenerateClaudeMd();
    this.registerApply();
    this.registerSavePreset();
    this.registerLoadPresets();
    this.registerChat();

    this.logger.debug('Harness RPC handlers registered', {
      methods: [
        'harness:initialize',
        'harness:suggest-config',
        'harness:search-skills',
        'harness:create-skill',
        'harness:discover-mcp',
        'harness:generate-prompt',
        'harness:generate-claude-md',
        'harness:apply',
        'harness:save-preset',
        'harness:load-presets',
        'harness:chat',
      ],
    });
  }

  // ─── Initialization ────────────────────────────────────

  /**
   * harness:initialize - Start a harness builder session.
   *
   * Returns workspace context (project name, type, frameworks, languages),
   * available CLI agents with availability status, discovered skills from
   * enabled plugins, and existing saved presets.
   */
  private registerInitialize(): void {
    this.rpcHandler.registerMethod<
      HarnessInitializeParams,
      HarnessInitializeResponse
    >('harness:initialize', async () => {
      try {
        this.logger.debug('RPC: harness:initialize called');

        const workspaceContext = await this.resolveWorkspaceContext();
        const availableAgents = this.getAvailableAgents();
        const availableSkills = this.discoverAvailableSkills();
        const existingPresets = await this.loadPresetsFromDisk();

        this.logger.debug('RPC: harness:initialize success', {
          projectName: workspaceContext.projectName,
          agentCount: availableAgents.length,
          skillCount: availableSkills.length,
          presetCount: existingPresets.length,
        });

        return {
          workspaceContext,
          availableAgents,
          availableSkills,
          existingPresets,
        };
      } catch (error) {
        this.logger.error(
          'RPC: harness:initialize failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  }

  // ─── AI Suggestions ────────────────────────────────────

  /**
   * harness:suggest-config - AI-powered config suggestion based on persona.
   *
   * Analyzes the persona description and goals to suggest appropriate agents,
   * skills, and a system prompt. Uses keyword matching for now; will be
   * replaced with actual AI generation in a future iteration.
   */
  private registerSuggestConfig(): void {
    this.rpcHandler.registerMethod<
      HarnessSuggestConfigParams,
      HarnessSuggestConfigResponse
    >('harness:suggest-config', async (params) => {
      try {
        this.logger.debug('RPC: harness:suggest-config called', {
          descriptionLength: params.personaDescription.length,
          goalCount: params.goals.length,
        });

        const result = this.buildSuggestionFromPersona(
          params.personaDescription,
          params.goals,
        );

        this.logger.debug('RPC: harness:suggest-config success', {
          suggestedAgentCount: Object.keys(result.suggestedAgents).length,
          suggestedSkillCount: result.suggestedSkills.length,
        });

        return result;
      } catch (error) {
        this.logger.error(
          'RPC: harness:suggest-config failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  }

  // ─── Skill Management ──────────────────────────────────

  /**
   * harness:search-skills - Search available skills by query string.
   *
   * Filters discovered skills from enabled plugins by matching the query
   * against skill name and description (case-insensitive substring match).
   */
  private registerSearchSkills(): void {
    this.rpcHandler.registerMethod<
      HarnessSearchSkillsParams,
      HarnessSearchSkillsResponse
    >('harness:search-skills', async (params) => {
      try {
        this.logger.debug('RPC: harness:search-skills called', {
          query: params.query,
        });

        const allSkills = this.discoverAvailableSkills();
        const query = (params.query ?? '').toLowerCase().trim();

        const results =
          query.length === 0
            ? allSkills
            : allSkills.filter(
                (skill) =>
                  skill.name.toLowerCase().includes(query) ||
                  skill.description.toLowerCase().includes(query),
              );

        this.logger.debug('RPC: harness:search-skills success', {
          totalSkills: allSkills.length,
          matchedSkills: results.length,
        });

        return { results };
      } catch (error) {
        this.logger.error(
          'RPC: harness:search-skills failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  }

  /**
   * harness:create-skill - Create a new custom skill file.
   *
   * Writes a SKILL.md file to ~/.ptah/plugins/custom-{name}/skills/{name}/SKILL.md
   * with YAML frontmatter and the provided content body.
   */
  private registerCreateSkill(): void {
    this.rpcHandler.registerMethod<
      HarnessCreateSkillParams,
      HarnessCreateSkillResponse
    >('harness:create-skill', async (params) => {
      try {
        this.logger.debug('RPC: harness:create-skill called', {
          name: params.name,
        });

        const sanitizedName = params.name
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');

        if (sanitizedName.length === 0) {
          throw new Error(
            'Invalid skill name: must contain at least one alphanumeric character',
          );
        }

        const pluginDir = path.join(
          getPtahHome(),
          'plugins',
          `custom-${sanitizedName}`,
        );
        const skillDir = path.join(pluginDir, 'skills', sanitizedName);
        const skillMdPath = path.join(skillDir, 'SKILL.md');

        await fs.mkdir(skillDir, { recursive: true });

        // Escape values for YAML frontmatter: quote strings and escape
        // inner double-quotes and newlines to prevent malformed YAML
        const escapedName = params.name.replace(/"/g, '\\"');
        const escapedDesc = params.description
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n');

        const toolsSection =
          params.allowedTools && params.allowedTools.length > 0
            ? `\nallowed_tools:\n${params.allowedTools.map((t) => `  - ${t}`).join('\n')}`
            : '';

        const skillContent = [
          '---',
          `name: "${escapedName}"`,
          `description: "${escapedDesc}"`,
          `source: custom${toolsSection}`,
          '---',
          '',
          params.content,
          '',
        ].join('\n');

        await fs.writeFile(skillMdPath, skillContent, 'utf-8');

        this.logger.debug('RPC: harness:create-skill success', {
          skillId: sanitizedName,
          skillPath: skillMdPath,
        });

        return {
          skillId: sanitizedName,
          skillPath: skillMdPath,
        };
      } catch (error) {
        this.logger.error(
          'RPC: harness:create-skill failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  }

  // ─── MCP Discovery ────────────────────────────────────

  /**
   * harness:discover-mcp - Discover available MCP servers.
   *
   * Returns the built-in Ptah MCP server entry. Will be expanded
   * to discover additional MCP servers from workspace configuration
   * in a future iteration.
   */
  private registerDiscoverMcp(): void {
    this.rpcHandler.registerMethod<
      HarnessDiscoverMcpParams,
      HarnessDiscoverMcpResponse
    >('harness:discover-mcp', async () => {
      try {
        this.logger.debug('RPC: harness:discover-mcp called');

        // TODO: Expand to discover MCP servers from workspace .mcp.json and user config
        const servers = [
          {
            name: 'ptah-mcp',
            url: 'http://localhost:0', // Port assigned dynamically at runtime
            description:
              'Built-in Ptah MCP server providing workspace analysis, code execution, browser automation, and agent orchestration tools',
            enabled: true,
          },
        ];

        this.logger.debug('RPC: harness:discover-mcp success', {
          serverCount: servers.length,
        });

        return { servers };
      } catch (error) {
        this.logger.error(
          'RPC: harness:discover-mcp failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  }

  // ─── Prompt Generation ─────────────────────────────────

  /**
   * harness:generate-prompt - Generate a system prompt from persona and selections.
   *
   * Builds a template-based system prompt incorporating the persona definition,
   * enabled agents, and selected skills. Returns both the full prompt and
   * individual sections for UI preview.
   */
  private registerGeneratePrompt(): void {
    this.rpcHandler.registerMethod<
      HarnessGeneratePromptParams,
      HarnessGeneratePromptResponse
    >('harness:generate-prompt', async (params) => {
      try {
        this.logger.debug('RPC: harness:generate-prompt called', {
          personaLabel: params.persona.label,
          enabledAgentCount: params.enabledAgents.length,
          selectedSkillCount: params.selectedSkills.length,
        });

        const sections = this.buildPromptSections(
          params.persona,
          params.enabledAgents,
          params.selectedSkills,
        );

        const generatedPrompt = Object.values(sections).join('\n\n');

        this.logger.debug('RPC: harness:generate-prompt success', {
          sectionCount: Object.keys(sections).length,
          promptLength: generatedPrompt.length,
        });

        return { generatedPrompt, sections };
      } catch (error) {
        this.logger.error(
          'RPC: harness:generate-prompt failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  }

  // ─── CLAUDE.md Generation ──────────────────────────────

  /**
   * harness:generate-claude-md - Generate CLAUDE.md content from config.
   *
   * Builds a markdown document with sections for persona, agents, skills,
   * and prompt configuration suitable for writing to .claude/CLAUDE.md.
   */
  private registerGenerateClaudeMd(): void {
    this.rpcHandler.registerMethod<
      HarnessGenerateClaudeMdParams,
      HarnessGenerateClaudeMdResponse
    >('harness:generate-claude-md', async (params) => {
      try {
        this.logger.debug('RPC: harness:generate-claude-md called', {
          configName: params.config.name,
        });

        const content = this.buildClaudeMdContent(params.config);

        this.logger.debug('RPC: harness:generate-claude-md success', {
          contentLength: content.length,
        });

        return { content };
      } catch (error) {
        this.logger.error(
          'RPC: harness:generate-claude-md failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  }

  // ─── Apply Configuration ───────────────────────────────

  /**
   * harness:apply - Apply the full harness config to the workspace.
   *
   * Writes the harness config as a preset, optionally generates CLAUDE.md
   * in the workspace, updates ~/.ptah/settings.json with agent configuration,
   * and creates skill junctions for selected skills.
   */
  private registerApply(): void {
    this.rpcHandler.registerMethod<HarnessApplyParams, HarnessApplyResponse>(
      'harness:apply',
      async (params) => {
        try {
          this.logger.debug('RPC: harness:apply called', {
            configName: params.config.name,
            generateClaudeMd: params.config.claudeMd.generateProjectClaudeMd,
            skillCount: params.config.skills.selectedSkills.length,
          });

          const appliedPaths: string[] = [];
          const warnings: string[] = [];

          // 1. Save harness config as preset
          const presetPath = await this.writePresetToDisk(
            params.config.name,
            params.config,
          );
          appliedPaths.push(presetPath);

          // 2. Generate and write CLAUDE.md if requested
          if (params.config.claudeMd.generateProjectClaudeMd) {
            const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
            if (workspaceRoot) {
              const result = await this.writeClaudeMdToWorkspace(
                workspaceRoot,
                params.config,
              );
              if (result.backupPath) {
                appliedPaths.push(result.backupPath);
              }
              appliedPaths.push(result.claudeMdPath);
            } else {
              warnings.push(
                'No workspace folder open. CLAUDE.md was not generated.',
              );
            }
          }

          // 3. Update ~/.ptah/settings.json with agent configuration
          try {
            await this.updatePtahSettings(params.config);
            appliedPaths.push(path.join(getPtahHome(), 'settings.json'));
          } catch (settingsError) {
            const msg =
              settingsError instanceof Error
                ? settingsError.message
                : String(settingsError);
            warnings.push(`Failed to update settings.json: ${msg}`);
            this.logger.error(
              'RPC: harness:apply settings update failed',
              settingsError instanceof Error ? settingsError : new Error(msg),
            );
          }

          // 4. Create skill junctions for selected skills
          if (params.config.skills.selectedSkills.length > 0) {
            try {
              const pluginPaths = this.pluginLoader.resolveCurrentPluginPaths();
              const disabledSkillIds = this.pluginLoader.getDisabledSkillIds();
              this.skillJunction.createJunctions(pluginPaths, disabledSkillIds);
            } catch (junctionError) {
              const msg =
                junctionError instanceof Error
                  ? junctionError.message
                  : String(junctionError);
              warnings.push(`Failed to create skill junctions: ${msg}`);
              this.logger.error(
                'RPC: harness:apply junction creation failed',
                junctionError instanceof Error ? junctionError : new Error(msg),
              );
            }
          }

          this.logger.debug('RPC: harness:apply success', {
            appliedPathCount: appliedPaths.length,
            warningCount: warnings.length,
          });

          return { appliedPaths, warnings };
        } catch (error) {
          this.logger.error(
            'RPC: harness:apply failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          throw error;
        }
      },
    );
  }

  // ─── Preset Management ─────────────────────────────────

  /**
   * harness:save-preset - Save config as a named preset.
   *
   * Writes the full config to ~/.ptah/harnesses/{name}.json.
   * Overwrites existing presets with the same name.
   */
  private registerSavePreset(): void {
    this.rpcHandler.registerMethod<
      HarnessSavePresetParams,
      HarnessSavePresetResponse
    >('harness:save-preset', async (params) => {
      try {
        this.logger.debug('RPC: harness:save-preset called', {
          name: params.name,
        });

        const presetPath = await this.writePresetToDisk(
          params.name,
          params.config,
          params.description,
        );

        const presetId = this.sanitizeFileName(params.name);

        this.logger.debug('RPC: harness:save-preset success', {
          presetId,
          presetPath,
        });

        return { presetId, presetPath };
      } catch (error) {
        this.logger.error(
          'RPC: harness:save-preset failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  }

  /**
   * harness:load-presets - List saved presets from disk.
   *
   * Reads all .json files from ~/.ptah/harnesses/ and parses them
   * as HarnessPreset objects. Malformed files are skipped with a warning.
   */
  private registerLoadPresets(): void {
    this.rpcHandler.registerMethod<
      HarnessLoadPresetsParams,
      HarnessLoadPresetsResponse
    >('harness:load-presets', async () => {
      try {
        this.logger.debug('RPC: harness:load-presets called');

        const presets = await this.loadPresetsFromDisk();

        this.logger.debug('RPC: harness:load-presets success', {
          presetCount: presets.length,
        });

        return { presets };
      } catch (error) {
        this.logger.error(
          'RPC: harness:load-presets failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  }

  // ─── AI Chat ───────────────────────────────────────────

  /**
   * harness:chat - Step-contextual AI chat message.
   *
   * Provides contextual help based on the current wizard step.
   * Returns a stub response with helpful text; will be replaced
   * with actual AI agent sessions in a future iteration.
   */
  private registerChat(): void {
    this.rpcHandler.registerMethod<HarnessChatParams, HarnessChatResponse>(
      'harness:chat',
      async (params) => {
        try {
          this.logger.debug('RPC: harness:chat called', {
            step: params.step,
            messageLength: params.message.length,
          });

          const reply = this.buildChatReply(params.step, params.message);

          this.logger.debug('RPC: harness:chat success', {
            replyLength: reply.length,
          });

          // TODO: Replace with actual AI agent session for interactive chat
          return { reply };
        } catch (error) {
          this.logger.error(
            'RPC: harness:chat failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          throw error;
        }
      },
    );
  }

  // ─── Private Helpers ───────────────────────────────────

  /**
   * Resolve workspace context from the current workspace provider.
   * Returns a default context if no workspace is open.
   *
   * Performs lightweight detection by checking for common project indicators
   * (package.json, requirements.txt, go.mod, Cargo.toml) without requiring
   * a full workspace analysis pass.
   */
  private async resolveWorkspaceContext(): Promise<
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

    // Try to detect from package.json
    try {
      const pkgPath = path.join(workspaceRoot, 'package.json');
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
    } catch {
      // No package.json or unreadable — that's fine
    }

    // Detect Python projects
    try {
      await fs.access(path.join(workspaceRoot, 'requirements.txt'));
      languages.push('Python');
    } catch {
      /* ignore */
    }

    // Detect Go projects
    try {
      await fs.access(path.join(workspaceRoot, 'go.mod'));
      languages.push('Go');
    } catch {
      /* ignore */
    }

    // Detect Rust projects
    try {
      await fs.access(path.join(workspaceRoot, 'Cargo.toml'));
      languages.push('Rust');
    } catch {
      /* ignore */
    }

    return { projectName, projectType, frameworks, languages };
  }

  /**
   * Get the list of available CLI agents with availability status.
   *
   * Returns a hardcoded catalog of supported CLI agents. Availability
   * is reported as true since actual CLI detection happens at session
   * start time, not during wizard initialization.
   */
  private getAvailableAgents(): AvailableAgent[] {
    return [
      {
        id: 'gemini',
        name: 'Gemini CLI',
        description: 'Google Gemini CLI agent for code generation and analysis',
        type: 'cli',
        available: true,
      },
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
  private discoverAvailableSkills(): SkillSummary[] {
    try {
      const pluginPaths = this.pluginLoader.resolveCurrentPluginPaths();
      const pluginSkills =
        this.pluginLoader.discoverSkillsForPlugins(pluginPaths);
      const disabledSkillIds = new Set(this.pluginLoader.getDisabledSkillIds());

      return pluginSkills.map((skill) => ({
        id: skill.skillId,
        name: skill.displayName,
        description: skill.description,
        source: skill.pluginId.startsWith('custom-')
          ? ('custom' as const)
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

  /**
   * Build a config suggestion based on keyword matching in the persona description.
   *
   * Analyzes the description and goals for keywords related to content creation,
   * development, testing, etc. and suggests appropriate agents and skills.
   *
   * TODO: Replace with actual AI generation using SdkInternalQueryService
   */
  private buildSuggestionFromPersona(
    description: string,
    goals: string[],
  ): HarnessSuggestConfigResponse {
    const text = `${description} ${goals.join(' ')}`.toLowerCase();

    const suggestedAgents: Record<string, AgentOverride> = {};
    const suggestedSkills: string[] = [];
    const reasoningParts: string[] = [];

    // Content/marketing persona
    if (
      text.includes('content') ||
      text.includes('marketing') ||
      text.includes('writing') ||
      text.includes('blog') ||
      text.includes('documentation')
    ) {
      suggestedAgents['ptah-cli'] = { enabled: true };
      suggestedAgents['gemini'] = { enabled: true };
      reasoningParts.push(
        'Content-oriented persona detected: enabled Ptah CLI for orchestration and Gemini for generation.',
      );
    }

    // Developer persona
    if (
      text.includes('developer') ||
      text.includes('coding') ||
      text.includes('programming') ||
      text.includes('engineer') ||
      text.includes('backend') ||
      text.includes('frontend') ||
      text.includes('fullstack')
    ) {
      suggestedAgents['copilot'] = { enabled: true };
      suggestedAgents['codex'] = { enabled: true };
      suggestedAgents['ptah-cli'] = { enabled: true };
      reasoningParts.push(
        'Developer persona detected: enabled Copilot for code suggestions, Codex for completion, and Ptah CLI for multi-agent workflows.',
      );
    }

    // Testing/QA persona
    if (
      text.includes('test') ||
      text.includes('quality') ||
      text.includes('qa') ||
      text.includes('review')
    ) {
      suggestedAgents['ptah-cli'] = { enabled: true };
      suggestedAgents['copilot'] = { enabled: true };
      reasoningParts.push(
        'Testing/QA persona detected: enabled Ptah CLI for orchestrated test generation and Copilot for code review.',
      );
    }

    // DevOps persona
    if (
      text.includes('devops') ||
      text.includes('infrastructure') ||
      text.includes('ci/cd') ||
      text.includes('deployment') ||
      text.includes('docker') ||
      text.includes('kubernetes')
    ) {
      suggestedAgents['gemini'] = { enabled: true };
      suggestedAgents['ptah-cli'] = { enabled: true };
      reasoningParts.push(
        'DevOps persona detected: enabled Gemini for infrastructure analysis and Ptah CLI for automation.',
      );
    }

    // Default: enable ptah-cli if nothing matched
    if (Object.keys(suggestedAgents).length === 0) {
      suggestedAgents['ptah-cli'] = { enabled: true };
      suggestedAgents['copilot'] = { enabled: true };
      reasoningParts.push(
        'General persona detected: enabled Ptah CLI and Copilot as a balanced default.',
      );
    }

    const suggestedPrompt = `You are a ${description || 'helpful assistant'}. Your goals are: ${goals.length > 0 ? goals.join(', ') : 'assist with development tasks'}.`;

    return {
      suggestedAgents,
      suggestedSkills,
      suggestedPrompt,
      reasoning: reasoningParts.join(' '),
    };
  }

  /**
   * Build system prompt sections from persona, agents, and skills.
   */
  private buildPromptSections(
    persona: HarnessGeneratePromptParams['persona'],
    enabledAgents: string[],
    selectedSkills: string[],
  ): Record<string, string> {
    const sections: Record<string, string> = {};

    // Persona section
    sections['persona'] = [
      `# ${persona.label}`,
      '',
      persona.description,
      '',
      persona.goals.length > 0
        ? `## Goals\n${persona.goals.map((g) => `- ${g}`).join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    // Agents section
    if (enabledAgents.length > 0) {
      sections['agents'] = [
        '## Available Agents',
        '',
        ...enabledAgents.map((agentId) => `- **${agentId}**: Enabled`),
      ].join('\n');
    }

    // Skills section
    if (selectedSkills.length > 0) {
      sections['skills'] = [
        '## Active Skills',
        '',
        ...selectedSkills.map((skillId) => `- ${skillId}`),
      ].join('\n');
    }

    // Instructions section
    sections['instructions'] = [
      '## Instructions',
      '',
      'Follow the configured persona and goals when responding.',
      'Use available agents for specialized tasks.',
      'Apply active skills when relevant to the user request.',
    ].join('\n');

    return sections;
  }

  /**
   * Build CLAUDE.md content from harness config.
   */
  private buildClaudeMdContent(
    config: Omit<HarnessConfig, 'claudeMd' | 'createdAt' | 'updatedAt'>,
  ): string {
    const lines: string[] = [];

    // Header
    lines.push(`# ${config.name}`);
    lines.push('');
    lines.push(
      `> Generated by Ptah Harness Builder on ${new Date().toISOString().split('T')[0]}`,
    );
    lines.push('');

    // Persona
    lines.push('## Persona');
    lines.push('');
    lines.push(`**${config.persona.label}**`);
    lines.push('');
    lines.push(config.persona.description);
    lines.push('');
    if (config.persona.goals.length > 0) {
      lines.push('### Goals');
      lines.push('');
      for (const goal of config.persona.goals) {
        lines.push(`- ${goal}`);
      }
      lines.push('');
    }

    // Agents
    const enabledAgentIds = Object.entries(config.agents.enabledAgents)
      .filter(([, override]) => override.enabled)
      .map(([id]) => id);

    if (enabledAgentIds.length > 0) {
      lines.push('## Agents');
      lines.push('');
      for (const agentId of enabledAgentIds) {
        const override = config.agents.enabledAgents[agentId];
        const details: string[] = [];
        if (override.modelTier) details.push(`tier: ${override.modelTier}`);
        if (override.autoApprove) details.push('auto-approve: yes');
        const suffix = details.length > 0 ? ` (${details.join(', ')})` : '';
        lines.push(`- **${agentId}**${suffix}`);
      }
      lines.push('');
    }

    // Skills
    if (config.skills.selectedSkills.length > 0) {
      lines.push('## Skills');
      lines.push('');
      for (const skillId of config.skills.selectedSkills) {
        lines.push(`- ${skillId}`);
      }
      lines.push('');
    }

    // System Prompt
    if (config.prompt.systemPrompt) {
      lines.push('## System Prompt');
      lines.push('');
      lines.push(config.prompt.systemPrompt);
      lines.push('');
    }

    // MCP Servers
    const enabledServers = config.mcp.servers.filter((s) => s.enabled);
    if (enabledServers.length > 0) {
      lines.push('## MCP Servers');
      lines.push('');
      for (const server of enabledServers) {
        lines.push(`- **${server.name}**: ${server.description || server.url}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Write CLAUDE.md to the workspace .claude/ directory.
   * If an existing CLAUDE.md is found, backs it up to CLAUDE.md.bak first.
   *
   * @returns Object with the written path and optional backup path
   */
  private async writeClaudeMdToWorkspace(
    workspaceRoot: string,
    config: HarnessConfig,
  ): Promise<{ claudeMdPath: string; backupPath?: string }> {
    const claudeDir = path.join(workspaceRoot, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });

    const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');

    // Back up existing CLAUDE.md before overwriting
    let backupPath: string | undefined;
    try {
      await fs.access(claudeMdPath);
      backupPath = claudeMdPath + '.bak';
      await fs.copyFile(claudeMdPath, backupPath);
      this.logger.info('Backed up existing CLAUDE.md', { backupPath });
    } catch {
      // File doesn't exist, no backup needed
    }

    // Use preview content if available, otherwise generate
    const content = config.claudeMd.previewContent
      ? config.claudeMd.previewContent
      : this.buildClaudeMdContent(config);

    await fs.writeFile(claudeMdPath, content, 'utf-8');

    this.logger.debug('Wrote CLAUDE.md to workspace', {
      path: claudeMdPath,
      contentLength: content.length,
      backedUp: !!backupPath,
    });

    return { claudeMdPath, backupPath };
  }

  /**
   * Update ~/.ptah/settings.json with agent configuration from the harness config.
   *
   * Merges agent overrides into the existing settings file,
   * preserving any unrelated settings.
   */
  private async updatePtahSettings(config: HarnessConfig): Promise<void> {
    const settingsPath = path.join(getPtahHome(), 'settings.json');

    let existingSettings: Record<string, unknown> = {};
    try {
      const raw = await fs.readFile(settingsPath, 'utf-8');
      existingSettings = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // File doesn't exist or is invalid JSON; start fresh
    }

    // Merge agent configuration
    const agentConfig: Record<string, unknown> = {};
    for (const [agentId, override] of Object.entries(
      config.agents.enabledAgents,
    )) {
      if (override.enabled) {
        agentConfig[agentId] = {
          enabled: true,
          ...(override.modelTier ? { modelTier: override.modelTier } : {}),
          ...(override.autoApprove !== undefined
            ? { autoApprove: override.autoApprove }
            : {}),
          ...(override.customInstructions
            ? { customInstructions: override.customInstructions }
            : {}),
        };
      }
    }

    existingSettings['harness.agents'] = agentConfig;
    existingSettings['harness.lastApplied'] = config.name;
    existingSettings['harness.lastAppliedAt'] = new Date().toISOString();

    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(
      settingsPath,
      JSON.stringify(existingSettings, null, 2),
      'utf-8',
    );
  }

  /**
   * Write a preset to disk at ~/.ptah/harnesses/{name}.json.
   *
   * Handles filename collisions: if the sanitized name maps to an existing file
   * belonging to a different preset (different original name), a numeric suffix
   * is appended to avoid silent overwrites. Same-name presets are updated in place.
   */
  private async writePresetToDisk(
    name: string,
    config: HarnessConfig,
    description?: string,
  ): Promise<string> {
    const harnessesDir = getHarnessesDir();
    await fs.mkdir(harnessesDir, { recursive: true });

    const baseName = this.sanitizeFileName(name);
    let fileName = `${baseName}.json`;
    let presetPath = path.join(harnessesDir, fileName);

    // Avoid overwriting existing presets with different names
    let counter = 1;
    while (true) {
      try {
        await fs.access(presetPath);
        // File exists — check if it belongs to the same preset (same name = update)
        const existing = JSON.parse(
          await fs.readFile(presetPath, 'utf-8'),
        ) as HarnessPreset;
        if (existing.name === name) break; // Same preset, safe to overwrite
        // Different preset with colliding filename, try next suffix
        fileName = `${baseName}-${counter}.json`;
        presetPath = path.join(harnessesDir, fileName);
        counter++;
      } catch {
        break; // File doesn't exist, safe to write
      }
    }

    const presetId = fileName.replace(/\.json$/, '');

    const preset: HarnessPreset = {
      id: presetId,
      name,
      description: description || `Harness preset: ${name}`,
      config: {
        ...config,
        updatedAt: new Date().toISOString(),
      },
      createdAt: config.createdAt || new Date().toISOString(),
    };

    await fs.writeFile(presetPath, JSON.stringify(preset, null, 2), 'utf-8');

    this.logger.debug('Wrote harness preset to disk', {
      presetId,
      presetPath,
    });

    return presetPath;
  }

  /**
   * Load all presets from ~/.ptah/harnesses/ directory.
   * Malformed files are skipped with a debug log.
   */
  private async loadPresetsFromDisk(): Promise<HarnessPreset[]> {
    const harnessesDir = getHarnessesDir();
    const presets: HarnessPreset[] = [];

    let entries: string[];
    try {
      entries = await fs.readdir(harnessesDir);
    } catch {
      // Directory doesn't exist yet — no presets
      return [];
    }

    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;

      const filePath = path.join(harnessesDir, entry);
      try {
        const raw = await fs.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(raw) as HarnessPreset;

        // Basic validation: ensure required fields exist
        if (parsed.id && parsed.name && parsed.config) {
          presets.push(parsed);
        } else {
          this.logger.debug('Skipping malformed harness preset', {
            file: entry,
          });
        }
      } catch (parseError) {
        this.logger.debug('Failed to parse harness preset', {
          file: entry,
          error:
            parseError instanceof Error
              ? parseError.message
              : String(parseError),
        });
      }
    }

    return presets;
  }

  /**
   * Build a contextual chat reply based on the current wizard step.
   *
   * TODO: Replace with actual AI agent session using SdkInternalQueryService
   */
  private buildChatReply(step: HarnessWizardStep, message: string): string {
    const stepGuidance: Record<HarnessWizardStep, string> = {
      persona:
        'I can help you define your persona. Describe your role and goals, and I will suggest a configuration that matches your workflow. Try describing what kind of work you primarily do.',
      agents:
        'I can help you choose agents. Each agent specializes in different tasks: Copilot for code suggestions, Codex for code completion, Gemini for analysis, and Ptah CLI for multi-agent orchestration. Which aspects of development do you need help with?',
      skills:
        'I can help you select skills. Skills extend agent capabilities with specialized knowledge and tools. You can search for existing skills or create custom ones tailored to your workflow.',
      prompts:
        'I can help you refine your system prompt. The prompt shapes how agents respond to your requests. Consider including your preferred coding style, project conventions, and any specific guidelines you want agents to follow.',
      mcp: 'I can help you configure MCP servers. MCP servers provide additional tools like workspace analysis, code execution, and browser automation. The built-in Ptah MCP server covers most common needs.',
      review:
        'Your harness configuration is ready for review. Check each section to make sure it matches your workflow. You can go back to any step to make changes before applying.',
    };

    const guidance =
      stepGuidance[step] || 'How can I help you with the harness setup?';

    return `${guidance}\n\nRegarding your question: "${message}" - this is a preview of the harness AI chat. Full AI-powered responses will be available in a future update.`;
  }

  /**
   * Sanitize a name for use as a filename (no path separators, special chars).
   */
  private sanitizeFileName(name: string): string {
    return (
      name
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'unnamed'
    );
  }
}
