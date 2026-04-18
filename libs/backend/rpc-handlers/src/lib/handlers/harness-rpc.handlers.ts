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
 * - harness:design-agents - AI designs a custom subagent fleet
 * - harness:generate-skills - AI generates specialized skill specs
 * - harness:generate-document - Generate comprehensive PRD/requirements document
 * - harness:analyze-intent - AI architects a complete harness from freeform input
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
  SdkMessageTransformer,
} from '@ptah-extension/agent-sdk';
import type {
  InternalQueryService,
  StreamEventEmitter,
  StreamEvent,
  SDKMessage,
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
  HarnessDesignAgentsParams,
  HarnessDesignAgentsResponse,
  HarnessGenerateSkillsParams,
  HarnessGenerateSkillsResponse,
  HarnessGenerateDocumentParams,
  HarnessGenerateDocumentResponse,
  HarnessAnalyzeIntentParams,
  HarnessAnalyzeIntentResponse,
  HarnessConverseParams,
  HarnessConverseResponse,
  AvailableAgent,
  SkillSummary,
  HarnessPreset,
  HarnessConfig,
  AgentOverride,
  McpServerSuggestion,
  HarnessWizardStep,
  HarnessSubagentDefinition,
  GeneratedSkillSpec,
  HarnessChatAction,
  HarnessStreamPayload,
  HarnessStreamCompletePayload,
  HarnessStreamOperation,
} from '@ptah-extension/shared';
import type {
  HarnessFlatStreamPayload,
  SessionId,
} from '@ptah-extension/shared';

/** Structured output shape from the LLM suggestion call */
interface LlmSuggestionOutput {
  selectedAgentIds: string[];
  selectedSkillIds: string[];
  mcpSearchTerms: string[];
  systemPrompt: string;
  reasoning: string;
}

/** Structured output shape from the LLM subagent design call */
interface LlmSubagentDesignOutput {
  subagents: Array<{
    id: string;
    name: string;
    description: string;
    role: string;
    tools: string[];
    executionMode: 'background' | 'on-demand' | 'scheduled';
    triggers?: string[];
    instructions: string;
  }>;
  reasoning: string;
}

/** Structured output shape from the LLM skill generation call */
interface LlmSkillGenerationOutput {
  skills: Array<{
    name: string;
    description: string;
    content: string;
    requiredTools?: string[];
    reasoning: string;
  }>;
  reasoning: string;
}

/** Structured output shape from the LLM intent analysis call */
interface LlmIntentAnalysisOutput {
  persona: {
    label: string;
    description: string;
    goals: string[];
  };
  selectedAgentIds: string[];
  subagents: Array<{
    id: string;
    name: string;
    description: string;
    role: string;
    tools: string[];
    executionMode: 'background' | 'on-demand' | 'scheduled';
    triggers?: string[];
    instructions: string;
  }>;
  selectedSkillIds: string[];
  skillSpecs: Array<{
    name: string;
    description: string;
    content: string;
    requiredTools?: string[];
    reasoning: string;
  }>;
  systemPrompt: string;
  mcpSearchTerms: string[];
  summary: string;
  reasoning: string;
}

/** Structured output shape from the LLM chat call */
interface LlmChatOutput {
  reply: string;
  suggestedActions?: Array<{
    type: string;
    label: string;
    payload: Record<string, unknown>;
  }>;
}

/** Structured output shape from the conversational harness call */
interface LlmConverseOutput {
  reply: string;
  configUpdates?: Partial<HarnessConfig>;
  isConfigComplete?: boolean;
}

/**
 * Local interface for webview broadcasting.
 * Uses `string` for message type because harness stream types are not members
 * of StrictMessageType. The underlying WebviewManager.broadcastMessage
 * implementation accepts any message type via postMessage.
 */
