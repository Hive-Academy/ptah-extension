/**
 * DI Registration for VS Code LM Tools
 *
 * This file centralizes all service registrations for the vscode-lm-tools library.
 * Following the standardized registration pattern established in agent-sdk and agent-generation.
 *
 * Pattern:
 * - Function signature: registerVsCodeLmToolsServices(container, logger)
 * - Uses injected container (no global import)
 * - Uses injected logger (no console.log)
 * - Logs registration start and completion
 *
 * @see libs/backend/agent-sdk/src/lib/di/register.ts - Pattern reference
 * @see apps/ptah-extension-vscode/src/di/container.ts - Orchestration point
 */

import { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IMcpServerStatus,
  type IMcpSubagentRootRegistrar,
} from '@ptah-extension/platform-core';
import { PtahAPIBuilder } from '../code-execution/ptah-api-builder.service';
import { CodeExecutionMCP } from '../code-execution/mcp-http/http-mcp-server.service';
import { PermissionPromptService } from '../permission/permission-prompt.service';
import {
  DIAGNOSTICS_CACHE_INVALIDATOR,
  DiagnosticsCacheInvalidator,
} from '../diagnostics/diagnostics-cache-invalidator.service';
import type { DashboardSurfaceHost } from '../code-execution/namespace-builders/dashboard-namespace.builder';
import {
  SURFACE_STATE_SERVICE_OPTIONS,
  SurfaceStateService,
  type SurfacePushHostProvider,
  type SurfaceStateServiceOptions,
} from '../surface';
import { VSCODE_LM_TOOLS_TOKENS } from './tokens';

/**
 * Register vscode-lm-tools services in DI container
 *
 * Services expose workspace-intelligence to Claude CLI via Code Execution MCP server.
 *
 * Registers:
 * - PtahAPIBuilder (singleton): Constructs Ptah API namespaces for code execution
 * - CodeExecutionMCP (singleton): MCP server with execute_code and approval_prompt tools
 * - PermissionPromptService (singleton): User permission prompts for tool execution
 *
 * @param container - TSyringe DI container
 * @param logger - Logger instance for registration logging
 *
 * @example
 * ```typescript
 * import { registerVsCodeLmToolsServices } from '@ptah-extension/vscode-lm-tools';
 *
 * // In container.ts
 * registerVsCodeLmToolsServices(container, logger);
 *
 * // Resolve services
 * const mcpServer = container.resolve<CodeExecutionMCP>(TOKENS.CODE_EXECUTION_MCP);
 * ```
 */
