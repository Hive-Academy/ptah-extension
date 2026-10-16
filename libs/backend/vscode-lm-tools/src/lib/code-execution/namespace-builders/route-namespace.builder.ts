/**
 * `ptah.route` namespace (TASK_2026_646, part A §8).
 *
 * `decide` resolves `LANE_ROUTING_TOKENS.ROUTE_DECIDE_SERVICE` on every
 * call. Hosts do not call `registerLaneRoutingServices` until Batch 30, so
 * this is a locator, not an `@inject` on a class a host constructs today.
 * An unregistered service throws {@link RoutingUnavailableError} (F9)
 * before any agent I/O.
 */
import type {
  CliDetectionResult,
  LaneLimitState,
} from '@ptah-extension/shared';
import {
  LANE_ROUTING_TOKENS,
  type RouteCandidateSource,
  type RouteDecideArgs,
  type RouteDecideResult,
  type RouteDecideService,
} from '@ptah-extension/lane-routing';
import type { AgentNamespace } from '../types';

/** F9. The skill treats this sentence as "tool not listed". */
export const ROUTING_UNAVAILABLE_MESSAGE =
  "routing is not available in this host; use the skill's rule tables";

export class RoutingUnavailableError extends Error {
  constructor() {
    super(ROUTING_UNAVAILABLE_MESSAGE);
    this.name = 'RoutingUnavailableError';
  }
}

/**
 * The two container methods this namespace uses. `DependencyContainer`
 * satisfies it. `isRegistered(token, true)` includes parent containers.
 */
export interface RouteServiceLocator {
  isRegistered(token: symbol, recursive?: boolean): boolean;
  resolve<T>(token: symbol): T;
}

export interface RouteNamespace {
  decide(args: RouteDecideArgs): Promise<RouteDecideResult>;
}

export interface RouteNamespaceDependencies {
  readonly agent: Pick<AgentNamespace, 'list' | 'limits' | 'listRoles'>;
  /** Read on every call. Absent or unregistered → F9, and no agent I/O. */
  readonly container: RouteServiceLocator | undefined;
}

type RouteAgent = RouteNamespaceDependencies['agent'];

/**
 * `RouteDecideService` when the host has registered it. `undefined` when
 * the container is missing or the token is not registered. Does not throw
 * for the unregistered case.
 */
export function resolveRouteDecideService(
  container: RouteServiceLocator | undefined,
): RouteDecideService | undefined {
  if (!container) return undefined;
  const token = LANE_ROUTING_TOKENS.ROUTE_DECIDE_SERVICE;
  if (!container.isRegistered(token, true)) return undefined;
  return container.resolve<RouteDecideService>(token);
}

/**
 * Limit-map key. Same rule as lane-routing's `laneCandidateId`: `ptahCliId`
 * for a Ptah CLI row that has one, otherwise `cli`. That helper is not on
 * the public barrel.
 */
function limitKey(row: Pick<CliDetectionResult, 'cli' | 'ptahCliId'>): string {
  if (row.cli === 'ptah-cli' && row.ptahCliId) return row.ptahCliId;
  return row.cli;
}

function buildRouteCandidateSource(agent: RouteAgent): RouteCandidateSource {
  return {
    rows: () => agent.list(),

    limits: async (rows) => {
      const lookup = agent.limits;
      if (!lookup) return null;
      const listed = await lookup(rows);
      if (listed === undefined) return null;
      const map = new Map<string, LaneLimitState>();
      for (const entry of listed) {
        map.set(limitKey(entry.row), entry.state.state);
      }
      return map;
    },

    // A rejection stays a rejection. Gather records "roles unavailable"
    // and still offers built-in roles. Swallowing it as [] would hide that.
    roles: () => agent.listRoles(),
  };
}

export function buildRouteNamespace(
  deps: RouteNamespaceDependencies,
): RouteNamespace {
  return {
    decide: async (args) => {
      const service = resolveRouteDecideService(deps.container);
      if (!service) throw new RoutingUnavailableError();
      return service.decide(args, buildRouteCandidateSource(deps.agent));
    },
  };
}
