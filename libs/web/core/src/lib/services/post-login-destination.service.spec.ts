import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import type { MemberEntitlementResponse } from '@ptah-contracts/community';

import { MEMBER_ENTITLEMENT_URL } from './member-entitlement.service';
import {
  PostLoginDestinationService,
  defaultDestinationFor,
} from './post-login-destination.service';
import { MemberSessionStore } from '../state/member-session.store';

/**
 * The post-login DEFAULT destination.
 *
 * ⚠️ WHAT IS NOT TESTED HERE, BECAUSE IT CANNOT BE: this service is only ever
 * consulted when there is no `returnUrl`. That precedence is a property of the
 * CALLER — `auth-page.component.ts` returns before reaching it — and is proven
 * in `libs/web/auth/src/lib/auth-page.component.spec.ts`, where the strongest
 * available form of the assertion lives: with a `returnUrl` present, the
 * entitlement probe is never even issued.
 */
describe('defaultDestinationFor — admin > entitled member > everyone else', () => {
  it('an admin who is ALSO an entitled member defaults to /admin', () => {
    // The tie-break. Both facts are true and neither implies the other; for the
    // LANDING decision only, admin wins. Nothing about the entitlement changes,
    // and /members stays one click away in the sidebar.
    expect(
      defaultDestinationFor({ entitled: true, cohorts: [], isAdmin: true }),
    ).toBe('/admin');
  });

  it('an admin with NO entitlement still defaults to /admin', () => {
    // The founder's real account: admin, free `community` license. Admin-ness
    // and membership are orthogonal (R7.4), so the landing must not require a
    // Builders entitlement it never needed.
    expect(
      defaultDestinationFor({ entitled: false, cohorts: [], isAdmin: false }),
    ).toBe('/profile');
    expect(
      defaultDestinationFor({ entitled: false, cohorts: [], isAdmin: true }),
    ).toBe('/admin');
  });

  it('an entitled non-admin defaults to /members', () => {
    expect(
      defaultDestinationFor({ entitled: true, cohorts: [], isAdmin: false }),
    ).toBe('/members');
  });

  it('an UNKNOWN state defaults to /profile, the pre-existing destination', () => {
    // A failed or unparseable probe must not strand a visitor who just
    // authenticated successfully.
    expect(defaultDestinationFor(null)).toBe('/profile');
  });
});

describe('PostLoginDestinationService — resolves against the live probe', () => {
  let httpMock: HttpTestingController;
  let service: PostLoginDestinationService;
  let store: MemberSessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    httpMock = TestBed.inject(HttpTestingController);
    service = TestBed.inject(PostLoginDestinationService);
    store = TestBed.inject(MemberSessionStore);
  });

  afterEach(() => {
    httpMock.verify();
    store.clear();
  });

  /** Resolves the default destination, answering the probe with `body`. */
  async function resolveWith(
    body: MemberEntitlementResponse | null,
    status?: { status: number; statusText: string },
  ): Promise<string> {
    const resolution = firstValueFrom(service.resolveDefault());
    const probe = httpMock.expectOne(MEMBER_ENTITLEMENT_URL);
    if (status) probe.flush(null, status);
    else probe.flush(body);
    return resolution;
  }

  it('an admin+member lands on /admin and the member session is still seeded', async () => {
    const body: MemberEntitlementResponse = {
      entitled: true,
      cohorts: [{ key: 'builders', name: 'Builders Lounge' }],
      isAdmin: true,
    };

    await expect(resolveWith(body)).resolves.toBe('/admin');
    // Landing on /admin must not cost the member session: the admin's Member
    // Panel link is gated on exactly this, and /members must stay one click
    // away rather than requiring a second probe to become visible.
    expect(store.context()).toEqual(body);
    expect(store.entitled()).toBe(true);
    expect(store.isAdmin()).toBe(true);
  });

  it('an entitled non-admin lands on /members', async () => {
    await expect(
      resolveWith({ entitled: true, cohorts: [], isAdmin: false }),
    ).resolves.toBe('/members');
  });

  it('a signed-in non-member, non-admin lands on /profile', async () => {
    await expect(
      resolveWith({ entitled: false, cohorts: [], isAdmin: false }),
    ).resolves.toBe('/profile');
    // Not a member session — nothing to seed.
    expect(store.context()).toBeNull();
  });

  it('a 500 resolves to /profile rather than erroring the login flow', async () => {
    await expect(
      resolveWith(null, { status: 500, statusText: 'Server Error' }),
    ).resolves.toBe('/profile');
  });

  it('a malformed body resolves to /profile, never to /admin', async () => {
    const resolution = firstValueFrom(service.resolveDefault());
    httpMock.expectOne(MEMBER_ENTITLEMENT_URL).flush({ isAdmin: 'yes' });

    // A body that fails the contract parse is UNKNOWN state. Reading a truthy
    // string as "admin" would hand the operator surface to whoever the server
    // drifted into describing.
    await expect(resolution).resolves.toBe('/profile');
    expect(store.context()).toBeNull();
  });

  it('issues exactly one probe per resolution', async () => {
    await resolveWith({ entitled: true, cohorts: [], isAdmin: true });
    httpMock.expectNone(MEMBER_ENTITLEMENT_URL);
  });
});
