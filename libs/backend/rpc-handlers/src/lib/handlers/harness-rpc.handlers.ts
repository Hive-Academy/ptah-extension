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
  McpRegistryProvider,
  SdkStreamProcessor,
  isSuccessResult,
} from '@ptah-extension/agent-sdk';
import type { InternalQueryService } from '@ptah-extension/agent-sdk';
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
  McpServerSuggestion,
  HarnessWizardStep,
} from '@ptah-extension/shared';

/** Structured output shape from the LLM suggestion call */
interface LlmSuggestionOutput {
  selectedAgentIds: string[];
  selectedSkillIds: string[];
  mcpSearchTerms: string[];
  systemPrompt: string;
  reasoning: string;
}

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
  private readonly registryProvider = new McpRegistryProvider();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(SDK_TOKENS.SDK_PLUGIN_LOADER)
    private readonly pluginLoader: PluginLoaderService,
    @inject(SDK_TOKENS.SDK_SKILL_JUNCTION)
    private readonly skillJunction: SkillJunctionService,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE)
    private readonly internalQueryService: InternalQueryService,
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
   * Uses InternalQueryService with structured JSON output to let the LLM
   * dynamically decide which agents, skills, MCP servers, and system prompt
   * best fit the persona. Falls back to a keyword heuristic if the LLM
   * is unavailable.
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

        const availableSkills = this.discoverAvailableSkills();
        const availableAgents = this.getAvailableAgents();
        const result = await this.buildSuggestionFromPersona(
          params.personaDescription,
          params.goals,
          availableSkills,
          availableAgents,
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
   * Build a config suggestion by asking the AI to analyze the persona
   * and select the most appropriate agents, skills, and MCP servers.
   *
   * Uses InternalQueryService with structured JSON output to let the LLM
   * dynamically decide what's relevant — no hardcoded keyword maps.
   * Falls back to a basic heuristic if the LLM call fails.
   */
  private async buildSuggestionFromPersona(
    description: string,
    goals: string[],
    availableSkills: SkillSummary[],
    availableAgents: AvailableAgent[],
  ): Promise<HarnessSuggestConfigResponse> {
    try {
      return await this.buildSuggestionViaAgent(
        description,
        goals,
        availableSkills,
        availableAgents,
      );
    } catch (error) {
      this.logger.warn(
        'LLM-powered suggestion failed, falling back to heuristic',
        { error: error instanceof Error ? error.message : String(error) },
      );
      return this.buildSuggestionFallback(description, goals);
    }
  }

  /**
   * LLM-powered suggestion engine.
   *
   * Sends the persona, available agents, and available skills to the AI agent
   * via InternalQueryService with a structured output schema. The AI analyzes
   * the persona and returns the best-fit agents, skills, MCP search terms,
   * a system prompt, and reasoning — all decided dynamically.
   */
  private async buildSuggestionViaAgent(
    description: string,
    goals: string[],
    availableSkills: SkillSummary[],
    availableAgents: AvailableAgent[],
  ): Promise<HarnessSuggestConfigResponse> {
    const workspaceRoot =
      this.workspaceProvider.getWorkspaceRoot() ?? process.cwd();

    // Build agent catalog for the prompt
    const agentList = availableAgents
      .map(
        (a) =>
          `- id: "${a.id}" | name: "${a.name}" | type: ${a.type} | description: ${a.description}`,
      )
      .join('\n');

    // Build skill catalog for the prompt (cap at 50 to avoid prompt bloat)
    const skillList = availableSkills
      .slice(0, 50)
      .map(
        (s) =>
          `- id: "${s.id}" | name: "${s.name}" | description: ${s.description}`,
      )
      .join('\n');

    const prompt = `You are configuring an AI coding assistant harness for a user. Analyze their persona and select the most appropriate configuration.

## User Persona
**Description:** ${description}
**Goals:** ${goals.length > 0 ? goals.join(', ') : 'General development assistance'}

## Available Agents
These are the CLI/subagent tools the user can enable:
${agentList}

## Available Skills
These are plugin skills that can be activated:
${skillList || '(no skills available)'}

## Your Task
Based on the persona description and goals, return a JSON object with:

1. **selectedAgentIds**: Array of agent IDs to enable. Pick agents whose capabilities best match the persona's workflow. Enable at least 1 agent.
2. **selectedSkillIds**: Array of skill IDs to activate. Pick skills whose descriptions match the persona's needs. Can be empty if no skills are relevant.
3. **mcpSearchTerms**: Array of 3-6 specific technology keywords to search the MCP Server Registry for relevant tools (e.g., "github", "postgresql", "docker", "playwright"). These should be concrete technology names, not generic terms.
4. **systemPrompt**: A concise system prompt (2-4 sentences) tailored to this persona that instructs the AI assistant on how to behave.
5. **reasoning**: A brief explanation (2-3 sentences) of why you chose these specific agents, skills, and tools for this persona.

Return ONLY the JSON object matching the schema.`;

    const outputSchema = {
      type: 'object',
      properties: {
        selectedAgentIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Agent IDs to enable',
        },
        selectedSkillIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Skill IDs to activate',
        },
        mcpSearchTerms: {
          type: 'array',
          items: { type: 'string' },
          description: 'Technology keywords for MCP Registry search',
        },
        systemPrompt: {
          type: 'string',
          description: 'Tailored system prompt for the persona',
        },
        reasoning: {
          type: 'string',
          description: 'Explanation of the suggestions',
        },
      },
      required: [
        'selectedAgentIds',
        'selectedSkillIds',
        'mcpSearchTerms',
        'systemPrompt',
        'reasoning',
      ],
      additionalProperties: false,
    };

    // AbortController with 45-second timeout to prevent hanging
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 45_000);

    const handle = await this.internalQueryService.execute({
      cwd: workspaceRoot,
      model: 'sonnet',
      prompt,
      systemPromptAppend:
        'You are a configuration advisor. Analyze the user persona and select the best agents, skills, and tools. Be specific and practical in your choices. Do NOT use any tools — just analyze the information provided and return the structured JSON.',
      isPremium: false,
      mcpServerRunning: false,
      maxTurns: 1,
      outputFormat: { type: 'json_schema', schema: outputSchema },
      abortController,
    });

    let rawOutput: unknown | null = null;

    try {
      // Use SdkStreamProcessor for consistent stream consumption
      const processor = new SdkStreamProcessor({
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        emitter: { emit: () => {} },
        logger: this.logger,
        serviceTag: '[HarnessSuggest]',
      });
      const result = await processor.process(handle.stream);
      rawOutput = result.structuredOutput;
    } finally {
      clearTimeout(timeout);
      handle.close();
    }

    // ── Runtime validation of LLM output shape ──

    const output = this.validateSuggestionOutput(rawOutput);

    // ── Map validated output to HarnessSuggestConfigResponse ──

    // Build agent overrides from selected IDs
    const validAgentIds = new Set(availableAgents.map((a) => a.id));
    const suggestedAgents: Record<string, AgentOverride> = {};
    for (const agentId of output.selectedAgentIds) {
      if (validAgentIds.has(agentId)) {
        suggestedAgents[agentId] = { enabled: true };
      }
    }
    // Ensure at least ptah-cli is enabled
    if (Object.keys(suggestedAgents).length === 0) {
      suggestedAgents['ptah-cli'] = { enabled: true };
    }

    // Filter skill IDs to only valid ones
    const validSkillIds = new Set(availableSkills.map((s) => s.id));
    const suggestedSkills = output.selectedSkillIds.filter((id) =>
      validSkillIds.has(id),
    );

    // Search MCP Registry using AI-selected keywords
    const suggestedMcpServers = await this.suggestMcpServersFromRegistry(
      output.mcpSearchTerms,
    );

    this.logger.info('LLM-powered suggestion completed', {
      agentCount: Object.keys(suggestedAgents).length,
      skillCount: suggestedSkills.length,
      mcpCount: suggestedMcpServers.length,
      searchTerms: output.mcpSearchTerms,
    });

    return {
      suggestedAgents,
      suggestedSkills,
      suggestedMcpServers,
      suggestedPrompt: output.systemPrompt,
      reasoning: output.reasoning,
    };
  }

  /**
   * Validate the raw structured output from the LLM matches
   * the expected LlmSuggestionOutput shape. Throws if invalid.
   */
  private validateSuggestionOutput(raw: unknown): LlmSuggestionOutput {
    if (!raw || typeof raw !== 'object') {
      throw new Error('LLM did not return structured output');
    }

    const obj = raw as Record<string, unknown>;

    if (
      !Array.isArray(obj['selectedAgentIds']) ||
      !Array.isArray(obj['selectedSkillIds']) ||
      !Array.isArray(obj['mcpSearchTerms']) ||
      typeof obj['systemPrompt'] !== 'string' ||
      typeof obj['reasoning'] !== 'string'
    ) {
      throw new Error(
        'LLM returned malformed structured output: missing or wrong-typed fields',
      );
    }

    return {
      selectedAgentIds: obj['selectedAgentIds'] as string[],
      selectedSkillIds: obj['selectedSkillIds'] as string[],
      mcpSearchTerms: obj['mcpSearchTerms'] as string[],
      systemPrompt: obj['systemPrompt'] as string,
      reasoning: obj['reasoning'] as string,
    };
  }

  /**
   * Fallback heuristic suggestion when the LLM is unavailable.
   *
   * Uses basic defaults — enables ptah-cli + copilot, generates a
   * simple system prompt, and searches the MCP registry with extracted keywords.
   */
  private async buildSuggestionFallback(
    description: string,
    goals: string[],
  ): Promise<HarnessSuggestConfigResponse> {
    const text = `${description} ${goals.join(' ')}`.toLowerCase();

    // Default agents
    const suggestedAgents: Record<string, AgentOverride> = {
      'ptah-cli': { enabled: true },
      copilot: { enabled: true },
    };

    // MCP server suggestions via keyword extraction fallback
    const keywords = this.extractSearchableKeywords(text);
    const suggestedMcpServers =
      await this.suggestMcpServersFromRegistry(keywords);

    const suggestedPrompt = `You are a ${description || 'helpful assistant'}. Your goals are: ${goals.length > 0 ? goals.join(', ') : 'assist with development tasks'}.`;

    return {
      suggestedAgents,
      suggestedSkills: [],
      suggestedMcpServers,
      suggestedPrompt,
      reasoning:
        'Using default configuration (AI suggestion unavailable). Enabled Ptah CLI and Copilot as a balanced starting point. Adjust agents and skills in subsequent steps.',
    };
  }

  /**
   * Search the live MCP Registry for servers matching the given keywords.
   *
   * Searches the Official MCP Registry for each keyword in parallel,
   * deduplicates, and returns the top results. Keywords are either
   * AI-selected (from buildSuggestionViaAgent) or extracted via
   * heuristic (from buildSuggestionFallback).
   */
  private async suggestMcpServersFromRegistry(
    keywords: string[],
  ): Promise<McpServerSuggestion[]> {
    if (keywords.length === 0) return [];

    // Search the registry for each keyword in parallel (cap at 6 keywords)
    const searchResults = await Promise.allSettled(
      keywords.slice(0, 6).map(async (keyword) => {
        const result = await this.registryProvider.listServers({
          query: keyword,
          limit: 3,
        });
        return { keyword, servers: result.servers };
      }),
    );

    // Collect results, deduplicate by server name
    const seen = new Set<string>();
    const suggestions: McpServerSuggestion[] = [];

    for (const outcome of searchResults) {
      if (outcome.status !== 'fulfilled') continue;

      const { keyword, servers } = outcome.value;
      for (const server of servers) {
        if (seen.has(server.name)) continue;
        seen.add(server.name);

        const displayName = server.name.split('/').pop() || server.name;

        suggestions.push({
          query: server.name,
          displayName,
          reason:
            server.description || `Matched your persona keyword "${keyword}"`,
        });
      }
    }

    // Return top 8 suggestions
    return suggestions.slice(0, 8);
  }

  /**
   * Extract searchable keywords from persona text (fallback path).
   *
   * Used when the LLM suggestion engine is unavailable. Filters out
   * common English stop words and generic role descriptors, keeping
   * technology-specific terms for MCP registry search.
   */
  private extractSearchableKeywords(text: string): string[] {
    const stopWords = new Set([
      // Common English
      'the',
      'and',
      'for',
      'with',
      'that',
      'this',
      'from',
      'your',
      'have',
      'are',
      'was',
      'will',
      'can',
      'want',
      'need',
      'work',
      'help',
      'use',
      'like',
      'also',
      'make',
      'get',
      'set',
      'new',
      'all',
      'any',
      'but',
      'not',
      'our',
      'out',
      'who',
      'how',
      'its',
      'may',
      'more',
      'most',
      'been',
      'such',
      'than',
      'them',
      'then',
      'some',
      'into',
      'over',
      'just',
      'about',
      'would',
      'could',
      'should',
      'being',
      'other',
      'each',
      'which',
      'their',
      'there',
      // Generic role/job words (not useful as registry search terms)
      'developer',
      'engineer',
      'architect',
      'designer',
      'manager',
      'lead',
      'senior',
      'junior',
      'mid',
      'level',
      'full',
      'stack',
      'fullstack',
      'full-stack',
      'software',
      'coding',
      'programming',
      'building',
      'working',
      'projects',
      'applications',
      'systems',
      'team',
      'role',
      'goal',
      'goals',
      'experience',
      'focus',
      'responsible',
      'creating',
      'developing',
      'using',
      'tools',
      'looking',
      'assist',
      'tasks',
      'write',
      'code',
    ]);

    return text
      .split(/[\s,./;:!?()[\]{}]+/)
      .map((w) => w.toLowerCase())
      .filter((w) => w.length >= 3 && !stopWords.has(w))
      .filter((w, i, arr) => arr.indexOf(w) === i);
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
