/**
 * CLI surface composition — the full-mode container's store, a real
 * two-consumer round trip, and defensive missing-collaborator cases
 * (TASK_2026_538 Batch 14, Task 14.5; plan Req 7 row,
 * implementation-plan.md:796; carried from Batch 11).
 *
 * `container.ts:772-774` registers `registerVsCodeLmToolsServices` (and
 * therefore `VSCODE_LM_TOOLS_TOKENS.SURFACE_STATE_SERVICE`) and the
 * `surface:*` RPC handlers together, ONLY in `bootstrapMode: 'full'`
 * (`container.ts:761-889`); `container.ts:379-380` registers
 * `CliWebviewManagerAdapter` at `TOKENS.WEBVIEW_MANAGER` earlier still, in
 * every mode. The CLI and TUI render no surfaces at all
 * (`cli-webview-manager-adapter.ts:44-53`), so a committed surface is always
 * `no-surface` on this host — a success, never a failure.
 *
 * Revision 1 (code-logic-review-batch-14.md, F1 SERIOUS / F2 MODERATE):
 *
 *  1. The orchestrator approved a narrow, named export of
 *     `buildSurfaceNamespace` / `SurfaceNamespace` / `SurfaceCaller` and
 *     `handleSurfaceToolCall` from `@ptah-extension/vscode-lm-tools`'s public
 *     barrel (this batch's only production change; see `batch-14-report.md`
 *     "Revision 1"). No `SurfaceRpcHandlers` export was added.
 *  2. The RPC side is reached through the public host-profile API
 *     (`RPC_HANDLER_MANIFEST` / `resolveRpcHandlerPlan`, already exported via
 *     `export * from './lib/host-profile'`): `resolveRpcHandlerPlan(createCliRpcHostProfile(...))`
 *     filtered to the one `key: 'surface'` step, resolved from THIS
 *     container and `.register()`ed.
 *
 * Labelling: the agent side below is tool-call / namespace level
 * (`handleSurfaceToolCall` + `buildSurfaceNamespace`), the same code
 * `protocol-dispatcher.ts:1680` calls into — NOT the full JSON-RPC/MCP
 * dispatcher (no `AsyncLocalStorage` caller-scope resolution here). The UI
 * side goes through the real `RpcHandler.handleMessage`, the full RPC wire
 * entry point.
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
import {
  registerVsCodeLmToolsServices,
  VSCODE_LM_TOOLS_TOKENS,
  SurfaceStateService,
  buildSurfaceNamespace,
  handleSurfaceToolCall,
  SURFACE_UPDATE_TOOL_NAME,
  SURFACE_GET_STATE_TOOL_NAME,
} from '@ptah-extension/vscode-lm-tools';
import { resolveRpcHandlerPlan } from '@ptah-extension/rpc-handlers';
import type { SurfaceEnvelope } from '@ptah-extension/shared';

import { CliWebviewManagerAdapter } from './transport/cli-webview-manager-adapter';
import { createCliRpcHostProfile } from './rpc/cli-host-profile';

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

/** A surface with a submit action, for the F2 "no submit-turn service" case. */
function formEnvelope(): SurfaceEnvelope {
  return {
    schemaVersion: 'dashboard-spec/2',
    catalogVersion: 'dashboard-catalog/2',
    surfaceId: 'form',
    title: { text: 'Form' },
    components: [
      {
        kind: 'card',
        id: 'card',
        title: { text: 'Card' },
        actions: [
          { id: 'send', action: 'surface.submit', label: { text: 'Send' } },
        ],
        children: [
          { kind: 'text', id: 'name', label: 'Name', path: 'form.name' },
        ],
      },
    ],
  };
}

/**
 * Resolve and `register()` the real `SurfaceRpcHandlers` — found through the
 * PUBLIC `resolveRpcHandlerPlan(realHostProfile)`, filtered to the one
 * `key: 'surface'` step (code-logic-review-batch-14.md, "smallest practical
 * follow-up"), not through a name import.
 */
function registerSurfaceRpc(container: DependencyContainer): void {
  const profile = createCliRpcHostProfile('cli');
  const step = resolveRpcHandlerPlan(profile).find((s) => s.key === 'surface');
  if (!step) {
    throw new Error(
      "resolveRpcHandlerPlan(createCliRpcHostProfile('cli')) has no 'surface' step — has the manifest or the CLI profile changed?",
    );
  }
  container.resolve(step.ctor).register();
}

