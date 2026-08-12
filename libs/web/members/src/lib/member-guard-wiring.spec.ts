import { provideLocationMocks } from '@angular/common/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  TestBed,
  fakeAsync,
  tick,
  type ComponentFixture,
} from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, RouterOutlet, Routes, provideRouter } from '@angular/router';

import type { MemberEntitlementResponse } from '@ptah-contracts/community';
import { MemberGuard, MemberSessionStore } from '@ptah-web/core';

import { MemberLayout } from './member-layout/member-layout';
import { MEMBER_ROUTES } from './members.routes';

const PROBE_URL = '/api/v1/members/entitlement';

/**
 * R9.5 — `MemberGuard` on the `/members` route, exercised through a real Router
 * against the real `MEMBER_ROUTES`.
 *
 * `member.guard.spec.ts` (now in `@ptah-web/core`) proves what the guard
 * DECIDES by calling it directly. `members.routes.spec.ts` proves this tree
 * declares no guard of its own. `app.routes.spec.ts` proves `/members` names
 * one. None of those three prove the thing that actually matters after the
 * relocation: that with the guard one level UP — on the lazy `/members` route
 * rather than on `MEMBER_ROUTES[0]` — a denied probe still stops
 * `MemberLayout` from ever being constructed.
 *
 * That was the real risk in moving it. A guard on the parent of a `loadChildren`
 * route resolves BEFORE the child config is loaded, so a rejection must leave
 * the member shell uninstantiated and the visitor on the right destination. The
 * three tests below assert exactly that, against the same route shape
 * `app.routes.ts` declares.
 */
