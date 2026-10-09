import 'reflect-metadata';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import type { ClaudePlanUsage } from '@ptah-extension/agent-sdk';
import type { CodexAccountUsageResult } from '../providers/codex/codex-provider.types';
import {
  PlanLimitLedgerService,
  type PlanLimitProxyObservations,
  type PlanLimitSessionOwnerResolver,
  type PlanLimitSignalSource,
} from './plan-limit-ledger.service';
import {
  PlanSecret,
  type PlanCredentialResolution,
} from './plan-credential.source';
import {
  PLAN_USAGE_CACHE_TTL_MS,
  PLAN_USAGE_MAX_OWNERS,
  PlanUsageService,
} from './plan-usage.service';
import {
  accountOwnerKey,
  cliStoreOwnerKey,
  credentialOwnerKey,
  quotaOwnerRefFromKey,
  unknownOwnerKey,
} from './provider-owner.resolver';
import type {
  PlanOwnerTarget,
  PlanUsageReading,
} from './readers/plan-usage-reader.types';

const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);
const SECRET = 'sk-plan-usage-secret-123';
const RESET_SECONDS = Math.floor(Date.UTC(2026, 9, 4, 17, 0, 0) / 1000);

const CLAUDE_A = quotaOwnerRefFromKey(accountOwnerKey('anthropic', 'a@x\0'));
const CODEX_A = quotaOwnerRefFromKey(accountOwnerKey('openai-codex', 'h\0a@x'));
const CODEX_B = quotaOwnerRefFromKey(accountOwnerKey('openai-codex', 'h\0b@x'));
const CODEX_HOME = quotaOwnerRefFromKey(unknownOwnerKey('openai-codex', 'h'));
const OPENCODE = quotaOwnerRefFromKey(
  credentialOwnerKey('opencode-go', 'oc-key'),
);

function claudeTarget(sessionId = 's-1'): PlanOwnerTarget {
  return {
    providerId: 'anthropic',
    ownerRef: CLAUDE_A,
    sessionHandle: { kind: 'session', sessionId },
  };
}

function codexTarget(ownerRef = CODEX_A): PlanOwnerTarget {
  return { providerId: 'openai-codex', ownerRef };
}

function codexOwner(index: number) {
  return quotaOwnerRefFromKey(
    accountOwnerKey('openai-codex', `home\0owner-${index}@example.test`),
  );
}

function claudeUsage(fiveHourPercent = 42): ClaudePlanUsage {
  return {
    subscription_type: 'max',
    rate_limits_available: true,
    rate_limits: {
      five_hour: {
        utilization: fiveHourPercent,
        resets_at: '2026-10-04T15:00:00Z',
      },
    },
  } as unknown as ClaudePlanUsage;
}

