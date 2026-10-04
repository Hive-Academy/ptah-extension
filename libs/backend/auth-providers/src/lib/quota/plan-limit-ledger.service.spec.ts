import 'reflect-metadata';
import { resolve } from 'node:path';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { IAuthSecretsService, Logger } from '@ptah-extension/vscode-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import {
  SessionPlanLimitCallbackRegistry,
  type SessionPlanLimitSignal,
  type SessionQuotaProbe,
} from '@ptah-extension/agent-sdk';
import type {
  OwnerLimitEvidence,
  PlanLimitWindow,
  QuotaOwnerRef,
} from '@ptah-extension/shared';
import { ProviderQuotaStore } from '../auth/provider-quota.store';
import { CodexHomeResolver } from '../providers/codex/codex-home-resolver';
import {
  PLAN_LIMIT_LEDGER_STORAGE_KEY,
  PlanLimitLedgerService,
} from './plan-limit-ledger.service';
import {
  ProviderOwnerResolver,
  accountOwnerKey,
  credentialOwnerKey,
  quotaOwnerRefFromKey,
  unknownOwnerKey,
  type ClaudeAccountInfo,
} from './provider-owner.resolver';

const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// The resolver's Claude account material is `email + "\0" + organization`.
const OWNER_A = quotaOwnerRefFromKey(
  accountOwnerKey('anthropic', 'a@example.test\0org'),
);
const OWNER_B = quotaOwnerRefFromKey(
  accountOwnerKey('anthropic', 'b@example.test\0org'),
);
const ACCOUNT_A = {
  email: 'a@example.test',
  organization: 'org',
} as ClaudeAccountInfo;
const ACCOUNT_B = {
  email: 'b@example.test',
  organization: 'org',
} as ClaudeAccountInfo;

type MemoryStorage = IStateStorage & {
  readonly data: Map<string, unknown>;
  update: jest.Mock<Promise<void>, [string, unknown]>;
};

/** JSON round-trip, like the real stores. */
function memoryStorage(initial: Record<string, unknown> = {}): MemoryStorage {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    data,
    get: <T>(key: string, fallback?: T) =>
      (data.has(key) ? data.get(key) : fallback) as T | undefined,
    update: jest.fn(async (key: string, value: unknown) => {
      data.set(key, JSON.parse(JSON.stringify(value)));
    }),
    keys: () => [...data.keys()],
  };
}

function harness(options: { storage?: MemoryStorage; at?: number } = {}) {
  const logger = createMockLogger();
  const clock = { now: options.at ?? T0 };
  const storage = options.storage ?? memoryStorage();
  const registry = new SessionPlanLimitCallbackRegistry(
    logger as unknown as Logger,
  );
  const quotaStore = new ProviderQuotaStore();
  const account = { current: ACCOUNT_A };
  const probe = {
    readAccount: jest.fn(async () => account.current),
    readPlanUsage: jest.fn(async () => null),
    sessionRoute: jest.fn(() => ({
      providerId: 'anthropic',
      routeKind: 'native' as const,
    })),
  } satisfies SessionQuotaProbe;
  const resolver = new ProviderOwnerResolver(
    logger as unknown as Logger,
    { getProviderKey: jest.fn() } as unknown as IAuthSecretsService,
    probe,
    { currentOwnerKey: () => null },
    new CodexHomeResolver(resolve('synthetic-codex-home')),
  );
  const ledger = new PlanLimitLedgerService(
    logger as unknown as Logger,
    storage,
    registry,
    resolver,
    quotaStore,
    () => clock.now,
  );
  const signal = (sessionId: string, value: SessionPlanLimitSignal) =>
    registry.notifyAll({ sessionId, signal: value });
  return {
    ledger,
    logger,
    clock,
    storage,
    registry,
    quotaStore,
    probe,
    account,
    signal,
  };
}

function fixtureKind(key: PlanLimitWindow['key']): PlanLimitWindow['kind'] {
  if (key.startsWith('weekly_model:')) return 'weekly_model';
  if (key.startsWith('other:')) return 'other';
  return key as PlanLimitWindow['kind'];
}

/** Lets the per-session signal chain (microtasks) run to completion. */
const settle = () => new Promise<void>((done) => setImmediate(done));

