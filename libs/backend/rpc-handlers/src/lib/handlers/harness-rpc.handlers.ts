/**
 * Harness RPC Handlers — thin facade.
 *
 * Registers the sixteen `harness:*` RPC methods and delegates each call to one
 * of the extracted harness services:
 *
 *   - `HarnessWorkspaceContextService`   — workspace detection, agent roster, skill discovery.
 *   - `HarnessSuggestionService`         — persona → config suggestion, freeform intent analysis.
 *   - `HarnessSubagentDesignService`     — subagent fleet design.
 *   - `HarnessSkillGenerationService`    — SKILL.md spec generation.
 *   - `HarnessDocumentGenerationService` — PRD document generation.
 *   - `HarnessPromptBuilderService`      — template-based system-prompt + CLAUDE.md builders.
 *   - `HarnessConfigStore`               — filesystem persistence for CLAUDE.md, settings.json, presets.
 *   - `HarnessWorkflowPromptService`     — composes the agent-driven workflow seed prompt.
 *   - `HarnessFsService`                 — custom-skill plugin write + MCP-config discovery.
 *
 * The METHODS tuple is kept in sync with `RpcMethodName` so `SHARED_HANDLERS`
 * coverage + runtime disjoint-ness both keep working.
 *
 * Error handling is centralised via the private `runRpc` helper: every delegate
 * call is wrapped once, mirroring the pre-extraction try/log/sentry boilerplate
 * without duplicating it at every call site. `wire()` is a thin sugar that
 * combines `runRpc` with `rpcHandler.registerMethod` so each register* method
 * stays a one-liner-plus-delegate.
 *
 * `registerHarnessServices(container)` from `@ptah-extension/rpc-handlers` must
 * be invoked BEFORE `registerAllRpcHandlers(container)` resolves this class —
 * the service registration order is documented in `../harness/di.ts`.
 */

import { injectable, inject, DependencyContainer } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  PluginLoaderService,
  SkillJunctionService,
} from '@ptah-extension/agent-sdk';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
  type IPlatformCommands,
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
  HarnessDesignAgentsParams,
  HarnessDesignAgentsResponse,
  HarnessGenerateSkillsParams,
  HarnessGenerateSkillsResponse,
  HarnessGenerateDocumentParams,
  HarnessGenerateDocumentResponse,
  HarnessAnalyzeIntentParams,
  HarnessAnalyzeIntentResponse,
  HarnessStartNewProjectParams,
  HarnessStartNewProjectResult,
  HarnessWorkflowPromptParams,
  HarnessWorkflowPromptResponse,
  RpcMethodName,
} from '@ptah-extension/shared';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

import { HARNESS_TOKENS } from '../harness/tokens';
import {
  NEW_PROJECT_CHAT_SEED_PROMPT,
  SAAS_WORKSPACE_INITIALIZER_PLUGIN_ID,
  WIZARD_VIEW_TYPE,
} from '../harness/harness-constants';
import type { WebviewBroadcaster } from '../harness/streaming';
import {
  HarnessWorkflowPromptParamsSchema,
  HarnessWorkspacePinParamsSchema,
} from './harness-rpc.schema';
import type { HarnessWorkspaceContextService } from '../harness/workspace/harness-workspace-context.service';
import type { HarnessSuggestionService } from '../harness/ai/harness-suggestion.service';
import type { HarnessSubagentDesignService } from '../harness/ai/harness-subagent-design.service';
import type { HarnessSkillGenerationService } from '../harness/ai/harness-skill-generation.service';
import type { HarnessDocumentGenerationService } from '../harness/ai/harness-document-generation.service';
import type { HarnessPromptBuilderService } from '../harness/config/harness-prompt-builder.service';
import type { HarnessConfigStore } from '../harness/config/harness-config-store.service';
import type { HarnessAgentFileWriterService } from '../harness/config/harness-agent-file-writer.service';
import type { HarnessWorkflowPromptService } from '../harness/ai/harness-workflow-prompt.service';
import type { HarnessFsService } from '../harness/io/harness-fs.service';

interface WizardWebviewLifecycleLike {
  disposeWebview(viewType: string): void;
}

const WIZARD_WEBVIEW_LIFECYCLE_TOKEN = Symbol.for(
  'WizardWebviewLifecycleService',
);