function codexAvailable(fetchedAt: number): CodexAccountUsageResult {
  return {
    status: 'available',
    providerId: 'openai-codex',
    fetchedAt,
    account: { planType: 'plus' },
    quota: {
      primary: {
        usedPercent: 37,
        windowDurationMins: 300,
        resetsAt: RESET_SECONDS,
      },
    },
    activity: { lifetimeTokens: '1', dailyUsage: [] },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness() {
  let clock = T0;
  const now = () => clock;
  const logger = createMockLogger();
  const storage = {
    get: () => undefined,
    update: async () => undefined,
    keys: () => [],
  } as unknown as IStateStorage;
  const signals: PlanLimitSignalSource = { register: () => () => undefined };
  const resolver: PlanLimitSessionOwnerResolver = {
    ownerForSession: async () => CLAUDE_A,
  };
  const proxies: PlanLimitProxyObservations = {
    onRateLimit: () => () => undefined,
    onSuccess: () => () => undefined,
  };
  const ledger = new PlanLimitLedgerService(
    logger as unknown as Logger,
    storage,
    signals,
    resolver,
    proxies,
    now,
  );
  const readPlanUsage = jest.fn<Promise<ClaudePlanUsage | null>, [string?]>(
    async () => claudeUsage(),
  );
  const getAccountUsage = jest.fn<
    Promise<CodexAccountUsageResult>,
    [{ refresh?: boolean; signal?: AbortSignal }?]
  >(async () => codexAvailable(clock));
  const resolve = jest.fn<Promise<PlanCredentialResolution>, [unknown]>(
    async () => ({ kind: 'available', secret: new PlanSecret(SECRET) }),
  );
  const service = new PlanUsageService(
    logger as unknown as Logger,
    ledger,
    { resolve },
    { readPlanUsage },
    { getAccountUsage },
    now,
  );
  return {
    service,
    ledger,
    logger,
    readPlanUsage,
    getAccountUsage,
    resolve,
    advance: (ms: number) => {
      clock += ms;
    },
    time: () => clock,
  };
}

describe('PlanUsageService', () => {
  describe('dispatch and merge', () => {
    it('reads Claude through the probe for the target session and records the windows in the ledger', async () => {
      const h = harness();

      const snapshot = await h.service.getOwnerSnapshot(claudeTarget('s-9'));

      expect(h.readPlanUsage).toHaveBeenCalledWith('s-9');
      expect(snapshot).toMatchObject({
        owner: CLAUDE_A,
        status: 'available',
        fetchedAt: T0,
        windowSetEstablished: true,
        account: { planType: 'max' },
        ownerEvidence: [],
      });
      expect(snapshot.staleSince).toBeUndefined();
      expect(snapshot.windows).toHaveLength(1);
      expect(snapshot.windows[0]).toMatchObject({
        key: 'five_hour',
        used: { kind: 'percent', percent: 42 },
        usedSource: 'provider-api',
      });
      expect(h.ledger.snapshotFor(CLAUDE_A.key)?.windows).toHaveLength(1);
    });

    it('F27: with no open session returns event-only data under no-open-session', async () => {
      const h = harness();
      h.readPlanUsage.mockResolvedValue(null);
      h.ledger.recordWindowEvidence(CLAUDE_A, {
        key: 'weekly',
        kind: 'weekly',
        label: 'Weekly',
        used: { kind: 'percent', percent: 80 },
        usedSource: 'stream-event',
        observedAt: T0 - 1_000,
      });

      const snapshot = await h.service.getOwnerSnapshot(claudeTarget());

      expect(snapshot.status).toBe('service-unavailable');
      expect(snapshot.unavailableReason).toBe('no-open-session');
      expect(snapshot.windowSetEstablished).toBe(false);
      expect(snapshot.windows.map((w) => [w.key, w.usedSource])).toEqual([
        ['weekly', 'stream-event'],
      ]);
    });

    it('F28: an API-key Claude owner is unsupported-auth and carries no windows', async () => {
      const h = harness();
      h.readPlanUsage.mockResolvedValue({
        subscription_type: null,
        rate_limits_available: false,
        rate_limits: null,
      } as unknown as ClaudePlanUsage);
      h.ledger.recordWindowEvidence(CLAUDE_A, {
        key: 'five_hour',
        kind: 'five_hour',
        label: '5-hour',
        observedAt: T0 - 1_000,
      });

      const snapshot = await h.service.getOwnerSnapshot(claudeTarget());

      expect(snapshot.status).toBe('unsupported-auth');
      expect(snapshot.windows).toEqual([]);
      expect(snapshot.windowSetEstablished).toBe(false);
    });

    it('F29: Codex windows keep primary-first order and the existing fields (Req 2.10)', async () => {
      const h = harness();

      const snapshot = await h.service.getOwnerSnapshot(codexTarget(), {
        refresh: true,
      });

      expect(h.getAccountUsage).toHaveBeenCalledWith(
        expect.objectContaining({ refresh: true }),
      );
      expect(snapshot.status).toBe('available');
      expect(snapshot.account).toEqual({ planType: 'plus' });
      expect(snapshot.activity).toEqual({
        lifetimeTokens: '1',
        dailyUsage: [],
      });
      expect(snapshot.windows[0]).toMatchObject({
        key: 'five_hour',
        durationMins: 300,
        resetsAt: RESET_SECONDS * 1000,
      });
    });

    // OpenCode reads local usage through its CLI (PR #673); stub that reader
    // so these tests never spawn a real `opencode` process.
    const stubOpenCodeReader = (
      service: PlanUsageService,
      providerId: 'opencode' | 'opencode-go',
      reading: PlanUsageReading,
    ): jest.Mock => {
      const reader = jest.fn<Promise<PlanUsageReading>, [unknown]>(
        async () => reading,
      );
      (service as unknown as { readers: Record<string, unknown> }).readers[
        providerId
      ] = reader;
      return reader;
    };

    it('F31: OpenCode with no local usage answers its reader status and no evidence', async () => {
      const h = harness();
      const reader = stubOpenCodeReader(h.service, 'opencode-go', {
        status: 'service-unavailable',
        windowSetEstablished: false,
        windows: [],
      });

      const snapshot = await h.service.getOwnerSnapshot({
        providerId: 'opencode-go',
        ownerRef: OPENCODE,
        credentialRef: { kind: 'provider-key', providerId: 'opencode-go' },
      });

      expect(reader).toHaveBeenCalledTimes(1);
      expect(snapshot).toEqual({
        owner: OPENCODE,
        status: 'service-unavailable',
        windowSetEstablished: false,
        windows: [],
        ownerEvidence: [],
      });
    });

    it('F32: OpenCode with a recorded limit hit keeps that evidence (Req 2.8)', async () => {
      const h = harness();
      stubOpenCodeReader(h.service, 'opencode', {
        status: 'service-unavailable',
        windowSetEstablished: false,
        windows: [],
      });
      const owner = quotaOwnerRefFromKey(cliStoreOwnerKey('opencode', '/oc'));
      const hit = { observedAt: T0 - 60_000, source: 'error-derived' as const };
      h.ledger.recordOwnerEvidence(owner, hit);

      const snapshot = await h.service.getOwnerSnapshot({
        providerId: 'opencode',
        ownerRef: owner,
      });

      expect(snapshot.status).toBe('service-unavailable');
      expect(snapshot.ownerEvidence).toEqual([hit]);
    });

    it('answers provider-unsupported for a provider without a reader', async () => {
      const h = harness();
      const owner = quotaOwnerRefFromKey(credentialOwnerKey('openrouter', 'k'));

      const snapshot = await h.service.getOwnerSnapshot({
        providerId: 'openrouter',
        ownerRef: owner,
      });

      expect(snapshot.status).toBe('provider-unsupported');
      expect(snapshot.windows).toEqual([]);
    });
  });

  describe('credentials (F71)', () => {
    it('maps an unavailable credential straight to its status without calling the reader', async () => {
      const h = harness();
      h.resolve.mockResolvedValue({
        kind: 'unavailable',
        status: 'unsupported-config',
      });

      const snapshot = await h.service.getOwnerSnapshot({
        ...claudeTarget(),
        credentialRef: { kind: 'provider-key', providerId: 'anthropic' },
      });

      expect(snapshot.status).toBe('unsupported-config');
      expect(h.readPlanUsage).not.toHaveBeenCalled();
    });

    it('resolves the referenced secret per read and never puts it in the snapshot or logs', async () => {
      const h = harness();
      const ref = { kind: 'provider-key', providerId: 'anthropic' } as const;

      const snapshot = await h.service.getOwnerSnapshot({
        ...claudeTarget(),
        credentialRef: ref,
      });

      expect(h.resolve).toHaveBeenCalledWith(ref);
      expect(JSON.stringify(snapshot)).not.toContain(SECRET);
      const logs = JSON.stringify(
        Object.values(h.logger).flatMap((fn) =>
          jest.isMockFunction(fn) ? fn.mock.calls : [],
        ),
      );
      expect(logs).not.toContain(SECRET);
    });
  });

  describe('cache and single flight', () => {
    it('FU A6: evicts the oldest owner and its failure timestamp above the owner cap', async () => {
      const h = harness();
      const oldest = codexOwner(0);
      await h.service.getOwnerSnapshot(codexTarget(oldest));
      h.advance(PLAN_USAGE_CACHE_TTL_MS + 1);
      h.getAccountUsage.mockRejectedValueOnce(new Error('timeout'));
      await h.service.getOwnerSnapshot(codexTarget(oldest));

      for (let index = 1; index <= PLAN_USAGE_MAX_OWNERS; index += 1) {
        h.advance(1);
        await h.service.getOwnerSnapshot(codexTarget(codexOwner(index)));
      }

      const state = h.service as unknown as {
        cache: Map<string, unknown>;
        failingSince: Map<string, number>;
      };
      expect(state.cache.size).toBe(PLAN_USAGE_MAX_OWNERS);
      expect(state.cache.has(oldest.key)).toBe(false);
      expect(state.failingSince.has(oldest.key)).toBe(false);
    });

    it('FU A6: retains an owner with an in-flight refresh during eviction', async () => {
      const h = harness();
      for (let index = 0; index < PLAN_USAGE_MAX_OWNERS; index += 1) {
        h.advance(1);
        await h.service.getOwnerSnapshot(codexTarget(codexOwner(index)));
      }
      const protectedOwner = codexOwner(0);
      const gate = deferred<CodexAccountUsageResult>();
      h.getAccountUsage.mockReturnValueOnce(gate.promise);
      const pending = h.service.getOwnerSnapshot(codexTarget(protectedOwner), {
        refresh: true,
      });

      h.advance(1);
      await h.service.getOwnerSnapshot(
        codexTarget(codexOwner(PLAN_USAGE_MAX_OWNERS)),
      );

      const state = h.service as unknown as { cache: Map<string, unknown> };
      expect(state.cache.has(protectedOwner.key)).toBe(true);
      expect(state.cache.size).toBe(PLAN_USAGE_MAX_OWNERS);
      gate.resolve(codexAvailable(h.time()));
      await expect(pending).resolves.toMatchObject({ status: 'available' });
    });

    it('serves one owner from a 30 s cache keyed by owner key; refresh bypasses it', async () => {
      const h = harness();

      await h.service.getOwnerSnapshot(claudeTarget());
      h.advance(PLAN_USAGE_CACHE_TTL_MS - 1);
      const cached = await h.service.getOwnerSnapshot(claudeTarget('s-2'));
      expect(h.readPlanUsage).toHaveBeenCalledTimes(1);
      expect(cached.status).toBe('available');

      await h.service.getOwnerSnapshot(claudeTarget(), { refresh: true });
      expect(h.readPlanUsage).toHaveBeenCalledTimes(2);

      h.advance(PLAN_USAGE_CACHE_TTL_MS);
      await h.service.getOwnerSnapshot(claudeTarget());
      expect(h.readPlanUsage).toHaveBeenCalledTimes(3);
    });

    it('joins concurrent reads of the same owner into one', async () => {
      const h = harness();
      const gate = deferred<ClaudePlanUsage | null>();
      h.readPlanUsage.mockReturnValueOnce(gate.promise);

      const first = h.service.getOwnerSnapshot(claudeTarget());
      const second = h.service.getOwnerSnapshot(claudeTarget(), {
        refresh: true,
      });
      gate.resolve(claudeUsage());

      const [a, b] = await Promise.all([first, second]);
      expect(h.readPlanUsage).toHaveBeenCalledTimes(1);
      expect(a).toEqual(b);
    });

    it("one caller's abort ends only its own wait; the read continues for the others", async () => {
      const h = harness();
      const gate = deferred<CodexAccountUsageResult>();
      h.getAccountUsage.mockReturnValueOnce(gate.promise);
      const leaving = new AbortController();
      const staying = new AbortController();

      const left = h.service.getOwnerSnapshot(codexTarget(), {
        signal: leaving.signal,
      });
      const stayed = h.service.getOwnerSnapshot(codexTarget(), {
        signal: staying.signal,
      });
      leaving.abort();

      await expect(left).rejects.toMatchObject({ name: 'AbortError' });
      const readSignal = h.getAccountUsage.mock.calls[0][0]?.signal;
      expect(readSignal?.aborted).toBe(false);
      gate.resolve(codexAvailable(h.time()));
      await expect(stayed).resolves.toMatchObject({ status: 'available' });
    });

    it('cancels the read once every caller has aborted, and caches nothing from it', async () => {
      const h = harness();
      h.getAccountUsage.mockImplementationOnce(
        (options) =>
          new Promise((resolve) => {
            options?.signal?.addEventListener('abort', () =>
              resolve({
                status: 'service-unavailable',
                providerId: 'openai-codex',
              }),
            );
          }),
      );
      const controller = new AbortController();

      const pending = h.service.getOwnerSnapshot(codexTarget(), {
        signal: controller.signal,
      });
      controller.abort();
      // Arrives before the cancelled read settles: it must not join it.
      const next = h.service.getOwnerSnapshot(codexTarget());

      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(h.getAccountUsage.mock.calls[0][0]?.signal?.aborted).toBe(true);
      expect(h.getAccountUsage).toHaveBeenCalledTimes(2);
      await expect(next).resolves.toMatchObject({ status: 'available' });
      expect((await next).staleSince).toBeUndefined();
    });

    it('rejects at once for an already-aborted signal without reading', async () => {
      const h = harness();
      await expect(
        h.service.getOwnerSnapshot(claudeTarget(), {
          signal: AbortSignal.abort(),
        }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(h.readPlanUsage).not.toHaveBeenCalled();
    });

    it("one provider's failure never affects another's snapshot", async () => {
      const h = harness();
      h.getAccountUsage.mockRejectedValue(new Error('app server crashed'));

      const [codex, claude] = await Promise.all([
        h.service.getOwnerSnapshot(codexTarget()),
        h.service.getOwnerSnapshot(claudeTarget()),
      ]);

      expect(codex.status).toBe('service-unavailable');
      expect(claude.status).toBe('available');
      expect(h.logger.debug).toHaveBeenCalledWith('[PlanUsage] reader failed', {
        providerId: 'openai-codex',
        reason: 'Error',
      });
    });
  });

  describe('F30: Req 2.9 stale matrix', () => {
    it('same owner, transient failure, with a cache → stale at the original observation time', async () => {
      const h = harness();
      await h.service.getOwnerSnapshot(codexTarget());
      const record = jest.spyOn(h.ledger, 'recordWindowEvidence');
      h.advance(PLAN_USAGE_CACHE_TTL_MS + 1);
      const failedAt = h.time();
      h.getAccountUsage.mockRejectedValue(new Error('timeout'));

      const first = await h.service.getOwnerSnapshot(codexTarget());
      h.advance(5_000);
      const second = await h.service.getOwnerSnapshot(codexTarget());

      expect(first).toMatchObject({
        status: 'stale',
        fetchedAt: T0,
        staleSince: failedAt,
        account: { planType: 'plus' },
      });
      expect(second.staleSince).toBe(failedAt);
      expect(first.windows[0].observedAt).toBe(T0);
      expect(record).toHaveBeenCalledWith(
        CODEX_A,
        expect.objectContaining({ key: 'five_hour', observedAt: T0 }),
        { stale: true },
      );
    });

    it('a source that answers stale itself is re-served with its own original time', async () => {
      const h = harness();
      h.getAccountUsage.mockResolvedValue({
        ...codexAvailable(T0 - 90_000),
        status: 'stale',
        staleSince: T0,
      });

      const snapshot = await h.service.getOwnerSnapshot(codexTarget());

      expect(snapshot.status).toBe('stale');
      expect(snapshot.fetchedAt).toBe(T0 - 90_000);
      expect(snapshot.staleSince).toBe(T0);
      expect(snapshot.windows[0].observedAt).toBe(T0 - 90_000);
    });

    it('transient failure without a cache → service-unavailable, no windows', async () => {
      const h = harness();
      h.getAccountUsage.mockRejectedValue(new Error('timeout'));

      const snapshot = await h.service.getOwnerSnapshot(codexTarget());

      expect(snapshot.status).toBe('service-unavailable');
      expect(snapshot.windows).toEqual([]);
      expect(snapshot.staleSince).toBeUndefined();
    });

    it('unsupported auth after a cached read carries no windows, and a later failure is not stale', async () => {
      const h = harness();
      await h.service.getOwnerSnapshot(codexTarget());
      h.advance(PLAN_USAGE_CACHE_TTL_MS + 1);
      h.getAccountUsage.mockResolvedValueOnce({
        status: 'unsupported-auth',
        providerId: 'openai-codex',
      });

      const ineligible = await h.service.getOwnerSnapshot(codexTarget());
      expect(ineligible.status).toBe('unsupported-auth');
      expect(ineligible.windows).toEqual([]);

      h.advance(PLAN_USAGE_CACHE_TTL_MS + 1);
      h.getAccountUsage.mockRejectedValueOnce(new Error('timeout'));
      const failed = await h.service.getOwnerSnapshot(codexTarget());
      expect(failed.status).toBe('service-unavailable');
    });

    it('unsupported CLI version carries no cached windows', async () => {
      const h = harness();
      await h.service.getOwnerSnapshot(codexTarget());
      h.advance(PLAN_USAGE_CACHE_TTL_MS + 1);
      h.getAccountUsage.mockResolvedValue({
        status: 'cli-version-unsupported',
        providerId: 'openai-codex',
      });

      const snapshot = await h.service.getOwnerSnapshot(codexTarget());

      expect(snapshot.status).toBe('cli-version-unsupported');
      expect(snapshot.windows).toEqual([]);
      expect(snapshot.windowSetEstablished).toBe(false);
    });

    it('cached account A, then signed in as B: A is never served for B (Req 4.3)', async () => {
      const h = harness();
      await h.service.getOwnerSnapshot(codexTarget(CODEX_A));
      h.getAccountUsage.mockRejectedValue(new Error('timeout'));

      const snapshot = await h.service.getOwnerSnapshot(codexTarget(CODEX_B));

      expect(snapshot.owner).toEqual(CODEX_B);
      expect(snapshot.status).toBe('service-unavailable');
      expect(snapshot.windows).toEqual([]);
    });

    it('cached account A, then sign-out: the signed-out owner gets no cache of A', async () => {
      const h = harness();
      await h.service.getOwnerSnapshot(codexTarget(CODEX_A));
      h.getAccountUsage.mockResolvedValue({
        status: 'unsupported-auth',
        providerId: 'openai-codex',
      });

      const snapshot = await h.service.getOwnerSnapshot(
        codexTarget(CODEX_HOME),
      );

      expect(snapshot.owner).toEqual(CODEX_HOME);
      expect(snapshot.status).toBe('unsupported-auth');
      expect(snapshot.windows).toEqual([]);
    });

    it('no open session never re-serves the cache as stale', async () => {
      const h = harness();
      await h.service.getOwnerSnapshot(claudeTarget());
      h.advance(PLAN_USAGE_CACHE_TTL_MS + 1);
      h.readPlanUsage.mockResolvedValue(null);

      const snapshot = await h.service.getOwnerSnapshot(claudeTarget());

      expect(snapshot.status).toBe('service-unavailable');
      expect(snapshot.unavailableReason).toBe('no-open-session');
      expect(snapshot.staleSince).toBeUndefined();
    });

    it('a success after a stale run clears the failure start', async () => {
      const h = harness();
      await h.service.getOwnerSnapshot(claudeTarget());
      h.advance(PLAN_USAGE_CACHE_TTL_MS + 1);
      h.readPlanUsage.mockRejectedValueOnce(new Error('timeout'));
      expect((await h.service.getOwnerSnapshot(claudeTarget())).status).toBe(
        'stale',
      );

      const recovered = await h.service.getOwnerSnapshot(claudeTarget());
      expect(recovered.status).toBe('available');
      expect(recovered.staleSince).toBeUndefined();

      h.advance(PLAN_USAGE_CACHE_TTL_MS + 1);
      const failedAt = h.time();
      h.readPlanUsage.mockRejectedValueOnce(new Error('timeout'));
      const again = await h.service.getOwnerSnapshot(claudeTarget());
      expect(again.staleSince).toBe(failedAt);
    });
  });
});