function exhaustedWindow(
  key: PlanLimitWindow['key'],
  observedAt: number,
  extra: { resetsAt?: number; modelScope?: string } = {},
): PlanLimitWindow {
  const scope =
    extra.modelScope !== undefined ? { modelScope: extra.modelScope } : {};
  const reset =
    extra.resetsAt !== undefined
      ? { resetsAt: extra.resetsAt, resetSource: 'stream-event' as const }
      : {};
  return {
    key,
    kind: fixtureKind(key),
    label: key,
    ...scope,
    ...reset,
    exhaustion: { observedAt, source: 'stream-event', ...reset, ...scope },
    observedAt,
  };
}

function readWindow(
  key: PlanLimitWindow['key'],
  observedAt: number,
  percent: number,
  extra: Partial<PlanLimitWindow> = {},
): PlanLimitWindow {
  return {
    key,
    kind: fixtureKind(key),
    label: key,
    used: { kind: 'percent', percent },
    usedSource: 'provider-api',
    usedObservedAt: observedAt,
    observedAt,
    ...extra,
  };
}

function windowOf(
  ledger: PlanLimitLedgerService,
  owner: QuotaOwnerRef,
  key: string,
) {
  return ledger.snapshotFor(owner.key)?.windows.find((w) => w.key === key);
}

const unknownEvidence = (
  observedAt: number,
  modelScope?: string,
): OwnerLimitEvidence => ({
  observedAt,
  source: 'error-derived',
  ...(modelScope !== undefined && { modelScope }),
});

describe('PlanLimitLedgerService — window and owner evidence', () => {
  it('F17: window known, reset known — exhausted until the reset, then gone', () => {
    const { ledger, clock } = harness();
    ledger.recordWindowEvidence(
      OWNER_A,
      exhaustedWindow('five_hour', T0, { resetsAt: T0 + 2 * HOUR }),
    );

    expect(windowOf(ledger, OWNER_A, 'five_hour')?.exhaustion?.resetsAt).toBe(
      T0 + 2 * HOUR,
    );
    clock.now = T0 + 2 * HOUR;
    expect(ledger.snapshotFor(OWNER_A.key)).toBeUndefined();
  });

  it('F18: window known, reset unknown — stays active with no timer until a clearing rule', () => {
    const { ledger, clock } = harness();
    ledger.recordWindowEvidence(OWNER_A, exhaustedWindow('weekly', T0));

    clock.now = T0 + 6 * DAY;
    expect(windowOf(ledger, OWNER_A, 'weekly')?.exhaustion).toEqual(
      expect.objectContaining({ observedAt: T0, source: 'stream-event' }),
    );
    expect(
      windowOf(ledger, OWNER_A, 'weekly')?.exhaustion?.resetsAt,
    ).toBeUndefined();
  });

  it('F19: window unknown, reset known — owner evidence expires at its reset', () => {
    const { ledger, clock } = harness();
    ledger.recordOwnerEvidence(OWNER_A, {
      observedAt: T0,
      source: 'error-derived',
      resetsAt: T0 + 5 * HOUR,
      resetSource: 'error-derived',
    });

    expect(ledger.snapshotFor(OWNER_A.key)?.ownerEvidence).toHaveLength(1);
    clock.now = T0 + 5 * HOUR;
    expect(ledger.snapshotFor(OWNER_A.key)).toBeUndefined();
  });

  it('F20: window unknown, reset unknown — held until a plan success clears it', () => {
    const { ledger, clock } = harness();
    ledger.recordOwnerEvidence(OWNER_A, unknownEvidence(T0));
    clock.now = T0 + 3 * DAY;
    expect(ledger.snapshotFor(OWNER_A.key)?.ownerEvidence).toHaveLength(1);

    ledger.recordSuccess({
      ownerKey: OWNER_A.key,
      modelScopes: ['sonnet'],
      billing: 'plan',
      observedAt: clock.now,
    });
    expect(ledger.snapshotFor(OWNER_A.key)).toBeUndefined();
  });

  it('keeps one owner-evidence entry per model scope; newer replaces older', () => {
    const { ledger } = harness();
    ledger.recordOwnerEvidence(OWNER_A, unknownEvidence(T0));
    ledger.recordOwnerEvidence(OWNER_A, unknownEvidence(T0 + 1));
    ledger.recordOwnerEvidence(OWNER_A, unknownEvidence(T0 - 1));
    ledger.recordOwnerEvidence(OWNER_A, unknownEvidence(T0, 'Opus'));

    const evidence = ledger.snapshotFor(OWNER_A.key)?.ownerEvidence ?? [];
    expect(evidence).toHaveLength(2);
    expect(evidence.map((e) => e.observedAt).sort()).toEqual([T0, T0 + 1]);
  });
});

