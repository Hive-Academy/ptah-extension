/**
 * Agent Orchestration RPC Handlers.
 *
 * Owns the `agent:*` namespace on every host:
 * - agent:getConfig / agent:setConfig — orchestration config via IWorkspaceProvider
 * - agent:detectClis / agent:listCliModels — rival-CLI detection and models
 * - agent:permissionResponse — routes decisions to the SDK + Copilot bridges
 * - agent:stop / agent:continue / agent:resumeCliSession — process control
 *
 * Unified from three byte-for-byte-equivalent copies (VS Code, Electron,
 * cli-engine). Electron's implementation is the base; the only host-specific
 * behaviour left is Copilot model discovery, which goes through
 * {@link IModelDiscovery} — VS Code's adapter queries the editor's Language
 * Model API, the other hosts return nothing and the curated CLI list is used.
 */

import { injectable, inject, type DependencyContainer } from 'tsyringe';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IWorkspaceProvider,
  IStateStorage,
  IModelDiscovery,
} from '@ptah-extension/platform-core';
import {
  CliDetectionService,
  CopilotPermissionBridge,
  AgentProcessManager,
  AgentContinueError,
  CLI_AGENT_RUNTIME_TOKENS,
  PtahCliRegistry,
} from '@ptah-extension/cli-agent-runtime';
import {
  SDK_TOKENS,
  SessionMetadataStore,
  SdkPermissionHandler,
} from '@ptah-extension/agent-sdk';
import { z } from 'zod';
import {
  AUTH_PROVIDERS_TOKENS,
  CodexAuthService,
} from '@ptah-extension/auth-providers';
import type {
  AgentOrchestrationConfig,
  AgentSetConfigParams,
  AgentListCliModelsResult,
  CliModelOption,
  AgentPermissionDecision,
  AgentContinueErrorCode,
  CliDetectionResult,
  CliType,
  SpawnAgentResult,
  ISdkPermissionHandler,
  PermissionResponse,
  SessionId,
  TabId,
} from '@ptah-extension/shared';

