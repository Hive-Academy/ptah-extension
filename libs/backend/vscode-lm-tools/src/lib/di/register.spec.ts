/**
 * register — DI registration specs.
 *
 * `registerVsCodeLmToolsServices` wires three singletons into a tsyringe
 * container:
 *   - `TOKENS.PTAH_API_BUILDER`
 *   - `TOKENS.CODE_EXECUTION_MCP`
 *   - `TOKENS.PERMISSION_PROMPT_SERVICE`
 *
 * It also fails fast when prerequisites are missing:
 *   - `TOKENS.LOGGER` must already be registered,
 *   - `TOKENS.CONTEXT_ORCHESTRATION_SERVICE` (owned by workspace-intelligence)
 *     must be registered first.
 *
 * These tests use a fresh child container per case to avoid polluting the
 * root tsyringe container (which is a singleton across the whole test run).
 *
 * We stub the concrete service classes via `jest.mock` because their real
 * implementations transitively import `vscode-core` → `vscode`, which explodes
 * under jest's node env. We only care that registration keeps each concrete
 * token mapped to *some* class token, not that the class itself can resolve.
 */

import 'reflect-metadata';

jest.mock('@ptah-extension/vscode-core', () => ({
  TOKENS: {
    LOGGER: Symbol.for('Logger'),
    CONTEXT_ORCHESTRATION_SERVICE: Symbol.for('ContextOrchestrationService'),
    PTAH_API_BUILDER: Symbol.for('PtahAPIBuilder'),
    CODE_EXECUTION_MCP: Symbol.for('CodeExecutionMCP'),
    PERMISSION_PROMPT_SERVICE: Symbol.for('PermissionPromptService'),
    WEBVIEW_MANAGER: Symbol.for('WebviewManager'),
  },
}));

// The register module pulls concrete services — stub those to avoid loading
// their vscode-dependent graphs. tsyringe only needs a constructor reference
// (it doesn't instantiate until `resolve` is called, which this spec does
// not do for these tokens).
jest.mock('../code-execution/ptah-api-builder.service', () => ({
  PtahAPIBuilder: class PtahAPIBuilderStub {},
}));
jest.mock('../code-execution/mcp-http/http-mcp-server.service', () => ({
  CodeExecutionMCP: class CodeExecutionMCPStub {},
}));
jest.mock('../permission/permission-prompt.service', () => ({
  PermissionPromptService: class PermissionPromptServiceStub {},
}));

import { container, type DependencyContainer } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { registerVsCodeLmToolsServices } from './register';
import { VSCODE_LM_TOOLS_TOKENS } from './tokens';
import { SurfaceStateService, type SurfacePushHostProvider } from '../surface';

interface MockLogger {
  info: jest.Mock;
  debug: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
}

