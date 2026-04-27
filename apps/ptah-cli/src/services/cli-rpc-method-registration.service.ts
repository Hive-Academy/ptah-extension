/**
 * CLI RPC Method Registration Service
 *
 * TASK_2025_263 Batch 3: original CLI orchestrator.
 * TASK_2025_291 Wave C4b: shared-handler fan-out + SDK / agent-event wiring
 * moved to platform-agnostic helpers; CLI now opts out of worktree,
 * wizard broadcast, Copilot permission, and CLI session persistence.
 * TASK_2026_104 Batch 4: shrink CLI exclusion list to ~22 entries (webview-only
 * surfaces) and unblock HarnessRpcHandlers so the CLI exposes Electron parity
 * for every backend capability documented in task-description.md § 0.
 */

import { container } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import {
  registerAllRpcHandlers,
  registerChatServices,
  registerHarnessServices,
  verifyAndReportRpcRegistration,
  __debugAssertSharedHandlersDisjoint,
} from '@ptah-extension/rpc-handlers';
import {
  wireSdkCallbacks,
  wireAgentEventListeners,
} from '@ptah-extension/agent-sdk';
import { CliAgentRpcHandlers } from './rpc/handlers/cli-agent-rpc.handlers.js';
import { SkillsShRpcHandlers } from './rpc/handlers/skills-sh-rpc.handlers.js';

/**
 * RPC methods that have NO sensible CLI implementation — they all sit on top
 * of webview-only UI surfaces (file pickers, command palette, embedded editor
 * panes, persisted layout, embedded PTY) that do not exist in a headless
 * stdio process. Anything not in this list is either implemented today or
 * scheduled for first-class CLI commands per task-description.md § 3.
 *
 * Final shape per TASK_2026_104 Batch 4 (~22 entries) — task-description.md § 0.8.
 */
const CLI_EXCLUDED_RPC_METHODS: readonly string[] = [
  // File operations — VS Code / Electron file pickers and save dialogs are
  // GUI-only. The CLI exposes equivalent functionality via direct path args
  // and `--out`/`--in` flags on the parent commands.
  'file:open',
  'file:pick',
  'file:pick-images',
  'file:read',
  'file:exists',
  'file:save-dialog',

  // Command execution — VS Code command palette dispatch. CLI has no
  // command palette; commands are invoked directly via the commander router.
  'command:execute',

  // Editor operations — Angular editor pane inside the webview. The CLI has
  // no embedded editor surface; consumers shell out to their own editor.
  // Verified against `libs/shared/src/lib/types/rpc.types.ts` — these are
  // every `editor:*` method declared in the RPC registry.
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

  // Layout persistence — Electron / VS Code webview panel layout state.
  // No webview means no layout to persist.
  'layout:persist',
  'layout:restore',

  // Terminal operations — Electron embedded PTY (`node-pty`). The CLI runs
  // inside the user's own terminal; spawning child PTYs is out of scope.
  'terminal:create',
  'terminal:kill',
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

  constructor() {
    this.logger = container.resolve<Logger>(TOKENS.LOGGER);
    this.rpcHandler = container.resolve<RpcHandler>(TOKENS.RPC_HANDLER);
  }

  /**
   * Register all RPC methods. CLI now registers the full shared handler set
   * (including HarnessRpcHandlers) for Electron parity. Webview-only
   * surfaces stay excluded via `CLI_EXCLUDED_RPC_METHODS`.
   */
  registerAll(): void {
    registerChatServices(container);

    // HarnessRpcHandlers depends on per-feature services (workspace context,
    // file system, AI helpers) registered by `registerHarnessServices`. This
    // MUST run before `registerAllRpcHandlers` resolves the handler. Same
    // ordering used by Electron / VS Code.
    registerHarnessServices(container);

    // TASK_2026_104 Batch 4: drop `exclude: [HarnessRpcHandlers]` so the
    // harness handler joins the shared set. Parity with Electron.
    registerAllRpcHandlers(container);

    // TASK_2026_104 Sub-batch B6b: re-register `SkillsShRpcHandlers` (CLI
    // copy of the Electron handler — `skills-sh-rpc.handlers.ts`). The Skills
    // handler is intentionally NOT in the shared rpc-handlers library; both
    // Electron and the CLI keep app-local copies because the upstream
    // `npx skills` integration may diverge per-platform in the future.
    container.registerSingleton(SkillsShRpcHandlers);
    container.resolve(SkillsShRpcHandlers).register();

    // TASK_2026_104 Batch B7: register `CliAgentRpcHandlers` — byte-for-byte
    // parity copy of the Electron `AgentRpcHandlers`. Same 7 methods, same
    // injection set, same dispatch bodies. Ships the agent surface for the
    // CLI now that the deprecated `profile` command emits a deprecation shim.
    // Both classes expose `static readonly METHODS` (locked tuple, deep-equal
    // verified by `cli-agent-rpc.handlers.spec.ts`).
    container.registerSingleton(CliAgentRpcHandlers);
    container.resolve(CliAgentRpcHandlers).register();

    wireSdkCallbacks(container, {
      logger: this.logger,
      platform: 'cli',
      options: { worktree: false },
    });

    wireAgentEventListeners(container, {
      logger: this.logger,
      platform: 'cli',
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
