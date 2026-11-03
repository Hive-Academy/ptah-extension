import { inject, injectable, type DependencyContainer } from 'tsyringe';
import { z } from 'zod';
import { PLATFORM_TOKENS, type IDisplayWindowHost } from '@ptah-extension/platform-core';
import {
  DISPLAY_WINDOW_STATE_MAX_BYTES,
  type DisplayWindowAction,
  type DisplayWindowActionParams,
  type DisplayWindowActionResult,
  type DisplayWindowCloseParams,
  type DisplayWindowCloseResult,
  type DisplayWindowGetStateParams,
  type DisplayWindowGetStateResult,
  type DisplayWindowJsonObject,
  type DisplayWindowOpenParams,
  type DisplayWindowOpenResult,
  type DisplayWindowPublishStateParams,
  type DisplayWindowPublishStateResult,
  type DisplayWindowSnapshot,
  type DisplayWindowStatusParams,
  type DisplayWindowStatusResult,
  type RpcMethodName,
} from '@ptah-extension/shared';
import { TOKENS, RpcUserError, type Logger, type RpcHandler } from '@ptah-extension/vscode-core';

// ---------------------------------------------------------------------------
// Boundary schemas (plan D2). Every param is parsed strictly here; past this
// point the port receives the parsed, typed value.
// ---------------------------------------------------------------------------

const MAX_ID_LENGTH = 256;
const MAX_KEY_LENGTH = 1024;
const MAX_PATH_LENGTH = 4096;

const EmptyParamsSchema = z.strictObject({});

const TabIdSchema = z.string().min(1).max(MAX_ID_LENGTH);

const JsonObjectSchema: z.ZodType<DisplayWindowJsonObject> = z.record(z.string(), z.json());

const ActionSchema: z.ZodType<DisplayWindowAction> = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('select'), key: z.string().min(1).max(MAX_KEY_LENGTH) }),
  z.strictObject({ type: z.literal('fullscreen-closed') }),
  z.strictObject({
    type: z.literal('view-state'),
    surfaceKey: z.string().min(1).max(MAX_KEY_LENGTH),
    viewState: JsonObjectSchema,
  }),
  z.strictObject({ type: z.literal('open-file'), path: z.string().min(1).max(MAX_PATH_LENGTH) }),
  z.strictObject({ type: z.literal('review') }),
  z.strictObject({ type: z.literal('attach') }),
]);

export const DisplayWindowPublishStateParamsSchema = z.strictObject({
  tabId: TabIdSchema,
  revision: z.number().int().min(0),
  state: JsonObjectSchema,
});

export const DisplayWindowActionParamsSchema = z.strictObject({
  tabId: TabIdSchema,
  action: ActionSchema,
});

/** Size of a snapshot's state as UTF-8 JSON text, the unit of the 4 MiB cap. */
function stateByteLength(state: DisplayWindowJsonObject): number {
  return Buffer.byteLength(JSON.stringify(state), 'utf8');
}

/**
 * `displayWindow:*` RPC family (TASK_2026_853_3401, plan D2).
 *
 * The port is resolved per call: Electron binds `DISPLAY_WINDOW_HOST` in its
 * bootstrap after phase 4 registers this handler (same pattern as
 * `artifact-rpc.handlers.ts`). Until it is bound, each method answers its
 * negative value and `open` answers `not-ready`.
 */
@injectable()
export class DisplayWindowRpcHandlers {
  static readonly METHODS = [
    'displayWindow:open',
    'displayWindow:close',
    'displayWindow:status',
    'displayWindow:publishState',
    'displayWindow:getState',
    'displayWindow:action',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.DI_CONTAINER) private readonly container: DependencyContainer,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod<DisplayWindowOpenParams, DisplayWindowOpenResult>(
      'displayWindow:open', async (params: unknown) => this.open(params),
    );
    this.rpcHandler.registerMethod<DisplayWindowCloseParams, DisplayWindowCloseResult>(
      'displayWindow:close', async (params: unknown) => this.close(params),
    );
    this.rpcHandler.registerMethod<DisplayWindowStatusParams, DisplayWindowStatusResult>(
      'displayWindow:status', async (params: unknown) => this.status(params),
    );
    this.rpcHandler.registerMethod<DisplayWindowPublishStateParams, DisplayWindowPublishStateResult>(
      'displayWindow:publishState', async (params: unknown) => this.publishState(params),
    );
    this.rpcHandler.registerMethod<DisplayWindowGetStateParams, DisplayWindowGetStateResult>(
      'displayWindow:getState', async (params: unknown) => this.getState(params),
    );
    this.rpcHandler.registerMethod<DisplayWindowActionParams, DisplayWindowActionResult>(
      'displayWindow:action', async (params: unknown) => this.action(params),
    );
  }

  private async open(params: unknown): Promise<DisplayWindowOpenResult> {
    this.parseEmpty('displayWindow:open', params);
    const host = this.resolveHost();
    if (!host) return { ok: false, reason: 'not-ready' };
    return host.open();
  }

  private async close(params: unknown): Promise<DisplayWindowCloseResult> {
    this.parseEmpty('displayWindow:close', params);
    const host = this.resolveHost();
    if (!host) return { closed: false };
    return { closed: await host.close() };
  }

  private async status(params: unknown): Promise<DisplayWindowStatusResult> {
    this.parseEmpty('displayWindow:status', params);
    const host = this.resolveHost();
    if (!host) return { supported: false, open: false };
    return { supported: host.supported, open: host.isOpen() };
  }

  private async publishState(params: unknown): Promise<DisplayWindowPublishStateResult> {
    const parsed = DisplayWindowPublishStateParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw new RpcUserError('displayWindow:publishState: invalid params', 'INVALID_PARAMS');
    }
    const bytes = stateByteLength(parsed.data.state);
    if (bytes > DISPLAY_WINDOW_STATE_MAX_BYTES) {
      this.logger.warn('displayWindow:publishState refused an oversized snapshot', {
        bytes,
        maxBytes: DISPLAY_WINDOW_STATE_MAX_BYTES,
      });
      throw new RpcUserError('displayWindow:publishState: state is too large', 'INVALID_PARAMS');
    }
    const host = this.resolveHost();
    if (!host) return { delivered: false };
    const snapshot: DisplayWindowSnapshot = parsed.data;
    return { delivered: host.publishState(snapshot) };
  }

  private async getState(params: unknown): Promise<DisplayWindowGetStateResult> {
    this.parseEmpty('displayWindow:getState', params);
    const host = this.resolveHost();
    return { state: host ? host.getState() : null };
  }

  private async action(params: unknown): Promise<DisplayWindowActionResult> {
    const parsed = DisplayWindowActionParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw new RpcUserError('displayWindow:action: invalid params', 'INVALID_PARAMS');
    }
    const host = this.resolveHost();
    if (!host) return { relayed: false };
    return { relayed: host.relayAction(parsed.data.tabId, parsed.data.action) };
  }

  private parseEmpty(method: RpcMethodName, params: unknown): void {
    if (!EmptyParamsSchema.safeParse(params).success) {
      throw new RpcUserError(`${method}: invalid params`, 'INVALID_PARAMS');
    }
  }

  private resolveHost(): IDisplayWindowHost | null {
    if (!this.container.isRegistered(PLATFORM_TOKENS.DISPLAY_WINDOW_HOST, true)) return null;
    return this.container.resolve<IDisplayWindowHost>(PLATFORM_TOKENS.DISPLAY_WINDOW_HOST);
  }
}
