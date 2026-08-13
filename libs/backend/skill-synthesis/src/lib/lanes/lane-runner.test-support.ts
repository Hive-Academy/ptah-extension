/**
 * Test-only builders shared by the four `LaneRunner` specs.
 *
 * NOT production code and NOT a Jest test file — `*.test-support.ts` is
 * excluded from `tsconfig.lib.json`, included by `tsconfig.spec.json`, and does
 * not match Jest's `*.(spec|test).ts` pattern. Same rationale as
 * `queue/skill-drain.test-support.ts`.
 *
 * THE FAKE `IInternalQuery` HONOURS ABORT ON PURPOSE. A fake that ignores its
 * `abortController` would make the timeout spec pass against a runner that
 * never armed a timer, which is the single assertion that spec exists for. The
 * `neverYields` stream below settles ONLY when the controller aborts, exactly
 * as a real SDK conversation does.
 */
import type { Logger } from '@ptah-extension/vscode-core';
import type { IInternalQuery } from '../internal-query.interface';
import type { SkillBudgetStore } from '../queue/skill-budget.store';
import type { SkillQueueStore } from '../queue/skill-queue.store';
import type { LaneResolverService } from './lane-resolver.service';
import type {
  ResolvedSkillLane,
  SkillLaneConfig,
  SkillLaneId,
  SkillLaneResolution,
} from './lane.types';
import { SKILL_LANE_DEFAULTS } from './skill-lane-config';

/** The exact config object `IInternalQuery.execute` was handed. */
export type ExecuteCall = Parameters<IInternalQuery['execute']>[0];

export type StreamMessage = {
  type: string;
  subtype?: string;
  message?: { content?: Array<{ type: string; text?: string }> };
  structured_output?: unknown;
  result?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  total_cost_usd?: number;
};

export function makeLogger(): Logger & {
  warn: jest.Mock;
  debug: jest.Mock;
  info: jest.Mock;
  error: jest.Mock;
} {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger & {
    warn: jest.Mock;
    debug: jest.Mock;
    info: jest.Mock;
    error: jest.Mock;
  };
}

export function makeBudgetStub(): {
  store: SkillBudgetStore;
  record: jest.Mock;
} {
  const record = jest.fn();
  return {
    record,
    store: {
      record,
      spentToday: jest.fn(() => 0),
    } as unknown as SkillBudgetStore,
  };
}

/**
 * A `SkillQueueStore` with only `requeue` on it. Returns `true` by default —
 * "the row was still claimed" — because that is what every caller that supplies
 * a `queueItemId` has just done.
 */
export function makeQueueStub(applied = true): {
  store: SkillQueueStore;
  requeue: jest.Mock;
} {
  const requeue = jest.fn(() => applied);
  return { requeue, store: { requeue } as unknown as SkillQueueStore };
}

/** A resolver that always hands back the same lane. */
export function makeResolverStub(lane: ResolvedSkillLane): {
  service: LaneResolverService;
  resolve: jest.Mock;
} {
  const resolve = jest.fn(
    async (): Promise<SkillLaneResolution> => ({ ok: true, lane }),
  );
  return {
    resolve,
    service: { resolve } as unknown as LaneResolverService,
  };
}

/** A resolver that stalls the lane, as `auth-unresolvable` does. */
export function makeFailingResolverStub(resolution: SkillLaneResolution): {
  service: LaneResolverService;
  resolve: jest.Mock;
} {
  const resolve = jest.fn(async () => resolution);
  return { resolve, service: { resolve } as unknown as LaneResolverService };
}

/**
 * A resolver that throws outright — the shape a genuine defect has, as opposed
 * to the `ProviderAuthError` the resolver converts into a stall itself.
 */
export function makeThrowingResolverStub(error: Error): LaneResolverService {
  return {
    resolve: jest.fn(async () => {
      throw error;
    }),
  } as unknown as LaneResolverService;
}

export function laneConfig(
  id: SkillLaneId,
  overrides: Partial<SkillLaneConfig> = {},
): SkillLaneConfig {
  return { ...SKILL_LANE_DEFAULTS[id], ...overrides, id };
}

export function resolvedLane(
  id: SkillLaneId,
  opts: {
    config?: Partial<SkillLaneConfig>;
    auth?: ResolvedSkillLane['auth'];
    model?: string;
  } = {},
): ResolvedSkillLane {
  return {
    config: laneConfig(id, opts.config),
    auth: opts.auth,
    model: opts.model ?? 'a-tier-alias',
  };
}

/** An `IInternalQuery` that replays a scripted message list per call. */
export function makeQueryStub(scripts: StreamMessage[][]): {
  query: IInternalQuery;
  execute: jest.Mock;
  calls: ExecuteCall[];
  closed: number;
  aborted: number;
} {
  const state = { closed: 0, aborted: 0 };
  const calls: ExecuteCall[] = [];
  const execute = jest.fn(async (config: ExecuteCall) => {
    calls.push(config);
    const script = scripts[calls.length - 1] ?? [];
    return {
      stream: (async function* () {
        for (const msg of script) yield msg;
      })(),
      abort: () => {
        state.aborted++;
      },
      close: () => {
        state.closed++;
      },
    };
  });
  return {
    execute,
    calls,
    query: { execute } as unknown as IInternalQuery,
    get closed() {
      return state.closed;
    },
    get aborted() {
      return state.aborted;
    },
  };
}

/**
 * An `IInternalQuery` whose stream yields nothing until its `abortController`
 * fires — the shape a hung endpoint has, and the only shape that proves the
 * runner's own timer is what ended the call.
 */
export function makeHangingQueryStub(): {
  query: IInternalQuery;
  execute: jest.Mock;
  calls: ExecuteCall[];
  readonly closed: number;
  readonly aborted: number;
} {
  const state = { closed: 0, aborted: 0 };
  const calls: ExecuteCall[] = [];
  const execute = jest.fn(async (config: ExecuteCall) => {
    calls.push(config);
    const controller = config.abortController;
    return {
      stream: {
        [Symbol.asyncIterator]() {
          return {
            next: () =>
              new Promise<IteratorResult<StreamMessage>>((_resolve, reject) => {
                controller?.signal.addEventListener(
                  'abort',
                  () => reject(new Error('aborted')),
                  { once: true },
                );
              }),
          };
        },
      } as AsyncIterable<StreamMessage>,
      abort: () => {
        state.aborted++;
        controller?.abort();
      },
      close: () => {
        state.closed++;
      },
    };
  });
  return {
    execute,
    calls,
    query: { execute } as unknown as IInternalQuery,
    get closed() {
      return state.closed;
    },
    get aborted() {
      return state.aborted;
    },
  };
}

/**
 * Drain the microtask queue so a pending `await` chain reaches its next
 * `setTimeout`. Needed under fake timers: `advanceTimersByTime*` only fires
 * timers that are ALREADY armed, and the runner arms its timeout two `await`s
 * into `run()`. Advancing too early leaves the run hanging forever, which shows
 * up as a Jest timeout rather than as the assertion failing.
 */
export async function flushMicrotasks(ticks = 10): Promise<void> {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
}

/** The `result` message shape, with only the fields a case cares about. */
export function resultMessage(
  fields: Partial<StreamMessage> = {},
): StreamMessage {
  return { type: 'result', ...fields };
}

export function assistantText(text: string): StreamMessage {
  return { type: 'assistant', message: { content: [{ type: 'text', text }] } };
}
