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
 *   - `HarnessChatService`               — step-aware chat reply + conversational config builder.
 *   - `HarnessFsService`                 — custom-skill plugin write + MCP-config discovery.
 *
 * The sixteen-entry METHODS tuple is preserved verbatim so `SHARED_HANDLERS`
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

import { injectable, inject } from 'tsyringe';
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
  RpcMethodName,
} from '@ptah-extension/shared';

import { HARNESS_TOKENS } from '../harness/tokens';
import type { HarnessWorkspaceContextService } from '../harness/workspace/harness-workspace-context.service';
import type { HarnessSuggestionService } from '../harness/ai/harness-suggestion.service';
import type { HarnessSubagentDesignService } from '../harness/ai/harness-subagent-design.service';
import type { HarnessSkillGenerationService } from '../harness/ai/harness-skill-generation.service';
import type { HarnessDocumentGenerationService } from '../harness/ai/harness-document-generation.service';
import type { HarnessPromptBuilderService } from '../harness/config/harness-prompt-builder.service';
import type { HarnessConfigStore } from '../harness/config/harness-config-store.service';
import type { HarnessChatService } from '../harness/ai/harness-chat.service';
import type { HarnessFsService } from '../harness/io/harness-fs.service';

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
    'harness:chat',
    'harness:design-agents',
    'harness:generate-skills',
    'harness:generate-document',
    'harness:analyze-intent',
    'harness:converse',
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
    @inject(HARNESS_TOKENS.CHAT) private readonly chat: HarnessChatService,
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

  /** Register all sixteen harness RPC methods. */
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
      methods: HarnessRpcHandlers.METHODS,
    });
  }

  // ─── Initialization ────────────────────────────────────

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
        return {
          workspaceContext,
          availableAgents,
          availableSkills,
          existingPresets,
        };
      },
    );
  }

  // ─── AI Suggestions ────────────────────────────────────

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

  // ─── Skill Management ──────────────────────────────────

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

  // ─── MCP Discovery ────────────────────────────────────

  private registerDiscoverMcp(): void {
    this.wire<HarnessDiscoverMcpParams, HarnessDiscoverMcpResponse>(
      'harness:discover-mcp',
      'registerDiscoverMcp',
      () => this.fsService.discoverMcpServers(),
    );
  }

  // ─── Prompt Generation ─────────────────────────────────

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

  // ─── CLAUDE.md Generation ──────────────────────────────

  private registerGenerateClaudeMd(): void {
    this.wire<HarnessGenerateClaudeMdParams, HarnessGenerateClaudeMdResponse>(
      'harness:generate-claude-md',
      'registerGenerateClaudeMd',
      async (params) => ({
        content: this.promptBuilder.buildClaudeMdContent(params.config),
      }),
    );
  }

  // ─── Apply Configuration ───────────────────────────────

  private registerApply(): void {
    this.wire<HarnessApplyParams, HarnessApplyResponse>(
      'harness:apply',
      'registerApply',
      async (params) => {
        const config = this.configStore.normalizeHarnessConfig(params.config);
        const appliedPaths: string[] = [];
        const warnings: string[] = [];

        // 1. Save harness config as preset
        const presetPath = await this.configStore.writePresetToDisk(
          config.name,
          config,
        );
        appliedPaths.push(presetPath);

        // 2. Generate and write CLAUDE.md if requested
        if (config.claudeMd.generateProjectClaudeMd) {
          const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
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

        // 3. Update ~/.ptah/settings.json with agent configuration
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

        return { appliedPaths, warnings };
      },
    );
  }

  // ─── Preset Management ─────────────────────────────────

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

  // ─── AI Chat ───────────────────────────────────────────

  /**
   * `harness:chat` — graceful fallback path: when the chat service rejects we
   * must NOT propagate the error (the frontend relies on non-error payloads to
   * keep the conversation alive), so this method does not use `runRpc`.
   */
  private registerChat(): void {
    this.rpcHandler.registerMethod<HarnessChatParams, HarnessChatResponse>(
      'harness:chat',
      async (params) => {
        this.logger.debug('RPC: harness:chat called', {
          step: params.step,
          messageLength: params.message.length,
        });
        try {
          const result = await this.chat.buildIntelligentChatReply(
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
          const err = error instanceof Error ? error : new Error(String(error));
          this.logger.error('RPC: harness:chat failed', err);
          this.sentryService.captureException(err, {
            errorSource: 'HarnessRpcHandlers.registerChat',
          });
          // Graceful fallback — frontend expects a non-error payload.
          return {
            reply: this.chat.buildChatReplyFallback(
              params.step,
              params.message,
            ),
          };
        }
      },
    );
  }

  // ─── Subagent Fleet Design ─────────────────────────────

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

  // ─── Skill Generation ─────────────────────────────────

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

  // ─── Document Generation ──────────────────────────────

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

  // ─── Intent Analysis ───────────────────────────────────

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

  // ─── Converse (Freeform Chat) ─────────────────────────

  private registerConverse(): void {
    this.wire<HarnessConverseParams, HarnessConverseResponse>(
      'harness:converse',
      'registerConverse',
      async (params) => this.chat.converseWithUser(params),
    );
  }
}
