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
import { SDK_TOKENS, PluginLoaderService } from '@ptah-extension/agent-sdk';
import {
  HARNESS_SYNC_TOKENS,
  type HarnessPropagationService,
} from '@ptah-extension/harness-sync';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
  type IPlatformCommands,
} from '@ptah-extension/platform-core';
import { probeStackToolchain } from '@ptah-extension/workspace-intelligence';
import {
  PLUGIN_MARKETPLACE_TOKENS,
  buildExternalPluginId,
  type ExternalPluginStateStore,
} from '@ptah-extension/plugin-marketplace';
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
  HarnessHealthParams,
  HarnessHealthResult,
  HarnessReconcileParams,
  HarnessReconcileResult,
  HarnessRemoveParams,
  HarnessRemoveResult,
  HarnessRepairBlockedParams,
  HarnessRepairBlockedResult,
  RpcMethodName,
  ExternalPluginRef,
  StackProfile,
  StackProfileId,
  ToolchainProbeResult,
} from '@ptah-extension/shared';
import {
  MESSAGE_TYPES,
  resolveStackProfileForPlatform,
} from '@ptah-extension/shared';

import { HARNESS_TOKENS } from '../harness/tokens';
import {
  buildNewProjectSeedPrompt,
  WIZARD_VIEW_TYPE,
} from '../harness/harness-constants';
import type { WebviewBroadcaster } from '../harness/streaming';
import {
  HarnessHealthParamsSchema,
  HarnessReconcileParamsSchema,
  HarnessRemoveParamsSchema,
  HarnessRepairBlockedParamsSchema,
  HarnessStartNewProjectParamsSchema,
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
import type { HarnessMcpInstallService } from '../harness/io/harness-mcp-install.service';
import type { HarnessSkillInstallService } from '../harness/io/harness-skill-install.service';
import type { HarnessHealthRpcService } from '../harness/health/harness-health-rpc.service';

interface WizardWebviewLifecycleLike {
  disposeWebview(viewType: string): void;
}

const WIZARD_WEBVIEW_LIFECYCLE_TOKEN = Symbol.for(
  'WizardWebviewLifecycleService',
);

/**
 * Profiles whose toolchain is the runtime Ptah is ALREADY executing in, so the
 * probe is skipped for them.
 *
 * `node --version` answers "is there a Node on PATH", which is a different
 * question from "can this project be scaffolded". Electron ships its own Node,
 * and plenty of desktop users have none installed system-wide — probing them
 * would print "Node.js is not installed" into the seed prompt of every
 * TypeScript project on those machines, which is both false and a change to a
 * path that must not change.
 */
const RUNTIME_PROVIDED_PROFILE_IDS: readonly StackProfileId[] = ['node-ts'];

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
    // The reconciler surface (TASK_2026_278 Batch 4). Registered here rather
    // than in a new handler class so the host-profile manifest, both app DI
    // bundles and the method-coverage specs keep working unchanged; the work
    // itself lives in `HarnessHealthRpcService`.
    'harness:health',
    'harness:reconcile',
    'harness:remove',
    // The consent-gated repair (TASK_2026_306 Batch 8). `harness:` is already
    // in `ALLOWED_METHOD_PREFIXES` (`vscode-core/.../rpc-handler.ts:70`), so
    // the runtime half of the dual registration is satisfied by the namespace
    // and only the compile-time half in `rpc.types.ts` was new.
    'harness:repairBlocked',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(SDK_TOKENS.SDK_PLUGIN_LOADER)
    private readonly pluginLoader: PluginLoaderService,
    @inject(HARNESS_SYNC_TOKENS.PROPAGATION)
    private readonly harnessPropagation: HarnessPropagationService,
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
    @inject(HARNESS_TOKENS.MCP_INSTALL)
    private readonly mcpInstall: HarnessMcpInstallService,
    @inject(HARNESS_TOKENS.SKILL_INSTALL)
    private readonly skillInstall: HarnessSkillInstallService,
    @inject(HARNESS_TOKENS.HEALTH)
    private readonly healthService: HarnessHealthRpcService,
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

  /**
   * Push whatever this handler just wrote out to every harness target.
   *
   * Delegates to `HarnessPropagationService`, which refreshes the user layer
   * FIRST. That ordering is what this handler in particular needs and what it
   * lacked: `createSkillPlugin` writes into `~/.ptah/plugins/ptah-harness-*`,
   * and the reconciler's desired state is `~/.ptah/user` — so a bare reconcile
   * here copied the state from before the skill was authored and reported a
   * clean pass (TASK_2026_278 Batch 3).
   *
   * Returns `null` on success (or when there is no workspace) and a short
   * message otherwise, so `harness:apply` can turn it into a user-visible
   * warning without letting it fail the whole apply — the skill files ARE on
   * disk in the user layer either way, and the next activation heals the copy.
   */
  private async reconcileHarness(reason: string): Promise<string | null> {
    const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
    if (workspaceRoot === undefined || workspaceRoot === null) return null;
    try {
      const health = await this.harnessPropagation.propagate(
        workspaceRoot,
        reason,
      );
      if (health === null) return 'harness propagation did not run';
      const claude = health.targets.find((t) => t.target === 'claude');
      this.logger.debug('Harness reconciled', {
        reason,
        expected: claude?.expected ?? 0,
        found: claude?.found ?? 0,
        writeFailed: claude?.writeFailed.length ?? 0,
      });
      return null;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('Harness reconcile failed (non-fatal)', {
        reason,
        error: message,
      });
      return message;
    }
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
    this.registerHealth();
    this.registerReconcile();
    this.registerRemove();
    this.registerRepairBlocked();

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
      async (params) => {
        const result = await this.fsService.createSkillPlugin(params);
        // `createSkillPlugin` mirrors the new `ptah-harness-*` dir into the
        // user layer and stops there. Until Batch 3 nothing carried it the last
        // step into `{ws}/.claude/skills`, so a skill the user had just
        // authored — including one the model authored for itself through
        // `ptah_harness_create_skill` mid-session — did not exist for any tool
        // until the next activation. Awaited, not fire-and-forget: the caller's
        // very next act is usually to invoke the skill.
        await this.reconcileHarness('harness:create-skill');
        return result;
      },
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
        // Install the MCP servers the design recorded. Entries the agent left
        // without a transport config surface as warnings rather than silently
        // doing nothing.
        const mcpOutcome = await this.mcpInstall.installServers(
          config.mcp.servers ?? [],
          workspaceRoot,
        );
        appliedPaths.push(...mcpOutcome.installedPaths);
        warnings.push(...mcpOutcome.warnings);

        // Install the skills.sh skills the design recorded. Refs the agent
        // tagged skills.sh without an installSource surface as warnings rather
        // than silently doing nothing. Local selections are already on disk and
        // are handled by the junction pass below.
        const skillOutcome = await this.skillInstall.installSkills(
          config.skills.selectedSkillRefs,
          workspaceRoot,
        );
        appliedPaths.push(...skillOutcome.installedPaths);
        warnings.push(...skillOutcome.warnings);

        // Materialize skill definitions the agent proposed but never wrote via
        // harness:create-skill / ptah_harness_create_skill. Without this a skill
        // listed in createdSkills produces no file at all. createSkillPlugin
        // overwrites, so re-running it for already-created skills is idempotent.
        // Must run BEFORE junction creation so the SKILL.md files exist.
        const createdSkills = config.skills.createdSkills ?? [];
        for (const skill of createdSkills) {
          try {
            const { skillPath } = await this.fsService.createSkillPlugin(skill);
            appliedPaths.push(skillPath);
          } catch (skillError) {
            const msg =
              skillError instanceof Error
                ? skillError.message
                : String(skillError);
            const label = skill?.name ?? '(unnamed)';
            warnings.push(`Failed to create skill "${label}": ${msg}`);
            this.logger.error(
              `RPC: harness:apply skill creation failed for "${label}"`,
              skillError instanceof Error ? skillError : new Error(msg),
            );
          }
        }

        // UNCONDITIONAL since TASK_2026_278 Batch 3. The old
        // `selectedSkills.length > 0 || createdSkills.length > 0` gate read as
        // an optimisation and was a hole: an apply that wrote only subagents
        // (the common case for a harness whose skills were already installed)
        // left `{ws}/.claude/agents` mirrored into the user layer with nothing
        // fanning it out to Codex, Copilot or Cursor. The pass is idempotent —
        // an apply that changed nothing costs a directory walk.
        const failure = await this.reconcileHarness('harness:apply');
        if (failure !== null) {
          warnings.push(`Failed to sync harness skills: ${failure}`);
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

  /**
   * Split a profile's `requiredPlugins` into "turn these on" and "tell the user
   * these are missing".
   *
   * The asymmetry is the point. A bundled plugin ships inside Ptah, so enabling
   * it is a configuration flip the user already consented to by installing
   * Ptah. An external one is code downloaded from a third-party GitHub repo,
   * possibly carrying scripts and an MCP server, and the ONLY way it may reach
   * disk is the two-call consent flow in `ExternalPluginInstallerService`.
   * This method therefore never installs and never enables an external plugin —
   * it reads the consent record and reports what is absent, and the seed prompt
   * tells the user where to approve it.
   *
   * A host with no marketplace registered (the store fails to resolve) reports
   * every external ref as missing. Failing closed is the honest answer: we
   * cannot show the user something we cannot verify is there.
   */
  private partitionRequiredPlugins(profile: StackProfile | null): {
    bundled: string[];
    missingExternal: ExternalPluginRef[];
  } {
    const bundled: string[] = [];
    const external: ExternalPluginRef[] = [];
    for (const ref of profile?.requiredPlugins ?? []) {
      if (typeof ref === 'string') {
        bundled.push(ref);
      } else {
        external.push(ref);
      }
    }

    if (external.length === 0) {
      return { bundled, missingExternal: [] };
    }

    let stateStore: ExternalPluginStateStore | null = null;
    try {
      stateStore = this.container.resolve<ExternalPluginStateStore>(
        PLUGIN_MARKETPLACE_TOKENS.STATE_STORE,
      );
    } catch (error: unknown) {
      this.logger.debug(
        '[harness:start-new-project] External plugin state store unavailable; treating every external requirement as missing',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }

    const missingExternal = external.filter((ref) => {
      const [owner, repo] = ref.marketplace.split('/');
      if (!owner || !repo) {
        return true;
      }
      const pluginId = buildExternalPluginId({
        owner,
        repo,
        plugin: ref.plugin,
      });
      return !stateStore?.isInstalled(pluginId);
    });

    return { bundled, missingExternal };
  }

  /**
   * The skill ids the agent can actually invoke, for the seed prompt to gate
   * the profile's Stage A skill names on.
   *
   * Read AFTER the profile's bundled plugin has been enabled and reconciled, so
   * a plugin turned on by this very call counts as present. Skills the user
   * disabled are excluded: `disabledSkillIds` keeps them out of the harness
   * dirs altogether, so from the agent's side they are not there.
   *
   * Anything unreadable comes back empty, which makes the prompt name no preset
   * skill at all — the same fail-closed posture as
   * {@link partitionRequiredPlugins}. A generic Stage A contract is a duller
   * prompt; a named skill that does not exist is a broken one.
   */
  private resolveAvailableSkillIds(): string[] {
    try {
      return this.workspaceContext
        .discoverAvailableSkills()
        .filter((skill) => skill.isActive)
        .map((skill) => skill.id);
    } catch (error: unknown) {
      this.logger.debug(
        '[harness:start-new-project] Skill discovery unavailable; the seed prompt will use the generic Stage A contract',
        { error: error instanceof Error ? error.message : String(error) },
      );
      return [];
    }
  }

  /**
   * Probe the profile's toolchain so the prompt can warn about a missing SDK.
   *
   * Skipped for the profiles in {@link RUNTIME_PROVIDED_PROFILE_IDS} — see that
   * constant for why probing PATH there produces false alarms rather than
   * information.
   */
  private async probeProfileToolchain(
    profile: StackProfile | null,
  ): Promise<ToolchainProbeResult | undefined> {
    if (!profile || RUNTIME_PROVIDED_PROFILE_IDS.includes(profile.id)) {
      return undefined;
    }
    return probeStackToolchain(profile);
  }

  private registerStartNewProject(): void {
    this.rpcHandler.registerMethod<
      HarnessStartNewProjectParams,
      HarnessStartNewProjectResult
    >('harness:start-new-project', async (params) => {
      this.logger.debug('RPC: harness:start-new-project called');
      try {
        // Validate BEFORE any side effect: a malformed intake must not leave
        // a plugin half-enabled or the wizard panel disposed.
        const { intake } = HarnessStartNewProjectParamsSchema.parse(params);
        const profile = resolveStackProfileForPlatform(intake.platform);
        const { bundled, missingExternal } =
          this.partitionRequiredPlugins(profile);

        const config = this.pluginLoader.getWorkspacePluginConfig();
        const enabled = new Set(config.enabledPluginIds);
        const newlyEnabled = bundled.filter((id) => !enabled.has(id));
        let pluginConfigChanged = false;
        if (newlyEnabled.length > 0) {
          for (const id of newlyEnabled) {
            enabled.add(id);
          }
          await this.pluginLoader.saveWorkspacePluginConfig({
            enabledPluginIds: Array.from(enabled),
            disabledSkillIds: config.disabledSkillIds,
          });
          pluginConfigChanged = true;
          this.logger.info(
            '[harness:start-new-project] Enabled bundled plugins for workspace',
            { pluginIds: newlyEnabled },
          );
        }
        if (pluginConfigChanged) {
          await this.reconcileHarness('harness:start-new-project');
        }
        // Composed before the broadcast, and outside its try, so a probe or a
        // consent-record read can never be mistaken for a broadcast failure.
        const seedPrompt = buildNewProjectSeedPrompt(intake, {
          toolchain: await this.probeProfileToolchain(profile),
          missingExternalPlugins: missingExternal,
          availableSkillIds: this.resolveAvailableSkillIds(),
        });

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
            {
              mode: 'new-project',
              // What the agent receives …
              seedPrompt,
              // … and what the user sees rendered as their first bubble.
              intake,
            },
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

  // -- Reconciler surface (TASK_2026_278 Batch 4) ---------------------------
  //
  // Three one-line delegates. The logic, the workspace resolution and the
  // `harness:healthChanged` push all live in `HarnessHealthRpcService`; what
  // stays here is registration, Zod parsing and the shared error funnel.

  private registerHealth(): void {
    this.wire<HarnessHealthParams, HarnessHealthResult>(
      'harness:health',
      'registerHealth',
      async (params) =>
        this.healthService.health(
          HarnessHealthParamsSchema.parse(params ?? {}),
        ),
    );
  }

  private registerReconcile(): void {
    this.wire<HarnessReconcileParams, HarnessReconcileResult>(
      'harness:reconcile',
      'registerReconcile',
      async (params) =>
        this.healthService.reconcile(
          HarnessReconcileParamsSchema.parse(params ?? {}),
        ),
    );
  }

  private registerRemove(): void {
    this.wire<HarnessRemoveParams, HarnessRemoveResult>(
      'harness:remove',
      'registerRemove',
      async (params) =>
        this.healthService.remove(HarnessRemoveParamsSchema.parse(params)),
    );
  }

  /**
   * The consent-gated repair (TASK_2026_306 Batch 8).
   *
   * `params` is parsed without a `?? {}` default, unlike `harness:health` and
   * `harness:reconcile` above. Those two are safe to call with nothing; this
   * one moves a directory the user may have written by hand, so a caller that
   * sends no params at all is a bug and must be rejected rather than quietly
   * turned into an empty selection.
   */
  private registerRepairBlocked(): void {
    this.wire<HarnessRepairBlockedParams, HarnessRepairBlockedResult>(
      'harness:repairBlocked',
      'registerRepairBlocked',
      async (params) =>
        this.healthService.repairBlocked(
          HarnessRepairBlockedParamsSchema.parse(params),
        ),
    );
  }
}
