/**
 * Electron RPC Method Registration Service
 *
 * Class-based orchestrator mirroring the VS Code pattern. Shared handler
 * registration + SDK / agent-event wiring is delegated to helpers in
 * `@ptah-extension/rpc-handlers` and `@ptah-extension/agent-sdk`. Only the
 * Electron-specific handler fan-out and the `ELECTRON_EXCLUDED_METHODS`
 * verification list stay in this file.
 *
 * `mcpDirectory:*` is registered via the shared rpc-handlers library, so
 * `ELECTRON_EXCLUDED_METHODS` is empty (Electron exposes the full RPC surface
 * from the shared registry).
 */

import { injectable, inject, container } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type {
  GitInfoService,
  Logger,
  RpcHandler,
} from '@ptah-extension/vscode-core';
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

// Electron-specific handler classes.
// GitRpcHandlers and WorkspaceRpcHandlers live in shared rpc-handlers
// (registered + dispatched via SHARED_HANDLERS).
import {
  EditorRpcHandlers,
  FileRpcHandlers,
  ConfigExtendedRpcHandlers,
  CommandRpcHandlers,
  AgentRpcHandlers,
  SkillsShRpcHandlers,
  LayoutRpcHandlers,
  TerminalRpcHandlers,
  UpdateRpcHandlers,
} from './handlers';

/**
 * Methods omitted from Electron's RPC verification.
 *
 * Empty: `mcpDirectory:*` now lives in the shared `rpc-handlers` library and
 * Electron registers it via Phase 4.
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
    @inject(EditorRpcHandlers)
    private readonly editorHandlers: EditorRpcHandlers,
    @inject(FileRpcHandlers)
    private readonly fileHandlers: FileRpcHandlers,
    @inject(ConfigExtendedRpcHandlers)
    private readonly configExtendedHandlers: ConfigExtendedRpcHandlers,
    @inject(CommandRpcHandlers)
    private readonly commandHandlers: CommandRpcHandlers,
    @inject(AgentRpcHandlers)
    private readonly agentHandlers: AgentRpcHandlers,
    @inject(SkillsShRpcHandlers)
    private readonly skillsShHandlers: SkillsShRpcHandlers,
    @inject(LayoutRpcHandlers)
    private readonly layoutHandlers: LayoutRpcHandlers,
    @inject(TerminalRpcHandlers)
    private readonly terminalHandlers: TerminalRpcHandlers,
    @inject(UpdateRpcHandlers)
    private readonly updateHandlers: UpdateRpcHandlers,
  ) {}

  /**
   * Register all RPC methods and wire SDK / agent events.
   *
   * Shared handlers register first (platform-agnostic), then Electron-specific
   * handlers register supplementary/override methods.
   */
  registerAll(): void {
    // Wire the six extracted harness services BEFORE
    // `registerAllRpcHandlers` resolves `HarnessRpcHandlers`.
    registerHarnessServices(container);

    // Wire the four extracted chat services BEFORE
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
            if (!container.isRegistered(TOKENS.GIT_INFO_SERVICE)) {
              return undefined;
            }
            const gitInfo = container.resolve<GitInfoService>(
              TOKENS.GIT_INFO_SERVICE,
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
      { name: 'EditorRpcHandlers', handler: this.editorHandlers },
      { name: 'FileRpcHandlers', handler: this.fileHandlers },
      {
        name: 'ConfigExtendedRpcHandlers',
        handler: this.configExtendedHandlers,
      },
      { name: 'CommandRpcHandlers', handler: this.commandHandlers },
      { name: 'AgentRpcHandlers', handler: this.agentHandlers },
      { name: 'SkillsShRpcHandlers', handler: this.skillsShHandlers },
      { name: 'LayoutRpcHandlers', handler: this.layoutHandlers },
      { name: 'TerminalRpcHandlers', handler: this.terminalHandlers },
      { name: 'UpdateRpcHandlers', handler: this.updateHandlers },
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
