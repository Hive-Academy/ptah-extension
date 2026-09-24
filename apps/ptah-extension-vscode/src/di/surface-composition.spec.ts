/**
 * VS Code surface composition — one host-owned store, two entry points
 * (TASK_2026_538 Batch 14, Task 14.3; plan Req 7 row, implementation-plan.md:796).
 *
 * `registerVsCodeLmToolsServices` registers exactly one
 * `VSCODE_LM_TOOLS_TOKENS.SURFACE_STATE_SERVICE` singleton per container
 * (pinned unit-level in `register.spec.ts`). Two production consumers read
 * and write that singleton:
 *
 *  - the MCP tools `ptah_surface_update` / `ptah_surface_get_state`, via
 *    `ptahAPI.surface` (`ptah-api-builder.service.ts:867-872`), which is
 *    `buildSurfaceNamespace({ service: this.surfaceStateService, logger })`
 *    (`surface-namespace.builder.ts:85-203`), and `handleSurfaceToolCall`
 *    (`surface-tool-handlers.ts:96-116`), which maps the named tool call onto
 *    `namespace.update` / `.getState` and turns the outcome into the
 *    `{ isError, text }` an MCP reply carries;
 *  - the `surface:*` RPC methods, `SurfaceRpcHandlers`
 *    (`libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts`),
 *    whose `handleChange` / `handleRead` call `service.change(...)` /
 *    `service.read(...)` on the same `@inject`ed token (`:127-128`,
 *    `:169-183`, `:164-167`).
 *
 * Revision 1 (code-logic-review-batch-14.md, F1 SERIOUS): the original round
 * trips here called `SurfaceStateService` methods directly on both "sides",
 * which cannot detect a broken consumer injection or a disconnected wiring
 * — a regression at `ptah-api-builder.service.ts:481` or
 * `surface-rpc.handlers.ts:127` would not fail those tests. Two fixes:
 *
 *  1. The orchestrator approved a narrow, named export of
 *     `buildSurfaceNamespace` / `SurfaceNamespace` / `SurfaceCaller` and the
 *     `handleSurfaceToolCall` tool-call mapper from the
 *     `@ptah-extension/vscode-lm-tools` public barrel (this batch's only
 *     production change; see `batch-14-report.md` "Revision 1"). Nothing else
 *     in production changed, and no `SurfaceRpcHandlers` export was added.
 *  2. The RPC side is reached through the public host-profile API the review
 *     pointed at (`@ptah-extension/rpc-handlers`'s `RPC_HANDLER_MANIFEST` /
 *     `resolveRpcHandlerPlan`, already exported via `export * from
 *     './lib/host-profile'`): `resolveRpcHandlerPlan(createVscodeRpcHostProfile(...))`
 *     is filtered to the one `key: 'surface'` step and THAT constructor is
 *     resolved from this container and `.register()`ed — the exact
 *     `SurfaceRpcHandlers` class, with this container's `@inject`ed
 *     `SURFACE_STATE_SERVICE`, without constructing the other ~40 handlers or
 *     `registerRpcSurface`'s full bridge graph.
 *
 * Labelling, per the review's request for accuracy: the "agent write" side
 * below goes through `handleSurfaceToolCall` and `buildSurfaceNamespace` —
 * tool-call / namespace level, the same code `protocol-dispatcher.ts:1680`
 * calls into. It does NOT go through the JSON-RPC/MCP dispatcher itself
 * (`tools/call` parsing, `AsyncLocalStorage` caller-scope resolution) — that
 * is `protocol-dispatcher.surface.spec.ts`'s job, not this composition spec's.
 * The "UI write/read" side goes through the real `RpcHandler.handleMessage`,
 * which IS the full RPC wire entry point host apps use.
 */

import 'reflect-metadata';

import { container as rootContainer } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';

