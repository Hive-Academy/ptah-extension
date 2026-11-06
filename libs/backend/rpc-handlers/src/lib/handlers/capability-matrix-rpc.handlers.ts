/**
 * Capability matrix read (routing learning, item 7).
 *
 * `agent:getCapabilityMatrix` takes no params and returns the merged view:
 * one profile per family and model, one cell per task kind. Unknown cells
 * stay `{ kind: 'unknown' }`.
 *
 * The store supplies the merged view through its read port.
 */

import { inject, injectable, type DependencyContainer } from 'tsyringe';
import { TOKENS, RpcUserError } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { LANE_ROUTING_TOKENS, type CapabilityMatrixViewReader, type RotationStateReader } from '@ptah-extension/lane-routing';
import type {
  AgentCapabilityMatrixCell,
  AgentCapabilityMatrixProfile,
  AgentCapabilityMatrixValueCell,
  AgentGetCapabilityMatrixParams,
  AgentGetCapabilityMatrixResult,
  RpcMethodName,
} from '@ptah-extension/shared';
import {
  CapabilityMatrixParamsSchema,
  CapabilityMatrixViewSchema,
  RotationPicksSchema,
  type ParsedCapabilityMatrixView,
} from './capability-matrix-rpc.schema';

const METHOD = 'agent:getCapabilityMatrix';


@injectable()
export class CapabilityMatrixRpcHandlers {
  static readonly METHODS = [
    METHOD,
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.DI_CONTAINER)
    private readonly runtimeContainer: DependencyContainer,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod<
      AgentGetCapabilityMatrixParams,
      AgentGetCapabilityMatrixResult
    >(METHOD, async (params: unknown) => this.getCapabilityMatrix(params));
  }

  private async getCapabilityMatrix(
    params: unknown,
  ): Promise<AgentGetCapabilityMatrixResult> {
    const parsed = CapabilityMatrixParamsSchema.safeParse(
      params === undefined ? {} : params,
    );
    if (!parsed.success) {
      throw new RpcUserError(
        `${METHOD}: invalid params — this method takes no parameters`,
        'INVALID_PARAMS',
      );
    }

    if (
      !this.runtimeContainer.isRegistered(
        LANE_ROUTING_TOKENS.CAPABILITY_MATRIX_STORE,
        true,
      )
    ) {
      throw this.unavailable('capability matrix store is not registered');
    }

    let reader: CapabilityMatrixViewReader;
    try {
      reader = this.runtimeContainer.resolve<CapabilityMatrixViewReader>(
        LANE_ROUTING_TOKENS.CAPABILITY_MATRIX_STORE,
      );
    } catch (error: unknown) {
      throw this.unavailable('capability matrix store did not resolve', error);
    }

    let raw: unknown;
    try {
      raw = await reader.readMergedView();
    } catch (error: unknown) {
      throw this.unavailable('capability matrix read failed', error);
    }

    const view = CapabilityMatrixViewSchema.safeParse(raw);
    if (!view.success) {
      throw this.unavailable('capability matrix view did not match the contract');
    }
    const result = toResult(view.data);
    if (!this.runtimeContainer.isRegistered(LANE_ROUTING_TOKENS.ROUTE_DECIDE_SERVICE, true)) return result;
    try {
      const rotation = this.runtimeContainer.resolve<RotationStateReader>(LANE_ROUTING_TOKENS.ROUTE_DECIDE_SERVICE);
      const picks = rotation.getLastPicks();
      return { ...result, lastPicks: RotationPicksSchema.parse(picks.entries), lastPicksUnavailable: picks.reason !== null };
    } catch (error: unknown) {
      this.logger.warn('RPC: rotation state could not be read', error instanceof Error ? error : new Error('rotation state read failed'));
      return result;
    }
  }

  private unavailable(message: string, error?: unknown): RpcUserError {
    const cause = error instanceof Error ? error : new Error(message);
    this.logger.error(`RPC: ${METHOD} failed`, cause);
    return new RpcUserError(
      'Capability matrix is unavailable.',
      'PERSISTENCE_UNAVAILABLE',
    );
  }
}

function toResult(
  view: ParsedCapabilityMatrixView,
): AgentGetCapabilityMatrixResult {
  return {
    profiles: view.profiles.map((profile) => ({
      family: profile.family,
      model: profile.model,
      cells: toCells(profile.cells),
    })),
  };
}

function toCells(
  cells: ParsedCapabilityMatrixView['profiles'][number]['cells'],
): AgentCapabilityMatrixProfile['cells'] {
  return {
    plan: toCell(cells.plan),
    implement: toCell(cells.implement),
    review: toCell(cells.review),
    research: toCell(cells.research),
    tests: toCell(cells.tests),
    docs: toCell(cells.docs),
  };
}

function toCell(
  cell: ParsedCapabilityMatrixView['profiles'][number]['cells']['plan'],
): AgentCapabilityMatrixCell {
  if (cell.kind === 'unknown') return { kind: 'unknown' };
  const value: AgentCapabilityMatrixValueCell = {
    kind: 'value',
    score: cell.score,
    source: cell.source,
    sourceRef: cell.sourceRef ?? null,
    asOf: cell.asOf,
    stale: cell.stale,
    sampleCount: cell.sampleCount ?? null,
  };
  if (cell.note === undefined) return value;
  return { ...value, note: cell.note };
}