describe('PlanLimitLedgerService — precedence (F21, ledger side)', () => {
  it('rule 1: estimated never supersedes real evidence observed after the last reset', () => {
    const { ledger } = harness();
    ledger.recordWindowEvidence(
      OWNER_A,
      readWindow('weekly', T0, 40, { lastResetAt: T0 - HOUR }),
    );
    ledger.recordWindowEvidence(
      OWNER_A,
      readWindow('weekly', T0 + MINUTE, 90, {
        usedSource: 'estimated',
        lastResetAt: T0 - HOUR,
      }),
    );

    expect(windowOf(ledger, OWNER_A, 'weekly')?.used).toEqual({
      kind: 'percent',
      percent: 40,
    });
  });

  it('rule 2: stale data never clears a live exhaustion at least as new', () => {
    const { ledger } = harness();
    ledger.recordWindowEvidence(OWNER_A, exhaustedWindow('five_hour', T0 + 10));
    ledger.recordWindowEvidence(OWNER_A, readWindow('five_hour', T0 + 5, 20), {
      stale: true,
    });

    expect(windowOf(ledger, OWNER_A, 'five_hour')?.exhaustion?.observedAt).toBe(
      T0 + 10,
    );
    expect(windowOf(ledger, OWNER_A, 'five_hour')?.used).toBeUndefined();
  });

  it('rule 3: newer evidence wins; an older reading arriving later is ignored', () => {
    const { ledger } = harness();
    ledger.recordWindowEvidence(
      OWNER_A,
      readWindow('five_hour', T0 + 2 * MINUTE, 30),
    );
    ledger.recordWindowEvidence(
      OWNER_A,
      readWindow('five_hour', T0 + MINUTE, 80),
    );
    expect(windowOf(ledger, OWNER_A, 'five_hour')?.used).toEqual({
      kind: 'percent',
      percent: 30,
    });

    ledger.recordWindowEvidence(
      OWNER_A,
      readWindow('five_hour', T0 + 3 * MINUTE, 50),
    );
    expect(windowOf(ledger, OWNER_A, 'five_hour')?.used).toEqual({
      kind: 'percent',
      percent: 50,
    });
  });

  it('a stale reading keeps its original observation time, so it cannot pose as new', () => {
    const { ledger, clock } = harness();
    ledger.recordWindowEvidence(OWNER_A, readWindow('weekly', T0 + HOUR, 10));
    clock.now = T0 + 2 * HOUR;
    // Re-served from a cache at T0+2h, but observed at T0: older, so ignored.
    ledger.recordWindowEvidence(OWNER_A, readWindow('weekly', T0, 70), {
      stale: true,
    });

    expect(windowOf(ledger, OWNER_A, 'weekly')?.observedAt).toBe(T0 + HOUR);
  });
});

