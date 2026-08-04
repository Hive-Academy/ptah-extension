import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  Router,
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
} from '@angular/router';
import { firstValueFrom, isObservable, type Observable } from 'rxjs';

import type { MemberEntitlementResponse } from '@ptah-contracts/community';

import { MemberGuard } from './member.guard';
import { MemberSessionStore } from '../state/member-session.store';

const PROBE_URL = '/api/v1/members/entitlement';

describe('MemberGuard — three outcomes (R7.7, R9.5)', () => {
  let httpMock: HttpTestingController;
  let router: Router;
  let store: MemberSessionStore;
  let navigate: jest.SpyInstance;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    store = TestBed.inject(MemberSessionStore);
    navigate = jest.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    httpMock.verify();
    store.clear();
    jest.restoreAllMocks();
  });

  /** Runs the functional guard inside an injection context, as the router does. */
  function activate(): Promise<boolean> {
    const result = TestBed.runInInjectionContext(() =>
      MemberGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );
    if (!isObservable(result))
      throw new Error('guard must return an Observable');
    return firstValueFrom(result as Observable<boolean>);
  }

  it('401 -> /login?returnUrl=/members, and does not seed the store', async () => {
    const activation = activate();
    httpMock
      .expectOne(PROBE_URL)
      .flush(null, { status: 401, statusText: 'Unauthorized' });

    await expect(activation).resolves.toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/members' },
    });
    expect(store.context()).toBeNull();
  });

  it('200 { entitled: false } -> /pricing, NOT /login and NOT an empty panel', async () => {
    const body: MemberEntitlementResponse = {
      entitled: false,
      cohorts: [],
      isAdmin: false,
    };

    const activation = activate();
    httpMock.expectOne(PROBE_URL).flush(body);

    await expect(activation).resolves.toBe(false);
    // R7.7 is explicit: a logged-in non-member gets the upgrade surface. Sending
    // them to /login would tell someone who IS signed in that they are not.
    expect(navigate).toHaveBeenCalledWith(['/pricing']);
    expect(navigate).not.toHaveBeenCalledWith(['/login'], expect.anything());
    expect(store.context()).toBeNull();
  });

  it('200 { entitled: true } -> allows and seeds MemberSessionStore', async () => {
    const body: MemberEntitlementResponse = {
      entitled: true,
      cohorts: [{ key: 'builders', name: 'Builders Lounge' }],
      isAdmin: true,
    };

    const activation = activate();
    httpMock.expectOne(PROBE_URL).flush(body);

    await expect(activation).resolves.toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    expect(store.context()).toEqual(body);
    expect(store.primaryCohortName()).toBe('Builders Lounge');
    expect(store.isAdmin()).toBe(true);
  });

  it('entitled with ZERO cohorts is allowed, not an error (R7.8, A-2)', async () => {
    // This is the live database's actual state: member_group_assignments is
    // empty, so every entitled user has `cohorts: []`. Treating that as a
    // failure would lock every real member out of the product.
    const body: MemberEntitlementResponse = {
      entitled: true,
      cohorts: [],
      isAdmin: true,
    };

    const activation = activate();
    httpMock.expectOne(PROBE_URL).flush(body);

    await expect(activation).resolves.toBe(true);
    expect(store.cohorts()).toEqual([]);
    expect(store.primaryCohortName()).toBeNull();
  });

  it('a malformed body is UNKNOWN state -> /login, never a silent allow', async () => {
    const activation = activate();
    httpMock.expectOne(PROBE_URL).flush({ entitled: 'yes' });

    await expect(activation).resolves.toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/members' },
    });
    expect(store.context()).toBeNull();
  });

  it('a 500 does not route to /pricing (that would misinform a paying member)', async () => {
    const activation = activate();
    httpMock
      .expectOne(PROBE_URL)
      .flush(null, { status: 500, statusText: 'Server Error' });

    await expect(activation).resolves.toBe(false);
    expect(navigate).not.toHaveBeenCalledWith(['/pricing']);
    expect(navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/members' },
    });
  });
});
