/**
 * TASK_2026_704: the recurring `agent:getLanePlanLimits` RPC timeout.
 *
 * The backend's own lane-lookup budget for a cold Codex or Antigravity read is
 * `SLOW_LIMIT_LOOKUP_DEADLINE_MS` (12 s, shared plan-limits
 * evidence-precedence), and the lookup waits for the slowest lane
 * (`LaneLimitLookupService.lookup`, Promise.all over per-lane races). The
 * renderer's RPC deadline for this method is `LANE_PLAN_LIMITS_TIMEOUT_MS`
 * (10 s, ptah-ui-lane-limits.source.ts). A backend-budget-legal cold read
 * therefore replies AFTER the caller gave up: the renderer logs
 * "[ClaudeRpcService] RPC timeout", drops a successful reply, and `$limits`
 * shows "unavailable" at every cold start. Raising the renderer deadline (the
 * other branch's 15 s) does not close the gap: cold `agent.list()` detection
 * runs before the lookup and is not deadline-bounded at all.
 *
 * This spec reproduces the late reply with fake timers and pins the repair:
 * the handler must keep the whole read — the cold `agent.list()` detection
 * included — inside ONE budget that fits the caller's deadline, and hand the
 * lookup only the time the list left. A lane that misses the deadline comes
 * back as a 'timeout' row (partial result), a list that misses it comes back
 * as the fixed "unavailable" error, and neither case leaves a reply nobody is
 * waiting for.
 */

// The vscode-lm-tools barrel reaches the workspace-intelligence tree-sitter
// loader, whose `wasm-bundle-dir` reads `import.meta.url` (unparseable under
// CommonJS ts-jest). Same stub as the handler contract spec.
jest.mock('../../../../workspace-intelligence/src/ast/wasm-bundle-dir', () => ({
  BUNDLE_DIR: '',
  resolveWasmPath: (filename: string) => filename,
}));

import 'reflect-metadata';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { ALLOWED_METHOD_PREFIXES } from '@ptah-extension/vscode-core';
import {
  classifyLaneState,
  FRESHNESS_MS,
  NEAR_LIMIT_PERCENT,
  SLOW_LIMIT_LOOKUP_DEADLINE_MS,
  type AgentGetLanePlanLimitsResult,
  type CliDetectionResult,
} from '@ptah-extension/shared';
import {
  formatPlanLimitRows,
  type AgentLimit,
  type PtahAPI,
  type PtahAPIBuilder,
} from '@ptah-extension/vscode-lm-tools';
import { LanePlanLimitsRpcHandlers } from './lane-plan-limits-rpc.handlers';

const METHOD = 'agent:getLanePlanLimits';
const NOW = Date.UTC(2026, 9, 3, 12, 0);

/**
 * The renderer's RPC deadline for this method:
 * `LANE_PLAN_LIMITS_TIMEOUT_MS` in
 * libs/frontend/chat-ui/src/lib/organisms/ptah-ui/sources/ptah-ui-lane-limits.source.ts.
 * Hardcoded here because the frontend Angular lib is not importable from a
 * backend Jest run; keep both in sync when either changes.
 */
const RENDERER_RPC_DEADLINE_MS = 10_000;

/**
 * The handler's whole-read budget: `LANE_PLAN_LIMITS_RPC_BUDGET_MS` in
 * lane-plan-limits-rpc.handlers.ts. Hardcoded here for the same reason —
 * the constant is module-private — and kept in sync the same way.
 */
const HANDLER_BUDGET_MS = 8_000;

/**
 * The handler's fixed caller-facing error text for an unavailable read
 * (`UNAVAILABLE` in lane-plan-limits-rpc.handlers.ts). A list that misses
 * the budget must answer with this text, not with a hang.
 */
const UNAVAILABLE = 'Lane plan limits are unavailable on this host';

// --- fixtures -----------------------------------------------------------------

function cliRow(cli: CliDetectionResult['cli']): CliDetectionResult {
  return { cli, installed: true, messagingMode: 'steer' } as CliDetectionResult;
}

const ROWS: CliDetectionResult[] = [cliRow('codex'), cliRow('copilot')];

/** A lane the real `LaneLimitLookupService` returns when a read misses its deadline. */
function timedOutLane(row: CliDetectionResult, now: number): AgentLimit {
  return {
    row,
    lookup: 'timeout',
    state: classifyLaneState(undefined, {
      now,
      nearLimitPercent: NEAR_LIMIT_PERCENT,
      freshnessMs: FRESHNESS_MS,
      lookupFailure: 'timed-out',
    }),
  };
}

// --- doubles ------------------------------------------------------------------

type Registered = (params: unknown) => Promise<AgentGetLanePlanLimitsResult>;

function createLogger(): Logger & { debug: jest.Mock } {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger & { debug: jest.Mock };
}

