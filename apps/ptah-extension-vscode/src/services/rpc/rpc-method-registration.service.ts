/**
 * RPC Method Registration Service
 *
 * Orchestrates RPC handler registration by delegating to shared + Tier-3
 * handler classes and the four reusable wiring helpers:
 *   - `registerAllRpcHandlers` (@ptah-extension/rpc-handlers)
 *   - `verifyAndReportRpcRegistration` (@ptah-extension/rpc-handlers)
 *   - `wireSdkCallbacks` (@ptah-extension/agent-sdk)
 *   - `wireAgentEventListeners` (@ptah-extension/agent-sdk)
 *
 * TASK_2025_051: SDK-only migration.
 * TASK_2025_074: First decomposition (~1500 → ~150 lines orchestrator).
 * TASK_2025_291 Wave C4b: shared-handler fan-out + SDK / agent-event wiring
 * moved to platform-agnostic helpers.
 */

import { injectable, inject, DependencyContainer, container } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  TOKENS,
  CommandManager,
} from '@ptah-extension/vscode-core';
import {
  registerAllRpcHandlers,
  registerHarnessServices,
  registerChatServices,
  verifyAndReportRpcRegistration,
  WorkspaceRpcHandlers,
  __debugAssertSharedHandlersDisjoint,
} from '@ptah-extension/rpc-handlers';
import {
  wireSdkCallbacks,
  wireAgentEventListeners,
  type WorktreeCreatedData,
} from '@ptah-extension/agent-sdk';
import { parseWorktreeList } from '@ptah-extension/shared';
import { AGENT_GENERATION_TOKENS } from '@ptah-extension/agent-generation';
import * as vscode from 'vscode';

// Tier 3 handlers (VS Code-specific, local to this app).
// `McpDirectoryRpcHandlers` was lifted to shared in TASK_2026_104 Batch 6a and
// is now registered via `registerAllRpcHandlers()` — no manual register() call.
import {
  ChatRpcHandlers,
  FileRpcHandlers,
  CommandRpcHandlers,
  AgentRpcHandlers,
  SkillsShRpcHandlers,
} from './handlers';

/**
 * RPC methods not applicable in VS Code — Electron desktop-app features.
 * Excluded from RPC verification so the shared registry can still enumerate them.
 */
const ELECTRON_ONLY_METHODS: readonly string[] = [
  'workspace:getInfo',
  'workspace:addFolder',
  'workspace:registerFolder',
  'workspace:removeFolder',
  'workspace:switch',
  'layout:persist',
  'layout:restore',
  'editor:openFile',
  'editor:saveFile',
  'editor:getFileTree',
  'editor:getDirectoryChildren',
  'file:read',
  'file:exists',
  'file:save-dialog',
  'config:model-set',
  'auth:setApiKey',
  'auth:getStatus',
  'settings:export',
  'settings:import',
  'git:info',
  'git:worktrees',
  'git:addWorktree',
  'git:removeWorktree',
  'git:stage',
  'git:unstage',
  'git:discard',
  'git:commit',
  'git:showFile',
  'terminal:create',
  'terminal:kill',
  'license:clearKey',
];

/**
 * Orchestrates RPC method registration for the VS Code extension host.
 */