describe('PlanLimitLedgerService — clearing (F22, F23, F62-F66)', () => {
  function seedClaudeExhaustion(ledger: PlanLimitLedgerService, at = T0) {
    ledger.recordWindowEvidence(OWNER_A, exhaustedWindow('five_hour', at));
    ledger.recordWindowEvidence(OWNER_A, exhaustedWindow('weekly', at));
    ledger.recordWindowEvidence(
      OWNER_A,
      exhaustedWindow('weekly_model:sonnet', at, { modelScope: 'sonnet' }),
    );
    ledger.recordWindowEvidence(
      OWNER_A,
      exhaustedWindow('weekly_model:opus', at, { modelScope: 'opus' }),
    );
    ledger.recordWindowEvidence(OWNER_A, exhaustedWindow('overage', at));
  }
  const exhaustedKeys = (ledger: PlanLimitLedgerService) =>
    (ledger.snapshotFor(OWNER_A.key)?.windows ?? [])
      .filter((w) => w.exhaustion !== undefined)
      .map((w) => w.key)
      .sort();

  it('F22: Opus-only exhaustion is a separate allowance from Sonnet', () => {
    const { ledger } = harness();
    ledger.recordWindowEvidence(
      OWNER_A,
      exhaustedWindow('weekly_model:opus', T0, { modelScope: 'opus' }),
    );
    ledger.recordWindowEvidence(
      OWNER_A,
      readWindow('weekly_model:sonnet', T0 + MINUTE, 10, {
        modelScope: 'sonnet',
      }),
    );

    expect(
      windowOf(ledger, OWNER_A, 'weekly_model:opus')?.exhaustion,
    ).toBeDefined();
    expect(
      windowOf(ledger, OWNER_A, 'weekly_model:sonnet')?.exhaustion,
    ).toBeUndefined();
  });

  it('F62: a Sonnet plan success clears five_hour, weekly and Sonnet only', () => {
    const { ledger } = harness();
    seedClaudeExhaustion(ledger);
    ledger.recordSuccess({
      ownerKey: OWNER_A.key,
      modelScopes: ['sonnet'],
      billing: 'plan',
      observedAt: T0 + 1,
    });

    expect(exhaustedKeys(ledger)).toEqual(['overage', 'weekly_model:opus']);
  });

  it('a multi-family turn clears each of its families plus the shared windows', () => {
    const { ledger } = harness();
    seedClaudeExhaustion(ledger);
    ledger.recordSuccess({
      ownerKey: OWNER_A.key,
      modelScopes: ['Sonnet', 'opus'],
      billing: 'plan',
      observedAt: T0 + 1,
    });

    expect(exhaustedKeys(ledger)).toEqual(['overage']);
  });

  it.each(['overage', 'fallback', 'unknown'] as const)(
    'F23/F63/F65/F80: a %s-billed success clears no exhaustion',
    (billing) => {
      const { ledger } = harness();
      seedClaudeExhaustion(ledger);
      ledger.recordOwnerEvidence(OWNER_A, unknownEvidence(T0));
      ledger.recordSuccess({
        ownerKey: OWNER_A.key,
        modelScopes: ['sonnet'],
        billing,
        observedAt: T0 + 1,
      });

      expect(exhaustedKeys(ledger)).toEqual([
        'five_hour',
        'overage',
        'weekly',
        'weekly_model:opus',
        'weekly_model:sonnet',
      ]);
      expect(ledger.snapshotFor(OWNER_A.key)?.ownerEvidence).toHaveLength(1);
    },
  );

  it('F23: an unrelated-model plan success leaves the other scope exhausted', () => {
    const { ledger } = harness();
    ledger.recordWindowEvidence(
      OWNER_A,
      exhaustedWindow('weekly_model:opus', T0, { modelScope: 'opus' }),
    );
    ledger.recordOwnerEvidence(OWNER_A, unknownEvidence(T0, 'opus'));
    ledger.recordSuccess({
      ownerKey: OWNER_A.key,
      modelScopes: ['sonnet'],
      billing: 'plan',
      observedAt: T0 + 1,
    });

    expect(
      windowOf(ledger, OWNER_A, 'weekly_model:opus')?.exhaustion,
    ).toBeDefined();
    expect(ledger.snapshotFor(OWNER_A.key)?.ownerEvidence).toHaveLength(1);
  });

  it('F23: a plan success never clears a known reset or evidence newer than itself', () => {
    const { ledger } = harness();
    ledger.recordWindowEvidence(
      OWNER_A,
      exhaustedWindow('five_hour', T0, { resetsAt: T0 + HOUR }),
    );
    ledger.recordWindowEvidence(OWNER_A, exhaustedWindow('weekly', T0 + 10));
    ledger.recordSuccess({
      ownerKey: OWNER_A.key,
      modelScopes: [],
      billing: 'plan',
      observedAt: T0 + 5,
    });

    expect(exhaustedKeys(ledger)).toEqual(['five_hour', 'weekly']);
  });

  it('F23: a fresh same-allowance read below the limit clears unknown-reset exhaustion', () => {
    const { ledger } = harness();
    ledger.recordWindowEvidence(OWNER_A, exhaustedWindow('weekly', T0));
    ledger.recordWindowEvidence(
      OWNER_A,
      readWindow('weekly', T0 + MINUTE, 100),
    );
    expect(windowOf(ledger, OWNER_A, 'weekly')?.exhaustion).toBeDefined();

    ledger.recordWindowEvidence(
      OWNER_A,
      readWindow('weekly', T0 + 2 * MINUTE, 60),
    );
    expect(windowOf(ledger, OWNER_A, 'weekly')?.exhaustion).toBeUndefined();
    expect(windowOf(ledger, OWNER_A, 'weekly')?.used).toEqual({
      kind: 'percent',
      percent: 60,
    });
  });

  it('a newer reading without a used value keeps the held exhaustion', () => {
    const { ledger } = harness();
    ledger.recordWindowEvidence(OWNER_A, exhaustedWindow('five_hour', T0));
    ledger.recordWindowEvidence(OWNER_A, {
      key: 'five_hour',
      kind: 'five_hour',
      label: '5-hour session',
      observedAt: T0 + MINUTE,
    });

    expect(windowOf(ledger, OWNER_A, 'five_hour')?.exhaustion?.observedAt).toBe(
      T0,
    );
  });

  it('F23: once the longest window elapses the exhaustion reads as unknown usage', () => {
    const { ledger, clock } = harness();
    ledger.recordWindowEvidence(OWNER_A, exhaustedWindow('weekly', T0));
    clock.now = T0 + 7 * DAY - 1;
    expect(windowOf(ledger, OWNER_A, 'weekly')?.exhaustion).toBeDefined();

    clock.now = T0 + 7 * DAY;
    expect(windowOf(ledger, OWNER_A, 'weekly')).toBeUndefined();
    expect(ledger.snapshotFor(OWNER_A.key)).toBeUndefined();
  });

  it("a Codex owner's longest window is its largest declared duration", () => {
    const { ledger, clock } = harness();
    const codex = quotaOwnerRefFromKey(accountOwnerKey('openai-codex', 'acct'));
    ledger.recordWindowEvidence(
      codex,
      readWindow('other:window', T0, 10, { durationMins: 14 * 24 * 60 }),
    );
    ledger.recordOwnerEvidence(codex, unknownEvidence(T0));

    clock.now = T0 + 10 * DAY;
    expect(ledger.snapshotFor(codex.key)?.ownerEvidence).toHaveLength(1);
    clock.now = T0 + 14 * DAY;
    expect(ledger.snapshotFor(codex.key)).toBeUndefined();
  });

  it('F64: a success under the fallback provider owner leaves the original owner intact', () => {
    const { ledger } = harness();
    seedClaudeExhaustion(ledger);
    const fallbackOwner = quotaOwnerRefFromKey(
      credentialOwnerKey('openrouter', 'k'),
    );
    ledger.recordCooldown(fallbackOwner, { until: T0 + HOUR, observedAt: T0 });
    ledger.recordSuccess({
      ownerKey: fallbackOwner.key,
      modelScopes: ['sonnet'],
      billing: 'plan',
      observedAt: T0 + 1,
    });

    expect(exhaustedKeys(ledger)).toHaveLength(5);
  });

  it('F65 (ledger side): a plan-billed lane exit clears its scope; unknown billing does not', () => {
    const { ledger } = harness();
    const lane = quotaOwnerRefFromKey(accountOwnerKey('antigravity', 'acct'));
    ledger.recordOwnerEvidence(lane, unknownEvidence(T0, 'gemini'));
    ledger.recordSuccess({
      ownerKey: lane.key,
      modelScopes: ['gemini'],
      billing: 'unknown',
      observedAt: T0 + 1,
    });
    expect(ledger.snapshotFor(lane.key)?.ownerEvidence).toHaveLength(1);

    ledger.recordSuccess({
      ownerKey: lane.key,
      modelScopes: ['gemini'],
      billing: 'plan',
      observedAt: T0 + 2,
    });
    expect(ledger.snapshotFor(lane.key)).toBeUndefined();
  });
});