/** A `PtahAPI` whose `agent.limits` emulates `LaneLimitLookupService.lookup`. */
function apiWithColdCodexLane(): {
  api: PtahAPI;
  limits: jest.Mock;
} {
  const limits = makeDeadlineHonoringLimits();
  const api = {
    agent: {
      list: async () => ROWS,
      limits,
    },
  } as unknown as PtahAPI;
  return { api, limits };
}

/**
 * A `PtahAPI` whose `agent.list()` emulates the cold-start step the code
 * review found unbounded: CLI detection plus registry listing that consumes
 * `listMs` before the first row exists. The lookup is the same fake as
 * `apiWithColdCodexLane`'s — it honors the deadline it is given.
 */
function apiWithSlowList(listMs: number): { api: PtahAPI; limits: jest.Mock } {
  const limits = makeDeadlineHonoringLimits();
  const api = {
    agent: {
      list: (): Promise<readonly CliDetectionResult[]> =>
        new Promise((resolve) => {
          setTimeout(() => resolve(ROWS), listMs);
        }),
      limits,
    },
  } as unknown as PtahAPI;
  return { api, limits };
}

/**
 * A `PtahAPI` whose `agent.list()` never settles: a detection that hangs has
 * no backend timeout of its own, so the handler's budget is the only thing
 * that can end the read.
 */
function apiWithHungList(): { api: PtahAPI; limits: jest.Mock } {
  const limits = makeDeadlineHonoringLimits();
  const api = {
    agent: {
      list: (): Promise<readonly CliDetectionResult[]> =>
        new Promise(() => {}),
      limits,
    },
  } as unknown as PtahAPI;
  return { api, limits };
}

/**
 * The shared lookup fake: it emulates `LaneLimitLookupService.lookup`, which
 * races every lane against the deadline it is given and never rejects. With
 * no deadline a cold Codex lane holds the whole lookup for its own
 * `SLOW_LIMIT_LOOKUP_DEADLINE_MS`; with one, a lane that misses comes back
 * as a 'timeout' row at that deadline.
 */
function makeDeadlineHonoringLimits(): jest.Mock {
  return jest.fn(
    async (
      rows: readonly CliDetectionResult[],
      options?: { deadlineMs?: number },
    ): Promise<readonly AgentLimit[] | undefined> => {
      const deadline = options?.deadlineMs ?? SLOW_LIMIT_LOOKUP_DEADLINE_MS;
      await new Promise((resolve) => setTimeout(resolve, deadline));
      const now = Date.now();
      return rows.map((row) => timedOutLane(row, now));
    },
  );
}

function registerHandler(
  api: PtahAPI,
  logger: Logger = createLogger(),
): Registered {
  const registered = new Map<string, Registered>();
  const rpcHandler = {
    registerMethod: (method: string, handler: Registered) => {
      const prefix = method.slice(0, method.indexOf(':') + 1);
      if (!(ALLOWED_METHOD_PREFIXES as readonly string[]).includes(prefix)) {
        throw new Error(`Method prefix not allowed: ${prefix}`);
      }
      registered.set(method, handler);
    },
  } as unknown as RpcHandler;
  const builder = { build: () => api } as unknown as PtahAPIBuilder;
  new LanePlanLimitsRpcHandlers(
    logger,
    rpcHandler,
    builder,
  ).register();
  const handler = registered.get(METHOD);
  if (!handler) throw new Error(`${METHOD} was not registered`);
  return handler;
}

// --- the defect and the repair -------------------------------------------------

