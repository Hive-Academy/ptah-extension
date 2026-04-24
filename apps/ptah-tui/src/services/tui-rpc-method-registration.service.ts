/**
 * TUI RPC Method Registration Service
 *
 * TASK_2025_263 Batch 3: original CLI orchestrator.
 * TASK_2025_291 Wave C4b: shared-handler fan-out + SDK / agent-event wiring
 * moved to platform-agnostic helpers; CLI now opts out of worktree,
 * wizard broadcast, Copilot permission, and CLI session persistence.
 */

import { container } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import {
  registerAllRpcHandlers,
  verifyAndReportRpcRegistration,
  __debugAssertSharedHandlersDisjoint,
} from '@ptah-extension/rpc-handlers';
import {
  wireSdkCallbacks,
  wireAgentEventListeners,
} from '@ptah-extension/agent-sdk';
import { HarnessRpcHandlers } from '@ptah-extension/rpc-handlers';

/**
 * RPC methods not applicable in TUI — platform-specific (VS Code/Electron only).
 * Excluded from RPC verification to prevent false CRITICAL errors.
 */
const TUI_EXCLUDED_RPC_METHODS: readonly string[] = [
  // File operations (VS Code/Electron file pickers & dialogs)
  'file:open',
  'file:pick',
  'file:pick-images',
  'file:read',
  'file:exists',
  'file:save-dialog',

  // Command execution (VS Code command palette)
  'command:execute',

  // Agent orchestration (registered by platform-specific handlers)
  'agent:getConfig',
  'agent:setConfig',
  'agent:detectClis',
  'agent:listCliModels',
  'agent:permissionResponse',
  'agent:stop',
  'agent:resumeCliSession',

  // Skills.sh marketplace (not available in CLI v1)
  'skillsSh:search',
  'skillsSh:listInstalled',
  'skillsSh:install',
  'skillsSh:uninstall',
  'skillsSh:getPopular',
  'skillsSh:detectRecommended',

  // Workspace management (Electron desktop only)
  'workspace:getInfo',
  'workspace:addFolder',
  'workspace:removeFolder',
  'workspace:switch',

  // Layout persistence (Electron desktop only)
  'layout:persist',
  'layout:restore',

  // Editor operations (Electron desktop only)
  'editor:openFile',
  'editor:saveFile',
  'editor:getFileTree',
  'editor:getDirectoryChildren',

  // Extended config/auth (Electron desktop only)
  'config:model-set',
  'auth:setApiKey',
  'auth:getStatus',
  'auth:getApiKeyStatus',

  // Settings import/export (Electron desktop only)
  'settings:export',
  'settings:import',

  // Git operations (Electron desktop only)
  'git:info',
  'git:worktrees',
  'git:addWorktree',
  'git:removeWorktree',

  // Terminal operations (Electron desktop only)
  'terminal:create',
  'terminal:kill',

  // MCP Directory (VS Code marketplace directory — not applicable in CLI)
  'mcpDirectory:search',
  'mcpDirectory:getDetails',
  'mcpDirectory:install',
  'mcpDirectory:uninstall',
  'mcpDirectory:listInstalled',
  'mcpDirectory:getPopular',

  // Harness setup builder (excluded from CLI registration via
  // `registerAllRpcHandlers({ exclude: [HarnessRpcHandlers] })` — these
  // methods would otherwise show as missing in verifyRpcRegistration).
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
];

/**
 * Orchestrates RPC method registration for the TUI CLI app.
 *
 * Unlike the VS Code / Electron services, this is NOT `@injectable()` because
 * it is only instantiated once during bootstrap. It resolves its two core
 * dependencies from the global container directly.
 */
export class TuiRpcMethodRegistrationService {
  private readonly logger: Logger;
  private readonly rpcHandler: RpcHandler;

  constructor() {
    this.logger = container.resolve<Logger>(TOKENS.LOGGER);
    this.rpcHandler = container.resolve<RpcHandler>(TOKENS.RPC_HANDLER);
  }

  /**
   * Register all RPC methods. CLI excludes Harness (VS Code only), worktree
   * resolution, wizard broadcasts, Copilot permission UI, and CLI session
   * persistence.
   */
  registerAll(): void {
    registerAllRpcHandlers(container, { exclude: [HarnessRpcHandlers] });

    wireSdkCallbacks(container, {
      logger: this.logger,
      platform: 'tui',
      options: { worktree: false },
    });

    wireAgentEventListeners(container, {
      logger: this.logger,
      platform: 'tui',
      options: {
        wizardBroadcast: false,
        copilotPermission: false,
        persistCliSession: false,
      },
    });

    // `assertInDevelopment: false` keeps CLI boot permissive when Sentry is absent.
    verifyAndReportRpcRegistration({
      rpcHandler: this.rpcHandler,
      logger: this.logger,
      container,
      sentryToken: TOKENS.SENTRY_SERVICE,
      platform: 'tui',
      excluded: TUI_EXCLUDED_RPC_METHODS,
      assertInDevelopment: false,
    });

    if (process.env['NODE_ENV'] === 'development') {
      __debugAssertSharedHandlersDisjoint();
    }

    this.logger.info('[TUI RPC] All RPC methods registered', {
      methods: this.rpcHandler.getRegisteredMethods(),
    });
  }
}