/**
 * Production order: `TOKENS.WEBVIEW_MANAGER` before Phase 4's
 * `registerVsCodeLmToolsServices` (`container.ts:379-380`, `:773`).
 */
function composeFullMode(): {
  container: DependencyContainer;
  logger: Logger;
  state: SurfaceStateService;
} {
  const logger = makeLogger();
  const c: DependencyContainer = rootContainer.createChildContainer();
  c.register(TOKENS.LOGGER, { useValue: logger });
  registerVsCodeCorePlatformAgnostic(c, logger, {
    includeLicensingAndAuth: false,
  });
  c.register(TOKENS.CONTEXT_ORCHESTRATION_SERVICE, { useValue: {} });
  c.register(TOKENS.WEBVIEW_MANAGER, {
    useValue: new CliWebviewManagerAdapter(),
  });

  registerVsCodeLmToolsServices(c, logger);
  const state = c.resolve<SurfaceStateService>(
    VSCODE_LM_TOOLS_TOKENS.SURFACE_STATE_SERVICE,
  );
  return { container: c, logger, state };
}

describe('CLI surface composition — collaborator-level (Req 7.4, 11.2)', () => {
  it('keeps state through the real CliWebviewManagerAdapter while delivery honestly reports no-surface', async () => {
    const { state } = composeFullMode();

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
  });

  it('collaborator-level: a UI write is visible to an agent read', async () => {
    const { state } = composeFullMode();

    const created = state.applyAgentUpdate(
      'tab-1',
      { operation: 'create', surface: envelope() },
      'call-create',
    );
    expect(created.status).toBe('applied');
    if (created.status !== 'applied') return;

    const operationId = opId('clicomposetest01');
    const changed = state.change('tab-1', {
      surfaceId: 'profile',
      revision: created.revision,
      operationId,
      componentId: 'name',
      value: 'Bo',
    });
    expect(changed).toEqual({
      status: 'applied',
      operationId,
      revision: created.revision + 1,
    });

    const read = state.describeForAgent('tab-1', { surfaceId: 'profile' });
    expect(read.status).toBe('found');
    if (read.status !== 'found') return;
    expect(read.text).toContain('Bo');
  });
});

describe('CLI surface composition — real two-consumer round trip (Req 7.4, F1)', () => {
  it('a real agent tool call is visible through the real RPC handler', async () => {
    const { container: c, logger, state } = composeFullMode();
    const namespace = buildSurfaceNamespace({ service: state, logger });
    registerSurfaceRpc(c);
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
    const data = read.data as {
      status: string;
      routingId: string;
      surfaces: Array<{ surfaceId: string; revision: number }>;
    };
    expect(data.status).toBe('found');
    expect(data.routingId).toBe('tab-1');
    expect(data.surfaces[0]?.surfaceId).toBe('profile');
    expect(data.surfaces[0]?.revision).toBe(1);
  });

  it('a real UI write through RpcHandler.handleMessage is visible through a real agent tool call', async () => {
    const { container: c, logger, state } = composeFullMode();
    const namespace = buildSurfaceNamespace({ service: state, logger });
    registerSurfaceRpc(c);
    const rpc = c.resolve<RpcHandler>(TOKENS.RPC_HANDLER);

    await handleSurfaceToolCall(
      SURFACE_UPDATE_TOOL_NAME,
      { operation: 'create', surface: envelope() },
      namespace,
      { sessionId: 'tab-1', toolCallId: 'call-create' },
      logger,
    );

    const operationId = opId('clicomposetest02');
    const change = await rpc.handleMessage({
      method: 'surface:change',
      params: {
        routingId: 'tab-1',
        surfaceId: 'profile',
        revision: 1,
        operationId,
        componentId: 'name',
        value: 'Bo',
      },
      correlationId: 'c-change-1',
    });
    expect(change.success).toBe(true);
    expect(change.data).toEqual({ status: 'applied', operationId, revision: 2 });

    const reply = await handleSurfaceToolCall(
      SURFACE_GET_STATE_TOOL_NAME,
      { surfaceId: 'profile' },
      namespace,
      { sessionId: 'tab-1', toolCallId: 'call-read' },
      logger,
    );
    expect(reply.isError).toBe(false);
    expect(reply.text).toContain('"revision":2');
    expect(reply.text).toContain('"name":"Bo"');
  });
});

/**
 * F2 (code-logic-review-batch-14.md, MODERATE): the CLI's full-mode
 * bootstrap wires the store and the RPC surface together, all-or-nothing
 * (plan evidence row "CLI registers the RPC surface in the same full-mode
 * branch"), so these variants build a container by hand rather than toggling
 * `bootstrapMode`.
 */