import {
  TOKENS,
  registerVsCodeCorePlatformAgnostic,
  RpcHandler,
  type Logger,
} from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import {
  registerVsCodeLmToolsServices,
  VSCODE_LM_TOOLS_TOKENS,
  SurfaceStateService,
  PtahAPIBuilder,
  buildSurfaceNamespace,
  handleSurfaceToolCall,
  SURFACE_UPDATE_TOOL_NAME,
  SURFACE_GET_STATE_TOOL_NAME,
} from '@ptah-extension/vscode-lm-tools';
import { resolveRpcHandlerPlan } from '@ptah-extension/rpc-handlers';
import type { SurfaceEnvelope } from '@ptah-extension/shared';

import { createVscodeRpcHostProfile } from '../rpc-host-profile';

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  } as unknown as Logger;
}

/** A well-formed, unexpired operation id (real clock — this container has no fake one). */
function opId(suffix: string): string {
  return `op-${Date.now()}-${suffix}`;
}

/** One text input bound to `form.name`, the same shape the RPC schema tests use. */
function envelope(): SurfaceEnvelope {
  return {
    schemaVersion: 'dashboard-spec/2',
    catalogVersion: 'dashboard-catalog/2',
    surfaceId: 'profile',
    title: { text: 'Profile' },
    components: [{ kind: 'text', id: 'name', label: 'Name', path: 'form.name' }],
    dataModel: { form: { name: 'Ada' } },
  };
}

/**
 * Resolve and `register()` the real `SurfaceRpcHandlers` — found through the
 * PUBLIC `resolveRpcHandlerPlan(realHostProfile)`, filtered to the one
 * `key: 'surface'` step, per the review's "smallest practical follow-up".
 */
function registerSurfaceRpc(container: DependencyContainer, logger: Logger): void {
  const profile = createVscodeRpcHostProfile(logger);
  const step = resolveRpcHandlerPlan(profile).find((s) => s.key === 'surface');
  if (!step) {
    throw new Error(
      "resolveRpcHandlerPlan(createVscodeRpcHostProfile(...)) has no 'surface' step — has the manifest or the VS Code profile changed?",
    );
  }
  container.resolve(step.ctor).register();
}

/**
 * The production wiring this spec exercises, without the rest of
 * `PtahAPIBuilder`'s ~45 unrelated `@inject`s. `TOKENS.CONTEXT_ORCHESTRATION_SERVICE`
 * is a guard-only prerequisite inside `registerVsCodeLmToolsServices`
 * (`register.ts:68-73`); a real workspace-intelligence registration is not
 * needed to prove the surface store's composition.
 */
function compose(): {
  container: DependencyContainer;
  logger: Logger;
  state: SurfaceStateService;
} {
  const logger = makeLogger();
  const c = rootContainer.createChildContainer();
  c.register(TOKENS.LOGGER, { useValue: logger });
  registerVsCodeCorePlatformAgnostic(c, logger, {
    includeLicensingAndAuth: false,
  });
  c.register(TOKENS.CONTEXT_ORCHESTRATION_SERVICE, { useValue: {} });

  registerVsCodeLmToolsServices(c, logger);

  const state = c.resolve<SurfaceStateService>(
    VSCODE_LM_TOOLS_TOKENS.SURFACE_STATE_SERVICE,
  );
  return { container: c, logger, state };
}