@injectable()
export class RpcMethodRegistrationService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.COMMAND_MANAGER)
    private readonly commandManager: CommandManager,
    @inject(ChatRpcHandlers) private readonly chatHandlers: ChatRpcHandlers,
    @inject(FileRpcHandlers) private readonly fileHandlers: FileRpcHandlers,
    @inject(CommandRpcHandlers)
    private readonly commandHandlers: CommandRpcHandlers,
    @inject(AgentRpcHandlers) private readonly agentHandlers: AgentRpcHandlers,
    @inject(SkillsShRpcHandlers)
    private readonly skillsShHandlers: SkillsShRpcHandlers,
    @inject('DependencyContainer')
    private readonly container: DependencyContainer,
  ) {
    this.registerSetupAgentsCommand();
  }

  /**
   * Register all RPC methods and wire SDK / agent events.
   */
  registerAll(): void {
    // Wave C7d: wire the six extracted harness services BEFORE
    // `registerAllRpcHandlers` resolves `HarnessRpcHandlers`.
    registerHarnessServices(this.container);

    // Wave C7e: wire the four extracted chat services BEFORE
    // `registerAllRpcHandlers` resolves `ChatRpcHandlers`.
    registerChatServices(this.container);

    // VS Code excludes WorkspaceRpcHandlers: VsCodeWorkspaceProvider has no
    // lifecycle methods, so IWorkspaceLifecycleProvider is not registered in
    // this host. The workspace:* methods are listed in ELECTRON_ONLY_METHODS
    // so the verifier accepts the gap.
    registerAllRpcHandlers(this.container, { exclude: [WorkspaceRpcHandlers] });

    this.fileHandlers.register();
    this.commandHandlers.register();
    this.agentHandlers.register();
    this.skillsShHandlers.register();
    // McpDirectoryRpcHandlers is registered via `registerAllRpcHandlers` above
    // (TASK_2026_104 Batch 6a — lifted to shared `rpc-handlers` library).

    this.logger.info('RPC methods registered (SDK-only mode)', {
      methods: this.rpcHandler.getRegisteredMethods(),
    });

    wireSdkCallbacks(this.container, {
      logger: this.logger,
      platform: 'vscode',
      options: {
        worktree: true,
        resolveWorktreePath: async (data: WorktreeCreatedData) => {
          // VS Code resolves via dynamic `cross-spawn` import (extension host has no
          // @ptah-extension/platform-* dependency at this layer).
          try {
            const crossSpawn = await import('cross-spawn');
            const child = crossSpawn.default(
              'git',
              ['worktree', 'list', '--porcelain'],
              { cwd: data.cwd, stdio: ['pipe', 'pipe', 'pipe'] },
            );
            const chunks: Buffer[] = [];
            child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
            await new Promise<void>((resolve) =>
              child.on('close', () => resolve()),
            );
            const output = Buffer.concat(chunks).toString();
            const worktrees = parseWorktreeList(output);
            const match = worktrees.find((w) => w.branch === data.name);
            return match?.path;
          } catch (err) {
            this.logger.warn(
              '[RPC] Failed to resolve worktree path',
              err instanceof Error ? err : new Error(String(err)),
            );
            return undefined;
          }
        },
        getSdkSessionId: (ptahCliId: string) =>
          this.chatHandlers.getPtahCliSdkSessionId(ptahCliId),
      },
    });

    wireAgentEventListeners(this.container, {
      logger: this.logger,
      platform: 'vscode',
      options: {
        wizardBroadcast: true,
        copilotPermission: true,
        persistCliSession: true,
        getSdkSessionId: (ptahCliId: string) =>
          this.chatHandlers.getPtahCliSdkSessionId(ptahCliId),
      },
    });

    verifyAndReportRpcRegistration({
      rpcHandler: this.rpcHandler,
      logger: this.logger,
      container,
      sentryToken: TOKENS.SENTRY_SERVICE,
      platform: 'vscode',
      excluded: ELECTRON_ONLY_METHODS,
    });

    if (process.env['NODE_ENV'] === 'development') {
      __debugAssertSharedHandlersDisjoint();
    }
  }

  /**
   * Register VS Code command for launching the setup wizard.
   * VS Code-only — couples to the `vscode` namespace, cannot move to a
   * platform-agnostic library.
   */
  private registerSetupAgentsCommand(): void {
    try {
      this.commandManager.registerCommand({
        id: 'ptah.setupAgents',
        title: 'Setup Ptah Agents',
        category: 'Ptah',
        handler: async () => {
          const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

          if (!workspaceFolder) {
            vscode.window.showErrorMessage(
              'No workspace open. Please open a folder first.',
            );
            return;
          }

          try {
            const setupWizardService = this.container.resolve(
              AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE,
            ) as {
              launchWizard: (workspacePath: string) => Promise<{
                isErr?: () => boolean;
                error?: { message: string };
              }>;
            };

            const result = await setupWizardService.launchWizard(
              workspaceFolder.uri.fsPath,
            );

            if (result.isErr && result.isErr()) {
              vscode.window.showErrorMessage(
                `Failed to launch setup wizard: ${result.error?.message}`,
              );
            }
          } catch (error) {
            this.logger.error(
              'Failed to launch setup wizard',
              error instanceof Error ? error : new Error(String(error)),
            );
            vscode.window.showErrorMessage(
              `Failed to launch setup wizard: ${
                error instanceof Error ? error.message : 'Unknown error'
              }`,
            );
          }
        },
      });

      this.logger.info('Setup agents command registered');
    } catch (error) {
      // Command may already be registered by another instance of the extension
      // (e.g., marketplace version running alongside dev build).
      this.logger.warn(
        'Setup agents command registration skipped (likely already registered)',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
}