describe('PlanLimitLedgerService — proxy observers (F66-F68)', () => {
  const PROVIDER = 'opencode-go';
  const KEYED = quotaOwnerRefFromKey(credentialOwnerKey(PROVIDER, 'key-a'));

  it("F66: a 2xx with an owner clears only that owner's cooldown, never exhaustion", () => {
    const { ledger, quotaStore } = harness();
    quotaStore.recordRateLimit(PROVIDER, '120', T0, {
      ownerKey: KEYED.key,
      statusCode: 429,
      sourceId: 'p1',
    });
    ledger.recordWindowEvidence(KEYED, exhaustedWindow('weekly', T0));
    expect(ledger.snapshotFor(KEYED.key)?.cooldown).toEqual({
      until: T0 + 120_000,
      rawUntil: T0 + 120_000,
      observedAt: T0,
    });

    quotaStore.recordSuccess(
      PROVIDER,
      { ownerKey: KEYED.key, statusCode: 200, sourceId: 'p1' },
      T0 + 1,
    );

    const snapshot = ledger.snapshotFor(KEYED.key);
    expect(snapshot?.cooldown).toBeUndefined();
    expect(snapshot?.windows[0].exhaustion).toBeDefined();
  });

  it('F66/F68: a 2xx with a null owner clears nothing', () => {
    const { ledger, quotaStore } = harness();
    quotaStore.recordRateLimit(PROVIDER, undefined, T0, {
      ownerKey: null,
      statusCode: 429,
      sourceId: 'p1',
    });
    quotaStore.recordSuccess(
      PROVIDER,
      { ownerKey: null, statusCode: 200, sourceId: 'p1' },
      T0 + 1,
    );

    const unattributed = unknownOwnerKey(PROVIDER, 'proxy:p1');
    expect(ledger.snapshotFor(unattributed)?.cooldown).toBeDefined();
  });

  it('F67/F68: unattributed 429s from two proxies stay two unknown owners', () => {
    const { ledger, quotaStore } = harness();
    quotaStore.recordRateLimit(PROVIDER, undefined, T0, {
      ownerKey: null,
      statusCode: 429,
      sourceId: 'p1',
    });
    quotaStore.recordRateLimit(PROVIDER, undefined, T0, {
      ownerKey: null,
      statusCode: 429,
      sourceId: 'p2',
    });
    quotaStore.recordRateLimit(PROVIDER, undefined, T0, {
      ownerKey: KEYED.key,
      statusCode: 429,
      sourceId: 'p1',
    });

    const owners = ledger.knownOwners();
    expect(owners.map((o) => o.key).sort()).toEqual(
      [
        unknownOwnerKey(PROVIDER, 'proxy:p1'),
        unknownOwnerKey(PROVIDER, 'proxy:p2'),
        KEYED.key,
      ].sort(),
    );
    expect(owners.filter((o) => o.identityKind === 'unknown')).toHaveLength(2);
  });

  it('Req 3.6: a seven-day Retry-After stays seven days on the cooldown', () => {
    const { ledger, quotaStore } = harness();
    quotaStore.recordRateLimit(PROVIDER, String(7 * 24 * 3600), T0, {
      ownerKey: KEYED.key,
      statusCode: 429,
      sourceId: 'p1',
    });

    const cooldown = ledger.snapshotFor(KEYED.key)?.cooldown;
    expect(cooldown?.rawUntil).toBe(T0 + 7 * DAY);
    // The gate itself is clamped; the ledger keeps both.
    expect(cooldown?.until).toBeLessThan(T0 + 7 * DAY);
  });
});