/** Type of the RPC handler callback used by every `rpcHandler.registerMethod`. */
type RpcHandlerFn<TParams, TResp> = (params: TParams) => Promise<TResp>;

/**
 * RPC handlers for harness setup builder operations.
 *
 * Owns RPC registration + light orchestration only; all LLM, filesystem, and
 * stream-broadcasting logic lives in the harness sub-services registered via
 * `registerHarnessServices(container)`.
 */
@injectable()
export class HarnessRpcHandlers {
  static readonly METHODS = [
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
    'harness:design-agents',
    'harness:generate-skills',
    'harness:generate-document',
    'harness:analyze-intent',
    'harness:start-new-project',
    'harness:workflow-prompt',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(SDK_TOKENS.SDK_PLUGIN_LOADER)
    private readonly pluginLoader: PluginLoaderService,
    @inject(SDK_TOKENS.SDK_SKILL_JUNCTION)
    private readonly skillJunction: SkillJunctionService,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(TOKENS.PLATFORM_COMMANDS)
    private readonly platformCommands: IPlatformCommands,
    @inject(PLATFORM_TOKENS.DI_CONTAINER)
    private readonly container: DependencyContainer,
    @inject(HARNESS_TOKENS.WORKSPACE_CONTEXT)
    private readonly workspaceContext: HarnessWorkspaceContextService,
    @inject(HARNESS_TOKENS.SUGGESTION)
    private readonly suggestion: HarnessSuggestionService,
    @inject(HARNESS_TOKENS.SUBAGENT_DESIGN)
    private readonly subagentDesign: HarnessSubagentDesignService,
    @inject(HARNESS_TOKENS.SKILL_GENERATION)
    private readonly skillGeneration: HarnessSkillGenerationService,
    @inject(HARNESS_TOKENS.DOCUMENT_GENERATION)
    private readonly documentGeneration: HarnessDocumentGenerationService,
    @inject(HARNESS_TOKENS.PROMPT_BUILDER)
    private readonly promptBuilder: HarnessPromptBuilderService,
    @inject(HARNESS_TOKENS.CONFIG_STORE)
    private readonly configStore: HarnessConfigStore,
    @inject(HARNESS_TOKENS.AGENT_FILE_WRITER)
    private readonly agentFileWriter: HarnessAgentFileWriterService,
    @inject(HARNESS_TOKENS.WORKFLOW_PROMPT)
    private readonly workflowPrompt: HarnessWorkflowPromptService,
    @inject(HARNESS_TOKENS.IO_FS) private readonly fsService: HarnessFsService,
  ) {}

  /**
   * Shared error funnel for every harness RPC method.
   *
   * Logs `RPC: {method} called` on entry and `RPC: {method} success` on exit.
   * On exception, logs the error, captures it in Sentry with an `errorSource`
   * matching the pre-extraction convention (`HarnessRpcHandlers.{tag}`), and
   * re-throws so the RPC layer can surface the failure to the webview.
   */
  private runRpc<TParams, TResp>(
    method: RpcMethodName,
    tag: string,
    fn: RpcHandlerFn<TParams, TResp>,
  ): RpcHandlerFn<TParams, TResp> {
    return async (params) => {
      this.logger.debug(`RPC: ${method} called`);
      try {
        const result = await fn(params);
        this.logger.debug(`RPC: ${method} success`);
        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.error(`RPC: ${method} failed`, err);
        this.sentryService.captureException(err, {
          errorSource: `HarnessRpcHandlers.${tag}`,
        });
        throw error;
      }
    };
  }

  /** Sugar: `runRpc` + `rpcHandler.registerMethod` combined. */
  private wire<TParams, TResp>(
    method: RpcMethodName,
    tag: string,
    fn: RpcHandlerFn<TParams, TResp>,
  ): void {
    this.rpcHandler.registerMethod<TParams, TResp>(
      method,
      this.runRpc(method, tag, fn),
    );
  }

  /** Register all harness RPC methods. */
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
    this.registerDesignAgents();
    this.registerGenerateSkills();
    this.registerGenerateDocument();
    this.registerAnalyzeIntent();
    this.registerStartNewProject();
    this.registerWorkflowPrompt();