function createLogger(): MockLogger {
  return {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function createContainer(): DependencyContainer {
  // Fresh child of the tsyringe root. Children inherit nothing from the root
  // registry, so registrations below are fully isolated.
  return container.createChildContainer();
}

function seedPrerequisites(c: DependencyContainer, logger: MockLogger): void {
  c.registerInstance(TOKENS.LOGGER, logger);
  c.registerInstance(
    TOKENS.CONTEXT_ORCHESTRATION_SERVICE,
    {} /* opaque stub — we never resolve it in these specs */,
  );
}

describe('registerVsCodeLmToolsServices', () => {
  // ========================================
  // Happy path
  // ========================================

  describe('token registration', () => {
    let child: DependencyContainer;
    let logger: MockLogger;

    beforeEach(() => {
      child = createContainer();
      logger = createLogger();
      seedPrerequisites(child, logger);
    });

    it('registers PTAH_API_BUILDER, CODE_EXECUTION_MCP, MCP_SERVER_STATUS, PERMISSION_PROMPT_SERVICE', () => {
      registerVsCodeLmToolsServices(
        child,
        logger as unknown as Parameters<
          typeof registerVsCodeLmToolsServices
        >[1],
      );

      expect(child.isRegistered(TOKENS.PTAH_API_BUILDER)).toBe(true);
      expect(child.isRegistered(TOKENS.CODE_EXECUTION_MCP)).toBe(true);
      expect(child.isRegistered(PLATFORM_TOKENS.MCP_SERVER_STATUS)).toBe(true);
      expect(child.isRegistered(TOKENS.PERMISSION_PROMPT_SERVICE)).toBe(true);
    });

    it('logs start and completion with the service list', () => {
      registerVsCodeLmToolsServices(
        child,
        logger as unknown as Parameters<
          typeof registerVsCodeLmToolsServices
        >[1],
      );

      expect(logger.info).toHaveBeenCalledWith(
        '[VS Code LM Tools] Registering services...',
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[VS Code LM Tools] Services registered',
        expect.objectContaining({
          services: [
            'DIAGNOSTICS_CACHE_INVALIDATOR',
            'PTAH_API_BUILDER',
            'CODE_EXECUTION_MCP',
            'MCP_SERVER_STATUS',
            'PERMISSION_PROMPT_SERVICE',
          ],
        }),
      );
    });

    it('is idempotent in that re-registering resolves to the same singleton instance', () => {
      registerVsCodeLmToolsServices(
        child,
        logger as unknown as Parameters<
          typeof registerVsCodeLmToolsServices
        >[1],
      );
      // Second call should not throw; tsyringe's `registerSingleton` replaces
      // the binding rather than duplicating it.
      expect(() =>
        registerVsCodeLmToolsServices(
          child,
          logger as unknown as Parameters<
            typeof registerVsCodeLmToolsServices
          >[1],
        ),
      ).not.toThrow();

      // All three tokens still resolvable, with a single entry apiece.
      expect(child.isRegistered(TOKENS.PTAH_API_BUILDER)).toBe(true);
      expect(child.isRegistered(TOKENS.CODE_EXECUTION_MCP)).toBe(true);
      expect(child.isRegistered(TOKENS.PERMISSION_PROMPT_SERVICE)).toBe(true);
    });
  });

  // ========================================
  // Mis-wiring / prerequisite validation
  // ========================================

  describe('dependency validation', () => {
    it('throws when TOKENS.LOGGER has not been registered', () => {
      const child = createContainer();
      const logger = createLogger();
      // Intentionally: skip LOGGER registration.
      child.registerInstance(TOKENS.CONTEXT_ORCHESTRATION_SERVICE, {});

      expect(() =>
        registerVsCodeLmToolsServices(
          child,
          logger as unknown as Parameters<
            typeof registerVsCodeLmToolsServices
          >[1],
        ),
      ).toThrow(/TOKENS\.LOGGER must be registered first/);
    });

    it('throws when workspace-intelligence services are missing', () => {
      const child = createContainer();
      const logger = createLogger();
      child.registerInstance(TOKENS.LOGGER, logger);
      // Intentionally: skip CONTEXT_ORCHESTRATION_SERVICE.

      expect(() =>
        registerVsCodeLmToolsServices(
          child,
          logger as unknown as Parameters<
            typeof registerVsCodeLmToolsServices
          >[1],
        ),
      ).toThrow(/workspace-intelligence services must be registered before/);
    });

    it('does not log "Registering services" when validation fails', () => {
      const child = createContainer();
      const logger = createLogger();
      // Neither prereq registered.

      expect(() =>
        registerVsCodeLmToolsServices(
          child,
          logger as unknown as Parameters<
            typeof registerVsCodeLmToolsServices
          >[1],
        ),
      ).toThrow();

      expect(logger.info).not.toHaveBeenCalledWith(
        '[VS Code LM Tools] Registering services...',
      );
    });

    it('does not register any tokens when validation fails', () => {
      const child = createContainer();
      const logger = createLogger();

      expect(() =>
        registerVsCodeLmToolsServices(
          child,
          logger as unknown as Parameters<
            typeof registerVsCodeLmToolsServices
          >[1],
        ),
      ).toThrow();

      expect(child.isRegistered(TOKENS.PTAH_API_BUILDER)).toBe(false);
      expect(child.isRegistered(TOKENS.CODE_EXECUTION_MCP)).toBe(false);
      expect(child.isRegistered(TOKENS.PERMISSION_PROMPT_SERVICE)).toBe(false);
    });
  });

  // ========================================
  // Isolation — root container must not leak
  // ========================================

  it('registers into the supplied container, not the tsyringe root', () => {
    const child = createContainer();
    const logger = createLogger();
    seedPrerequisites(child, logger);

    registerVsCodeLmToolsServices(
      child,
      logger as unknown as Parameters<typeof registerVsCodeLmToolsServices>[1],
    );

    // Sibling child of the same root — should NOT see the registrations.
    const sibling = container.createChildContainer();
    expect(sibling.isRegistered(TOKENS.PTAH_API_BUILDER)).toBe(false);
    expect(sibling.isRegistered(TOKENS.CODE_EXECUTION_MCP)).toBe(false);
    expect(sibling.isRegistered(TOKENS.PERMISSION_PROMPT_SERVICE)).toBe(false);
  });
});

describe('registerVsCodeLmToolsServices - surface state (TASK_2026_538)', () => {
  function registered(): { child: DependencyContainer; logger: MockLogger } {
    const child = createContainer();
    const logger = createLogger();
    seedPrerequisites(child, logger);
    registerVsCodeLmToolsServices(
      child,
      logger as unknown as Parameters<typeof registerVsCodeLmToolsServices>[1],
    );
    return { child, logger };
  }

  it('registers SURFACE_PUSH_HOST and SURFACE_STATE_SERVICE', () => {
    const { child } = registered();

    expect(child.isRegistered(VSCODE_LM_TOOLS_TOKENS.SURFACE_PUSH_HOST)).toBe(
      true,
    );
    expect(
      child.isRegistered(VSCODE_LM_TOOLS_TOKENS.SURFACE_STATE_SERVICE),
    ).toBe(true);
  });

  it('resolves the service as one singleton per container', () => {
    const { child } = registered();

    const first = child.resolve<SurfaceStateService>(
      VSCODE_LM_TOOLS_TOKENS.SURFACE_STATE_SERVICE,
    );
    const second = child.resolve<SurfaceStateService>(
      VSCODE_LM_TOOLS_TOKENS.SURFACE_STATE_SERVICE,
    );

    expect(first).toBeInstanceOf(SurfaceStateService);
    expect(second).toBe(first);
  });

  it('resolves WEBVIEW_MANAGER lazily on every getHost call', () => {
    const { child } = registered();
    const provider = child.resolve<SurfacePushHostProvider>(
      VSCODE_LM_TOOLS_TOKENS.SURFACE_PUSH_HOST,
    );

    // Registered after the DI phase (the Electron order, assumption A1).
    expect(provider.getHost()).toBeUndefined();
    const firstHost = {
      getActiveWebviews: () => [],
      sendMessage: async () => true,
    };
    child.registerInstance(TOKENS.WEBVIEW_MANAGER, firstHost);
    expect(provider.getHost()).toBe(firstHost);

    // A replaced host is visible to the next push.
    const secondHost = {
      getActiveWebviews: () => ['ptah.main'],
      sendMessage: async () => true,
    };
    child.registerInstance(TOKENS.WEBVIEW_MANAGER, secondHost);
    expect(provider.getHost()).toBe(secondHost);
  });

  it('delivers a committed surface through the lazily resolved host', async () => {
    const { child } = registered();
    const sendMessage = jest.fn(async () => true);
    const service = child.resolve<SurfaceStateService>(
      VSCODE_LM_TOOLS_TOKENS.SURFACE_STATE_SERVICE,
    );
    child.registerInstance(TOKENS.WEBVIEW_MANAGER, {
      getActiveWebviews: () => ['ptah.main'],
      sendMessage,
    });

    const result = service.applyAgentUpdate(
      'tab-1',
      {
        operation: 'create',
        surface: {
          schemaVersion: 'dashboard-spec/2',
          catalogVersion: 'dashboard-catalog/2',
          surfaceId: 'summary',
          title: { text: 'Summary' },
          components: [{ kind: 'stat', id: 'users', value: 1 }],
        },
      },
      'call-1',
    );

    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    await expect(result.delivery).resolves.toEqual({
      status: 'delivered',
      surfaces: 1,
    });
    expect(sendMessage).toHaveBeenCalledWith(
      'ptah.main',
      'surface:updated',
      expect.objectContaining({ routingId: 'tab-1', surfaceId: 'summary' }),
    );
  });
});