describe('PlanLimitLedgerService — session signals (G2, F62, F79)', () => {
  const rejected = (
    windowKey: 'five_hour' | 'weekly_model:sonnet' | 'weekly_model:opus',
    at: number,
  ): SessionPlanLimitSignal => ({
    kind: 'evidence',
    evidence: {
      kind: 'window',
      windowKey,
      ...(windowKey.startsWith('weekly_model:') && {
        modelScope: windowKey.slice(13),
      }),
      status: 'rejected',
      exhausted: true,
      source: 'stream-event',
      observedAt: at,
    },
  });

  it('F62 through the registry: turn evidence and its plan success land on the turn owner', async () => {
    const { ledger, signal } = harness();
    signal('s1', { kind: 'turn-start', observedAt: T0 });
    signal('s1', rejected('five_hour', T0 + 1));
    signal('s1', rejected('weekly_model:sonnet', T0 + 2));
    signal('s1', rejected('weekly_model:opus', T0 + 3));
    signal('s1', {
      kind: 'success',
      turnScopes: ['sonnet'],
      billing: 'plan',
      observedAt: T0 + 4,
    });
    await settle();

    const exhausted = (ledger.snapshotFor(OWNER_A.key)?.windows ?? [])
      .filter((w) => w.exhaustion)
      .map((w) => w.key);
    expect(exhausted).toEqual(['weekly_model:opus']);
    expect(ledger.sessionOwners()).toEqual({
      s1: { ownerKey: OWNER_A.key, modelScope: 'sonnet' },
    });
  });

  it('F79/G2: an account change A→B moves the session; A keeps its evidence; nothing of A goes to B', async () => {
    const { ledger, signal, account, probe } = harness();
    signal('s1', { kind: 'turn-start', observedAt: T0 });
    signal('s1', rejected('five_hour', T0 + 1));
    await settle();

    account.current = ACCOUNT_B;
    signal('s1', { kind: 'turn-start', observedAt: T0 + 10 });
    signal('s1', rejected('weekly_model:opus', T0 + 11));
    await settle();

    expect(probe.readAccount).toHaveBeenCalledTimes(2);
    expect(ledger.sessionOwners()['s1'].ownerKey).toBe(OWNER_B.key);
    expect(ledger.snapshotFor(OWNER_A.key)?.windows.map((w) => w.key)).toEqual([
      'five_hour',
    ]);
    expect(ledger.snapshotFor(OWNER_B.key)?.windows.map((w) => w.key)).toEqual([
      'weekly_model:opus',
    ]);
    expect(
      ledger
        .knownOwners()
        .map((o) => o.key)
        .sort(),
    ).toEqual([OWNER_A.key, OWNER_B.key].sort());
  });

  it('resolves the owner once when evidence arrives before any turn-start', async () => {
    const { ledger, signal, probe } = harness();
    signal('s1', rejected('five_hour', T0));
    signal('s1', rejected('weekly_model:opus', T0 + 1));
    await settle();

    expect(probe.readAccount).toHaveBeenCalledTimes(1);
    expect(ledger.snapshotFor(OWNER_A.key)?.windows).toHaveLength(2);
  });

  it('owner-level stream evidence records the owner evidence and its cooldown', async () => {
    const { ledger, signal } = harness();
    signal('s1', {
      kind: 'evidence',
      evidence: {
        kind: 'owner',
        cause: 'api-retry',
        source: 'error-derived',
        observedAt: T0,
        cooldown: { until: T0 + MINUTE, observedAt: T0, rawUntil: T0 + MINUTE },
      },
    });
    await settle();

    const snapshot = ledger.snapshotFor(OWNER_A.key);
    expect(snapshot?.ownerEvidence).toEqual([
      { observedAt: T0, source: 'error-derived' },
    ]);
    expect(snapshot?.cooldown?.until).toBe(T0 + MINUTE);
  });
});

