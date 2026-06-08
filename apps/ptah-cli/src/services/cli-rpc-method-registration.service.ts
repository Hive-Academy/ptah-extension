/**
 * CLI RPC Method Registration Service
 *
 * Shared-handler fan-out + SDK / agent-event wiring moved to platform-agnostic
 * helpers; CLI opts out of worktree, wizard broadcast, Copilot permission,
 * and CLI session persistence. CLI exclusion list (~22 entries, webview-only
 * surfaces) keeps HarnessRpcHandlers active so the CLI exposes Electron parity
 * for every backend capability.
 */

import type { DependencyContainer } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import {
  registerAllRpcHandlers,
  registerChatServices,
  registerHarnessServices,
  verifyAndReportRpcRegistration,
  __debugAssertSharedHandlersDisjoint,
  CorpusRpcHandlers,
  CronRpcHandlers,
  EmbedderRpcHandlers,
  GatewayRpcHandlers,
  IndexingRpcHandlers,
  MemoryRpcHandlers,
  MemRpcHandlers,
  PersistenceRpcHandlers,
  SkillsSynthesisRpcHandlers,
} from '@ptah-extension/rpc-handlers';
import {
  wireSdkCallbacks,
  wireAgentEventListeners,
} from '@ptah-extension/cli-agent-runtime';
import { CliAgentRpcHandlers } from './rpc/handlers/cli-agent-rpc.handlers.js';

/**
 * RPC methods that have NO sensible CLI implementation — they all sit on top
 * of webview-only UI surfaces (file pickers, command palette, embedded editor
 * panes, persisted layout, embedded PTY) that do not exist in a headless
 * stdio process. Anything not in this list is either implemented today or
 * scheduled for first-class CLI commands per task-description.md § 3.
 *
 */
const CLI_EXCLUDED_RPC_METHODS: readonly string[] = [
  'file:open',
  'file:pick',
  'file:pick-images',
  'file:read',
  'file:exists',
  'file:save-dialog',
  'command:execute',
  'editor:openFile',
  'editor:saveFile',
  'editor:getFileTree',
  'editor:getDirectoryChildren',
  'editor:createFile',
  'editor:createFolder',
  'editor:renameItem',
  'editor:deleteItem',
  'editor:getSetting',
  'editor:updateSetting',
  'editor:searchInFiles',
  'editor:listAllFiles',
  'layout:persist',
  'layout:restore',
  'terminal:create',
  'terminal:kill',
  'cron:list',
  'cron:get',
  'cron:create',
  'cron:update',
  'cron:delete',
  'cron:toggle',
  'cron:runNow',
  'cron:runs',
  'cron:nextFire',
  'gateway:status',
  'gateway:start',
  'gateway:stop',
  'gateway:setToken',
  'gateway:listBindings',
  'gateway:approveBinding',
  'gateway:blockBinding',
  'gateway:listMessages',
  'gateway:test',
  'memory:list',
  'memory:search',
  'memory:get',
  'memory:pin',
  'memory:unpin',
  'memory:forget',
  'memory:rebuildIndex',
  'memory:stats',
  'mem:searchIndex',
  'mem:timeline',
  'mem:getObservations',
  'embedder:status',
  'embedder:retry',
  'corpus:list',
  'corpus:get',
  'corpus:build',
  'corpus:prime',
  'corpus:query',
  'corpus:reprime',
  'corpus:rebuild',
  'corpus:delete',
  'skillSynthesis:listCandidates',
  'skillSynthesis:getCandidate',
  'skillSynthesis:promote',
  'skillSynthesis:reject',
  'skillSynthesis:invocations',
  'skillSynthesis:stats',
  'db:health',
  'db:reset',
  'indexing:getStatus',
  'indexing:start',
  'indexing:pause',
  'indexing:resume',
  'indexing:cancel',
  'indexing:setPipelineEnabled',
  'indexing:dismissStale',
  'indexing:acknowledgeDisclosure',
];

/**
 * Orchestrates RPC method registration for the CLI app.
 *
 * Unlike the VS Code / Electron services, this is NOT `@injectable()` because
 * it is only instantiated once during bootstrap. It resolves its two core
 * dependencies from the global container directly.
 */
export class CliRpcMethodRegistrationService {
  private readonly logger: Logger;
  private readonly rpcHandler: RpcHandler;

  constructor(private readonly container: DependencyContainer) {
    this.logger = container.resolve<Logger>(TOKENS.LOGGER);
    this.rpcHandler = container.resolve<RpcHandler>(TOKENS.RPC_HANDLER);
  }

  /**
   * Register all RPC methods. CLI now registers the full shared handler set
   * (including HarnessRpcHandlers) for Electron parity. Webview-only
   * surfaces stay excluded via `CLI_EXCLUDED_RPC_METHODS`.
   */
  registerAll(): void {
    const c = this.container;
    registerChatServices(c);
    registerHarnessServices(c);
    registerAllRpcHandlers(c, {
      exclude: [
        CronRpcHandlers,
        EmbedderRpcHandlers,
        GatewayRpcHandlers,
        MemoryRpcHandlers,
        MemRpcHandlers,
        CorpusRpcHandlers,
        SkillsSynthesisRpcHandlers,
        PersistenceRpcHandlers,
        IndexingRpcHandlers,
      ],
    });
    c.registerSingleton(CliAgentRpcHandlers);
    c.resolve(CliAgentRpcHandlers).register();

    wireSdkCallbacks(c, {
      logger: this.logger,
      platform: 'cli',
      options: { worktree: false },
    });

    wireAgentEventListeners(c, {
      logger: this.logger,
      platform: 'cli',
      options: {
        copilotPermission: false,
        persistCliSession: false,
      },
    });
    verifyAndReportRpcRegistration({
      rpcHandler: this.rpcHandler,
      logger: this.logger,
      container: c,
      sentryToken: TOKENS.SENTRY_SERVICE,
      platform: 'cli',
      excluded: CLI_EXCLUDED_RPC_METHODS,
      assertInDevelopment: false,
    });

    if (process.env['NODE_ENV'] === 'development') {
      __debugAssertSharedHandlersDisjoint();
    }

    this.logger.info('[CLI RPC] All RPC methods registered', {
      methods: this.rpcHandler.getRegisteredMethods(),
    });
  }
}

/**
 * Exported so tests can audit the exclusion shape without re-importing private
 * module state.
 */
export const __CLI_EXCLUDED_RPC_METHODS_FOR_TEST = CLI_EXCLUDED_RPC_METHODS;
