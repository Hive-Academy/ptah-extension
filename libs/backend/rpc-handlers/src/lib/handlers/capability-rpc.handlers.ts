/**
 * `capabilities:*` RPC handlers (TASK_2026_560, plan C8).
 *
 *  - `capabilities:getState`     every MCP server, skill and plugin row of the
 *                                active workspace, with its on/off state.
 *  - `capabilities:getEffective` the set a session started now would load.
 *  - `capabilities:setEnabled`   one toggle; answers with the re-resolved row.
 *
 * ## Which workspace
 *
 * No method takes a root. The active workspace path is passed as `cwd` to the
 * shared `ICapabilityResolver`, which canonicalizes it to its policy root
 * itself, so a webview can never address a policy outside the workspace it is
 * showing. With no workspace open every method answers `WORKSPACE_NOT_OPEN`:
 * the resolver contract resolves every call — the global rows included —
 * against a workspace, so there is nothing honest to return without one.
 *
 * ## Boundary
 *
 * Params are parsed with the schemas below; a failure is `INVALID_PARAMS`
 * naming the failing fields. `explicit: true` is the install path's "keep
 * this workspace ON" write (N6): it is workspace-only, MCP-only and ON-only,
 * because that is all `ICapabilityResolver.setExplicit` can express. A toggle
 * id is checked against the workspace inventory before anything is written.
 *
 * ## Failures
 *
 * A rejected write is an RPC error that names the item and a fixed, safe
 * reason (AC-1.4); the UI reverts its optimistic value on it. The resolver's
 * own error text (paths, errno detail) is logged here and never sent across.
 *
 * ## Schema size
 *
 * `schemaTokens` is attached only when the optional `SDK_MCP_SCHEMA_SIZE`
 * service is registered (PR 2). Without it every row omits the field, which
 * the UI renders as "size unknown", never zero (AC-5.2).
 */