describe('PlanLimitLedgerService — persistence (P6, F24, F74)', () => {
  it('F24: after a restart known-reset exhaustion survives and unknown-reset does not', () => {
    const storage = memoryStorage();
    const first = harness({ storage });
    first.ledger.recordWindowEvidence(
      OWNER_A,
      exhaustedWindow('five_hour', T0, { resetsAt: T0 + 3 * HOUR }),
    );
    first.ledger.recordWindowEvidence(OWNER_A, exhaustedWindow('weekly', T0));
    first.ledger.recordOwnerEvidence(OWNER_B, {
      observedAt: T0,
      source: 'error-derived',
      resetsAt: T0 + HOUR,
    });
    first.ledger.recordOwnerEvidence(OWNER_B, unknownEvidence(T0, 'opus'));
    expect(storage.update).toHaveBeenCalledWith(
      PLAN_LIMIT_LEDGER_STORAGE_KEY,
      expect.anything(),
    );

    const restarted = harness({ storage, at: T0 + 30 * MINUTE });
    expect(
      restarted.ledger.snapshotFor(OWNER_A.key)?.windows.map((w) => w.key),
    ).toEqual(['five_hour']);
    expect(
      windowOf(restarted.ledger, OWNER_A, 'five_hour')?.exhaustion?.resetsAt,
    ).toBe(T0 + 3 * HOUR);
    expect(restarted.ledger.snapshotFor(OWNER_B.key)?.ownerEvidence).toEqual([
      { observedAt: T0, source: 'error-derived', resetsAt: T0 + HOUR },
    ]);

    const afterReset = harness({ storage, at: T0 + 3 * HOUR });
    expect(afterReset.ledger.knownOwners()).toEqual([]);
  });

  it('a corrupt payload starts empty; a corrupt owner entry is dropped alone', () => {
    const corrupt = harness({
      storage: memoryStorage({ [PLAN_LIMIT_LEDGER_STORAGE_KEY]: 'garbage' }),
    });
    expect(corrupt.ledger.knownOwners()).toEqual([]);

    const valid = {
      owner: OWNER_A,
      windows: [
        {
          key: 'five_hour',
          kind: 'five_hour',
          label: '5-hour session',
          exhaustion: {
            observedAt: T0,
            source: 'stream-event',
            resetsAt: T0 + HOUR,
          },
          observedAt: T0,
        },
      ],
      ownerEvidence: [],
    };
    const partial = harness({
      storage: memoryStorage({
        [PLAN_LIMIT_LEDGER_STORAGE_KEY]: {
          version: 1,
          owners: [
            valid,
            { ...valid, owner: { ...OWNER_B, email: 'leak@example.test' } },
            { ...valid, owner: OWNER_B, windows: [{ key: 'nonsense' }] },
          ],
        },
      }),
    });
    expect(partial.ledger.knownOwners().map((o) => o.key)).toEqual([
      OWNER_A.key,
    ]);
  });

  it('F74: 100 owners with active known-reset exhaustion all survive, in memory and across a restart', () => {
    const storage = memoryStorage();
    const { ledger } = harness({ storage });
    const owners = Array.from({ length: 100 }, (_, i) =>
      quotaOwnerRefFromKey(accountOwnerKey('anthropic', `owner-${i}`)),
    );
    for (const owner of owners) {
      ledger.recordWindowEvidence(
        owner,
        exhaustedWindow('weekly', T0, { resetsAt: T0 + 2 * DAY }),
      );
    }

    expect(ledger.knownOwners()).toHaveLength(100);
    const restarted = harness({ storage, at: T0 + DAY });
    expect(restarted.ledger.knownOwners()).toHaveLength(100);
  });

  it('a failed write is logged at debug and memory stays authoritative', async () => {
    const storage = memoryStorage();
    storage.update.mockRejectedValue(new Error('disk full'));
    const { ledger, logger } = harness({ storage });
    ledger.recordWindowEvidence(
      OWNER_A,
      exhaustedWindow('five_hour', T0, { resetsAt: T0 + HOUR }),
    );
    await settle();

    expect(windowOf(ledger, OWNER_A, 'five_hour')?.exhaustion).toBeDefined();
    expect(logger.debug).toHaveBeenCalledWith(
      '[PlanLimitLedger] persist failed',
      { reason: 'Error' },
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('PlanLimitLedgerService — lifecycle', () => {
  it('dispose removes all three subscriptions, synchronously and idempotently', () => {
    const { ledger, registry, quotaStore } = harness();
    expect(registry.size).toBe(1);

    ledger.dispose();
    ledger.dispose();

    expect(registry.size).toBe(0);
    quotaStore.recordRateLimit('opencode-go', undefined, T0, {
      ownerKey: null,
      statusCode: 429,
      sourceId: 'p1',
    });
    expect(ledger.knownOwners()).toEqual([]);
  });

  it('isolates a throwing change listener from the others and from the write', () => {
    const { ledger, logger } = harness();
    const second = jest.fn();
    ledger.onChange(() => {
      throw new Error('listener failure');
    });
    const unsubscribe = ledger.onChange(second);

    ledger.recordOwnerEvidence(OWNER_A, unknownEvidence(T0));
    expect(second).toHaveBeenCalledWith({
      kind: 'owner',
      ownerKey: OWNER_A.key,
    });
    expect(ledger.snapshotFor(OWNER_A.key)).toBeDefined();
    expect(logger.debug).toHaveBeenCalledWith(
      '[PlanLimitLedger] change listener threw',
      {
        change: 'owner',
        reason: 'Error',
      },
    );

    unsubscribe();
    ledger.recordOwnerEvidence(OWNER_B, unknownEvidence(T0));
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('starts no timer', () => {
    jest.useFakeTimers();
    try {
      const { ledger } = harness();
      ledger.recordWindowEvidence(
        OWNER_A,
        exhaustedWindow('five_hour', T0, { resetsAt: T0 + HOUR }),
      );
      ledger.recordOwnerEvidence(OWNER_A, unknownEvidence(T0));
      ledger.recordCooldown(OWNER_A, { until: T0 + MINUTE, observedAt: T0 });
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
