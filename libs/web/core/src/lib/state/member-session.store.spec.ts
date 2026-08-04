import { TestBed } from '@angular/core/testing';

import type { MemberEntitlementResponse } from '@ptah-contracts/community';

import { MemberSessionStore } from './member-session.store';

/**
 * The Batch 4 addendum recorded that this store had no direct spec — it was
 * covered transitively through the guard — and left it to "whoever next touches
 * `MemberSessionStore`". This addendum adds `entitled()`, which both cross-panel
 * nav links now read, so the direct coverage is due.
 */
describe('MemberSessionStore', () => {
  let store: MemberSessionStore;

  const entitledAdmin: MemberEntitlementResponse = {
    entitled: true,
    cohorts: [{ key: 'builders', name: 'Builders Lounge' }],
    isAdmin: true,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(MemberSessionStore);
  });

  afterEach(() => store.clear());

  it('starts empty, and every derived flag reads false rather than throwing', () => {
    expect(store.context()).toBeNull();
    expect(store.cohorts()).toEqual([]);
    expect(store.primaryCohortName()).toBeNull();
    expect(store.isAdmin()).toBe(false);
    // ⚠️ "not known to be entitled", NOT "known to be unentitled". The admin
    // panel's Member Panel link reads this, and the empty store is exactly the
    // cold-load case where it stays hidden.
    expect(store.entitled()).toBe(false);
  });

  it('exposes entitlement and admin-ness ORTHOGONALLY (R7.4)', () => {
    store.set({ entitled: true, cohorts: [], isAdmin: false });
    expect(store.entitled()).toBe(true);
    expect(store.isAdmin()).toBe(false);

    store.set({ entitled: false, cohorts: [], isAdmin: true });
    expect(store.entitled()).toBe(false);
    expect(store.isAdmin()).toBe(true);
  });

  it('set is idempotent — the guard re-seeds it on every activation', () => {
    store.set(entitledAdmin);
    store.set(entitledAdmin);

    expect(store.context()).toEqual(entitledAdmin);
    expect(store.primaryCohortName()).toBe('Builders Lounge');
  });

  it('set REPLACES rather than merges, so a lapsed membership is not sticky', () => {
    store.set(entitledAdmin);
    store.set({ entitled: false, cohorts: [], isAdmin: true });

    expect(store.entitled()).toBe(false);
    expect(store.cohorts()).toEqual([]);
    expect(store.primaryCohortName()).toBeNull();
  });

  it('clear returns it to the empty state', () => {
    store.set(entitledAdmin);
    store.clear();

    expect(store.context()).toBeNull();
    expect(store.entitled()).toBe(false);
    expect(store.isAdmin()).toBe(false);
  });
});
