/**
 * Electron RPC Method Registration Service
 *
 * Class-based orchestrator mirroring the VS Code pattern. Shared handler
 * registration + SDK / agent-event wiring is delegated to helpers in
 * `@ptah-extension/rpc-handlers` and `@ptah-extension/agent-sdk`. Only the
 * Electron-specific handler fan-out and the `ELECTRON_EXCLUDED_METHODS`
 * verification list stay in this file.
 *
 * TASK_2025_203 Batch 5: original rewrite to class orchestrator.
 * TASK_2025_209: unified Chat / LLM handlers.
 * TASK_2025_291 Wave C6: dropped redundant Electron prefix.
 * TASK_2025_291 Wave C4b: shared fan-out + wiring moved to shared helpers.
 * TASK_2026_104 Batch 6a: `mcpDirectory:*` lifted to shared rpc-handlers;
 * `ELECTRON_EXCLUDED_METHODS` is now empty (Electron exposes the full RPC
 * surface from the shared registry).
 */

import { injectable, inject, container } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import {
  registerAllRpcHandlers,
  registerHarnessServices,
  registerChatServices,
  verifyAndReportRpcRegistration,
  __debugAssertSharedHandlersDisjoint,
} from '@ptah-extension/rpc-handlers';
import {
  wireSdkCallbacks,
  wireAgentEventListeners,
  type WorktreeCreatedData,
} from '@ptah-extension/agent-sdk';
import { ChatRpcHandlers } from '@ptah-extension/rpc-handlers';

// Electron-specific handler classes (TASK_2025_291 Wave C6: Electron prefix dropped).
import {
  WorkspaceRpcHandlers,
  EditorRpcHandlers,
  FileRpcHandlers,
  ConfigExtendedRpcHandlers,
  CommandRpcHandlers,
  SettingsRpcHandlers,
  AgentRpcHandlers,
  SkillsShRpcHandlers,
  LayoutRpcHandlers,
  GitRpcHandlers,
  TerminalRpcHandlers,
} from './handlers';
import { ELECTRON_TOKENS } from '../../di/electron-tokens';
import type { GitInfoService } from '../git-info.service';

/**
 * Methods omitted from Electron's RPC verification.
 *
 * TASK_2026_104 Batch 6a: `mcpDirectory:*` was previously excluded because
 * the handler lived in the VS Code app. The handler is now in the shared
 * `rpc-handlers` library and Electron registers it via Phase 4 — exclusion
 * removed.
 */
const ELECTRON_EXCLUDED_METHODS: readonly string[] = [];

/**
 * Orchestrates RPC method registration for the Electron desktop app.
 */
@injectable()
export class ElectronRpcMethodRegistrationService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(ChatRpcHandlers) private readonly chatHandlers: ChatRpcHandlers,
    @inject(WorkspaceRpcHandlers)
    private readonly workspaceHandlers: WorkspaceRpcHandlers,
    @inject(EditorRpcHandlers)
    private readonly editorHandlers: EditorRpcHandlers,
    @inject(FileRpcHandlers)
    private readonly fileHandlers: FileRpcHandlers,
    @inject(ConfigExtendedRpcHandlers)
    private readonly configExtendedHandlers: ConfigExtendedRpcHandlers,
    @inject(CommandRpcHandlers)
    private readonly commandHandlers: CommandRpcHandlers,
    @inject(SettingsRpcHandlers)
    private readonly settingsHandlers: SettingsRpcHandlers,
    @inject(AgentRpcHandlers)
    private readonly agentHandlers: AgentRpcHandlers,
    @inject(SkillsShRpcHandlers)
    private readonly skillsShHandlers: SkillsShRpcHandlers,
    @inject(LayoutRpcHandlers)
    private readonly layoutHandlers: LayoutRpcHandlers,
    @inject(GitRpcHandlers)
    private readonly gitHandlers: GitRpcHandlers,
    @inject(TerminalRpcHandlers)
    private readonly terminalHandlers: TerminalRpcHandlers,
  ) {}

  /**
   * Register all RPC methods and wire SDK / agent events.
   *
   * Shared handlers register first (platform-agnostic), then Electron-specific
   * handlers register supplementary/override methods.
   */
  registerAll(): void {
    // Wave C7d: wire the six extracted harness services BEFORE
    // `registerAllRpcHandlers` resolves `HarnessRpcHandlers`.
    registerHarnessServices(container);

    // Wave C7e: wire the four extracted chat services BEFORE
    // `registerAllRpcHandlers` resolves `ChatRpcHandlers`.
    registerChatServices(container);

    registerAllRpcHandlers(container);
    this.registerElectronHandlers();

    wireSdkCallbacks(container, {
      logger: this.logger,
      platform: 'electron',
      options: {
        worktree: true,
        resolveWorktreePath: async (data: WorktreeCreatedData) => {
          try {
            if (!container.isRegistered(ELECTRON_TOKENS.GIT_INFO_SERVICE)) {
              return undefined;
            }
            const gitInfo = container.resolve<GitInfoService>(
              ELECTRON_TOKENS.GIT_INFO_SERVICE,
            );
            const worktrees = await gitInfo.getWorktrees(data.cwd);
            const match = worktrees.find((w) => w.branch === data.name);
            return match?.path;
          } catch (err) {
            this.logger.warn(
              '[Electron RPC] Failed to resolve worktree path',
              err instanceof Error ? err : new Error(String(err)),
            );
            return undefined;
          }
        },
        getSdkSessionId: (ptahCliId: string) =>
          this.chatHandlers.getPtahCliSdkSessionId(ptahCliId),
      },
    });

    wireAgentEventListeners(container, {
      logger: this.logger,
      platform: 'electron',
      options: {
        wizardBroadcast: false,
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
      platform: 'electron',
      excluded: ELECTRON_EXCLUDED_METHODS,
    });

    if (process.env['NODE_ENV'] === 'development') {
      __debugAssertSharedHandlersDisjoint();
    }

    this.logger.info('[Electron RPC] All RPC methods registered', {
      methods: this.rpcHandler.getRegisteredMethods(),
    });
  }

  private registerElectronHandlers(): void {
    const electronHandlers: Array<{
      name: string;
      handler: { register(): void };
    }> = [
      { name: 'WorkspaceRpcHandlers', handler: this.workspaceHandlers },
      { name: 'EditorRpcHandlers', handler: this.editorHandlers },
      { name: 'FileRpcHandlers', handler: this.fileHandlers },
      {
        name: 'ConfigExtendedRpcHandlers',
        handler: this.configExtendedHandlers,
      },
      { name: 'CommandRpcHandlers', handler: this.commandHandlers },
      { name: 'SettingsRpcHandlers', handler: this.settingsHandlers },
      { name: 'AgentRpcHandlers', handler: this.agentHandlers },
      { name: 'SkillsShRpcHandlers', handler: this.skillsShHandlers },
      { name: 'LayoutRpcHandlers', handler: this.layoutHandlers },
      { name: 'GitRpcHandlers', handler: this.gitHandlers },
      { name: 'TerminalRpcHandlers', handler: this.terminalHandlers },
    ];

    for (const { name, handler } of electronHandlers) {
      try {
        handler.register();
        this.logger.info(`[Electron RPC] ${name} registered (Electron)`);
      } catch (error) {
        this.logger.warn(
          `[Electron RPC] Failed to register ${name} (Electron)`,
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
    }
  }
}
