/**
 * Test-only builders shared by the four drain specs.
 *
 * NOT production code and NOT a Jest test file — `*.test-support.ts` is
 * excluded from `tsconfig.lib.json`, included by `tsconfig.spec.json`, and does
 * not match Jest's `*.(spec|test).ts` pattern. Same rationale as
 * `queue-db.test-support.ts`: four specs need the same stubs, and four copies
 * would drift.
 *
 * The gate specs use the fully stubbed store (a gate must be provable by
 * "`tryClaim` was never called"); the fairness and idempotency specs use the
 * REAL stores over a real SQLite file, because round-robin ordering and the CAS
 * claim are properties of the SQL, not of a mock.
 */
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import { SkillDrainService } from './skill-drain.service';
import type { SkillQueueStore } from './skill-queue.store';
import type { SkillBudgetStore } from './skill-budget.store';
import { ForegroundActivityTracker } from './foreground-activity.tracker';

/** Every settings key the drain reads, with the value it should read. */
export type DrainSettings = Record<string, unknown>;

/** An `IWorkspaceProvider` whose `getConfiguration` serves a plain map. */
export function makeWorkspace(settings: DrainSettings): IWorkspaceProvider {
  return {
    getConfiguration: <T>(_section: string, key: string, fallback?: T) =>
      key in settings ? (settings[key] as T) : (fallback as T),
  } as unknown as IWorkspaceProvider;
}

export interface QueueStub {
  store: SkillQueueStore;
  reapStale: jest.Mock;
  listEligibleWorkspaces: jest.Mock;
  listEligible: jest.Mock;
  markWorkspaceDrained: jest.Mock;
  tryClaim: jest.Mock;
  touchClaim: jest.Mock;
  markDone: jest.Mock;
  markFailed: jest.Mock;
  markUnscored: jest.Mock;
  markSkipped: jest.Mock;
}

export function makeQueueStub(): QueueStub {
  const parts = {
    reapStale: jest.fn(() => 0),
    listEligibleWorkspaces: jest.fn(() => [] as string[]),
    listEligible: jest.fn(() => []),
    markWorkspaceDrained: jest.fn(),
    tryClaim: jest.fn(() => null),
    touchClaim: jest.fn(() => true),
    markDone: jest.fn(),
    markFailed: jest.fn(),
    markUnscored: jest.fn(),
    markSkipped: jest.fn(),
  };
  return { ...parts, store: parts as unknown as SkillQueueStore };
}

export function makeBudgetStub(spentToday = 0): {
  store: SkillBudgetStore;
  spentToday: jest.Mock;
} {
  const spent = jest.fn(() => spentToday);
  return {
    spentToday: spent,
    store: { spentToday: spent } as unknown as SkillBudgetStore,
  };
}

/**
 * A tracker reporting a fixed age. `Number.POSITIVE_INFINITY` (the default) is
 * "no foreground activity ever", which is what a fresh process reports.
 */
export function makeTracker(
  msSinceLastActivity = Number.POSITIVE_INFINITY,
): ForegroundActivityTracker {
  return {
    start: jest.fn(),
    stop: jest.fn(),
    msSinceLastActivity: jest.fn(() => msSinceLastActivity),
  } as unknown as ForegroundActivityTracker;
}

export function makeLogger(): Logger & {
  warn: jest.Mock;
  error: jest.Mock;
  debug: jest.Mock;
  info: jest.Mock;
} {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger & {
    warn: jest.Mock;
    error: jest.Mock;
    debug: jest.Mock;
    info: jest.Mock;
  };
}

export function makeDrain(opts: {
  logger?: Logger;
  queue: SkillQueueStore;
  budget: SkillBudgetStore;
  foreground?: ForegroundActivityTracker;
  settings?: DrainSettings;
}): SkillDrainService {
  return new SkillDrainService(
    opts.logger ?? makeLogger(),
    opts.queue,
    opts.budget,
    opts.foreground ?? makeTracker(),
    makeWorkspace(opts.settings ?? {}),
  );
}

/** A signal that is never aborted — the normal cron case. */
export function liveSignal(): AbortSignal {
  return new AbortController().signal;
}