    this.logger.debug('Harness RPC handlers registered', {
      methods: HarnessRpcHandlers.METHODS,
    });
  }

  private registerInitialize(): void {
    this.wire<HarnessInitializeParams, HarnessInitializeResponse>(
      'harness:initialize',
      'registerInitialize',
      async () => {
        const [workspaceContext, existingPresets] = await Promise.all([
          this.workspaceContext.resolveWorkspaceContext(),
          this.configStore.loadPresetsFromDisk(),
        ]);
        const availableAgents = this.workspaceContext.getAvailableAgents();
        const availableSkills = this.workspaceContext.discoverAvailableSkills();
        // Return the resolved workspace root so the frontend can PIN it. Later
        // `harness:apply` calls echo this back, keeping file writes bound to the
        // workspace the build started in even after an Electron workspace switch.
        const workspaceRoot = this.workspaceProvider.getWorkspaceRoot() ?? null;
        return {
          workspaceContext,
          availableAgents,
          availableSkills,
          existingPresets,
          workspaceRoot,
        };
      },
    );
  }

  private registerSuggestConfig(): void {
    this.wire<HarnessSuggestConfigParams, HarnessSuggestConfigResponse>(
      'harness:suggest-config',
      'registerSuggestConfig',
      async (params) => {
        const availableSkills = this.workspaceContext.discoverAvailableSkills();
        const availableAgents = this.workspaceContext.getAvailableAgents();
        return this.suggestion.buildSuggestionFromPersona(
          params.personaDescription,
          params.goals,
          availableSkills,
          availableAgents,
        );
      },
    );
  }

  private registerSearchSkills(): void {
    this.wire<HarnessSearchSkillsParams, HarnessSearchSkillsResponse>(
      'harness:search-skills',
      'registerSearchSkills',
      async (params) => {
        const allSkills = this.workspaceContext.discoverAvailableSkills();
        const query = (params.query ?? '').toLowerCase().trim();
        const results =
          query.length === 0
            ? allSkills
            : allSkills.filter(
                (skill) =>
                  skill.name.toLowerCase().includes(query) ||
                  skill.description.toLowerCase().includes(query),
              );
        return { results };
      },
    );
  }

  private registerCreateSkill(): void {
    this.wire<HarnessCreateSkillParams, HarnessCreateSkillResponse>(
      'harness:create-skill',
      'registerCreateSkill',
      (params) => this.fsService.createSkillPlugin(params),
    );
  }

  private registerDiscoverMcp(): void {
    this.wire<HarnessDiscoverMcpParams, HarnessDiscoverMcpResponse>(
      'harness:discover-mcp',
      'registerDiscoverMcp',
      () => this.fsService.discoverMcpServers(),
    );
  }

  private registerGeneratePrompt(): void {
    this.wire<HarnessGeneratePromptParams, HarnessGeneratePromptResponse>(
      'harness:generate-prompt',
      'registerGeneratePrompt',
      async (params) => {
        const sections = this.promptBuilder.buildPromptSections(
          params.persona,
          params.enabledAgents,
          params.selectedSkills,
        );
        const generatedPrompt = Object.values(sections).join('\n\n');
        return { generatedPrompt, sections };
      },
    );
  }

  private registerGenerateClaudeMd(): void {
    this.wire<HarnessGenerateClaudeMdParams, HarnessGenerateClaudeMdResponse>(
      'harness:generate-claude-md',
      'registerGenerateClaudeMd',
      async (params) => ({
        content: this.promptBuilder.buildClaudeMdContent(params.config),
      }),
    );
  }

  private registerApply(): void {
    this.wire<HarnessApplyParams, HarnessApplyResponse>(
      'harness:apply',
      'registerApply',
      async (params) => {
        // Explicit pinned root wins; fall back to the active workspace when the
        // frontend didn't pin one (mirrors tasks-rpc `resolveRoot`).
        const { workspaceRoot: requestedRoot } =
          HarnessWorkspacePinParamsSchema.parse(params);
        const config = this.configStore.normalizeHarnessConfig(params.config);
        const appliedPaths: string[] = [];
        const warnings: string[] = [];
        const workspaceRoot =
          requestedRoot ?? this.workspaceProvider.getWorkspaceRoot();
        const presetPath = await this.configStore.writePresetToDisk(
          config.name,
          config,
        );
        appliedPaths.push(presetPath);
        if (config.claudeMd.generateProjectClaudeMd) {
          if (workspaceRoot) {
            const result = await this.configStore.writeClaudeMdToWorkspace(
              workspaceRoot,
              config,
            );
            if (result.backupPath) appliedPaths.push(result.backupPath);
            appliedPaths.push(result.claudeMdPath);
          } else {
            warnings.push(
              'No workspace folder open. CLAUDE.md was not generated.',
            );
          }
        }

        const subagents = config.agents.harnessSubagents ?? [];
        if (subagents.length > 0) {
          if (workspaceRoot) {
            const outcome = await this.agentFileWriter.writeSubagentFiles(
              workspaceRoot,
              subagents,
            );
            appliedPaths.push(...outcome.writtenPaths);
            warnings.push(...outcome.warnings);
          } else {
            warnings.push(
              'No workspace folder open. Subagent files were not generated.',
            );
          }
        }
        try {
          await this.configStore.updatePtahSettings(config);
          appliedPaths.push(this.configStore.settingsPath);
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
        const hasCreatedSkills = config.skills.createdSkills.length > 0;
        if (config.skills.selectedSkills.length > 0 || hasCreatedSkills) {
          try {
            const pluginPaths = this.pluginLoader.resolveCurrentPluginPaths();
            const harnessPluginPaths =
              await this.fsService.discoverHarnessPluginPaths();
            const mergedPluginPaths = Array.from(
              new Set([...pluginPaths, ...harnessPluginPaths]),
            );
            const disabledSkillIds = this.pluginLoader.getDisabledSkillIds();
            this.skillJunction.createJunctions(
              mergedPluginPaths,
              disabledSkillIds,
            );
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

        return { appliedPaths, warnings };
      },
    );
  }

  private registerSavePreset(): void {
    this.wire<HarnessSavePresetParams, HarnessSavePresetResponse>(
      'harness:save-preset',
      'registerSavePreset',
      async (params) => {
        const presetPath = await this.configStore.writePresetToDisk(
          params.name,
          params.config,
          params.description,
        );
        const presetId = this.configStore.sanitizeFileName(params.name);
        return { presetId, presetPath };
      },
    );
  }

  private registerLoadPresets(): void {
    this.wire<HarnessLoadPresetsParams, HarnessLoadPresetsResponse>(
      'harness:load-presets',
      'registerLoadPresets',
      async () => ({ presets: await this.configStore.loadPresetsFromDisk() }),
    );
  }

  private registerDesignAgents(): void {
    this.wire<HarnessDesignAgentsParams, HarnessDesignAgentsResponse>(
      'harness:design-agents',
      'registerDesignAgents',
      async (params) =>
        this.subagentDesign.designSubagentFleet(
          params.persona,
          params.existingAgents,
          params.workspaceContext,
        ),
    );
  }

  private registerGenerateSkills(): void {
    this.wire<HarnessGenerateSkillsParams, HarnessGenerateSkillsResponse>(
      'harness:generate-skills',
      'registerGenerateSkills',
      async (params) =>
        this.skillGeneration.generateSkillSpecs(
          params.persona,
          params.existingSkills,
          params.harnessSubagents,
        ),
    );
  }

  private registerGenerateDocument(): void {
    this.wire<HarnessGenerateDocumentParams, HarnessGenerateDocumentResponse>(
      'harness:generate-document',
      'registerGenerateDocument',
      async (params) =>
        this.documentGeneration.generateComprehensiveDocument(
          params.config,
          params.workspaceContext,
        ),
    );
  }

  private registerAnalyzeIntent(): void {
    this.wire<HarnessAnalyzeIntentParams, HarnessAnalyzeIntentResponse>(
      'harness:analyze-intent',
      'registerAnalyzeIntent',
      async (params) => {
        if (
          !params.input ||
          typeof params.input !== 'string' ||
          params.input.trim().length < 10
        ) {
          throw new Error('Input must be at least 10 characters for analysis');
        }

        const availableSkills = this.workspaceContext.discoverAvailableSkills();
        const availableAgents = this.workspaceContext.getAvailableAgents();

        return this.suggestion.analyzeIntent({
          input: params.input,
          availableSkills,
          availableAgents,
          workspaceContext: params.workspaceContext,
        });
      },
    );
  }

  private resolveService<T>(token: symbol, serviceName: string): T {
    const service = this.container.resolve<T>(token);
    if (service === null || service === undefined) {
      throw new Error(`${serviceName} resolved to null/undefined`);
    }
    return service;
  }

  private registerStartNewProject(): void {
    this.rpcHandler.registerMethod<
      HarnessStartNewProjectParams,
      HarnessStartNewProjectResult
    >('harness:start-new-project', async () => {
      this.logger.debug('RPC: harness:start-new-project called');
      try {
        const config = this.pluginLoader.getWorkspacePluginConfig();
        const enabled = new Set(config.enabledPluginIds);
        let pluginConfigChanged = false;
        if (!enabled.has(SAAS_WORKSPACE_INITIALIZER_PLUGIN_ID)) {
          enabled.add(SAAS_WORKSPACE_INITIALIZER_PLUGIN_ID);
          await this.pluginLoader.saveWorkspacePluginConfig({
            enabledPluginIds: Array.from(enabled),
            disabledSkillIds: config.disabledSkillIds,
          });
          pluginConfigChanged = true;
          this.logger.info(
            '[harness:start-new-project] Enabled ptah-nx-saas plugin for workspace',
          );
        }
        if (pluginConfigChanged) {
          try {
            const refreshedConfig =
              this.pluginLoader.getWorkspacePluginConfig();
            const pluginPaths = this.pluginLoader.resolvePluginPaths(
              refreshedConfig.enabledPluginIds,
            );
            const junctionResult = this.skillJunction.createJunctions(
              pluginPaths,
              refreshedConfig.disabledSkillIds,
            );
            this.logger.debug(
              '[harness:start-new-project] Skill junctions refreshed',
              {
                created: junctionResult.created,
                skipped: junctionResult.skipped,
                removed: junctionResult.removed,
                errorCount: junctionResult.errors.length,
              },
            );
          } catch (error: unknown) {
            this.logger.warn(
              '[harness:start-new-project] Failed to refresh skill junctions (non-fatal)',
              {
                error: error instanceof Error ? error.message : String(error),
              },
            );
          }
        }
        try {
          await this.platformCommands.focusChat();
        } catch (error: unknown) {
          this.logger.warn(
            '[harness:start-new-project] focusChat failed (non-fatal)',
            {
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
        try {
          const webviewManager = this.resolveService<WebviewBroadcaster>(
            TOKENS.WEBVIEW_MANAGER,
            'WebviewManager',
          );
          await webviewManager.broadcastMessage(
            MESSAGE_TYPES.HARNESS_OPEN_WORKFLOW,
            { mode: 'new-project', seedPrompt: NEW_PROJECT_CHAT_SEED_PROMPT },
          );
        } catch (error: unknown) {
          this.logger.warn(
            '[harness:start-new-project] Failed to broadcast workflow open',
            {
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
        try {
          const wizardLifecycle =
            this.resolveService<WizardWebviewLifecycleLike>(
              WIZARD_WEBVIEW_LIFECYCLE_TOKEN,
              'WizardWebviewLifecycleService',
            );
          wizardLifecycle.disposeWebview(WIZARD_VIEW_TYPE);
        } catch (error: unknown) {
          this.logger.debug(
            '[harness:start-new-project] Wizard panel dispose skipped (non-fatal)',
            {
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
        return { success: true };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          '[harness:start-new-project] Failed to open workflow',
          error instanceof Error ? error : new Error(message),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(message),
          {
            errorSource: 'HarnessRpcHandlers.registerStartNewProject',
          },
        );
        return { success: false, error: message };
      }
    });
  }

  private registerWorkflowPrompt(): void {
    this.wire<HarnessWorkflowPromptParams, HarnessWorkflowPromptResponse>(
      'harness:workflow-prompt',
      'registerWorkflowPrompt',
      async (params) => {
        const parsed = HarnessWorkflowPromptParamsSchema.parse(params);
        return this.workflowPrompt.composePrompt(parsed);
      },
    );
  }
}