describe('CLI surface composition — defensive missing collaborators (Req 7.4, F2)', () => {
  it('no state registered: both the MCP tool path and RPC return non-rejecting errors with the exact unavailable wording', async () => {
    const logger = makeLogger();
    const c: DependencyContainer = rootContainer.createChildContainer();
    c.register(TOKENS.LOGGER, { useValue: logger });
    registerVsCodeCorePlatformAgnostic(c, logger, {
      includeLicensingAndAuth: false,
    });
    // VSCODE_LM_TOOLS_TOKENS.SURFACE_STATE_SERVICE is never registered —
    // registerVsCodeLmToolsServices is not called on this container at all.
    registerSurfaceRpc(c);
    const rpc = c.resolve<RpcHandler>(TOKENS.RPC_HANDLER);
    const namespace = buildSurfaceNamespace({ service: undefined, logger });

    const updateReply = await handleSurfaceToolCall(
      SURFACE_UPDATE_TOOL_NAME,
      { operation: 'create', surface: envelope() },
      namespace,
      { sessionId: 'tab-1', toolCallId: 'call-1' },
      logger,
    );
    expect(updateReply).toEqual({
      isError: true,
      text: 'surface state unavailable on this host',
    });

    const getStateReply = await handleSurfaceToolCall(
      SURFACE_GET_STATE_TOOL_NAME,
      { surfaceId: 'profile' },
      namespace,
      { sessionId: 'tab-1', toolCallId: 'call-2' },
      logger,
    );
    expect(getStateReply).toEqual({
      isError: true,
      text: 'surface state unavailable on this host',
    });

    await expect(
      rpc.handleMessage({
        method: 'surface:read',
        params: { routingId: 'tab-1' },
        correlationId: 'c-missing-1',
      }),
    ).resolves.toEqual({
      success: false,
      error: 'surface state unavailable on this host',
      correlationId: 'c-missing-1',
    });

    await expect(
      rpc.handleMessage({
        method: 'surface:change',
        params: {
          routingId: 'tab-1',
          surfaceId: 'profile',
          revision: 1,
          operationId: opId('clinostate0001'),
          componentId: 'name',
          value: 'x',
        },
        correlationId: 'c-missing-2',
      }),
    ).resolves.toEqual({
      success: false,
      error: 'surface state unavailable on this host',
      correlationId: 'c-missing-2',
    });
  });

  it('state registered, no submit-turn service: submit settles rejected/session-unavailable and surface:operation is terminal', async () => {
    const { container: c, logger, state } = composeFullMode();
    // The store exists; only the chat runtime's submit-turn service
    // (CHAT_TOKENS.SURFACE_SUBMIT_TURN, registered by registerChatServices)
    // is absent — a supported host without a live chat runtime attached.
    registerSurfaceRpc(c);
    const rpc = c.resolve<RpcHandler>(TOKENS.RPC_HANDLER);
    const namespace = buildSurfaceNamespace({ service: state, logger });

    const created = await handleSurfaceToolCall(
      SURFACE_UPDATE_TOOL_NAME,
      { operation: 'create', surface: formEnvelope() },
      namespace,
      { sessionId: 'tab-1', toolCallId: 'call-create' },
      logger,
    );
    expect(created.isError).toBe(false);

    const operationId = opId('clinosubmit0001');
    const action = await rpc.handleMessage({
      method: 'surface:action',
      params: {
        routingId: 'tab-1',
        surfaceId: 'form',
        revision: 1,
        operationId,
        actionId: 'send',
      },
      correlationId: 'c-submit-1',
    });
    expect(action.success).toBe(true);
    expect(action.data).toEqual({
      status: 'rejected',
      operationId,
      reason: 'session-unavailable',
      detail:
        'The chat runtime is not available on this host; the submit was not sent.',
    });

    // Terminal: a later surface:operation lookup replays the SAME settled
    // outcome, never 'pending' or 'unknown'.
    const operation = await rpc.handleMessage({
      method: 'surface:operation',
      params: { routingId: 'tab-1', operationId },
      correlationId: 'c-operation-1',
    });
    expect(operation.success).toBe(true);
    expect(operation.data).toMatchObject({ status: 'rejected' });
    expect((operation.data as { status: string }).status).not.toBe('pending');
    expect((operation.data as { status: string }).status).not.toBe('unknown');
  });
});
