import {
  LicenseRecord,
  SubscriptionRecord,
  UserWithBilling,
  deriveEntitlement,
  isExpiringSoon,
  planLabel,
  subscriptionLabel,
} from './entitlement';

function license(over: Partial<LicenseRecord> = {}): LicenseRecord {
  return {
    id: 'lic-1',
    licenseKey: 'ptah_lic_abc',
    plan: 'community',
    status: 'active',
    source: 'signup',
    expiresAt: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    createdBy: 'auto_community_signup',
    ...over,
  };
}

function subscription(
  over: Partial<SubscriptionRecord> = {},
): SubscriptionRecord {
  return {
    id: 'sub-1',
    paddleSubscriptionId: 'sub_paddle_1',
    paddleCustomerId: 'cus_1',
    status: 'active',
    priceId: 'pri_1',
    currentPeriodEnd: '2026-09-01T00:00:00.000Z',
    trialEnd: null,
    canceledAt: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    ...over,
  };
}

function user(over: Partial<UserWithBilling> = {}): UserWithBilling {
  return {
    id: 'user-1',
    email: 'someone@example.com',
    firstName: null,
    lastName: null,
    emailVerified: true,
    workosId: null,
    paddleCustomerId: null,
    createdAt: null,
    updatedAt: null,
    licenses: [],
    subscriptions: [],
    ...over,
  };
}

/** Days from now as an ISO string — keeps expiry cases relative, not fixed. */
function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

describe('deriveEntitlement', () => {
  it('reports no entitlement for a user with neither record', () => {
    const e = deriveEntitlement(user());
    expect(e.activeLicense).toBeNull();
    expect(e.liveSubscription).toBeNull();
    expect(e.discrepancies).toEqual([]);
    expect(planLabel(e)).toBe('None');
    expect(subscriptionLabel(e)).toBe('None');
  });

  it('treats absent relations as empty rather than inventing findings', () => {
    const e = deriveEntitlement(
      user({ licenses: undefined, subscriptions: undefined }),
    );
    expect(e.activeLicense).toBeNull();
    expect(e.discrepancies).toEqual([]);
  });

  it('pairs a paid license with the live subscription without complaint', () => {
    const e = deriveEntitlement(
      user({
        licenses: [license({ plan: 'builders', source: 'paddle' })],
        subscriptions: [subscription()],
      }),
    );
    expect(e.isPaid).toBe(true);
    expect(e.liveSubscription?.paddleSubscriptionId).toBe('sub_paddle_1');
    expect(e.discrepancies).toEqual([]);
  });

  it('flags a paddle-sourced license with no subscription record', () => {
    const e = deriveEntitlement(
      user({ licenses: [license({ source: 'paddle' })] }),
    );
    expect(e.discrepancies.map((d) => d.code)).toEqual([
      'paid-license-no-subscription',
    ]);
    expect(e.discrepancies[0].severity).toBe('error');
  });

  it('does NOT flag a free signup license with no subscription', () => {
    // The whole point of the `source` fix: a free community license is not a
    // missing sale, so it must not surface in the reconciliation queue.
    const e = deriveEntitlement(user({ licenses: [license()] }));
    expect(e.discrepancies).toEqual([]);
  });

  it('does not flag complimentary or manual licenses either', () => {
    for (const source of ['complimentary', 'manual']) {
      const e = deriveEntitlement(
        user({ licenses: [license({ source, plan: 'builders' })] }),
      );
      expect(e.discrepancies).toEqual([]);
    }
  });

  it('flags a live subscription that entitles nothing', () => {
    const e = deriveEntitlement(
      user({
        licenses: [license({ status: 'revoked' })],
        subscriptions: [subscription({ status: 'trialing' })],
      }),
    );
    expect(e.discrepancies.map((d) => d.code)).toContain(
      'subscription-no-active-license',
    );
  });

  it('treats canceled and past_due subscriptions as not live', () => {
    for (const status of ['canceled', 'past_due', 'paused']) {
      const e = deriveEntitlement(
        user({ subscriptions: [subscription({ status })] }),
      );
      expect(e.liveSubscription).toBeNull();
    }
  });

  it('flags a paddle customer id that disagrees with the subscription', () => {
    const e = deriveEntitlement(
      user({
        paddleCustomerId: 'cus_other',
        licenses: [license({ source: 'paddle' })],
        subscriptions: [subscription({ paddleCustomerId: 'cus_1' })],
      }),
    );
    expect(e.discrepancies.map((d) => d.code)).toContain(
      'customer-id-mismatch',
    );
  });

  it('does not flag a mismatch when the user has no paddle customer id yet', () => {
    const e = deriveEntitlement(
      user({
        paddleCustomerId: null,
        licenses: [license({ source: 'paddle' })],
        subscriptions: [subscription()],
      }),
    );
    expect(e.discrepancies).toEqual([]);
  });

  it('flags more than one active license', () => {
    const e = deriveEntitlement(
      user({
        licenses: [
          license({ id: 'lic-1' }),
          license({ id: 'lic-2', plan: 'builders', source: 'complimentary' }),
        ],
      }),
    );
    expect(e.discrepancies.map((d) => d.code)).toContain(
      'multiple-active-licenses',
    );
  });

  it('prefers the paid plan when a leftover community license is also active', () => {
    const e = deriveEntitlement(
      user({
        licenses: [
          license({ id: 'lic-1', plan: 'community' }),
          license({ id: 'lic-2', plan: 'builders', source: 'complimentary' }),
        ],
      }),
    );
    expect(e.activeLicense?.plan).toBe('builders');
    expect(planLabel(e)).toBe('Builders');
  });

  it('ignores revoked and expired licenses when choosing the active one', () => {
    const e = deriveEntitlement(
      user({
        licenses: [
          license({ id: 'lic-1', plan: 'builders', status: 'revoked' }),
          license({ id: 'lic-2', plan: 'community', status: 'active' }),
        ],
      }),
    );
    expect(e.activeLicense?.id).toBe('lic-2');
  });

  it('marks a license lapsing inside the warning window as expiring soon', () => {
    const e = deriveEntitlement(
      user({ licenses: [license({ expiresAt: inDays(3) })] }),
    );
    expect(e.expiringSoon).toBe(true);
  });

  it('does not mark a lifetime or far-future license as expiring soon', () => {
    expect(
      deriveEntitlement(user({ licenses: [license({ expiresAt: null })] }))
        .expiringSoon,
    ).toBe(false);
    expect(
      deriveEntitlement(
        user({ licenses: [license({ expiresAt: inDays(90) })] }),
      ).expiringSoon,
    ).toBe(false);
  });
});

describe('isExpiringSoon', () => {
  it('returns false for an already-lapsed license', () => {
    expect(isExpiringSoon(license({ expiresAt: inDays(-1) }))).toBe(false);
  });

  it('returns false for an unparseable date rather than throwing', () => {
    expect(isExpiringSoon(license({ expiresAt: 'not-a-date' }))).toBe(false);
  });
});