describe('VS Code surface composition — collaborator-level sharing (Req 7.4)', () => {
  it('registers exactly one SURFACE_STATE_SERVICE singleton', () => {
    const { container: c } = compose();

    const first = c.resolve<SurfaceStateService>(
      VSCODE_LM_TOOLS_TOKENS.SURFACE_STATE_SERVICE,
    );
    const second = c.resolve<SurfaceStateService>(
      VSCODE_LM_TOOLS_TOKENS.SURFACE_STATE_SERVICE,
    );
    expect(first).toBe(second);
  });

  // These two cases call SurfaceStateService directly on both "sides" — they
  // prove the algebra (create/change/read/describeForAgent), not that the two
  // real consumers below are wired to it. Kept per "keep existing valid
  // assertions"; the consumer-level round trips follow in the next describe.
  it('collaborator-level: an agent write is visible to a UI read', async () => {
    const { state } = compose();

    const created = state.applyAgentUpdate(
      'tab-1',
      { operation: 'create', surface: envelope() },
      'call-create',
    );
    expect(created.status).toBe('applied');
    if (created.status !== 'applied') return;
    expect(created.revision).toBe(1);
    await expect(created.delivery).resolves.toEqual({ status: 'no-surface' });

    const read = state.read('tab-1', 'profile');
    expect(read.status).toBe('found');
    if (read.status !== 'found') return;
    expect(read.surfaces).toHaveLength(1);
    const content = read.surfaces[0]?.content;
    expect(
      content?.contract === 'dashboard-spec/2' ? content.dataModel : undefined,
    ).toEqual({ form: { name: 'Ada' } });
  });

  it('collaborator-level: a UI write is visible to an agent read', async () => {
    const { state } = compose();

    const created = state.applyAgentUpdate(
      'tab-1',
      { operation: 'create', surface: envelope() },
      'call-create',
    );
    expect(created.status).toBe('applied');
    if (created.status !== 'applied') return;

    const operationId = opId('composetest0001');
    const changed = state.change('tab-1', {
      surfaceId: 'profile',
      revision: created.revision,
      operationId,
      componentId: 'name',
      value: 'Grace',
    });
    expect(changed).toEqual({
      status: 'applied',
      operationId,
      revision: created.revision + 1,
    });

    const read = state.describeForAgent('tab-1', { surfaceId: 'profile' });
    expect(read.status).toBe('found');
    if (read.status !== 'found') return;
    expect(read.text).toContain('Grace');
  });
});

describe('VS Code surface composition — real two-consumer round trip (Req 7.4, F1)', () => {
  it('a real agent tool call (namespace/tool-call level) is visible through the real RPC handler', async () => {
    const { container: c, logger, state } = compose();
    const namespace = buildSurfaceNamespace({ service: state, logger });
    registerSurfaceRpc(c, logger);
    const rpc = c.resolve<RpcHandler>(TOKENS.RPC_HANDLER);

    const reply = await handleSurfaceToolCall(
      SURFACE_UPDATE_TOOL_NAME,
      { operation: 'create', surface: envelope() },
      namespace,
      { sessionId: 'tab-1', toolCallId: 'call-create' },
      logger,
    );
    expect(reply.isError).toBe(false);
    expect(reply.text).toContain('Surface profile committed at revision 1');

    const read = await rpc.handleMessage({
      method: 'surface:read',
      params: { routingId: 'tab-1', surfaceId: 'profile' },
      correlationId: 'c-read-1',
    });
    expect(read.success).toBe(true);
    expect(read.data).toMatchObject({ status: 'found', routingId: 'tab-1' });
    const surfaces = (
      read.data as {
        surfaces: Array<{
          surfaceId: string;
          revision: number;
          content: unknown;
        }>;
      }
    ).surfaces;
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0]?.surfaceId).toBe('profile');
    expect(surfaces[0]?.revision).toBe(1);
    const content = surfaces[0]?.content as {
      contract?: string;
      dataModel?: unknown;
    };
    expect(content.contract).toBe('dashboard-spec/2');
    expect(content.dataModel).toEqual({ form: { name: 'Ada' } });
  });

  it('a real UI write through RpcHandler.handleMessage is visible through a real agent tool call', async () => {
    const { container: c, logger, state } = compose();
    const namespace = buildSurfaceNamespace({ service: state, logger });
    registerSurfaceRpc(c, logger);
    const rpc = c.resolve<RpcHandler>(TOKENS.RPC_HANDLER);

    const created = await handleSurfaceToolCall(
      SURFACE_UPDATE_TOOL_NAME,
      { operation: 'create', surface: envelope() },
      namespace,
      { sessionId: 'tab-1', toolCallId: 'call-create' },
      logger,
    );
    expect(created.isError).toBe(false);

    const operationId = opId('composetest0002');
    const change = await rpc.handleMessage({
      method: 'surface:change',
      params: {
        routingId: 'tab-1',
        surfaceId: 'profile',
        revision: 1,
        operationId,
        componentId: 'name',
        value: 'Grace',
      },
      correlationId: 'c-change-1',
    });
    expect(change.success).toBe(true);
    expect(change.data).toEqual({
      status: 'applied',
      operationId,
      revision: 2,
    });

    const reply = await handleSurfaceToolCall(
      SURFACE_GET_STATE_TOOL_NAME,
      { surfaceId: 'profile' },
      namespace,
      { sessionId: 'tab-1', toolCallId: 'call-read' },
      logger,
    );
    expect(reply.isError).toBe(false);
    expect(reply.text).toContain('"revision":2');
    expect(reply.text).toContain('"name":"Grace"');
  });
});