export function registerVsCodeLmToolsServices(
  container: DependencyContainer,
  logger: Logger,
): void {
  if (!container.isRegistered(TOKENS.LOGGER)) {
    throw new Error(
      '[VS Code LM Tools] DEPENDENCY ERROR: TOKENS.LOGGER must be registered first.',
    );
  }
  if (!container.isRegistered(TOKENS.CONTEXT_ORCHESTRATION_SERVICE)) {
    throw new Error(
      '[VS Code LM Tools] DEPENDENCY ERROR: workspace-intelligence services must be registered before vscode-lm-tools. ' +
        'Ensure registerWorkspaceIntelligenceServices is called BEFORE registerVsCodeLmToolsServices in container.ts.',
    );
  }

  logger.info('[VS Code LM Tools] Registering services...');
  // Registered BEFORE the API builder because the builder injects it and
  // starts it: that is the whole mechanism keeping the diagnostics result
  // cache honest across an agent's write-then-recheck loop. Registration order
  // does not matter to tsyringe, but the coupling should be visible here.
  container.registerSingleton(
    DIAGNOSTICS_CACHE_INVALIDATOR,
    DiagnosticsCacheInvalidator,
  );
  container.registerSingleton(TOKENS.PTAH_API_BUILDER, PtahAPIBuilder);
  container.registerSingleton(TOKENS.CODE_EXECUTION_MCP, CodeExecutionMCP);
  const mcpStatusShim: IMcpServerStatus = {
    getPort: () => {
      try {
        if (!container.isRegistered(TOKENS.CODE_EXECUTION_MCP)) {
          return null;
        }
        return container
          .resolve<CodeExecutionMCP>(TOKENS.CODE_EXECUTION_MCP)
          .getPort();
      } catch {
        // degradation-audit: optional-capability - this shim only answers "what
        // port is the MCP server on" for status display; the isRegistered guard
        // above already covers the normal case, so a resolve failure here
        // degrades to "port unknown" rather than throwing into a status query.
        return null;
      }
    },
  };
  container.register(PLATFORM_TOKENS.MCP_SERVER_STATUS, {
    useValue: mcpStatusShim,
  });
  // Resolved on every call, like the status shim above, so the consumer
  // (cli-agent-runtime's spawner) never constructs the MCP server at its own
  // construction time. The port promises never to reject: a missing or
  // unresolvable server degrades to `registered: false`, and the detail stays
  // in the log rather than in the reason an agent reads.
  const resolveRootRegistrar = (): IMcpSubagentRootRegistrar | null =>
    container.isRegistered(TOKENS.CODE_EXECUTION_MCP)
      ? container.resolve<CodeExecutionMCP>(TOKENS.CODE_EXECUTION_MCP)
      : null;
  const describeError = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);
  const mcpSubagentRootRegistrarShim: IMcpSubagentRootRegistrar = {
    retainRoot: async (root) => {
      try {
        const registrar = resolveRootRegistrar();
        if (registrar === null) {
          return { registered: false, reason: 'registrar-unavailable' };
        }
        return await registrar.retainRoot(root);
      } catch (error: unknown) {
        // degradation-audit: optional-capability - the caller reads
        // `registered: false` and reports the child's subagent tools as
        // unavailable; the child session itself still starts.
        logger.warn(
          `[VS Code LM Tools] MCP subagent root retain failed: ${describeError(error)}`,
        );
        return { registered: false, reason: 'registrar-unavailable' };
      }
    },
    releaseRoot: async (root) => {
      try {
        await resolveRootRegistrar()?.releaseRoot(root);
      } catch (error: unknown) {
        // degradation-audit: optional-capability - a release failure must
        // never block a session stop; it is logged and the server's next
        // reconcile or stop removes the entry.
        logger.warn(
          `[VS Code LM Tools] MCP subagent root release failed: ${describeError(error)}`,
        );
      }
    },
  };
  container.register(PLATFORM_TOKENS.MCP_SUBAGENT_ROOT_REGISTRAR, {
    useValue: mcpSubagentRootRegistrarShim,
  });
  logger.info('[VS Code LM Tools] MCP subagent root registrar registered', {
    services: ['MCP_SUBAGENT_ROOT_REGISTRAR'],
  });
  container.registerSingleton(
    TOKENS.PERMISSION_PROMPT_SERVICE,
    PermissionPromptService,
  );
  // The webview host is resolved on EVERY push, not captured here: Electron
  // registers WEBVIEW_MANAGER after the DI phases and CLI at container build
  // (assumption A1), so a late registration or a replaced host is still
  // seen. No host yet means the push reports `no-surface`; a resolve that
  // throws is reported as a failed delivery by the broadcast, never thrown.
  const surfacePushHost: SurfacePushHostProvider = {
    getHost: () =>
      container.isRegistered(TOKENS.WEBVIEW_MANAGER, true)
        ? container.resolve<DashboardSurfaceHost>(TOKENS.WEBVIEW_MANAGER)
        : undefined,
  };
  container.register(VSCODE_LM_TOOLS_TOKENS.SURFACE_PUSH_HOST, {
    useValue: surfacePushHost,
  });
  // Empty options: production runs the documented defaults.
  const surfaceStateOptions: SurfaceStateServiceOptions = {};
  container.register(SURFACE_STATE_SERVICE_OPTIONS, {
    useValue: surfaceStateOptions,
  });
  // One store per host process: the MCP tools and the surface:* RPC handlers
  // share it (Req 7.4).
  container.registerSingleton(
    VSCODE_LM_TOOLS_TOKENS.SURFACE_STATE_SERVICE,
    SurfaceStateService,
  );
  logger.info('[VS Code LM Tools] Surface state registered', {
    services: ['SURFACE_PUSH_HOST', 'SURFACE_STATE_SERVICE'],
  });

  logger.info('[VS Code LM Tools] Services registered', {
    services: [
      'DIAGNOSTICS_CACHE_INVALIDATOR',
      'PTAH_API_BUILDER',
      'CODE_EXECUTION_MCP',
      'MCP_SERVER_STATUS',
      'PERMISSION_PROMPT_SERVICE',
    ],
  });
}