@injectable()
export class AgentRpcHandlers {
  /**
   * Method names registered against the global `RpcHandler`. Order matches
   * `register()` invocation order.
   */
  static readonly METHODS = [
    'agent:getConfig',
    'agent:setConfig',
    'agent:detectClis',
    'agent:listCliModels',
    'agent:permissionResponse',
    'agent:e2eSeedPermission',
    'agent:stop',
    'agent:continue',
    'agent:resumeCliSession',
  ] as const;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.CLI_DETECTION_SERVICE)
    private readonly cliDetection: CliDetectionService,
    @inject(CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_REGISTRY)
    private readonly ptahCliRegistry: PtahCliRegistry,
    @inject(TOKENS.AGENT_PROCESS_MANAGER)
    private readonly agentProcessManager: AgentProcessManager,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly sessionMetadataStore: SessionMetadataStore,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(PLATFORM_TOKENS.STATE_STORAGE)
    private readonly stateStorage: IStateStorage,
    @inject(TOKENS.MODEL_DISCOVERY)
    private readonly modelDiscovery: IModelDiscovery,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_AUTH)
    private readonly codexAuthService: CodexAuthService,
    @inject(PLATFORM_TOKENS.DI_CONTAINER)
    private readonly runtimeContainer: DependencyContainer,
  ) {}

  register(): void {
    void this.migrateAgentOrchestrationSettings();

    this.registerGetConfig();
    this.registerSetConfig();
    this.registerDetectClis();
    this.registerListCliModels();
    this.registerPermissionResponse();
    this.registerE2eSeedPermission();
    this.registerAgentStop();
    this.registerAgentContinue();
    this.registerResumeCliSession();
    const copilotAutoApprove = this.getAgentCfg<boolean>(
      'copilotAutoApprove',
      true,
    );
    const copilotAdapter = this.cliDetection.getAdapter('copilot');
    if (copilotAdapter && 'permissionBridge' in copilotAdapter) {
      const bridge = (
        copilotAdapter as { permissionBridge: CopilotPermissionBridge }
      ).permissionBridge;
      bridge.setAutoApprove(copilotAutoApprove);
    }

    this.logger.debug('Agent RPC handlers registered', {
      methods: [
        'agent:getConfig',
        'agent:setConfig',
        'agent:detectClis',
        'agent:listCliModels',
        'agent:permissionResponse',
        'agent:e2eSeedPermission',
        'agent:stop',
        'agent:continue',
        'agent:resumeCliSession',
      ],
    });
  }

  private registerGetConfig(): void {
    this.rpcHandler.registerMethod<void, AgentOrchestrationConfig>(
      'agent:getConfig',
      async () => {
        try {
          this.logger.debug('RPC: agent:getConfig called');

          const cliResults = await this.cliDetection.detectAll();
          const detectedClis = await this.mergePtahCliAgents(cliResults);

          const result: AgentOrchestrationConfig = {
            detectedClis,
            preferredAgentOrder: this.getAgentCfg<string[]>(
              'preferredAgentOrder',
              [],
            ),
            maxConcurrentAgents: this.getAgentCfg<number>(
              'maxConcurrentAgents',
              5,
            ),
            codexModel: this.getAgentCfg<string>('codexModel', ''),
            copilotModel: this.getAgentCfg<string>('copilotModel', ''),
            cursorModel: this.getAgentCfg<string>('cursorModel', ''),
            antigravityModel: this.getAgentCfg<string>('antigravityModel', ''),
            opencodeModel: this.getAgentCfg<string>('opencodeModel', ''),
            piModel: this.getAgentCfg<string>('piModel', ''),
            cursorApiKeyConfigured: this.isCursorApiKeyConfigured(),
            codexAutoApprove: this.getAgentCfg<boolean>(
              'codexAutoApprove',
              true,
            ),
            copilotAutoApprove: this.getAgentCfg<boolean>(
              'copilotAutoApprove',
              true,
            ),
            codexReasoningEffort: this.getAgentCfg<string>(
              'codexReasoningEffort',
              '',
            ),
            copilotReasoningEffort: this.getAgentCfg<string>(
              'copilotReasoningEffort',
              '',
            ),
            piReasoningEffort: this.getAgentCfg<string>(
              'piReasoningEffort',
              '',
            ),
            mcpPort:
              this.stateStorage.get<number>(
                'agentOrchestration.mcpPort',
                51820,
              ) ?? 51820,
            disabledClis: this.getAgentCfg<string[]>('disabledClis', []),
            disabledMcpNamespaces: this.getAgentCfg<string[]>(
              'disabledMcpNamespaces',
              [],
            ),
            browserAllowLocalhost:
              this.workspace.getConfiguration<boolean>(
                'ptah',
                'browser.allowLocalhost',
                false,
              ) ?? false,
            workflowsDisabled:
              this.workspace.getConfiguration<boolean>(
                'ptah',
                'workflows.disabled',
                false,
              ) ?? false,
          };

          this.logger.debug('RPC: agent:getConfig success', {
            cliCount: detectedClis.length,
            installedCount: detectedClis.filter((c) => c.installed).length,
          });

          return result;
        } catch (error) {
          this.logger.error(
            'RPC: agent:getConfig failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          throw error;
        }
      },
    );
  }

  private registerSetConfig(): void {
    this.rpcHandler.registerMethod<
      AgentSetConfigParams,
      { success: boolean; error?: string }
    >('agent:setConfig', async (params) => {
      try {
        this.logger.debug('RPC: agent:setConfig called', { params });
        if (params.preferredAgentOrder !== undefined) {
          await this.setAgentCfg(
            'preferredAgentOrder',
            params.preferredAgentOrder,
          );
        }
        if (params.maxConcurrentAgents !== undefined) {
          await this.setAgentCfg(
            'maxConcurrentAgents',
            Math.max(1, Math.min(10, params.maxConcurrentAgents)),
          );
        }
        if (params.codexModel !== undefined) {
          await this.setAgentCfg('codexModel', params.codexModel);
        }
        if (params.copilotModel !== undefined) {
          await this.setAgentCfg('copilotModel', params.copilotModel);
        }
        if (params.cursorModel !== undefined) {
          await this.setAgentCfg('cursorModel', params.cursorModel);
        }
        if (params.antigravityModel !== undefined) {
          await this.setAgentCfg('antigravityModel', params.antigravityModel);
        }
        if (params.opencodeModel !== undefined) {
          await this.setAgentCfg('opencodeModel', params.opencodeModel);
        }
        if (params.piModel !== undefined) {
          await this.setAgentCfg('piModel', params.piModel);
        }
        if (params.cursorApiKey !== undefined) {
          await this.workspace.setConfiguration(
            'ptah',
            'provider.cursor.apiKey',
            params.cursorApiKey,
          );
          this.cliDetection.invalidateCache();
        }
        if (params.copilotAutoApprove !== undefined) {
          await this.setAgentCfg(
            'copilotAutoApprove',
            params.copilotAutoApprove,
          );
          const copilotAdapter = this.cliDetection.getAdapter('copilot');
          if (copilotAdapter && 'permissionBridge' in copilotAdapter) {
            const bridge = (
              copilotAdapter as { permissionBridge: CopilotPermissionBridge }
            ).permissionBridge;
            bridge.setAutoApprove(params.copilotAutoApprove);
          }
        }
        if (params.codexReasoningEffort !== undefined) {
          await this.setAgentCfg(
            'codexReasoningEffort',
            params.codexReasoningEffort,
          );
        }
        if (params.copilotReasoningEffort !== undefined) {
          await this.setAgentCfg(
            'copilotReasoningEffort',
            params.copilotReasoningEffort,
          );
        }
        if (params.piReasoningEffort !== undefined) {
          await this.setAgentCfg('piReasoningEffort', params.piReasoningEffort);
        }
        if (params.mcpPort !== undefined) {
          await this.stateStorage.update(
            'agentOrchestration.mcpPort',
            Math.max(1024, Math.min(65535, params.mcpPort)),
          );
        }
        if (params.disabledClis !== undefined) {
          await this.setAgentCfg('disabledClis', params.disabledClis);
        }
        if (params.disabledMcpNamespaces !== undefined) {
          await this.setAgentCfg(
            'disabledMcpNamespaces',
            params.disabledMcpNamespaces,
          );
        }
        if (params.browserAllowLocalhost !== undefined) {
          await this.workspace.setConfiguration(
            'ptah',
            'browser.allowLocalhost',
            params.browserAllowLocalhost,
          );
        }
        if (params.workflowsDisabled !== undefined) {
          await this.workspace.setConfiguration(
            'ptah',
            'workflows.disabled',
            params.workflowsDisabled,
          );
        }
        this.logger.debug('RPC: agent:setConfig success');
        return { success: true };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          'RPC: agent:setConfig failed',
          error instanceof Error ? error : new Error(errorMessage),
        );
        return { success: false, error: errorMessage };
      }
    });
  }

  private registerDetectClis(): void {
    this.rpcHandler.registerMethod<void, { clis: CliDetectionResult[] }>(
      'agent:detectClis',
      async () => {
        try {
          this.logger.debug('RPC: agent:detectClis called');
          this.cliDetection.invalidateCache();
          const cliResults = await this.cliDetection.detectAll();
          const detectedClis = await this.mergePtahCliAgents(cliResults);

          this.logger.debug('RPC: agent:detectClis success', {
            cliCount: detectedClis.length,
            installedCount: detectedClis.filter((c) => c.installed).length,
          });

          return { clis: detectedClis };
        } catch (error) {
          this.logger.error(
            'RPC: agent:detectClis failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          throw error;
        }
      },
    );
  }

  private registerListCliModels(): void {
    this.rpcHandler.registerMethod<void, AgentListCliModelsResult>(
      'agent:listCliModels',
      async () => {
        try {
          this.logger.debug('RPC: agent:listCliModels called');

          const modelMap = await this.cliDetection.listModelsForAll();

          // The Codex adapter only knows a curated list baked into the build.
          // `~/.codex/auth.json` is the same account the CLI uses, so the
          // account's live model menu is authoritative when it resolves.
          let codex = await this.getCodexModelsFromAuth();
          if (codex.length === 0) {
            codex = (modelMap['codex'] ?? []) as CliModelOption[];
          }
          // Hosts with a Language Model API (VS Code) report the models the
          // user actually has; everywhere else this is empty and the curated
          // per-CLI list stands in.
          let copilot = await this.getCopilotModelsFromHost();
          if (copilot.length === 0) {
            copilot = (modelMap['copilot'] ?? []) as CliModelOption[];
          }
          const cursor = (modelMap['cursor'] ?? []) as CliModelOption[];
          const antigravity = (modelMap['antigravity'] ??
            []) as CliModelOption[];
          const opencode = (modelMap['opencode'] ?? []) as CliModelOption[];
          const pi = (modelMap['pi'] ?? []) as CliModelOption[];

          const result: AgentListCliModelsResult = {
            codex,
            copilot,
            cursor,
            antigravity,
            opencode,
            pi,
          };

          this.logger.debug('RPC: agent:listCliModels success', {
            codexCount: result.codex.length,
            copilotCount: result.copilot.length,
            cursorCount: result.cursor.length,
            antigravityCount: result.antigravity.length,
            opencodeCount: result.opencode.length,
            piCount: result.pi.length,
          });

          return result;
        } catch (error: unknown) {
          this.captureException(
            error,
            'AgentRpcHandlers.registerListCliModels',
          );
          this.logger.error(
            'RPC: agent:listCliModels failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          throw error;
        }
      },
    );
  }

  /**
   * Copilot models as reported by the host's Language Model API, with
   * human-readable display names. Empty when the host has no such API.
   */
  private async getCopilotModelsFromHost(): Promise<CliModelOption[]> {
    try {
      const models = await this.modelDiscovery.getCopilotModels();
      return models.map((model) => ({
        id: model.id,
        name: this.formatModelDisplayName(model.id),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Codex models for the account in `~/.codex/auth.json`, as reported by the
   * provider `/models` endpoint. Empty when unauthenticated or offline, in
   * which case the adapter's curated list stands in.
   */
  private async getCodexModelsFromAuth(): Promise<CliModelOption[]> {
    try {
      const models = await this.codexAuthService.listModels();
      return models.map((model) => ({
        id: model.id,
        name: model.name || this.formatModelDisplayName(model.id),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Convert a model family slug to a human-readable name.
   * e.g. "claude-opus-4.6" -> "Claude Opus 4.6"
   *      "gpt-5.3-codex"   -> "GPT 5.3 Codex"
   */
  private formatModelDisplayName(family: string): string {
    return family
      .split('-')
      .map((part) => {
        if (/^\d/.test(part)) return part;
        const upper = part.toUpperCase();
        if (['GPT', 'AI'].includes(upper)) return upper;
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join(' ');
  }

  /**
   * Forward an error to Sentry when the host registered it. Guarded rather
   * than injected because the headless hosts boot without Sentry.
   */
  private captureException(error: unknown, errorSource: string): void {
    if (!this.runtimeContainer.isRegistered(TOKENS.SENTRY_SERVICE)) return;
    try {
      this.runtimeContainer
        .resolve<{
          captureException(e: Error, ctx: { errorSource: string }): void;
        }>(TOKENS.SENTRY_SERVICE)
        .captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource },
        );
    } catch {
      // Observability must never break an RPC call.
    }
  }

  /**
   * agent:permissionResponse - Route user's permission decision to handlers
   *
   * Tries both:
   * 1. SdkPermissionHandler (Ptah CLI agent permissions) - via lazy container resolution
   * 2. CopilotPermissionBridge (Copilot SDK permissions) - via CLI adapter
   *
   * Both handlers silently ignore unknown requestIds, so trying both is safe.
   */
  private registerPermissionResponse(): void {
    this.rpcHandler.registerMethod<
      AgentPermissionDecision,
      { success: boolean; error?: string }
    >('agent:permissionResponse', async (params) => {
      try {
        this.logger.debug('RPC: agent:permissionResponse called', {
          requestId: params.requestId,
          decision: params.decision,
        });

        let handled = false;
        if (
          this.runtimeContainer.isRegistered(SDK_TOKENS.SDK_PERMISSION_HANDLER)
        ) {
          const permissionHandler =
            this.runtimeContainer.resolve<ISdkPermissionHandler>(
              SDK_TOKENS.SDK_PERMISSION_HANDLER,
            );
          const response: PermissionResponse = {
            id: params.requestId,
            decision: params.decision,
            reason: params.reason,
          };
          permissionHandler.handleResponse(params.requestId, response);
          handled = true;
        }
        const copilotAdapter = this.cliDetection.getAdapter('copilot');
        if (copilotAdapter && 'permissionBridge' in copilotAdapter) {
          const bridge = (
            copilotAdapter as { permissionBridge: CopilotPermissionBridge }
          ).permissionBridge;
          bridge.resolvePermission(params.requestId, params);
          handled = true;
        }

        if (handled) {
          return { success: true };
        }

        return {
          success: false,
          error: 'No permission handler available (neither SDK nor Copilot)',
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          'RPC: agent:permissionResponse failed',
          error instanceof Error ? error : new Error(errorMessage),
        );
        return { success: false, error: errorMessage };
      }
    });
  }

  /**
   * agent:e2eSeedPermission — TEST-ONLY seam (TASK_2026_264).
   *
   * TASK_2026_247 fixed the scope and mapping of a permission-cleanup path
   * that only runs when a permission is genuinely IN FLIGHT at the moment a
   * config change or teardown disposes sessions. Nothing outside a live SDK
   * tool call ever reaches `SdkPermissionHandler.createCallback()`, and the
   * unit specs that pin the fix (`sdk-permission-handler.spec.ts`,
   * `session-lifecycle-manager-dispose.spec.ts`) get there by importing the
   * class directly in-process. An Electron e2e cannot import backend classes
   * — it only has the RPC transport — so without this method there is no way
   * to put a REAL, ROUTABLE entry in the REAL `pendingRequests` map from
   * outside the process, and the fix's wiring-level gap (does a real
   * `auth:saveSettings` write actually reach `disposeAllSessions()`?) would
   * stay unverifiable by anything but a live model + real credentials, which
   * `.ptah/specs/TASK_2026_264/context.md` rules out as too
   * environment-dependent for CI.
   *
   * This method does nothing a unit test could not already do in-process: it
   * calls the same public `createCallback()` the SDK itself calls for every
   * tool permission check, with the same arguments shape the specs already
   * use. It is not a new capability, only a new place to reach an existing
   * one from. Gated on `PTAH_E2E==='1'` — the flag
   * `apps/ptah-electron-e2e/src/support/electron-launcher.ts` always sets and
   * a real user's build never has — as belt-and-braces on top of the RPC
   * channel already being unreachable outside the app's own IPC.
   *
   * Awaits the full permission round trip rather than firing-and-forgetting:
   * the caller needs the actual resolved `behavior`/`message`/`interrupt`
   * (not just "did it arrive"), and that value only exists once something
   * resolves the pending request — a webview answer, a session teardown, or
   * (for an unroutable request) the 60s deny timeout. A caller that seeds an
   * unroutable request should pass a `sendRpc` timeout comfortably past 60s.
   */
  private registerE2eSeedPermission(): void {
    const paramsSchema = z.object({
      toolName: z.string().min(1),
      input: z.record(z.string(), z.unknown()),
      toolUseId: z.string().min(1),
      sessionId: z.string().optional(),
      tabId: z.string().optional(),
    });

    this.rpcHandler.registerMethod<
      unknown,
      {
        success: boolean;
        error?: string;
        behavior?: 'allow' | 'deny';
        message?: string;
        interrupt?: boolean;
      }
    >('agent:e2eSeedPermission', async (rawParams) => {
      if (process.env['PTAH_E2E'] !== '1') {
        return { success: false, error: 'e2e-only' };
      }
      try {
        const params = paramsSchema.parse(rawParams);
        if (
          !this.runtimeContainer.isRegistered(SDK_TOKENS.SDK_PERMISSION_HANDLER)
        ) {
          return {
            success: false,
            error: 'SdkPermissionHandler not registered',
          };
        }
        const permissionHandler =
          this.runtimeContainer.resolve<SdkPermissionHandler>(
            SDK_TOKENS.SDK_PERMISSION_HANDLER,
          );
        const callback = permissionHandler.createCallback(
          params.sessionId as SessionId | undefined,
          undefined,
          params.tabId as TabId | undefined,
        );
        const result = await callback(params.toolName, params.input, {
          signal: new AbortController().signal,
          toolUseID: params.toolUseId,
        });
        return {
          success: true,
          behavior: result.behavior,
          message: 'message' in result ? result.message : undefined,
          interrupt: 'interrupt' in result ? result.interrupt : undefined,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          'RPC: agent:e2eSeedPermission failed',
          error instanceof Error ? error : new Error(errorMessage),
        );
        return { success: false, error: errorMessage };
      }
    });
  }

  private registerAgentStop(): void {
    this.rpcHandler.registerMethod<
      { agentId: string },
      { success: boolean; error?: string }
    >('agent:stop', async (params) => {
      try {
        this.logger.debug('RPC: agent:stop called', {
          agentId: params.agentId,
        });

        const result = await this.agentProcessManager.stop(params.agentId);

        this.logger.info('RPC: agent:stop success', {
          agentId: params.agentId,
          status: result.status,
        });

        return { success: true };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          'RPC: agent:stop failed',
          error instanceof Error ? error : new Error(errorMessage),
        );
        return { success: false, error: errorMessage };
      }
    });
  }

  private registerAgentContinue(): void {
    this.rpcHandler.registerMethod<
      { agentId: string; message: string },
      { success: boolean; error?: string; code?: AgentContinueErrorCode }
    >('agent:continue', async (params) => {
      try {
        this.logger.debug('RPC: agent:continue called', {
          agentId: params.agentId,
        });

        await this.agentProcessManager.continueConversation(
          params.agentId,
          params.message,
        );

        this.logger.info('RPC: agent:continue success', {
          agentId: params.agentId,
        });

        return { success: true };
      } catch (error) {
        if (error instanceof AgentContinueError) {
          this.logger.warn('RPC: agent:continue rejected', {
            agentId: params.agentId,
            code: error.code,
          });
          return { success: false, code: error.code, error: error.message };
        }
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          'RPC: agent:continue failed',
          error instanceof Error ? error : new Error(errorMessage),
        );
        return {
          success: false,
          code: 'unknown',
          error: 'Failed to continue agent conversation',
        };
      }
    });
  }

  private registerResumeCliSession(): void {
    this.rpcHandler.registerMethod<
      {
        cliSessionId: string;
        cli: CliType;
        task: string;
        parentSessionId?: string;
        ptahCliId?: string;
        previousAgentId?: string;
      },
      { success: boolean; agentId?: string; error?: string }
    >('agent:resumeCliSession', async (params) => {
      try {
        this.logger.debug('RPC: agent:resumeCliSession called', {
          cliSessionId: params.cliSessionId,
          cli: params.cli,
          ptahCliId: params.ptahCliId,
        });

        let result: SpawnAgentResult;
        const workspaceRoot = this.workspace.getWorkspaceRoot() ?? '';

        let ptahCliId = params.ptahCliId;
        if (params.cli === 'ptah-cli' && !ptahCliId) {
          ptahCliId = await this.resolveDefaultPtahCliId();
        }

        if (params.cli === 'ptah-cli' && ptahCliId) {
          result = await this.resumePtahCliSession(
            { ...params, ptahCliId },
            workspaceRoot,
          );
        } else if (params.cli === 'ptah-cli') {
          throw new Error(
            'No Ptah CLI agents configured. Add one in Agent Orchestration settings.',
          );
        } else {
          const cliSessionExists = await this.sessionFileExists(
            params.cliSessionId,
            workspaceRoot,
          );
          if (!cliSessionExists) {
            this.logger.warn(
              `[AgentRpc] CLI session file not found for ${params.cliSessionId} — starting fresh`,
            );
          }
          result = await this.agentProcessManager.spawn({
            cli: params.cli,
            task: params.task,
            resumeSessionId: cliSessionExists ? params.cliSessionId : undefined,
            parentSessionId: params.parentSessionId,
            ptahCliId: params.ptahCliId,
            resumedFromAgentId: params.previousAgentId,
          });
        }

        this.logger.info('RPC: agent:resumeCliSession success', {
          agentId: result.agentId,
          cli: params.cli,
          resumedFrom: params.cliSessionId,
        });

        return { success: true, agentId: result.agentId };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          'RPC: agent:resumeCliSession failed',
          error instanceof Error ? error : new Error(errorMessage),
        );
        return { success: false, error: errorMessage };
      }
    });
  }

  private async mergePtahCliAgents(
    cliResults: CliDetectionResult[],
  ): Promise<CliDetectionResult[]> {
    try {
      const ptahCliAgents = await this.ptahCliRegistry.listAgents();
      const ptahClis: CliDetectionResult[] = ptahCliAgents
        .filter((a) => a.enabled && a.hasApiKey)
        .map((a) => ({
          cli: 'ptah-cli' as const,
          installed: true,
          supportsSteer: false,
          ptahCliId: a.id,
          ptahCliName: a.name,
          providerName: a.providerName,
          providerId: a.providerId,
        }));
      return [...cliResults, ...ptahClis];
    } catch {
      return cliResults;
    }
  }

  private async resumePtahCliSession(
    params: {
      cliSessionId: string;
      cli: CliType;
      task: string;
      parentSessionId?: string;
      ptahCliId: string;
      previousAgentId?: string;
    },
    workspaceRoot: string,
  ): Promise<SpawnAgentResult> {
    const sessionFileExists = await this.sessionFileExists(
      params.cliSessionId,
      workspaceRoot,
    );

    const spawnResult = await this.ptahCliRegistry.spawnAgent(
      params.ptahCliId,
      params.task,
      {
        workingDirectory: workspaceRoot,
        resumeSessionId: sessionFileExists ? params.cliSessionId : undefined,
      },
    );

    if (!sessionFileExists) {
      this.logger.warn(
        `[AgentRpc] Session file not found for ${params.cliSessionId} — starting fresh instead of resuming`,
      );
    }

    if ('status' in spawnResult) {
      throw new Error(`Ptah CLI agent resume failed: ${spawnResult.message}`);
    }

    if (spawnResult.handle.onSessionResolved) {
      spawnResult.handle.onSessionResolved((sessionId: string) => {
        const sessionName = `CLI Agent: ${spawnResult.agentName}`;
        this.sessionMetadataStore
          .createChild(sessionId, workspaceRoot, sessionName)
          .catch((err) =>
            this.logger.warn(
              `[AgentRpc] Failed to save child session metadata: ${err}`,
            ),
          );
      });
    }

    const result = await this.agentProcessManager.spawnFromSdkHandle(
      spawnResult.handle,
      {
        task: params.task,
        cli: 'ptah-cli',
        workingDirectory: workspaceRoot,
        parentSessionId: params.parentSessionId,
        ptahCliName: spawnResult.agentName,
        ptahCliId: params.ptahCliId,
        resumedFromAgentId: params.previousAgentId,
        resumeSessionId: sessionFileExists ? params.cliSessionId : undefined,
      },
    );
    spawnResult.setAgentId(result.agentId);

    return result;
  }

  private async resolveDefaultPtahCliId(): Promise<string | undefined> {
    try {
      const agents = await this.ptahCliRegistry.listAgents();
      const enabled = agents.find((a) => a.enabled && a.hasApiKey);
      if (enabled) {
        this.logger.info(
          'RPC: agent:resumeCliSession resolved default ptahCliId',
          { ptahCliId: enabled.id, name: enabled.name },
        );
      }
      return enabled?.id;
    } catch {
      return undefined;
    }
  }

  /**
   * Read an `agentOrchestration.<key>` setting via IWorkspaceProvider so
   * file-based keys route through PtahFileSettingsManager (~/.ptah/settings.json)
   * — matching the VS Code handler and the read in
   * agent-process-manager.service.ts so the orchestration gate sees writes
   * made from this handler.
   */
  private getAgentCfg<T>(name: string, defaultValue: T): T {
    return (
      this.workspace.getConfiguration<T>(
        'ptah',
        `agentOrchestration.${name}`,
        defaultValue,
      ) ?? defaultValue
    );
  }

  /**
   * Write an `agentOrchestration.<key>` setting via IWorkspaceProvider.
   * Companion to {@link getAgentCfg}.
   */
  private async setAgentCfg(name: string, value: unknown): Promise<void> {
    await this.workspace.setConfiguration(
      'ptah',
      `agentOrchestration.${name}`,
      value,
    );
  }

  /**
   * Whether a Cursor API key is resolvable — either CURSOR_API_KEY in the
   * environment or `provider.cursor.apiKey` in ~/.ptah/settings.json. Mirrors
   * the resolution order in CursorCliAdapter; the raw key is never returned.
   */
  private isCursorApiKeyConfigured(): boolean {
    const envKey = process.env['CURSOR_API_KEY'];
    if (envKey && envKey.trim()) {
      return true;
    }
    const fileKey = this.workspace.getConfiguration<string>(
      'ptah',
      'provider.cursor.apiKey',
      '',
    );
    return !!fileKey && fileKey.trim().length > 0;
  }

  /**
   * One-shot migration: copy any pre-existing `agentOrchestration.*` values
   * from IStateStorage (legacy `global-state.json` location) into the
   * IWorkspaceProvider, where they can actually be observed by the gate in
   * `agent-process-manager.service.ts`. Idempotent — guarded by a flag in
   * stateStorage so subsequent launches are no-ops.
   *
   * Skips keys that already exist in the workspace provider so we never
   * clobber a value the user set after upgrading.
   */
  private async migrateAgentOrchestrationSettings(): Promise<void> {
    const FLAG_KEY = 'agentOrchestration.migratedToFileSettings';
    if (this.stateStorage.get<boolean>(FLAG_KEY, false) === true) {
      return;
    }
    const KEYS_TO_MIGRATE = [
      'preferredAgentOrder',
      'maxConcurrentAgents',
      'codexModel',
      'copilotModel',
      'codexAutoApprove',
      'copilotAutoApprove',
      'codexReasoningEffort',
      'copilotReasoningEffort',
      'disabledClis',
      'disabledMcpNamespaces',
    ] as const;

    try {
      let migratedCount = 0;
      for (const key of KEYS_TO_MIGRATE) {
        const stateKey = `agentOrchestration.${key}`;
        const stateValue = this.stateStorage.get<unknown>(stateKey, undefined);
        if (stateValue === undefined) {
          continue;
        }
        const existing = this.workspace.getConfiguration<unknown>(
          'ptah',
          stateKey,
          undefined,
        );
        if (existing !== undefined) {
          continue;
        }

        await this.workspace.setConfiguration('ptah', stateKey, stateValue);
        migratedCount++;
      }

      await this.stateStorage.update(FLAG_KEY, true);

      if (migratedCount > 0) {
        this.logger.info(
          'Migrated agentOrchestration settings from stateStorage to workspace provider',
          { migratedCount },
        );
      }
    } catch (error) {
      this.logger.warn(
        `[AgentRpc] agentOrchestration migration failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Check if a Claude SDK JSONL session file exists on disk.
   * Returns true if the file is found, false otherwise.
   */
  private async sessionFileExists(
    sessionId: string,
    workspacePath: string,
  ): Promise<boolean> {
    const projectsDir = path.join(os.homedir(), '.claude', 'projects');
    const escapedPath = workspacePath.replace(/[:\\/]/g, '-');
    const dirs = await fs.readdir(projectsDir);

    const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, '-');
    const normalizedEscaped = normalize(escapedPath);
    const matchedDir = dirs.find(
      (d) =>
        d === escapedPath ||
        d.toLowerCase() === escapedPath.toLowerCase() ||
        normalize(d) === normalizedEscaped,
    );

    if (matchedDir) {
      const sessionFile = path.join(
        projectsDir,
        matchedDir,
        `${sessionId}.jsonl`,
      );

      await fs.access(sessionFile);
      return true;
    }

    return false;
  }
}