interface WebviewBroadcaster {
  broadcastMessage(type: string, payload: unknown): Promise<void>;
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
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewBroadcaster,
    @inject(SDK_TOKENS.SDK_MESSAGE_TRANSFORMER)
    private readonly messageTransformer: SdkMessageTransformer,
  ) {}

  // ─── Streaming Helpers ──────────────────────────────

  private createStreamEmitter(operation: HarnessStreamOperation): {
    emitter: StreamEventEmitter;
    operationId: string;
  } {
    const operationId = `${operation}-${Date.now()}`;
    const emitter: StreamEventEmitter = {
      emit: (event: StreamEvent) => {
        const payload: HarnessStreamPayload = {
          operation,
          operationId,
          kind: event.kind,
          content: event.content,
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          isError: event.isError,
          timestamp: event.timestamp,
        };
        this.webviewManager.broadcastMessage('harness:stream', payload);
      },
    };
    return { emitter, operationId };
  }

  /**
   * Tee an SDK message stream: yields each SDKMessage to the downstream consumer
   * (SdkStreamProcessor) while also converting to FlatStreamEventUnion events
   * and broadcasting them to the webview for real-time execution visualization.
   */
  private async *teeStreamWithFlatEvents(
    stream: AsyncIterable<SDKMessage>,
    operationId: string,
  ): AsyncIterable<SDKMessage> {
    const transformer = this.messageTransformer.createIsolated();
    const harnessSessionId = `harness-${operationId}` as SessionId;

    for await (const sdkMessage of stream) {
      // Convert SDKMessage to FlatStreamEventUnion[] and broadcast each event
      const flatEvents = transformer.transform(sdkMessage, harnessSessionId);
      for (const event of flatEvents) {
        this.webviewManager.broadcastMessage('harness:flat-stream', {
          operationId,
          event,
        } satisfies HarnessFlatStreamPayload);
      }

      // Yield the original SDKMessage for SdkStreamProcessor
      yield sdkMessage;
    }
  }

  private broadcastStreamComplete(
    operation: HarnessStreamOperation,
    operationId: string,
    success: boolean,
    error?: string,
  ): void {
    const payload: HarnessStreamCompletePayload = {
      operation,
      operationId,
      success,
      error,
      timestamp: Date.now(),
    };
    this.webviewManager.broadcastMessage('harness:stream-complete', payload);
  }

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
    this.registerDesignAgents();
    this.registerGenerateSkills();
    this.registerGenerateDocument();
    this.registerAnalyzeIntent();
    this.registerConverse();

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
        'harness:design-agents',
        'harness:generate-skills',
        'harness:generate-document',
        'harness:analyze-intent',
        'harness:converse',
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
          `ptah-harness-${sanitizedName}`,
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

        // Sanitize tool names before embedding in YAML to prevent injection
        // via newlines or special characters in a tool name string.
        const safeToolName = (t: string) => t.replace(/[^\w:/.\\-]/g, '');
        const toolsSection =
          params.allowedTools && params.allowedTools.length > 0
            ? `\nallowed_tools:\n${params.allowedTools.map((t) => `  - ${safeToolName(t)}`).join('\n')}`
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

        const servers: Array<{
          name: string;
          url: string;
          description?: string;
          enabled: boolean;
        }> = [];

        // Always include built-in Ptah MCP server
        servers.push({
          name: 'ptah-mcp',
          url: 'http://localhost:0', // Port assigned dynamically at runtime
          description:
            'Built-in Ptah MCP server providing workspace analysis, code execution, browser automation, and agent orchestration tools',
          enabled: true,
        });

        // Discover workspace MCP servers from config files
        const wsRoot =
          this.workspaceProvider.getWorkspaceRoot() ?? process.cwd();

        // Read .vscode/mcp.json
        // Use async readFile directly and handle ENOENT in catch to avoid
        // blocking the event loop with existsSync and the TOCTOU race it creates.
        // Only extract server names — never forward env/args/credentials to the webview.
        const vscodeMcpPath = path.join(wsRoot, '.vscode', 'mcp.json');
        try {
          const raw = await fs.readFile(vscodeMcpPath, 'utf-8');
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          const mcpServers =
            (parsed['servers'] as Record<string, unknown>) ??
            (parsed['mcpServers'] as Record<string, unknown>) ??
            {};

          // Extract only server names — env/args/command fields may contain
          // credentials and must never be forwarded to the webview.
          const serverNames = Object.keys(mcpServers);
          for (const name of serverNames) {
            servers.push({
              name,
              url: '',
              description: 'From .vscode/mcp.json',
              enabled: true,
            });
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            this.logger.warn(
              `RPC: harness:discover-mcp failed to read .vscode/mcp.json: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        // Read .mcp.json from workspace root
        // Same pattern: async-only, name extraction only.
        const rootMcpPath = path.join(wsRoot, '.mcp.json');
        try {
          const raw = await fs.readFile(rootMcpPath, 'utf-8');
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          const mcpServers =
            (parsed['servers'] as Record<string, unknown>) ??
            (parsed['mcpServers'] as Record<string, unknown>) ??
            {};

          // Extract only server names — env/args/command fields may contain
          // credentials and must never be forwarded to the webview.
          const serverNames = Object.keys(mcpServers);
          for (const name of serverNames) {
            servers.push({
              name,
              url: '',
              description: 'From .mcp.json',
              enabled: true,
            });
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            this.logger.warn(
              `RPC: harness:discover-mcp failed to read .mcp.json: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

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
          const config = this.normalizeHarnessConfig(params.config);

          this.logger.debug('RPC: harness:apply called', {
            configName: config.name,
            generateClaudeMd: config.claudeMd.generateProjectClaudeMd,
            skillCount: config.skills.selectedSkills.length,
          });

          const appliedPaths: string[] = [];
          const warnings: string[] = [];

          // 1. Save harness config as preset
          const presetPath = await this.writePresetToDisk(config.name, config);
          appliedPaths.push(presetPath);

          // 2. Generate and write CLAUDE.md if requested
          if (config.claudeMd.generateProjectClaudeMd) {
            const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
            if (workspaceRoot) {
              const result = await this.writeClaudeMdToWorkspace(
                workspaceRoot,
                config,
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
            await this.updatePtahSettings(config);
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
          if (config.skills.selectedSkills.length > 0) {
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
   * harness:chat - Intelligent AI chat for collaborative harness building.
   *
   * Uses InternalQueryService for real LLM-powered responses with full
   * awareness of the current step, persona, and configuration state.
   * The AI can suggest concrete actions (add agents, create skills, etc.)
   * that the frontend can apply with one click.
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

          const result = await this.buildIntelligentChatReply(
            params.step,
            params.message,
            params.context,
          );

          this.logger.debug('RPC: harness:chat success', {
            replyLength: result.reply.length,
            actionCount: result.suggestedActions?.length ?? 0,
          });

          return result;
        } catch (error) {
          this.logger.error(
            'RPC: harness:chat failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          // Graceful fallback to stub if LLM fails
          return {
            reply: this.buildChatReplyFallback(params.step, params.message),
          };
        }
      },
    );
  }

  // ─── Subagent Fleet Design ─────────────────────────────

  /**
   * harness:design-agents - AI designs a custom subagent fleet for the persona.
   *
   * Analyzes the persona's role, goals, and workflow to create specialized
   * subagent definitions — each with a distinct role, tools, execution mode,
   * and trigger conditions. This is the core of the collaborative workflow:
   * the AI designs the agent architecture, the user refines it.
   */
  private registerDesignAgents(): void {
    this.rpcHandler.registerMethod<
      HarnessDesignAgentsParams,
      HarnessDesignAgentsResponse
    >('harness:design-agents', async (params) => {
      try {
        this.logger.debug('RPC: harness:design-agents called', {
          personaLabel: params.persona.label,
          goalCount: params.persona.goals.length,
        });

        const result = await this.designSubagentFleet(
          params.persona,
          params.existingAgents,
          params.workspaceContext,
        );

        this.logger.debug('RPC: harness:design-agents success', {
          subagentCount: result.subagents.length,
        });

        return result;
      } catch (error) {
        this.logger.error(
          'RPC: harness:design-agents failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  }

  // ─── Skill Generation ─────────────────────────────────

  /**
   * harness:generate-skills - AI generates specialized skill specs for the persona.
   *
   * Creates skill markdown content tailored to the persona's workflow.
   * Each skill is a complete SKILL.md specification that can be written
   * to disk and activated. Skills are designed to work with the custom
   * subagent fleet if one was designed.
   */
  private registerGenerateSkills(): void {
    this.rpcHandler.registerMethod<
      HarnessGenerateSkillsParams,
      HarnessGenerateSkillsResponse
    >('harness:generate-skills', async (params) => {
      try {
        this.logger.debug('RPC: harness:generate-skills called', {
          personaLabel: params.persona.label,
          existingSkillCount: params.existingSkills.length,
          subagentCount: params.harnessSubagents?.length ?? 0,
        });

        const result = await this.generateSkillSpecs(
          params.persona,
          params.existingSkills,
          params.harnessSubagents,
        );

        this.logger.debug('RPC: harness:generate-skills success', {
          generatedSkillCount: result.skills.length,
        });

        return result;
      } catch (error) {
        this.logger.error(
          'RPC: harness:generate-skills failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  }

  // ─── Document Generation ──────────────────────────────

  /**
   * harness:generate-document - Generate comprehensive PRD/requirements document.
   *
   * Produces a complete requirements document from the harness configuration,
   * similar to a Product Requirements Document. Includes persona profile,
   * subagent fleet architecture, skill library, security guardrails,
   * MCP server topology, and implementation roadmap.
   */
  private registerGenerateDocument(): void {
    this.rpcHandler.registerMethod<
      HarnessGenerateDocumentParams,
      HarnessGenerateDocumentResponse
    >('harness:generate-document', async (params) => {
      try {
        this.logger.debug('RPC: harness:generate-document called', {
          configName: params.config.name,
        });

        const result = await this.generateComprehensiveDocument(
          params.config,
          params.workspaceContext,
        );

        this.logger.debug('RPC: harness:generate-document success', {
          documentLength: result.document.length,
          sectionCount: Object.keys(result.sections).length,
        });

        return result;
      } catch (error) {
        this.logger.error(
          'RPC: harness:generate-document failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
  }

  // ─── Intent Analysis ───────────────────────────────────

  /**
   * harness:analyze-intent - AI architects a complete harness from freeform input.
   *
   * Accepts any text — a PRD document, a simple instruction like "build a harness
   * for real-estate marketing", or a detailed description. The AI analyzes the
   * intent and returns a complete harness blueprint: persona, subagent fleet,
   * skill specs, system prompt, and MCP server recommendations.
   */
  private registerAnalyzeIntent(): void {
    this.rpcHandler.registerMethod<
      HarnessAnalyzeIntentParams,
      HarnessAnalyzeIntentResponse
    >('harness:analyze-intent', async (params) => {
      try {
        if (
          !params.input ||
          typeof params.input !== 'string' ||
          params.input.trim().length < 10
        ) {
          throw new Error('Input must be at least 10 characters for analysis');
        }

        this.logger.debug('RPC: harness:analyze-intent called', {
          inputLength: params.input.length,
          hasWorkspaceContext: !!params.workspaceContext,
        });

        const availableSkills = this.discoverAvailableSkills();
        const availableAgents = this.getAvailableAgents();

        let result: HarnessAnalyzeIntentResponse;
        try {
          result = await this.analyzeIntentViaAgent(
            params.input,
            availableSkills,
            availableAgents,
            params.workspaceContext,
          );
        } catch (llmError) {
          this.logger.warn(
            'LLM-powered intent analysis failed, falling back to heuristic',
            {
              error:
                llmError instanceof Error ? llmError.message : String(llmError),
            },
          );
          result = this.buildAnalyzeIntentFallback(
            params.input,
            availableAgents,
            availableSkills,
          );
        }

        this.logger.debug('RPC: harness:analyze-intent success', {
          personaLabel: result.persona.label,
          agentCount: Object.keys(result.suggestedAgents).length,
          subagentCount: result.suggestedSubagents.length,
          skillSpecCount: result.suggestedSkillSpecs.length,
          mcpCount: result.suggestedMcpServers.length,
        });

        return result;
      } catch (error) {
        this.logger.error(
          'RPC: harness:analyze-intent failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    });
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

    const { emitter: streamEmitter, operationId } =
      this.createStreamEmitter('suggest-config');

    const handle = await this.internalQueryService.execute({
      cwd: workspaceRoot,
      model: 'sonnet',
      prompt,
      systemPromptAppend:
        "You are a configuration advisor. Analyze the user persona and select the best agents, skills, and tools. Be specific and practical in your choices. Use the available ptah.harness tools to enhance your recommendations: searchSkills(query?) to find existing skills relevant to the user's needs, searchMcpRegistry(query, limit?) to search the MCP Registry for relevant servers, listInstalledMcpServers() to check what MCP servers are already installed in the workspace. Actively search for and recommend additional skills and MCP servers beyond what the user explicitly asked for. After using tools, return your structured JSON response.",
      isPremium: true,
      mcpServerRunning: true,
      maxTurns: 6,
      outputFormat: { type: 'json_schema', schema: outputSchema },
      abortController,
    });

    let rawOutput: unknown | null = null;

    try {
      const processor = new SdkStreamProcessor({
        emitter: streamEmitter,
        logger: this.logger,
        serviceTag: '[HarnessSuggest]',
      });
      // Tee the stream so HarnessStreamingService receives harness:flat-stream events
      // and can show real-time execution visualization in the UI.
      const teedStream = this.teeStreamWithFlatEvents(
        handle.stream,
        operationId,
      );
      const result = await processor.process(teedStream);
      rawOutput = result.structuredOutput;
      this.broadcastStreamComplete('suggest-config', operationId, true);
      this.webviewManager.broadcastMessage('harness:flat-stream-complete', {
        operationId,
        success: true,
      });
    } catch (error) {
      this.broadcastStreamComplete(
        'suggest-config',
        operationId,
        false,
        error instanceof Error ? error.message : String(error),
      );
      this.webviewManager.broadcastMessage('harness:flat-stream-complete', {
        operationId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
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
   * Fallback heuristic for intent analysis when the LLM is unavailable.
   *
   * Extracts a basic persona from the input text, enables all available agents
   * by default, and returns empty subagents/skills. Produces a basic system
   * prompt derived from the input so the user has a working starting point.
   */
  private buildAnalyzeIntentFallback(
    input: string,
    availableAgents: AvailableAgent[],
    availableSkills: SkillSummary[],
  ): HarnessAnalyzeIntentResponse {
    // Extract a basic persona from the input
    const firstSentence =
      input
        .split(/[.!?\n]/)
        .find((s) => s.trim().length > 0)
        ?.trim() || input.trim();
    const labelWords = firstSentence.split(/\s+/).slice(0, 4).join(' ');
    const label =
      labelWords.length > 50 ? labelWords.substring(0, 50) + '...' : labelWords;

    // Extract goals from keywords in the input
    const goalKeywords = [
      'build',
      'create',
      'develop',
      'test',
      'deploy',
      'automate',
      'analyze',
      'optimize',
      'monitor',
      'integrate',
      'design',
      'implement',
      'migrate',
      'refactor',
    ];
    const inputLower = input.toLowerCase();
    const goals = goalKeywords
      .filter((kw) => inputLower.includes(kw))
      .map((kw) => `${kw.charAt(0).toUpperCase() + kw.slice(1)} as described`);
    if (goals.length === 0) {
      goals.push('Assist with development tasks');
    }

    // Enable all available agents by default
    const suggestedAgents: Record<string, AgentOverride> = {};
    for (const agent of availableAgents) {
      suggestedAgents[agent.id] = { enabled: true };
    }
    if (Object.keys(suggestedAgents).length === 0) {
      suggestedAgents['ptah-cli'] = { enabled: true };
    }

    const description =
      firstSentence.length > 200
        ? firstSentence.substring(0, 200) + '...'
        : firstSentence;

    const suggestedPrompt = `You are a coding assistant. The user described their needs as: "${description}". Help them accomplish their goals effectively.`;

    return {
      persona: {
        label,
        description,
        goals,
      },
      suggestedAgents,
      suggestedSubagents: [],
      suggestedSkills: availableSkills.map((s) => s.id),
      suggestedSkillSpecs: [],
      suggestedPrompt,
      suggestedMcpServers: [],
      summary: 'Basic configuration generated (AI analysis unavailable)',
      reasoning:
        'AI-powered intent analysis was unavailable. A basic configuration has been generated using heuristics. You can refine each section in the subsequent wizard steps.',
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

        const displayName =
          server.name?.split('/').pop() || server.name || 'Unknown Server';

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

    // Harness Subagent Fleet
    const harnessSubagents = config.agents.harnessSubagents ?? [];
    if (harnessSubagents.length > 0) {
      lines.push('## Harness Subagent Fleet');
      lines.push('');
      for (const sub of harnessSubagents) {
        lines.push(`### ${sub.name}`);
        lines.push('');
        lines.push(sub.description);
        lines.push('');
        lines.push(`- **Role**: ${sub.role}`);
        lines.push(`- **Execution Mode**: ${sub.executionMode}`);
        lines.push(`- **Tools**: ${sub.tools.join(', ')}`);
        if (sub.triggers && sub.triggers.length > 0) {
          lines.push(`- **Triggers**: ${sub.triggers.join(', ')}`);
        }
        lines.push('');
        lines.push(`**Instructions**: ${sub.instructions}`);
        lines.push('');
      }
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
   * Fill in missing fields with safe defaults so partial configs from the
   * conversational builder are applyable without schema violations.
   */
  private normalizeHarnessConfig(
    config: Partial<HarnessConfig> | HarnessConfig,
  ): HarnessConfig {
    const now = new Date().toISOString();
    return {
      name:
        config.name && config.name.trim().length > 0 ? config.name : 'harness',
      persona: config.persona ?? {
        label: '',
        description: '',
        goals: [],
      },
      agents: {
        enabledAgents: config.agents?.enabledAgents ?? {},
        harnessSubagents: config.agents?.harnessSubagents ?? [],
      },
      skills: {
        selectedSkills: config.skills?.selectedSkills ?? [],
        createdSkills: config.skills?.createdSkills ?? [],
      },
      prompt: {
        systemPrompt: config.prompt?.systemPrompt ?? '',
        enhancedSections: config.prompt?.enhancedSections ?? {},
      },
      mcp: {
        servers: config.mcp?.servers ?? [],
        enabledTools: config.mcp?.enabledTools ?? {},
      },
      claudeMd: {
        generateProjectClaudeMd:
          config.claudeMd?.generateProjectClaudeMd ?? true,
        customSections: config.claudeMd?.customSections ?? {},
        previewContent: config.claudeMd?.previewContent ?? '',
      },
      createdAt: config.createdAt ?? now,
      updatedAt: now,
    };
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

  // ─── Intelligent Chat ──────────────────────────────────

  /**
   * Build an intelligent AI-powered chat reply using InternalQueryService.
   *
   * The AI is fully context-aware: it knows the current wizard step,
   * the persona, the configuration state, and can suggest concrete
   * actions (add agents, create skills, etc.) that the frontend
   * can apply with one click.
   */
  private async buildIntelligentChatReply(
    step: HarnessWizardStep,
    message: string,
    context: Partial<HarnessConfig>,
  ): Promise<HarnessChatResponse> {
    const workspaceRoot =
      this.workspaceProvider.getWorkspaceRoot() ?? process.cwd();

    const stepContext = this.buildStepContextSummary(step, context);

    const prompt = `You are an AI harness architect collaborating with a user to build their perfect AI coding assistant configuration. You're helping them in the "${step}" step of a 6-step wizard (Persona → Agents → Skills → Prompts → MCP → Review).

## Current Configuration State
${stepContext}

## User's Message
${message}

## Your Role
You are a collaborative partner, not just an advisor. Based on the current step and their message:

**Persona step**: Help them articulate their role, workflow, and goals. Ask clarifying questions. Suggest goals they might not have considered. If they describe a complex workflow, suggest breaking it into subagent roles.

**Agents step**: Help them design their agent architecture. Go beyond the 4 CLI agents — suggest custom subagent roles with specific responsibilities, tools, and execution modes. Think like the PRD example: "Sentiment Watchdog", "Lead Router", "Market Intelligence Scout".

**Skills step**: Help them design specialized skills. Each skill should be a specific capability — like "podcast-transcript-analyzer", "vibe-mimic-writing", "intent-scorer". Suggest skills that would automate their repetitive workflows.

**Prompts step**: Help refine the system prompt. Include voice/tone guidelines, approval gates, security guardrails, and workflow-specific instructions.

**MCP step**: Recommend MCP servers based on their actual workflow needs. Explain what each server provides and why it's relevant.

**Review step**: Help them evaluate completeness. Identify gaps. Suggest improvements. Offer to generate a comprehensive requirements document.

## Response Format
Return a JSON object with:
- "reply": Your markdown-formatted response (be conversational but specific, include concrete suggestions)
- "suggestedActions": Optional array of actions the user can apply with one click. Each action has:
  - "type": One of "toggle-agent", "add-skill", "update-prompt", "add-mcp-server", "add-subagent", "create-skill"
  - "label": Short button text (e.g., "Add Sentiment Watchdog agent")
  - "payload": Data for the action (agent details, skill content, etc.)

Keep suggestedActions to 2-4 maximum. Only suggest actions that are directly relevant to the user's message.`;

    const outputSchema = {
      type: 'object',
      properties: {
        reply: { type: 'string', description: 'Markdown-formatted response' },
        suggestedActions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              label: { type: 'string' },
              payload: { type: 'object' },
            },
            required: ['type', 'label', 'payload'],
          },
          description: 'Optional clickable actions',
        },
      },
      required: ['reply'],
      additionalProperties: false,
    };

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 30_000);

    const { emitter: chatEmitter, operationId: chatOpId } =
      this.createStreamEmitter('chat');

    const handle = await this.internalQueryService.execute({
      cwd: workspaceRoot,
      model: 'sonnet',
      prompt,
      systemPromptAppend:
        "You are a harness architect. Be specific, practical, and collaborative. Always suggest concrete next steps. Use the available ptah.harness tools to enhance your recommendations: searchSkills(query?) to find existing skills relevant to the user's needs, searchMcpRegistry(query, limit?) to search the MCP Registry for relevant servers, listInstalledMcpServers() to check what MCP servers are already installed in the workspace. Actively search for and recommend relevant skills and MCP servers beyond what the user explicitly asked for. After using tools, return valid JSON matching the schema.",
      isPremium: true,
      mcpServerRunning: true,
      maxTurns: 10,
      outputFormat: { type: 'json_schema', schema: outputSchema },
      abortController,
    });

    try {
      const processor = new SdkStreamProcessor({
        emitter: chatEmitter,
        logger: this.logger,
        serviceTag: '[HarnessChat]',
      });
      // Tee the stream so HarnessStreamingService receives harness:flat-stream events
      // and can show real-time execution visualization in the UI.
      const teedStream = this.teeStreamWithFlatEvents(handle.stream, chatOpId);
      const result = await processor.process(teedStream);
      const output = result.structuredOutput as LlmChatOutput | null;

      if (!output?.reply) {
        this.broadcastStreamComplete('chat', chatOpId, true);
        this.webviewManager.broadcastMessage('harness:flat-stream-complete', {
          operationId: chatOpId,
          success: true,
        });
        return { reply: this.buildChatReplyFallback(step, message) };
      }

      // Validate and filter suggested actions to valid types
      const validTypes = new Set([
        'toggle-agent',
        'add-skill',
        'update-prompt',
        'add-mcp-server',
        'add-subagent',
        'create-skill',
      ]);

      const suggestedActions: HarnessChatAction[] = (
        output.suggestedActions ?? []
      )
        .filter((a) => validTypes.has(a.type))
        .map((a) => ({
          type: a.type as HarnessChatAction['type'],
          label: a.label,
          payload: a.payload ?? {},
        }));

      this.broadcastStreamComplete('chat', chatOpId, true);
      this.webviewManager.broadcastMessage('harness:flat-stream-complete', {
        operationId: chatOpId,
        success: true,
      });
      return {
        reply: output.reply,
        suggestedActions:
          suggestedActions.length > 0 ? suggestedActions : undefined,
      };
    } catch (error) {
      this.broadcastStreamComplete(
        'chat',
        chatOpId,
        false,
        error instanceof Error ? error.message : String(error),
      );
      this.webviewManager.broadcastMessage('harness:flat-stream-complete', {
        operationId: chatOpId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      clearTimeout(timeout);
      handle.close();
    }
  }

  /**
   * Build a summary of the current step's state for AI context.
   */
  private buildStepContextSummary(
    step: HarnessWizardStep,
    context: Partial<HarnessConfig>,
  ): string {
    const parts: string[] = [];

    if (context.persona) {
      parts.push(
        `**Persona**: "${context.persona.label}" — ${context.persona.description}`,
      );
      if (context.persona.goals.length > 0) {
        parts.push(`**Goals**: ${context.persona.goals.join(', ')}`);
      }
    }

    if (context.agents?.enabledAgents) {
      const enabled = Object.entries(context.agents.enabledAgents)
        .filter(([, v]) => v.enabled)
        .map(([k]) => k);
      if (enabled.length > 0) {
        parts.push(`**Enabled Agents**: ${enabled.join(', ')}`);
      }
    }

    if (
      context.agents?.harnessSubagents &&
      context.agents.harnessSubagents.length > 0
    ) {
      const subagents = context.agents.harnessSubagents.map(
        (s) => `${s.name} (${s.executionMode})`,
      );
      parts.push(`**Harness Subagents**: ${subagents.join(', ')}`);
    }

    if (
      context.skills?.selectedSkills &&
      context.skills.selectedSkills.length > 0
    ) {
      parts.push(
        `**Selected Skills**: ${context.skills.selectedSkills.join(', ')}`,
      );
    }

    if (context.prompt?.systemPrompt) {
      parts.push(
        `**System Prompt**: ${context.prompt.systemPrompt.slice(0, 200)}...`,
      );
    }

    if (context.mcp?.servers && context.mcp.servers.length > 0) {
      const servers = context.mcp.servers
        .filter((s) => s.enabled)
        .map((s) => s.name);
      parts.push(`**MCP Servers**: ${servers.join(', ')}`);
    }

    parts.push(`**Current Step**: ${step}`);

    return parts.length > 0 ? parts.join('\n') : '(No configuration yet)';
  }

  /**
   * Fallback chat reply when the LLM is unavailable.
   */
  private buildChatReplyFallback(
    step: HarnessWizardStep,
    _message: string,
  ): string {
    const stepGuidance: Record<HarnessWizardStep, string> = {
      persona:
        "Describe your role, workflow, and goals. I'll help you design a custom agent fleet with specialized subagents, skills, and tools tailored to your work. The more detail you provide, the better the harness I can help you build.",
      agents:
        'Beyond the CLI agents, I can help you design **custom subagents** — specialized agents with distinct roles, tools, and trigger conditions. Click "Design Agent Fleet" to have AI architect your subagent team, or describe the kind of agents you need.',
      skills:
        'I can help you create **specialized skills** — markdown instruction sets that give your agents domain expertise. Click "Generate Skills" to have AI design skills for your workflow, or describe what capabilities you need.',
      prompts:
        'I can help refine your system prompt with voice/tone guidelines, approval gates, security guardrails, and workflow-specific instructions. Describe how you want your agents to behave.',
      mcp: 'I can help you find and configure MCP servers that match your workflow. Describe the tools and integrations you need.',
      review:
        'Your configuration is ready for review. I can generate a comprehensive requirements document from your harness. Click "Generate Document" to produce a full PRD.',
    };

    return stepGuidance[step] ?? 'How can I help you build your harness?';
  }

  // ─── Subagent Fleet Design (Implementation) ───────────

  /**
   * Design a custom subagent fleet using the LLM.
   *
   * The AI analyzes the persona and designs specialized subagents,
   * each with a distinct role, toolset, execution mode, and triggers.
   */
  private async designSubagentFleet(
    persona: HarnessDesignAgentsParams['persona'],
    existingAgents: string[],
    workspaceContext?: HarnessDesignAgentsParams['workspaceContext'],
  ): Promise<HarnessDesignAgentsResponse> {
    const workspaceRoot =
      this.workspaceProvider.getWorkspaceRoot() ?? process.cwd();

    const contextInfo = workspaceContext
      ? `\n## Workspace Context\n- Project: ${workspaceContext.projectName}\n- Type: ${workspaceContext.projectType}\n- Frameworks: ${workspaceContext.frameworks.join(', ') || 'none detected'}\n- Languages: ${workspaceContext.languages.join(', ') || 'none detected'}`
      : '';

    const prompt = `You are designing a custom subagent fleet for an AI coding harness. Each subagent is a specialized worker with a distinct role in the user's workflow.

## User Persona
**Name**: ${persona.label}
**Description**: ${persona.description}
**Goals**: ${persona.goals.length > 0 ? persona.goals.join(', ') : 'General development assistance'}
${contextInfo}

## Existing CLI Agents Already Enabled
${existingAgents.length > 0 ? existingAgents.join(', ') : '(none)'}

## Your Task
Design 2-5 custom subagents that would transform this user's workflow. Each subagent should be:

1. **Specialized** — one clear responsibility, not a generalist
2. **Actionable** — has specific tools and triggers
3. **Complementary** — works with other subagents, not redundant

Think creatively based on the persona. Examples of great subagent designs:
- "Sentiment Watchdog" — monitors social media comments, categorizes by sentiment
- "Code Quality Guardian" — runs on every commit, flags regressions
- "Documentation Sync Agent" — detects code changes, updates docs automatically
- "Dependency Scout" — monitors package updates, flags security advisories
- "Performance Monitor" — tracks build times, bundle sizes, lighthouse scores

For each subagent, specify:
- **id**: kebab-case identifier
- **name**: Human-readable name
- **description**: What it does (1-2 sentences)
- **role**: The specialized persona prompt for this subagent
- **tools**: Array of tool names it needs (e.g., "web-search", "file-read", "git-log", "browser", "code-execute")
- **executionMode**: "background" (always running), "on-demand" (user-triggered), or "scheduled" (periodic)
- **triggers**: When this agent activates (e.g., "on-commit", "every-4-hours", "on-user-request")
- **instructions**: Detailed behavior instructions (3-5 sentences)

Return ONLY the JSON object matching the schema.`;

    const outputSchema = {
      type: 'object',
      properties: {
        subagents: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              description: { type: 'string' },
              role: { type: 'string' },
              tools: { type: 'array', items: { type: 'string' } },
              executionMode: {
                type: 'string',
                enum: ['background', 'on-demand', 'scheduled'],
              },
              triggers: { type: 'array', items: { type: 'string' } },
              instructions: { type: 'string' },
            },
            required: [
              'id',
              'name',
              'description',
              'role',
              'tools',
              'executionMode',
              'instructions',
            ],
          },
        },
        reasoning: { type: 'string' },
      },
      required: ['subagents', 'reasoning'],
      additionalProperties: false,
    };

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 45_000);

    const { emitter: agentsEmitter, operationId: agentsOpId } =
      this.createStreamEmitter('design-agents');

    const handle = await this.internalQueryService.execute({
      cwd: workspaceRoot,
      model: 'sonnet',
      prompt,
      systemPromptAppend:
        "You are a subagent fleet architect. Design creative, practical subagents that automate the user's most valuable workflows. Be specific about tools and triggers. Use the available ptah.harness tools to enhance your recommendations: searchSkills(query?) to find existing skills relevant to the user's needs, searchMcpRegistry(query, limit?) to search the MCP Registry for relevant servers, listInstalledMcpServers() to check what MCP servers are already installed in the workspace. Actively search for and recommend additional skills and MCP servers beyond what the user explicitly asked for. After using tools, return your structured JSON response.",
      isPremium: true,
      mcpServerRunning: true,
      maxTurns: 6,
      outputFormat: { type: 'json_schema', schema: outputSchema },
      abortController,
    });

    try {
      const processor = new SdkStreamProcessor({
        emitter: agentsEmitter,
        logger: this.logger,
        serviceTag: '[HarnessDesignAgents]',
      });
      // Tee the stream so HarnessStreamingService receives harness:flat-stream events
      // and can show real-time execution visualization in the UI.
      const teedStream = this.teeStreamWithFlatEvents(
        handle.stream,
        agentsOpId,
      );
      const result = await processor.process(teedStream);
      const output = result.structuredOutput as LlmSubagentDesignOutput | null;

      if (!output?.subagents || !Array.isArray(output.subagents)) {
        throw new Error('LLM did not return valid subagent designs');
      }

      // Validate and sanitize each subagent
      const subagents: HarnessSubagentDefinition[] = output.subagents
        .filter((s) => s.id && s.name && s.description)
        .map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          role: s.role || s.description,
          tools: Array.isArray(s.tools) ? s.tools : [],
          executionMode: (['background', 'on-demand', 'scheduled'].includes(
            s.executionMode,
          )
            ? s.executionMode
            : 'on-demand') as HarnessSubagentDefinition['executionMode'],
          triggers: Array.isArray(s.triggers) ? s.triggers : undefined,
          instructions: s.instructions || '',
        }));

      this.broadcastStreamComplete('design-agents', agentsOpId, true);
      this.webviewManager.broadcastMessage('harness:flat-stream-complete', {
        operationId: agentsOpId,
        success: true,
      });
      return {
        subagents,
        reasoning:
          output.reasoning ||
          'Subagent fleet designed based on persona analysis.',
      };
    } catch (error) {
      this.broadcastStreamComplete(
        'design-agents',
        agentsOpId,
        false,
        error instanceof Error ? error.message : String(error),
      );
      this.webviewManager.broadcastMessage('harness:flat-stream-complete', {
        operationId: agentsOpId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      clearTimeout(timeout);
      handle.close();
    }
  }

  // ─── Skill Generation (Implementation) ────────────────

  /**
   * Generate specialized skill specifications using the LLM.
   *
   * Creates complete SKILL.md content tailored to the persona's workflow.
   * If custom subagents are provided, skills are designed to support them.
   */
  private async generateSkillSpecs(
    persona: HarnessGenerateSkillsParams['persona'],
    existingSkills: string[],
    harnessSubagents?: HarnessSubagentDefinition[],
  ): Promise<HarnessGenerateSkillsResponse> {
    const workspaceRoot =
      this.workspaceProvider.getWorkspaceRoot() ?? process.cwd();

    const subagentContext =
      harnessSubagents && harnessSubagents.length > 0
        ? `\n## Harness Subagent Fleet\nThese subagents are designed for this persona — create skills that support their workflows:\n${harnessSubagents.map((s) => `- **${s.name}** (${s.executionMode}): ${s.description}`).join('\n')}`
        : '';

    const prompt = `You are creating specialized skill files for an AI coding harness. Skills are markdown instruction sets that give agents domain expertise.

## User Persona
**Name**: ${persona.label}
**Description**: ${persona.description}
**Goals**: ${persona.goals.length > 0 ? persona.goals.join(', ') : 'General development assistance'}
${subagentContext}

## Already Available Skills
${existingSkills.length > 0 ? existingSkills.join(', ') : '(none)'}

## Your Task
Design 2-4 specialized skills that would be most valuable for this persona. Each skill should:

1. **Solve a specific workflow problem** — not generic, but targeted
2. **Include complete instructions** — the full markdown content for SKILL.md
3. **Be actionable** — give the AI clear steps, constraints, and output formats

For each skill, provide:
- **name**: Skill name (kebab-case, e.g., "podcast-transcript-analyzer")
- **description**: What this skill does (1 sentence)
- **content**: Complete SKILL.md markdown content including:
  - A clear title and description
  - Step-by-step instructions for the AI
  - Input/output format specifications
  - Constraints and guardrails
  - Example usage scenarios
- **requiredTools**: Tools this skill needs (e.g., ["web-search", "file-read"])
- **reasoning**: Why this skill is valuable for this persona (1-2 sentences)

Return ONLY the JSON object matching the schema.`;

    const outputSchema = {
      type: 'object',
      properties: {
        skills: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              content: { type: 'string' },
              requiredTools: { type: 'array', items: { type: 'string' } },
              reasoning: { type: 'string' },
            },
            required: ['name', 'description', 'content', 'reasoning'],
          },
        },
        reasoning: { type: 'string' },
      },
      required: ['skills', 'reasoning'],
      additionalProperties: false,
    };

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 45_000);

    const { emitter: skillsEmitter, operationId: skillsOpId } =
      this.createStreamEmitter('generate-skills');

    const handle = await this.internalQueryService.execute({
      cwd: workspaceRoot,
      model: 'sonnet',
      prompt,
      systemPromptAppend:
        "You are a skill designer. Create practical, detailed skills that automate high-value workflows. Include complete SKILL.md content — not stubs. Use the available ptah.harness tools to enhance your recommendations: searchSkills(query?) to find existing skills relevant to the user's needs, searchMcpRegistry(query, limit?) to search the MCP Registry for relevant servers, listInstalledMcpServers() to check what MCP servers are already installed in the workspace. Actively search for and recommend additional skills and MCP servers beyond what the user explicitly asked for. After using tools, return your structured JSON response.",
      isPremium: true,
      mcpServerRunning: true,
      maxTurns: 6,
      outputFormat: { type: 'json_schema', schema: outputSchema },
      abortController,
    });

    try {
      const processor = new SdkStreamProcessor({
        emitter: skillsEmitter,
        logger: this.logger,
        serviceTag: '[HarnessGenerateSkills]',
      });
      // Tee the stream so HarnessStreamingService receives harness:flat-stream events
      // and can show real-time execution visualization in the UI.
      const teedStream = this.teeStreamWithFlatEvents(
        handle.stream,
        skillsOpId,
      );
      const result = await processor.process(teedStream);
      const output = result.structuredOutput as LlmSkillGenerationOutput | null;

      if (!output?.skills || !Array.isArray(output.skills)) {
        throw new Error('LLM did not return valid skill specifications');
      }

      const skills: GeneratedSkillSpec[] = output.skills
        .filter((s) => s.name && s.description && s.content)
        .map((s) => ({
          name: s.name,
          description: s.description,
          content: s.content,
          requiredTools: Array.isArray(s.requiredTools)
            ? s.requiredTools
            : undefined,
          reasoning: s.reasoning || 'Designed for persona workflow.',
        }));

      this.broadcastStreamComplete('generate-skills', skillsOpId, true);
      this.webviewManager.broadcastMessage('harness:flat-stream-complete', {
        operationId: skillsOpId,
        success: true,
      });
      return {
        skills,
        reasoning:
          output.reasoning || 'Skills designed based on persona analysis.',
      };
    } catch (error) {
      this.broadcastStreamComplete(
        'generate-skills',
        skillsOpId,
        false,
        error instanceof Error ? error.message : String(error),
      );
      this.webviewManager.broadcastMessage('harness:flat-stream-complete', {
        operationId: skillsOpId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      clearTimeout(timeout);
      handle.close();
    }
  }

  // ─── Document Generation (Implementation) ─────────────

  /**
   * Generate a comprehensive PRD/requirements document from the harness config.
   *
   * Uses the LLM to produce a professional-grade document that covers:
   * persona profile, subagent architecture, skill library, security
   * guardrails, MCP topology, and implementation roadmap.
   */
  private async generateComprehensiveDocument(
    config: HarnessConfig,
    workspaceContext?: HarnessGenerateDocumentParams['workspaceContext'],
  ): Promise<HarnessGenerateDocumentResponse> {
    const workspaceRoot =
      this.workspaceProvider.getWorkspaceRoot() ?? process.cwd();

    // Build a detailed config summary for the LLM
    const enabledAgents = Object.entries(config.agents.enabledAgents)
      .filter(([, v]) => v.enabled)
      .map(
        ([k, v]) =>
          `${k} (tier: ${v.modelTier ?? 'default'}, auto-approve: ${v.autoApprove ?? false})`,
      );

    const harnessSubagents = config.agents.harnessSubagents ?? [];
    const subagentSummary =
      harnessSubagents.length > 0
        ? harnessSubagents
            .map(
              (s) =>
                `- **${s.name}** (${s.executionMode}): ${s.description}\n  Tools: ${s.tools.join(', ')}\n  Triggers: ${s.triggers?.join(', ') ?? 'on-demand'}\n  Instructions: ${s.instructions}`,
            )
            .join('\n')
        : '(none designed)';

    const enabledServers = config.mcp.servers.filter((s) => s.enabled);
    const contextInfo = workspaceContext
      ? `Project: ${workspaceContext.projectName} (${workspaceContext.projectType}), Frameworks: ${workspaceContext.frameworks.join(', ')}, Languages: ${workspaceContext.languages.join(', ')}`
      : 'No workspace context';

    const prompt = `Generate a comprehensive Product Requirements Document (PRD) for an AI harness configuration. This document should be professional-grade and cover every aspect of the harness architecture.

## Harness Configuration Data

**Name**: ${config.name}
**Workspace**: ${contextInfo}

### Persona
- **Label**: ${config.persona.label}
- **Description**: ${config.persona.description}
- **Goals**: ${config.persona.goals.join(', ') || '(none)'}

### CLI Agents
${enabledAgents.length > 0 ? enabledAgents.join('\n') : '(none enabled)'}

### Custom Subagent Fleet
${subagentSummary}

### Skills
- **Selected**: ${config.skills.selectedSkills.join(', ') || '(none)'}
- **Created**: ${config.skills.createdSkills.map((s) => s.name).join(', ') || '(none)'}

### System Prompt
${config.prompt.systemPrompt || '(not configured)'}

### MCP Servers
${enabledServers.map((s) => `- ${s.name}: ${s.description ?? s.url}`).join('\n') || '(none)'}

## Document Requirements

Generate a comprehensive PRD with these sections:

1. **Objective** — 2-3 sentence summary of what this harness achieves
2. **Target User Profile** — Detailed persona analysis with platform/workflow strategy
3. **Core Harness Architecture** — How the components work together (memory, skills, agents)
4. **The Subagent Fleet** — Detailed description of each subagent's role, responsibilities, and interactions
5. **Specialized Skill Library** — Each skill with its purpose and how it fits the workflow
6. **Security & Human-in-the-Loop Guardrails** — Approval gates, runtime gatekeepers, deny-and-continue patterns, adversarial input protection
7. **MCP Server Topology** — What each server provides and how they integrate
8. **Implementation Roadmap** — Phased rollout with priorities

Write in a professional but engaging tone. Use markdown formatting with headers, bullet points, and bold emphasis. Make it feel like a real product document, not a config dump.`;

    const docOutputSchema = {
      type: 'object',
      properties: {
        document: {
          type: 'string',
          description: 'The complete markdown PRD document',
        },
      },
      required: ['document'],
      additionalProperties: false,
    };

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 60_000);

    const { emitter: docEmitter, operationId: docOpId } =
      this.createStreamEmitter('generate-document');

    const handle = await this.internalQueryService.execute({
      cwd: workspaceRoot,
      model: 'sonnet',
      prompt:
        prompt +
        '\n\nReturn a JSON object with a single "document" field containing the full markdown PRD as a string.',
      systemPromptAppend:
        'You are a technical product manager writing a PRD. Be thorough, specific, and professional. The document should be 800-1500 words. Use the available ptah.harness tools to enhance your document: searchSkills(query?) to find existing skills relevant to the project, searchMcpRegistry(query, limit?) to search the MCP Registry for relevant servers, listInstalledMcpServers() to check what MCP servers are already installed. After using tools, return valid JSON with the markdown document.',
      isPremium: true,
      mcpServerRunning: true,
      maxTurns: 6,
      outputFormat: { type: 'json_schema', schema: docOutputSchema },
      abortController,
    });

    try {
      const processor = new SdkStreamProcessor({
        emitter: docEmitter,
        logger: this.logger,
        serviceTag: '[HarnessGenerateDoc]',
      });
      // Tee the stream so HarnessStreamingService receives harness:flat-stream events
      // and can show real-time execution visualization in the UI.
      const teedStream = this.teeStreamWithFlatEvents(handle.stream, docOpId);
      const result = await processor.process(teedStream);
      const output = result.structuredOutput as { document: string } | null;

      const document = output?.document || this.buildFallbackDocument(config);

      // Parse sections from the document for structured access
      const sections = this.parseSectionsFromDocument(document);

      this.broadcastStreamComplete('generate-document', docOpId, true);
      this.webviewManager.broadcastMessage('harness:flat-stream-complete', {
        operationId: docOpId,
        success: true,
      });
      return { document, sections };
    } catch (error) {
      this.broadcastStreamComplete(
        'generate-document',
        docOpId,
        false,
        error instanceof Error ? error.message : String(error),
      );
      this.webviewManager.broadcastMessage('harness:flat-stream-complete', {
        operationId: docOpId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      clearTimeout(timeout);
      handle.close();
    }
  }

  /**
   * Parse section headers from a markdown document into a record.
   */
  private parseSectionsFromDocument(document: string): Record<string, string> {
    const sections: Record<string, string> = {};
    const lines = document.split('\n');
    let currentSection = 'header';
    let currentContent: string[] = [];

    for (const line of lines) {
      const headerMatch = /^#{1,3}\s+(?:\d+\.\s+)?(.+)$/.exec(line);
      if (headerMatch) {
        if (currentContent.length > 0) {
          sections[currentSection] = currentContent.join('\n').trim();
        }
        currentSection = headerMatch[1]
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        currentContent = [];
      } else {
        currentContent.push(line);
      }
    }

    if (currentContent.length > 0) {
      sections[currentSection] = currentContent.join('\n').trim();
    }

    return sections;
  }

  /**
   * Fallback document when LLM is unavailable.
   */
  private buildFallbackDocument(config: HarnessConfig): string {
    const lines: string[] = [];
    lines.push(`# ${config.name} — Harness Requirements Document`);
    lines.push('');
    lines.push(
      `> Generated by Ptah Harness Builder on ${new Date().toISOString().split('T')[0]}`,
    );
    lines.push('');
    lines.push('## 1. Objective');
    lines.push('');
    lines.push(
      `This harness configures an AI coding assistant for the "${config.persona.label}" persona.`,
    );
    lines.push('');
    lines.push('## 2. Persona');
    lines.push('');
    lines.push(config.persona.description || '(No description provided)');
    lines.push('');

    if (config.persona.goals.length > 0) {
      lines.push('### Goals');
      for (const goal of config.persona.goals) {
        lines.push(`- ${goal}`);
      }
      lines.push('');
    }

    const enabledAgentIds = Object.entries(config.agents.enabledAgents)
      .filter(([, v]) => v.enabled)
      .map(([k]) => k);
    if (enabledAgentIds.length > 0) {
      lines.push('## 3. Agents');
      lines.push('');
      for (const id of enabledAgentIds) {
        lines.push(`- **${id}**`);
      }
      lines.push('');
    }

    const harnessSubagents = config.agents.harnessSubagents ?? [];
    if (harnessSubagents.length > 0) {
      lines.push('## 4. Harness Subagent Fleet');
      lines.push('');
      for (const sub of harnessSubagents) {
        lines.push(`### ${sub.name}`);
        lines.push(`- **Role**: ${sub.role}`);
        lines.push(`- **Mode**: ${sub.executionMode}`);
        lines.push(`- **Tools**: ${sub.tools.join(', ')}`);
        lines.push(`- **Description**: ${sub.description}`);
        lines.push('');
      }
    }

    if (
      config.skills.selectedSkills.length > 0 ||
      config.skills.createdSkills.length > 0
    ) {
      lines.push('## 5. Skills');
      lines.push('');
      for (const skill of config.skills.selectedSkills) {
        lines.push(`- ${skill}`);
      }
      for (const skill of config.skills.createdSkills) {
        lines.push(`- ${skill.name}: ${skill.description}`);
      }
      lines.push('');
    }

    if (config.prompt.systemPrompt) {
      lines.push('## 6. System Prompt');
      lines.push('');
      lines.push(config.prompt.systemPrompt);
      lines.push('');
    }

    lines.push('## 7. Security & Guardrails');
    lines.push('');
    lines.push('- Approval gates for state-changing actions');
    lines.push('- Runtime permission checks before tool execution');
    lines.push('- Deny-and-continue fallback pattern');
    lines.push('- Adversarial input protection for external data');
    lines.push('');

    return lines.join('\n');
  }

  // ─── Intent Analysis (Implementation) ──────────────────

  /**
   * LLM-powered intent analysis engine.
   *
   * Takes freeform user input (PRD, instruction, description) and generates
   * a complete harness blueprint via a single LLM call with structured output.
   * The AI figures out the persona, subagent fleet, skill specs, system prompt,
   * and MCP server recommendations — all from the raw input.
   */
  private async analyzeIntentViaAgent(
    input: string,
    availableSkills: SkillSummary[],
    availableAgents: AvailableAgent[],
    workspaceContext?: HarnessAnalyzeIntentParams['workspaceContext'],
  ): Promise<HarnessAnalyzeIntentResponse> {
    const workspaceRoot =
      this.workspaceProvider.getWorkspaceRoot() ?? process.cwd();

    // Build catalogs for the prompt
    const agentList = availableAgents
      .map(
        (a) =>
          `- id: "${a.id}" | name: "${a.name}" | type: ${a.type} | description: ${a.description}`,
      )
      .join('\n');

    const skillList = availableSkills
      .slice(0, 50)
      .map(
        (s) =>
          `- id: "${s.id}" | name: "${s.name}" | description: ${s.description}`,
      )
      .join('\n');

    const contextInfo = workspaceContext
      ? `\n## Workspace Context\n- Project: ${workspaceContext.projectName}\n- Type: ${workspaceContext.projectType}\n- Frameworks: ${workspaceContext.frameworks.join(', ') || 'none detected'}\n- Languages: ${workspaceContext.languages.join(', ') || 'none detected'}`
      : '';

    const prompt = `You are an AI harness architect. The user has provided freeform input describing what they want to build. Your job is to analyze this input — whether it's a PRD document, a simple instruction, or a detailed description — and architect a COMPLETE harness configuration.

## User Input
${input}
${contextInfo}

## Available CLI Agents
${agentList}

## Available Skills
${skillList || '(no skills available)'}

## Your Task
Analyze the user's input and generate a comprehensive harness blueprint. You must figure out:

1. **persona**: The user's role/persona derived from their input
   - **label**: Short role name (e.g., "Real Estate Marketing Lead", "Full-Stack Developer")
   - **description**: Detailed description of the persona and workflow (2-4 sentences)
   - **goals**: Array of 3-6 specific goals extracted from the input

2. **selectedAgentIds**: Which CLI agents to enable from the available list

3. **subagents**: Design 2-5 custom subagents tailored to the input. Each subagent should be:
   - Specialized with one clear responsibility
   - Have specific tools and triggers
   - Complement other subagents in the fleet
   Include: id (kebab-case), name, description, role, tools[], executionMode (background/on-demand/scheduled), triggers[], instructions

4. **selectedSkillIds**: Which existing skills to activate (from the available list)

5. **skillSpecs**: Design 1-3 NEW skills that don't exist yet. Each needs:
   - name (kebab-case), description, content (complete SKILL.md markdown), requiredTools[], reasoning

6. **systemPrompt**: A comprehensive system prompt (4-8 sentences) tailored to the user's needs

7. **mcpSearchTerms**: Array of 3-6 technology keywords for MCP server discovery (concrete tech names like "github", "postgresql", "slack")

8. **summary**: A 1-2 sentence summary of what you understood from the input and what you've architected

9. **reasoning**: Detailed explanation (3-5 sentences) of your design decisions

Be creative and thorough. If the input is a PRD, extract everything. If it's a simple instruction, infer intelligently. Return ONLY the JSON object matching the schema.`;

    const outputSchema = {
      type: 'object',
      properties: {
        persona: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            description: { type: 'string' },
            goals: { type: 'array', items: { type: 'string' } },
          },
          required: ['label', 'description', 'goals'],
        },
        selectedAgentIds: {
          type: 'array',
          items: { type: 'string' },
        },
        subagents: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              description: { type: 'string' },
              role: { type: 'string' },
              tools: { type: 'array', items: { type: 'string' } },
              executionMode: {
                type: 'string',
                enum: ['background', 'on-demand', 'scheduled'],
              },
              triggers: { type: 'array', items: { type: 'string' } },
              instructions: { type: 'string' },
            },
            required: [
              'id',
              'name',
              'description',
              'role',
              'tools',
              'executionMode',
              'instructions',
            ],
          },
        },
        selectedSkillIds: {
          type: 'array',
          items: { type: 'string' },
        },
        skillSpecs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              content: { type: 'string' },
              requiredTools: { type: 'array', items: { type: 'string' } },
              reasoning: { type: 'string' },
            },
            required: ['name', 'description', 'content', 'reasoning'],
          },
        },
        systemPrompt: { type: 'string' },
        mcpSearchTerms: {
          type: 'array',
          items: { type: 'string' },
        },
        summary: { type: 'string' },
        reasoning: { type: 'string' },
      },
      required: [
        'persona',
        'selectedAgentIds',
        'subagents',
        'selectedSkillIds',
        'skillSpecs',
        'systemPrompt',
        'mcpSearchTerms',
        'summary',
        'reasoning',
      ],
      additionalProperties: false,
    };

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 150_000);

    const { emitter: intentEmitter, operationId: intentOpId } =
      this.createStreamEmitter('analyze-intent');

    const handle = await this.internalQueryService.execute({
      cwd: workspaceRoot,
      model: 'sonnet',
      prompt,
      systemPromptAppend:
        "You are a harness architect. Analyze the user's freeform input and design a complete AI coding harness. Be creative but practical. Extract maximum value from whatever input format the user provides — PRD, instruction, or description. Use the available ptah.harness tools to enhance your recommendations: searchSkills(query?) to find existing skills relevant to the user's needs, searchMcpRegistry(query, limit?) to search the MCP Registry for relevant servers, listInstalledMcpServers() to check what MCP servers are already installed in the workspace, createSkill(name, description, content, allowedTools?) to create custom skills. Actively search for and recommend additional skills and MCP servers beyond what the user explicitly asked for. After using tools, return your structured JSON response.",
      isPremium: true,
      mcpServerRunning: true,
      maxTurns: 10,
      outputFormat: { type: 'json_schema', schema: outputSchema },
      abortController,
    });

    try {
      const processor = new SdkStreamProcessor({
        emitter: intentEmitter,
        logger: this.logger,
        serviceTag: '[HarnessAnalyzeIntent]',
      });

      // Tee the stream: broadcast FlatStreamEventUnion events for inline
      // execution visualization while feeding SDKMessages to SdkStreamProcessor
      const teedStream = this.teeStreamWithFlatEvents(
        handle.stream,
        intentOpId,
      );
      const result = await processor.process(teedStream);
      const output = result.structuredOutput as LlmIntentAnalysisOutput | null;

      if (!output?.persona || !output?.systemPrompt) {
        throw new Error('LLM did not return a valid intent analysis');
      }

      // Validate and map agent IDs
      const validAgentIds = new Set(availableAgents.map((a) => a.id));
      const suggestedAgents: Record<string, AgentOverride> = {};
      for (const agentId of output.selectedAgentIds ?? []) {
        if (validAgentIds.has(agentId)) {
          suggestedAgents[agentId] = { enabled: true };
        }
      }
      if (Object.keys(suggestedAgents).length === 0) {
        suggestedAgents['ptah-cli'] = { enabled: true };
      }

      // Validate and map subagents
      const suggestedSubagents: HarnessSubagentDefinition[] = (
        output.subagents ?? []
      )
        .filter((s) => s.id && s.name && s.description)
        .map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          role: s.role || s.description,
          tools: Array.isArray(s.tools) ? s.tools : [],
          executionMode: (['background', 'on-demand', 'scheduled'].includes(
            s.executionMode,
          )
            ? s.executionMode
            : 'on-demand') as HarnessSubagentDefinition['executionMode'],
          triggers: Array.isArray(s.triggers) ? s.triggers : undefined,
          instructions: s.instructions || '',
        }));

      // Validate skill IDs
      const validSkillIds = new Set(availableSkills.map((s) => s.id));
      const suggestedSkills = (output.selectedSkillIds ?? []).filter((id) =>
        validSkillIds.has(id),
      );

      // Validate skill specs
      const suggestedSkillSpecs: GeneratedSkillSpec[] = (
        output.skillSpecs ?? []
      )
        .filter((s) => s.name && s.content)
        .map((s) => ({
          name: s.name,
          description: s.description || '',
          content: s.content,
          requiredTools: Array.isArray(s.requiredTools)
            ? s.requiredTools
            : undefined,
          reasoning: s.reasoning || '',
        }));

      // Search MCP Registry using AI-selected keywords
      let suggestedMcpServers: McpServerSuggestion[] = [];
      try {
        suggestedMcpServers = await this.suggestMcpServersFromRegistry(
          output.mcpSearchTerms ?? [],
        );
      } catch (mcpError) {
        this.logger.warn(
          'MCP registry search failed during intent analysis, continuing without MCP suggestions',
          {
            error:
              mcpError instanceof Error ? mcpError.message : String(mcpError),
          },
        );
      }

      this.broadcastStreamComplete('analyze-intent', intentOpId, true);
      this.webviewManager.broadcastMessage('harness:flat-stream-complete', {
        operationId: intentOpId,
        success: true,
      });
      return {
        persona: {
          label: output.persona.label || 'Custom Persona',
          description: output.persona.description || '',
          goals: Array.isArray(output.persona.goals)
            ? output.persona.goals
            : [],
        },
        suggestedAgents,
        suggestedSubagents,
        suggestedSkills,
        suggestedSkillSpecs,
        suggestedPrompt: output.systemPrompt,
        suggestedMcpServers,
        summary:
          output.summary || 'Harness configuration generated from your input.',
        reasoning: output.reasoning || '',
      };
    } catch (error) {
      this.broadcastStreamComplete(
        'analyze-intent',
        intentOpId,
        false,
        error instanceof Error ? error.message : String(error),
      );
      this.webviewManager.broadcastMessage('harness:flat-stream-complete', {
        operationId: intentOpId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      clearTimeout(timeout);
      handle.close();
    }
  }

  // ─── Conversational Harness ─────────────────────────────

  private registerConverse(): void {
    this.rpcHandler.registerMethod<
      HarnessConverseParams,
      HarnessConverseResponse
    >('harness:converse', async (params) => {
      try {
        this.logger.debug('RPC: harness:converse called');

        const { message, history, config, workspaceContext } = params;

        const workspaceRoot =
          this.workspaceProvider.getWorkspaceRoot() ?? process.cwd();

        const availableAgents = this.getAvailableAgents();
        const availableSkills = this.discoverAvailableSkills();

        const agentList = availableAgents
          .map(
            (a) =>
              `- ${a.id}: ${a.name} (${a.type}, ${a.available ? 'available' : 'unavailable'})`,
          )
          .join('\n');

        const skillList = availableSkills
          .map((s) => `- ${s.id}: ${s.name} — ${s.description}`)
          .join('\n');

        const contextBlock = workspaceContext
          ? `Project: ${workspaceContext.projectName} (${workspaceContext.projectType})\nFrameworks: ${workspaceContext.frameworks.join(', ')}\nLanguages: ${workspaceContext.languages.join(', ')}`
          : 'No workspace context available.';

        const historyBlock =
          history.length > 0
            ? history
                .map(
                  (m) =>
                    `**${m.role === 'user' ? 'User' : 'Assistant'}**: ${m.content}`,
                )
                .join('\n\n')
            : '(No prior messages — this is the start of the conversation.)';

        const prompt = `You are a harness architect having a conversation with a user to build their AI coding assistant configuration.

## Conversation History
${historyBlock}

## Current Configuration
\`\`\`json
${JSON.stringify(config, null, 2)}
\`\`\`

## Available Agents
${agentList}

## Available Skills
${skillList}

## Workspace
${contextBlock}

## User's Message
${message}

## Instructions
Respond conversationally. Ask clarifying questions when the user's intent is unclear.
When you understand what the user needs, include configUpdates with the changes.
configUpdates is a partial HarnessConfig — only include fields you want to change.
Set isConfigComplete to true when you believe the configuration is ready to apply.
Be proactive: suggest agents, skills, subagents, system prompts, and MCP servers.
If this is the first message, analyze the user's intent and propose a complete initial configuration.`;

        const outputSchema = {
          type: 'object' as const,
          properties: {
            reply: {
              type: 'string',
              description: 'Conversational reply to the user',
            },
            configUpdates: {
              type: 'object',
              description: 'Partial HarnessConfig updates to merge',
              properties: {
                persona: {
                  type: 'object',
                  properties: {
                    label: { type: 'string' },
                    description: { type: 'string' },
                    goals: { type: 'array', items: { type: 'string' } },
                  },
                },
                agents: {
                  type: 'object',
                  properties: {
                    enabledAgents: { type: 'object' },
                    harnessSubagents: { type: 'array' },
                  },
                },
                skills: {
                  type: 'object',
                  properties: {
                    selectedSkills: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                    createdSkills: { type: 'array' },
                  },
                },
                prompt: {
                  type: 'object',
                  properties: {
                    systemPrompt: { type: 'string' },
                    enhancedSections: { type: 'object' },
                  },
                },
                mcp: {
                  type: 'object',
                  properties: {
                    servers: { type: 'array' },
                    enabledTools: { type: 'object' },
                  },
                },
              },
            },
            isConfigComplete: { type: 'boolean' },
          },
          required: ['reply'],
          additionalProperties: false,
        };

        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), 300_000);

        const { emitter: converseEmitter, operationId: converseOpId } =
          this.createStreamEmitter('converse');

        const handle = await this.internalQueryService.execute({
          cwd: workspaceRoot,
          model: 'sonnet',
          prompt,
          systemPromptAppend:
            "You are a harness architect. Be conversational, specific, and proactive. Propose complete configurations when you have enough context. Ask clarifying questions when you need more information. Use the available ptah.harness tools to enhance your recommendations: searchSkills(query?) to find existing skills relevant to the user's needs, searchMcpRegistry(query, limit?) to search the MCP Registry for relevant servers, listInstalledMcpServers() to check what MCP servers are already installed in the workspace, createSkill(name, description, content, allowedTools?) to create custom skills. Actively search for and recommend additional skills and MCP servers beyond what the user explicitly asked for. After using tools, return your structured JSON response.",
          isPremium: true,
          mcpServerRunning: true,
          maxTurns: 8,
          outputFormat: { type: 'json_schema', schema: outputSchema },
          abortController,
        });

        try {
          const processor = new SdkStreamProcessor({
            emitter: converseEmitter,
            logger: this.logger,
            serviceTag: '[HarnessConverse]',
          });

          // Tee the stream: broadcast FlatStreamEventUnion events for inline
          // execution visualization while feeding SDKMessages to SdkStreamProcessor
          const teedStream = this.teeStreamWithFlatEvents(
            handle.stream,
            converseOpId,
          );
          const result = await processor.process(teedStream);
          const output = result.structuredOutput as LlmConverseOutput | null;

          this.broadcastStreamComplete('converse', converseOpId, true);
          this.webviewManager.broadcastMessage('harness:flat-stream-complete', {
            operationId: converseOpId,
            success: true,
          });

          return {
            reply:
              output?.reply ??
              'I understand. Could you tell me more about what you want to build?',
            configUpdates: output?.configUpdates,
            isConfigComplete: output?.isConfigComplete,
          };
        } catch (error) {
          this.broadcastStreamComplete(
            'converse',
            converseOpId,
            false,
            error instanceof Error ? error.message : String(error),
          );
          this.webviewManager.broadcastMessage('harness:flat-stream-complete', {
            operationId: converseOpId,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        } finally {
          clearTimeout(timeout);
          handle.close();
        }
      } catch (error) {
        this.logger.error('harness:converse failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    });
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
