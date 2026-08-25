/**
 * ProviderQuotaStore — the shared 429 record (TASK_2026_306 defect B).
 *
 * Four properties, and the third is the one the defect actually turns on:
 *
 *  1. A 429 arms a cooldown keyed by REGISTRY provider id.
 *  2. `retry-after` is honoured when it arrives; the 15-minute default carries
 *     the normal (bare) case.
 *  3. A SUCCESS clears the gate immediately, not only expiry — a subscription
 *     that refills early must not stay gated for the rest of the cooldown.
 *  4. The gate is per provider, and it re-opens on its own.
 *
 * `Date.now` is mocked rather than slept on: every deadline here is minutes
 * away, and a real timer would make the file slow and flaky in equal measure.
 */
import {
  parseRetryAfterMs,
  ProviderQuotaStore,
  providerQuotaStore,
  PROVIDER_QUOTA_DEFAULT_COOLDOWN_MS,
} from './provider-quota.store';

const T0 = 1_700_000_000_000;

describe('ProviderQuotaStore — recording a 429', () => {
  it('arms a cooldown for the default window when no retry-after arrived', () => {
    // The captured run's rate-limit lines are all bare, so this is the normal
    // path rather than the fallback.
    const store = new ProviderQuotaStore();
    const state = store.recordRateLimit('a-provider', undefined, T0);

    expect(state).toEqual({
      providerId: 'a-provider',
      until: T0 + PROVIDER_QUOTA_DEFAULT_COOLDOWN_MS,
    });
    expect(store.retryAfterMs('a-provider', T0)).toBe(
      PROVIDER_QUOTA_DEFAULT_COOLDOWN_MS,
    );
  });

  it('honours a delta-seconds retry-after', () => {
    const store = new ProviderQuotaStore();
    store.recordRateLimit('a-provider', '90', T0);
    expect(store.retryAfterMs('a-provider', T0)).toBe(90_000);
  });

  it('honours an HTTP-date retry-after', () => {
    const store = new ProviderQuotaStore();
    store.recordRateLimit(
      'a-provider',
      new Date(T0 + 60_000).toUTCString(),
      T0,
    );
    // Second-resolution date, so allow the truncation.
    expect(store.retryAfterMs('a-provider', T0)).toBeGreaterThan(58_000);
    expect(store.retryAfterMs('a-provider', T0)).toBeLessThanOrEqual(60_000);
  });

  it('falls back to the default for an unparseable retry-after', () => {
    // A bad header must never be the reason the gate fails to arm.
    const store = new ProviderQuotaStore();
    store.recordRateLimit('a-provider', 'soon-ish', T0);
    expect(store.retryAfterMs('a-provider', T0)).toBe(
      PROVIDER_QUOTA_DEFAULT_COOLDOWN_MS,
    );
  });

  it('never shortens a live cooldown', () => {
    // Two proxies for one provider can be in flight; the bare second reply must
    // not re-open a gate the first one armed for longer.
    const store = new ProviderQuotaStore();
    store.recordRateLimit('a-provider', '3600', T0);
    store.recordRateLimit('a-provider', '5', T0);
    expect(store.retryAfterMs('a-provider', T0)).toBe(3_600_000);
  });

  it('ignores a blank provider id rather than recording an unmatched key', () => {
    const store = new ProviderQuotaStore();
    expect(store.recordRateLimit('   ', undefined, T0)).toBeNull();
    expect(store.cooldownFor('', T0)).toBeNull();
  });
});

describe('ProviderQuotaStore — clearing', () => {
  it('clears on the next success, not only on expiry', () => {
    const store = new ProviderQuotaStore();
    store.recordRateLimit('a-provider', undefined, T0);
    expect(store.cooldownFor('a-provider', T0)).not.toBeNull();

    store.recordSuccess('a-provider');

    expect(store.cooldownFor('a-provider', T0)).toBeNull();
    expect(store.retryAfterMs('a-provider', T0)).toBe(0);
  });

  it('re-opens on its own once the deadline passes, and evicts the key', () => {
    const store = new ProviderQuotaStore();
    store.recordRateLimit('a-provider', '60', T0);

    expect(store.cooldownFor('a-provider', T0 + 59_000)).not.toBeNull();
    expect(store.cooldownFor('a-provider', T0 + 61_000)).toBeNull();
    // Evicted on read: a second query at the ORIGINAL clock must not resurrect
    // it, which is what proves the entry is gone rather than merely filtered.
    expect(store.cooldownFor('a-provider', T0)).toBeNull();
  });

  it('gates each provider independently', () => {
    const store = new ProviderQuotaStore();
    store.recordRateLimit('a-provider', undefined, T0);
    expect(store.cooldownFor('another-provider', T0)).toBeNull();
  });
});

describe('ProviderQuotaStore — the DYNAMIC provider id case', () => {
  it('records under whatever id the caller supplies at request time', () => {
    // `CustomOpenAiTranslationProxy` and `LocalModelTranslationProxy` serve an
    // id known only at construction. The store takes the id per call, so those
    // two need no special case.
    const store = new ProviderQuotaStore();
    store.recordRateLimit('custom-gateway-7', undefined, T0);
    store.recordRateLimit('lm-studio', undefined, T0);

    expect(store.cooldownFor('custom-gateway-7', T0)).not.toBeNull();
    expect(store.cooldownFor('lm-studio', T0)).not.toBeNull();
    expect(store.cooldownFor('LMStudio', T0)).toBeNull();
  });
});

describe('parseRetryAfterMs', () => {
  it.each([
    [undefined, null],
    ['', null],
    ['0', null],
    ['-5', null],
    ['not-a-date', null],
  ])('parses %p to %p', (header, expected) => {
    expect(parseRetryAfterMs(header as string | undefined, T0)).toBe(expected);
  });

  it('reads the first value when Node hands back an array', () => {
    expect(parseRetryAfterMs(['30', '60'], T0)).toBe(30_000);
  });

  it('clamps an absurd retry-after rather than disabling the provider for a week', () => {
    expect(parseRetryAfterMs('604800', T0)).toBe(6 * 60 * 60_000);
  });
});

describe('the process-wide instance', () => {
  it('is a real store and starts clean', () => {
    providerQuotaStore.clear();
    expect(providerQuotaStore).toBeInstanceOf(ProviderQuotaStore);
    expect(providerQuotaStore.retryAfterMs('a-provider')).toBe(0);
  });
});