@Component({
  selector: 'ptah-guard-wiring-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
class GuardWiringHost {}

/** Stand-ins for the two redirect destinations, which live outside this lib. */
@Component({
  selector: 'ptah-guard-wiring-stub',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<p>stub</p>',
})
class StubDestination {}

/**
 * The same shape `app.routes.ts` declares: the guard on the `/members` route
 * that lazy-loads the member tree, and no guard inside that tree.
 */
const APP_SHAPED_ROUTES: Routes = [
  { path: 'login', component: StubDestination },
  { path: 'pricing', component: StubDestination },
  // Present so an accidental bounce to the admin panel would RESOLVE rather
  // than fail to match — a redirect that lands nowhere is indistinguishable
  // from no redirect at all, and the admin tests below need to tell them apart.
  { path: 'admin', component: StubDestination },
  {
    path: 'members',
    canActivate: [MemberGuard],
    loadChildren: () => MEMBER_ROUTES,
  },
];

describe('MemberGuard guards /members from app.routes.ts (R9.5)', () => {
  let fixture: ComponentFixture<GuardWiringHost>;
  let router: Router;
  let httpMock: HttpTestingController;
  let store: MemberSessionStore;

  beforeEach(() => {
    // `AuthService.getCurrentUser()` short-circuits to `of(null)` with no auth
    // hint present, so the member shell renders without issuing a request and
    // the probe below is the ONLY call in flight.
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(APP_SHAPED_ROUTES),
        provideLocationMocks(),
      ],
    });

    router = TestBed.inject(Router);
    httpMock = TestBed.inject(HttpTestingController);
    store = TestBed.inject(MemberSessionStore);
    fixture = TestBed.createComponent(GuardWiringHost);
    fixture.detectChanges();
  });

  afterEach(() => {
    // 🔴 THE PANEL NOW POLLS, AND THAT IS ANSWERED RATHER THAN ASSERTED AWAY
    // (Batch 15, R10.4/R10.5). Once `MemberLayout` renders, it calls
    // `MemberNotificationsStore.start()`, which fetches the unread count
    // eagerly and again on every `NavigationEnd`. Those requests are a real
    // feature of the shell, not leakage from this spec's subject — which is
    // the GUARD.
    //
    // ⚠️ THEY ARE FLUSHED, NOT IGNORED, AND `verify()` IS NOT WEAKENED. Any
    // request that is NOT the count still fails the check below, so this
    // absorbs exactly one known, named endpoint and leaves every other
    // assertion in this file at full strength. `member-notifications.store.spec.ts`
    // owns the assertions about the poll itself.
    for (const request of httpMock.match(
      '/api/v1/members/notifications/unread-count',
    )) {
      request.flush({ unreadCount: 0 });
    }

    httpMock.verify();
    store.clear();
  });

  /**
   * Navigates and answers the entitlement probe with `body`.
   *
   * `fakeAsync` rather than `await`: the router reaches the guard on a
   * microtask, so the probe is not in flight on the line after
   * `navigateByUrl`. `tick()` drains that, the flush answers it, and the second
   * `tick()` drains both the guard's own redirect navigation and the
   * `loadChildren` resolution on the allow path.
   */
  function navigateWith(
    url: string,
    body: MemberEntitlementResponse | null,
    status?: { status: number; statusText: string },
  ): void {
    void router.navigateByUrl(url);
    tick();

    const probe = httpMock.expectOne(PROBE_URL);
    if (status) probe.flush(null, status);
    else probe.flush(body);

    tick();
    fixture.detectChanges();
  }

  /** Whether the member shell was actually constructed on this navigation. */
  function memberShellRendered(): boolean {
    return fixture.debugElement.query(By.directive(MemberLayout)) !== null;
  }

  it('401 -> /login?returnUrl=/members, and MemberLayout never instantiates', fakeAsync(() => {
    navigateWith('/members/account', null, {
      status: 401,
      statusText: 'Unauthorized',
    });

    // Angular's DefaultUrlSerializer percent-encodes the slash in a query
    // value; `/login?returnUrl=%2Fmembers` is the same destination.
    expect(router.url).toBe('/login?returnUrl=%2Fmembers');
    // The guard sits on the parent of a `loadChildren` route, so a denial has
    // to stop the member chunk from ever resolving. If this element existed,
    // the shell would have rendered for a visitor with no session at all.
    expect(memberShellRendered()).toBe(false);
    expect(store.context()).toBeNull();
  }));

  it('{ entitled: false } -> /pricing, NOT /login, and no shell', fakeAsync(() => {
    navigateWith('/members/account', {
      entitled: false,
      cohorts: [],
      isAdmin: false,
    });

    // R7.7: a logged-in non-member is shown how to buy. Sending them to /login
    // would tell someone who IS signed in that they are not.
    expect(router.url).toBe('/pricing');
    expect(router.url).not.toContain('/login');
    expect(memberShellRendered()).toBe(false);
    expect(store.context()).toBeNull();
  }));

  it('{ entitled: true } -> the panel renders and the store is seeded', fakeAsync(() => {
    const body: MemberEntitlementResponse = {
      entitled: true,
      cohorts: [{ key: 'builders', name: 'Builders Lounge' }],
      isAdmin: false,
    };

    navigateWith('/members/account', body);

    expect(router.url).toBe('/members/account');
    expect(memberShellRendered()).toBe(true);
    // Seeded by the guard BEFORE the shell read it — the chip below the nav
    // renders from this on first paint, with no second request.
    expect(store.context()).toEqual(body);
    expect(store.primaryCohortName()).toBe('Builders Lounge');
  }));

  /**
   * ⚠️ RULE 2. The post-login default sends an admin to `/admin`. It is a
   * LANDING PREFERENCE and nothing more — no guard, no redirect, no route rule
   * may act on `isAdmin` during navigation. An admin who types `/members`, or
   * clicks the Member Panel link in the admin sidebar, has asked for the member
   * panel and must get it. If any of the three below ever go red, the member
   * panel has become unreachable for every admin, including whoever is testing
   * it.
   */
  describe('an admin is NEVER bounced out of /members (rule 2)', () => {
    const entitledAdmin: MemberEntitlementResponse = {
      entitled: true,
      cohorts: [],
      isAdmin: true,
    };

    it('`/members` — the admin sidebar link target — resolves to the hub, not /admin', fakeAsync(() => {
      navigateWith('/members', entitledAdmin);

      // The hub is the one member surface that fetches on activation. Answering
      // it with a failure keeps this test about ROUTING: HubPage degrades to its
      // error state either way, and the assertions below are about where the
      // admin ended up, not what was on the page.
      httpMock
        .expectOne('/api/v1/members/hub')
        .flush(null, { status: 500, statusText: 'Server Error' });
      tick();
      fixture.detectChanges();

      expect(router.url).toBe('/members/hub');
      expect(router.url).not.toContain('/admin');
      expect(memberShellRendered()).toBe(true);
    }));

    it('a deep member URL is preserved too', fakeAsync(() => {
      navigateWith('/members/account', entitledAdmin);

      expect(router.url).toBe('/members/account');
      expect(memberShellRendered()).toBe(true);
      expect(store.isAdmin()).toBe(true);
    }));

    it('a FETCHING member surface is not bounced either', fakeAsync(() => {
      // ⚠️ 🔴 THIS CASE HAS NOW BEEN CHASED ACROSS THREE BATCHES, AND BATCH 15
      // STOPPED IT RUNNING. It began on `/members/live/replays`; Batch 13 made
      // that a fetching surface and moved the case to `/members/packs`; Batch 15
      // made `/members/packs` a fetching surface too. Its own comment offered
      // the two repairs — move it again, or ANSWER THE REQUEST the way the
      // `/members` case above does — and this is the second one.
      //
      // Moving it a third time was not available and would have been wrong
      // anyway: EVERY member surface now fetches on activation, so there is no
      // third destination, and "a surface with no activation fetch" had become
      // a category with no members. Chasing it would have deferred the problem
      // to a batch that could not solve it.
      //
      // ⚠️ THE ASSERTION IS NOT WEAKENED — it is about the GUARD, not about the
      // absence of data. The request is answered with a FAILURE, exactly as the
      // `/members` case does, precisely because the page's own rendering is not
      // this spec's subject: `PacksPage` degrades to its error cell either way,
      // and what is asserted below is where the admin ended up.
      navigateWith('/members/packs', entitledAdmin);

      httpMock
        .expectOne('/api/v1/members/packs')
        .flush(null, { status: 500, statusText: 'Server Error' });
      tick();
      fixture.detectChanges();

      expect(router.url).toBe('/members/packs');
      expect(router.url).not.toContain('/admin');
      expect(memberShellRendered()).toBe(true);
    }));

    it('an admin with NO entitlement still goes to /pricing, not /admin', fakeAsync(() => {
      // The founder's account: admin, free `community` license. The guard turns
      // on entitlement alone (R7.4), so admin-ness must not rescue this
      // navigation any more than it may redirect the previous two.
      navigateWith('/members/hub', {
        entitled: false,
        cohorts: [],
        isAdmin: true,
      });

      expect(router.url).toBe('/pricing');
      expect(memberShellRendered()).toBe(false);
      expect(store.context()).toBeNull();
    }));
  });

  it('runs the probe exactly once per navigation (not twice)', fakeAsync(() => {
    // The guard used to be declared on BOTH `/members` and `MEMBER_ROUTES[0]`
    // would be the obvious mis-merge of this change, and it would double every
    // member navigation's probe traffic silently. `httpMock.verify()` in
    // afterEach fails on a second outstanding request; `expectOne` inside
    // `navigateWith` fails if two are already queued.
    navigateWith('/members/account', {
      entitled: true,
      cohorts: [],
      isAdmin: false,
    });

    httpMock.expectNone(PROBE_URL);
  }));
});