describe(`${METHOD} against the renderer's RPC deadline`, () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    // No timer leaks: by the time a read settles, every timer the handler and
    // its stubs scheduled must have fired or been cleared. A leaked budget
    // timer would keep a real host's event loop busy after the reply.
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

  it('bounds the lane lookup inside the renderer deadline, so the reply lands before the caller gives up', async () => {
    const { api, limits } = apiWithColdCodexLane();
    const handler = registerHandler(api);

    let settled: AgentGetLanePlanLimitsResult | undefined;
    let failure: unknown;
    handler({}).then(
      (result) => {
        settled = result;
      },
      (error) => {
        failure = error;
      },
    );

    // Advance past the renderer deadline. Without a handler-side deadline the
    // cold Codex lane (SLOW_LIMIT_LOOKUP_DEADLINE_MS = 12 s) is still pending
    // here — the exact window in which the renderer logs the timeout.
    await jest.advanceTimersByTimeAsync(RENDERER_RPC_DEADLINE_MS);

    expect(failure).toBeUndefined();
    expect(settled).toBeDefined();
    expect(limits).toHaveBeenCalledTimes(1);
    // The late lanes are still rows: partial results, not an error.
    expect(settled?.rows).toHaveLength(ROWS.length);
    expect(settled?.unknown).toBe(ROWS.length);
    expect(settled?.asOf).toBeGreaterThan(0);
  });

  it('passes a deadline no larger than the renderer budget to the limits lookup', async () => {
    const { api, limits } = apiWithColdCodexLane();
    const handler = registerHandler(api);

    let failure: unknown;
    handler({}).catch((error: unknown) => {
      failure = error;
    });
    await jest.advanceTimersByTimeAsync(RENDERER_RPC_DEADLINE_MS);

    expect(failure).toBeUndefined();
    expect(limits).toHaveBeenCalledWith(
      ROWS,
      expect.objectContaining({ deadlineMs: expect.any(Number) }),
    );
    const options = limits.mock.calls[0]?.[1] as
      | { deadlineMs?: number }
      | undefined;
    expect(options?.deadlineMs).toBeLessThanOrEqual(RENDERER_RPC_DEADLINE_MS);
  });

  it('gives the lookup only the budget a slow cold list leaves, so the reply still lands inside the renderer deadline', async () => {
    // Six of the handler's eight seconds go to cold detection and registry
    // listing. The lookup must run inside the two that remain — the review's
    // failure mode was a lookup that always got a fresh 8 s AFTER a slow
    // list and answered past 10 s.
    const LIST_MS = 6_000;
    const { api, limits } = apiWithSlowList(LIST_MS);
    const handler = registerHandler(api);

    let settled: AgentGetLanePlanLimitsResult | undefined;
    let failure: unknown;
    handler({}).then(
      (result) => {
        settled = result;
      },
      (error) => {
        failure = error;
      },
    );

    // Advance only the handler budget: the reply must already be here at 8 s,
    // before the renderer's 10 s timer logs the timeout.
    await jest.advanceTimersByTimeAsync(HANDLER_BUDGET_MS);

    expect(failure).toBeUndefined();
    expect(settled).toBeDefined();
    expect(limits).toHaveBeenCalledTimes(1);
    const options = limits.mock.calls[0]?.[1] as
      | { deadlineMs?: number }
      | undefined;
    expect(options?.deadlineMs).toBeLessThanOrEqual(HANDLER_BUDGET_MS - LIST_MS);
    // The lanes that missed the shrunken deadline are still rows: partial
    // results, not an error and not a late reply.
    expect(settled?.rows).toHaveLength(ROWS.length);
    expect(settled?.unknown).toBe(ROWS.length);
  });

  it('answers with the fixed unavailable text, inside the renderer deadline, when the lane list never settles', async () => {
    const { api, limits } = apiWithHungList();
    const handler = registerHandler(api);

    let settled: AgentGetLanePlanLimitsResult | undefined;
    let failure: unknown;
    handler({}).then(
      (result) => {
        settled = result;
      },
      (error) => {
        failure = error;
      },
    );

    // A hung detection has no backend timeout of its own; the handler budget
    // is the only thing that can end this read.
    await jest.advanceTimersByTimeAsync(HANDLER_BUDGET_MS);

    expect(settled).toBeUndefined();
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(UNAVAILABLE);
    expect(limits).not.toHaveBeenCalled();
  });

  it('logs a late list rejection by error name, so the swallowed failure stays observable', async () => {
    // The list misses the budget, the read answers with the fixed text, and
    // the losing step rejects after the race was decided: the side-branch
    // catch is the only observer of what that step died of.
    const logger = createLogger();
    const limits = makeDeadlineHonoringLimits();
    const api = {
      agent: {
        list: (): Promise<readonly CliDetectionResult[]> =>
          new Promise((_, reject) => {
            setTimeout(
              () => reject(new Error('late list failure')),
              HANDLER_BUDGET_MS + 1_000,
            );
          }),
        limits,
      },
    } as unknown as PtahAPI;
    const handler = registerHandler(api, logger);

    let failure: unknown;
    handler({}).catch((error: unknown) => {
      failure = error;
    });
    await jest.advanceTimersByTimeAsync(HANDLER_BUDGET_MS + 1_000);

    // The read itself answered with the fixed unavailable text at the budget.
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(UNAVAILABLE);
    expect(limits).not.toHaveBeenCalled();
    // The late rejection was logged once — debug, error name only — never
    // leaked by message and never left as an unhandled rejection.
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(logger.debug).toHaveBeenCalledWith(
      `[lanePlanLimits] ${METHOD} lane list step rejected`,
      { errorName: 'Error' },
    );
  });
});

// The formatter must render a timed-out lane row for the partial result; this
// keeps the spec honest that `buildResult` can format what the bounded lookup
// returns (the handler would otherwise answer with a fixed-text error).
describe('formatPlanLimitRows on a timed-out lane', () => {
  it('renders one row per lane with five string cells', () => {
    const rows = formatPlanLimitRows(
      ROWS.map((row) => timedOutLane(row, NOW)),
      NOW,
    );
    expect(rows).toHaveLength(ROWS.length);
    for (const cells of rows) {
      // Six cells: 0-4 forwarded by the handler plus the Source cell it drops.
      expect(cells).toHaveLength(6);
      for (const cell of cells) expect(typeof cell).toBe('string');
    }
  });
});