/**
 * F1: "Include a wiring check using the production API builder so a manually
 * injected shared service does not conceal a broken builder injection."
 *
 * `PtahAPIBuilder` has ~45 `@inject`s; all but the ~21 listed below are
 * `{ isOptional: true }` and are never called during construction or during
 * `buildSurfaceNamespace`'s slice of `.build()` (every other namespace is
 * independently wrapped in `buildNamespaceSafe`, so a bare `{}` stub for an
 * unrelated required token cannot fail THIS assertion — it can only make an
 * unrelated namespace's proxy throw on its own methods, which this test never
 * calls). This resolves the REAL `TOKENS.PTAH_API_BUILDER` singleton
 * `registerVsCodeLmToolsServices` registers, so `PtahAPIBuilder`'s own
 * `@inject(VSCODE_LM_TOOLS_TOKENS.SURFACE_STATE_SERVICE, ...)`
 * (`ptah-api-builder.service.ts:481`) is what reaches `.surface`, not a
 * value this test passed in by hand.
 */
describe('VS Code surface composition — PtahAPIBuilder wiring check (Req 7.4, F1)', () => {
  it("PtahAPIBuilder's own injection (not a manually passed service) reaches the shared store", async () => {
    const { container: c, state } = compose();
    const stub = {} as never;
    const requiredUnrelatedTokens = [
      TOKENS.WORKSPACE_ANALYZER_SERVICE,
      TOKENS.FILE_SYSTEM_MANAGER,
      TOKENS.CONTEXT_SIZE_OPTIMIZER,
      TOKENS.MONOREPO_DETECTOR_SERVICE,
      TOKENS.DEPENDENCY_ANALYZER_SERVICE,
      TOKENS.FILE_RELEVANCE_SCORER,
      TOKENS.TOKEN_COUNTER_SERVICE,
      TOKENS.WORKSPACE_INDEXER_SERVICE,
      TOKENS.PROJECT_DETECTOR_SERVICE,
      TOKENS.CONTEXT_ENRICHMENT_SERVICE,
      TOKENS.DEPENDENCY_GRAPH_SERVICE,
      TOKENS.TREE_SITTER_PARSER_SERVICE,
      TOKENS.AST_ANALYSIS_SERVICE,
      TOKENS.AGENT_PROCESS_MANAGER,
      TOKENS.CLI_DETECTION_SERVICE,
    ] as const;
    for (const token of requiredUnrelatedTokens) {
      c.register(token, { useValue: stub });
    }
    c.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, { useValue: stub });
    c.register(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER, { useValue: stub });
    c.register(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER, { useValue: stub });
    c.register(PLATFORM_TOKENS.SECRET_STORAGE, { useValue: stub });

    const builder = c.resolve<PtahAPIBuilder>(TOKENS.PTAH_API_BUILDER);
    const api = builder.build();

    const outcome = await api.surface.update(
      { operation: 'create', surface: envelope() },
      { sessionId: 'tab-1', toolCallId: 'call-builder' },
    );
    expect(outcome.status).toBe('accepted');

    // The SAME independently-resolved store singleton must see the write —
    // proof that `.surface` used the container's own injection, not a value
    // this test constructed and handed in.
    const read = state.read('tab-1', 'profile');
    expect(read.status).toBe('found');
  });
});
