/**
 * Lane plan-limit RPC handler — the read behind the `$limits` host source
 * (TASK_2026_623 R10.1-R10.4, implementation-plan D13).
 *
 *   - `agent:getLanePlanLimits` — the per-lane, per-window plan-limit rows
 *     `ptah_agent_list` prints under "Plan limits", as the same text, plus four
 *     lane counts and the time the rows were formatted against.
 *
 * Read semantics (decisions.md #18): the same lookup as `ptah_agent_list`,
 * `agent.list()` then `agent.limits(rows)`. It never passes `refresh` and never
 * touches a spawn, stop or session method, so an agent block cannot start a
 * lane or bypass the plan-usage caches. Per-lane lookup failures arrive as
 * rows (the agent namespace turns a failed lookup into `lookup: 'failed'`); a
 * host with no lookup, or a failing `list`, is an RPC error the webview shows
 * as "unavailable".
 *
 * Privacy (R10.4): the response is built field by field from the formatter's
 * first five cells — Agent, Window, Used, State, Reset — and four counts. The
 * Source cell, the snapshot, the owner, the account and the detection row are
 * never forwarded. No log line carries row contents.
 *
 * Host gating is data: the manifest entry requires `lanePlanLimits`, which only
 * the Electron profile enables.
 */

import { inject, injectable } from 'tsyringe';
import { TOKENS, RpcUserError } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import {
  formatPlanLimitRows,
  type AgentLimit,
  type PtahAPI,
  type PtahAPIBuilder,
} from '@ptah-extension/vscode-lm-tools';
import type {
  AgentGetLanePlanLimitsParams,
  AgentGetLanePlanLimitsResult,
  AgentLanePlanLimitRow,
  RpcMethodName,
} from '@ptah-extension/shared';
import { LanePlanLimitsParamsSchema } from './lane-plan-limits-rpc.schema';

const METHOD = 'agent:getLanePlanLimits';

/** Fixed caller-facing text; no internal diagnostic crosses the boundary. */
const UNAVAILABLE = 'Lane plan limits are unavailable on this host';

@injectable()
export class LanePlanLimitsRpcHandlers {
  static readonly METHODS = [
    'agent:getLanePlanLimits',
  ] as const satisfies readonly RpcMethodName[];

  /**
   * `PtahAPIBuilder.build()` is not memoized: every call constructs all
   * namespaces again. The API is built on the first read and kept; a failed
   * build is not kept, so the next read tries again.
   */
  private api: PtahAPI | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.PTAH_API_BUILDER)
    private readonly apiBuilder: PtahAPIBuilder,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod<
      AgentGetLanePlanLimitsParams,
      AgentGetLanePlanLimitsResult
    >(METHOD, async (params: unknown) => this.getLanePlanLimits(params));
  }

  private async getLanePlanLimits(
    params: unknown,
  ): Promise<AgentGetLanePlanLimitsResult> {
    const parsed = LanePlanLimitsParamsSchema.safeParse(params ?? {});
    if (!parsed.success) {
      throw new RpcUserError(
        `${METHOD}: invalid params — this method takes no parameters`,
        'INVALID_PARAMS',
      );
    }

    const limits = await this.lookup();
    const now = Date.now();
    return {
      rows: formatPlanLimitRows(limits, now).map(toRow),
      lanes: limits.length,
      atLimit: countState(limits, 'at-limit'),
      nearLimit: countState(limits, 'near-limit'),
      unknown: limits.filter(
        (limit) =>
          limit.state.state !== 'at-limit' &&
          limit.state.state !== 'near-limit' &&
          limit.state.state !== 'confirmed-room',
      ).length,
      asOf: now,
    };
  }

  /**
   * The `ptah_agent_list` lookup: `list()` then `limits(rows)` with exactly one
   * argument. Failures are logged by error name only, never by message, since
   * a message may quote a lane, a path or an account.
   */
  private async lookup(): Promise<readonly AgentLimit[]> {
    let limits: readonly AgentLimit[] | undefined;
    try {
      const agent = this.getApi().agent;
      const rows = await agent.list();
      limits = await agent.limits?.(rows);
    } catch (error) {
      this.logger.warn(`[lanePlanLimits] ${METHOD} lookup failed`, {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      // The cause is dropped on purpose: its message may quote a lane, a path
      // or an account, and error reporting would forward a linked cause.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(UNAVAILABLE);
    }
    if (limits === undefined) {
      this.logger.warn(`[lanePlanLimits] ${METHOD}: no lane limit lookup`);
      throw new Error(UNAVAILABLE);
    }
    return limits;
  }

  private getApi(): PtahAPI {
    this.api ??= this.apiBuilder.build();
    return this.api;
  }
}

/** Cells 0-4 only. Cell 5 (Source) is never sent. */
function toRow(cells: readonly string[]): AgentLanePlanLimitRow {
  return {
    lane: cells[0] ?? '-',
    window: cells[1] ?? '-',
    used: cells[2] ?? '-',
    state: cells[3] ?? '-',
    reset: cells[4] ?? '-',
  };
}

function countState(
  limits: readonly AgentLimit[],
  state: AgentLimit['state']['state'],
): number {
  return limits.filter((limit) => limit.state.state === state).length;
}
