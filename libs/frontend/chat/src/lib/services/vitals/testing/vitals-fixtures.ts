import { signal, type WritableSignal } from '@angular/core';
import type {
  PlanLimitOwnerSnapshot,
  PlanLimitSessionOwner,
  PlanLimitsSnapshot,
  UsageFact,
  UsageSummary,
} from '@ptah-extension/shared';
import type { VitalsLoad } from '../vitals-load';

/** Spec-only builders shared by the vitals view-model store specs. */

export function fact(
  day: string,
  overrides: Partial<UsageFact> = {},
): UsageFact {
  return {
    day,
    providerId: 'anthropic',
    modelId: 'claude',
    inputUncachedTokens: 10,
    cacheReadTokens: 20,
    cacheWriteTokens: 30,
    outputTokens: 40,
    costUsd: 1.5,
    cacheSavingsUsd: null,
    costSource: 'model-priced',
    requestCount: 2,
    sourceId: 'claude-code',
    ...overrides,
  };
}

export function summary(
  facts: UsageFact[],
  overrides: Partial<UsageSummary> = {},
): UsageSummary {
  return {
    version: 1,
    generatedAt: '2026-10-26T12:00:00.000Z',
    timeZone: 'UTC',
    fromDay: '2026-07-29',
    untilDayExclusive: '2026-10-28',
    facts,
    sources: [],
    pricing: { source: 'bundled', asOf: null },
    ...overrides,
  };
}

export function owner(key: string, percent: number): PlanLimitOwnerSnapshot {
  return {
    owner: {
      key,
      providerId: 'anthropic',
      identityKind: 'account',
      label: 'Claude account',
    },
    status: 'available',
    windowSetEstablished: true,
    windows: [
      {
        key: 'five_hour',
        kind: 'five_hour',
        label: '5-hour',
        observedAt: 0,
        used: { kind: 'percent', percent },
      },
    ],
    ownerEvidence: [],
  };
}

export function planSnapshot(
  owners: PlanLimitOwnerSnapshot[],
  sessionOwners: PlanLimitsSnapshot['sessionOwners'] = {},
): PlanLimitsSnapshot {
  return { generatedAt: 1, owners, sessionOwners };
}

/** A `PlanLimitsStore` stand-in: the signals the stores read plus `load`. */
export interface FakePlanLimits {
  readonly snapshot: WritableSignal<PlanLimitsSnapshot | null>;
  readonly now: WritableSignal<number>;
  readonly loadError: WritableSignal<boolean>;
  readonly loading: WritableSignal<boolean>;
  readonly load: jest.Mock;
  sessionOwner(sessionId: string): PlanLimitSessionOwner | null;
}

export function fakePlanLimits(): FakePlanLimits {
  const snapshot = signal<PlanLimitsSnapshot | null>(null);
  return {
    snapshot,
    now: signal(Date.now()),
    loadError: signal(false),
    loading: signal(false),
    load: jest.fn(async () => undefined),
    sessionOwner: (sessionId) => snapshot()?.sessionOwners[sessionId] ?? null,
  };
}

/** A `UsageVitalsCache` stand-in with one writable signal per `scope|range`. */
export interface FakeUsageCache {
  readonly summary: jest.Mock;
  entry(
    scope: string | null,
    range: 7 | 90,
  ): WritableSignal<VitalsLoad<UsageSummary>>;
}

export function fakeUsageCache(): FakeUsageCache {
  const entries = new Map<string, WritableSignal<VitalsLoad<UsageSummary>>>();
  const entry = (scope: string | null, range: 7 | 90) => {
    const key = `${scope ?? ''}|${range}`;
    let value = entries.get(key);
    if (!value) {
      value = signal<VitalsLoad<UsageSummary>>({ status: 'loading' });
      entries.set(key, value);
    }
    return value;
  };
  return {
    summary: jest.fn((scope: string | null, range: 7 | 90) =>
      entry(scope, range),
    ),
    entry,
  };
}