import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import { RpcUserError, TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { isCapabilityPolicyUnknownError } from '@ptah-extension/shared';
import type {
  CapabilitiesGetEffectiveResult,
  CapabilitiesGetStateResult,
  CapabilitiesSetEnabledParams,
  CapabilitiesSetEnabledResult,
  CapabilityEntry,
  CapabilityInventory,
  CapabilityKind,
  CapabilityScope,
  ICapabilityResolver,
  RpcMethodName,
} from '@ptah-extension/shared';

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

/** Longest capability id accepted at the boundary. */
const CAPABILITY_ID_MAX_LENGTH = 1024;

/** True when `value` has no C0 control character and no DEL. */
function hasNoControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

/**
 * `capabilities:getState` and `capabilities:getEffective` params. Both take
 * nothing: the workspace is the host's active one. An absent payload and
 * extra fields from an older webview are accepted.
 */
export const CapabilitiesNoParamsSchema = z.object({}).passthrough().nullish();

/**
 * `capabilities:setEnabled` params.
 *
 * `explicit: true` is accepted only with `scope: 'workspace'`, `kind: 'mcp'`
 * and `enabled: true`: the install path's write (N6) is a workspace MCP ON,
 * and an explicit global write has no meaning (the global layer inherits from
 * nothing).
 */
export const CapabilitiesSetEnabledSchema = z
  .object({
    scope: z.enum(['workspace', 'global']),
    kind: z.enum(['mcp', 'skill', 'plugin']),
    id: z
      .string()
      .min(1)
      .max(CAPABILITY_ID_MAX_LENGTH)
      .refine(hasNoControlCharacters, {
        message: 'must not contain control characters',
      }),
    enabled: z.boolean(),
    explicit: z.boolean().optional(),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (value.explicit !== true) return;
    if (value.scope !== 'workspace') {
      context.addIssue({
        code: 'custom',
        path: ['explicit'],
        message: "explicit is only valid with scope 'workspace'",
      });
    }
    if (value.kind !== 'mcp') {
      context.addIssue({
        code: 'custom',
        path: ['explicit'],
        message: "explicit is only valid with kind 'mcp'",
      });
    }
    if (!value.enabled) {
      context.addIssue({
        code: 'custom',
        path: ['explicit'],
        message: 'explicit is only valid with enabled: true',
      });
    }
  });

// ---------------------------------------------------------------------------
// Optional schema-size port
// ---------------------------------------------------------------------------

/**
 * What this handler needs from `SDK_TOKENS.SDK_MCP_SCHEMA_SIZE` (PR 2,
 * `McpSchemaSizeService`): tool-schema token estimates for the active
 * workspace, keyed by MCP server name. A server with no figure is absent from
 * the map; the service bounds its own work.
 */
export interface McpSchemaSizeReader {
  schemaTokensFor(cwd: string): Promise<ReadonlyMap<string, number>>;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

type CapabilityRpcMethod =
  | 'capabilities:getState'
  | 'capabilities:getEffective'
  | 'capabilities:setEnabled';

const KIND_LABELS: Readonly<Record<CapabilityKind, string>> = {
  mcp: 'MCP server',
  skill: 'skill',
  plugin: 'plugin',
};

/** At most this many schema issues are named in an INVALID_PARAMS message. */
const MAX_REPORTED_ISSUES = 5;

/** Safe reasons sent across for a failure that is not a known store error. */
const READ_FALLBACK_REASON = 'the capability sources could not be read';
const WRITE_FALLBACK_REASON = 'the change was not applied';

@injectable()
export class CapabilityRpcHandlers {
  static readonly METHODS = [
    'capabilities:getState',
    'capabilities:getEffective',
    'capabilities:setEnabled',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(SDK_TOKENS.SDK_CAPABILITY_RESOLVER)
    private readonly resolver: ICapabilityResolver,
    // Optional until PR 2 registers the measurement. Absent means every row
    // is "size unknown".
    @inject(SDK_TOKENS.SDK_MCP_SCHEMA_SIZE, { isOptional: true })
    private readonly schemaSize: McpSchemaSizeReader | null = null,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod<unknown, CapabilitiesGetStateResult>(
      'capabilities:getState',
      async (params) => this.handleGetState(params),
    );
    this.rpcHandler.registerMethod<unknown, CapabilitiesGetEffectiveResult>(
      'capabilities:getEffective',
      async (params) => this.handleGetEffective(params),
    );
    this.rpcHandler.registerMethod<
      CapabilitiesSetEnabledParams,
      CapabilitiesSetEnabledResult
    >('capabilities:setEnabled', async (params) =>
      this.handleSetEnabled(params),
    );

    this.logger.debug('Capability RPC handlers registered', {
      methods: CapabilityRpcHandlers.METHODS,
      schemaSize: this.schemaSize !== null,
    });
  }

  private async handleGetState(
    params: unknown,
  ): Promise<CapabilitiesGetStateResult> {
    parseParams('capabilities:getState', CapabilitiesNoParamsSchema, params);
    const cwd = this.requireWorkspace(
      'capabilities:getState',
      'the capability list is resolved against the open workspace folder',
    );

    let inventory: CapabilityInventory;
    try {
      inventory = await this.resolver.list(cwd);
    } catch (error: unknown) {
      this.logFailure('capabilities:getState', error, {});
      throw new Error(
        `Could not read the capability list: ${safeReason(error, READ_FALLBACK_REASON)}.`,
      );
    }

    const figures = await this.readSchemaTokens(cwd);
    if (figures === null) return inventory;
    return {
      ...inventory,
      entries: inventory.entries.map((entry) =>
        withSchemaTokens(entry, figures),
      ),
    };
  }

  private async handleGetEffective(
    params: unknown,
  ): Promise<CapabilitiesGetEffectiveResult> {
    parseParams(
      'capabilities:getEffective',
      CapabilitiesNoParamsSchema,
      params,
    );
    const cwd = this.requireWorkspace(
      'capabilities:getEffective',
      'the effective set is resolved for the open workspace folder',
    );

    try {
      return await this.resolver.resolve(cwd);
    } catch (error: unknown) {
      // `resolve` promises not to throw; this is the guard if it ever does.
      this.logFailure('capabilities:getEffective', error, {});
      throw new Error(
        `Could not resolve the effective capability set: ${safeReason(error, READ_FALLBACK_REASON)}.`,
      );
    }
  }

  private async handleSetEnabled(
    params: unknown,
  ): Promise<CapabilitiesSetEnabledResult> {
    const input = parseParams(
      'capabilities:setEnabled',
      CapabilitiesSetEnabledSchema,
      params,
    );
    const cwd = this.requireWorkspace(
      'capabilities:setEnabled',
      input.scope === 'workspace'
        ? `a workspace ${KIND_LABELS[input.kind]} setting belongs to an open workspace folder`
        : 'the changed row is re-resolved against the open workspace folder',
    );
    const item = describeItem(input.kind, input.id, input.scope);
    const detail = {
      kind: input.kind,
      id: input.id,
      scope: input.scope,
      enabled: input.enabled,
      explicit: input.explicit === true,
    };

    await this.assertKnownItem(input.kind, input.id, cwd, item, input.enabled);

    this.logger.info('RPC: capabilities:setEnabled', detail);
    try {
      const entry =
        input.explicit === true
          ? await this.resolver.setExplicit(cwd, 'mcp', input.id, true)
          : await this.resolver.set({
              cwd,
              scope: input.scope,
              kind: input.kind,
              id: input.id,
              enabled: input.enabled,
            });
      return { entry };
    } catch (error: unknown) {
      this.logFailure('capabilities:setEnabled', error, detail);
      throw new Error(
        `Could not turn ${input.enabled ? 'on' : 'off'} ${item}: ${safeReason(error, WRITE_FALLBACK_REASON)}.`,
      );
    }
  }

  // ------------------------------------------------------------- helpers

  /**
   * Refuse an id the workspace inventory does not list. Skipped when the
   * inventory is `unverified`: an unreadable source may be the one declaring
   * the item, and the resolver still rejects an unknown id itself.
   */
  private async assertKnownItem(
    kind: CapabilityKind,
    id: string,
    cwd: string,
    item: string,
    enabled: boolean,
  ): Promise<void> {
    let inventory: CapabilityInventory;
    try {
      inventory = await this.resolver.list(cwd);
    } catch (error: unknown) {
      this.logFailure('capabilities:setEnabled', error, { kind, id });
      throw new Error(
        `Could not turn ${enabled ? 'on' : 'off'} ${item}: ${safeReason(error, READ_FALLBACK_REASON)}.`,
      );
    }
    if (inventory.status !== 'verified') return;
    const known = inventory.entries.some(
      (entry) => entry.kind === kind && entry.id === id,
    );
    if (!known) {
      throw new RpcUserError(
        `capabilities:setEnabled: invalid params — ${item} is not in this workspace's capability list.`,
        'INVALID_PARAMS',
      );
    }
  }

  private requireWorkspace(method: CapabilityRpcMethod, why: string): string {
    const root = this.workspaceProvider.getWorkspaceRoot();
    if (root === undefined || root === '') {
      throw new RpcUserError(
        `${method}: no workspace folder is open — ${why}.`,
        'WORKSPACE_NOT_OPEN',
      );
    }
    return root;
  }

  /**
   * The schema-size figures, or `null` when there are none to attach: the
   * service is not registered, or it failed (every row stays "size unknown").
   */
  private async readSchemaTokens(
    cwd: string,
  ): Promise<ReadonlyMap<string, number> | null> {
    if (this.schemaSize === null) return null;
    try {
      return await this.schemaSize.schemaTokensFor(cwd);
    } catch (error: unknown) {
      this.logger.warn(
        'RPC: capabilities:getState schema size unavailable; rows report size unknown',
        { errorName: errorName(error) },
      );
      return null;
    }
  }

  private logFailure(
    method: CapabilityRpcMethod,
    error: unknown,
    detail: Record<string, unknown>,
  ): void {
    this.logger.error(`RPC: ${method} failed`, {
      ...detail,
      errorName: errorName(error),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function parseParams<S extends z.ZodType>(
  method: CapabilityRpcMethod,
  schema: S,
  params: unknown,
): z.output<S> {
  const parsed = schema.safeParse(params);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue) => {
      const path = issue.path.map((segment) => String(segment)).join('.');
      return `${path === '' ? '(params)' : path}: ${issue.message}`;
    });
  throw new RpcUserError(
    `${method}: invalid params — ${issues.join('; ')}`,
    'INVALID_PARAMS',
  );
}

function describeItem(
  kind: CapabilityKind,
  id: string,
  scope: CapabilityScope,
): string {
  return `${KIND_LABELS[kind]} "${id}" (${scope})`;
}

/**
 * A fixed, user-safe reason for a resolver failure. Matched on the error's
 * `name` (never its message), so no internal text crosses the boundary.
 */
function safeReason(error: unknown, fallback: string): string {
  if (isCapabilityPolicyUnknownError(error)) {
    return 'the capability policy could not be read';
  }
  if (errorName(error) === 'CapabilityToggleStoreError') {
    return 'the setting could not be saved';
  }
  return fallback;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function withSchemaTokens(
  entry: CapabilityEntry,
  figures: ReadonlyMap<string, number>,
): CapabilityEntry {
  if (entry.kind !== 'mcp') return entry;
  const tokens = figures.get(entry.id);
  if (tokens === undefined || !Number.isFinite(tokens) || tokens < 0) {
    return entry;
  }
  return { ...entry, schemaTokens: tokens };
}
