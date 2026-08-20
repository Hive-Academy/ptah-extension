import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';

import type { MemberEntitlementResponse } from '@ptah-contracts/community';
import { MEMBER_ENTITLEMENT_URL, MemberSessionStore } from '@ptah-web/core';

import { AuthPageComponent } from './auth-page.component';
import { AuthApiService } from './services/auth-api.service';

/**
 * Post-login routing — where a successful sign-in actually lands.
 *
 * ⚠️ RULE 1 IS THE ONE THAT BREAKS SOMETHING IF IT REGRESSES. `MemberGuard`
 * bounces an unauthenticated visitor to `/login?returnUrl=%2Fmembers`; if the
 * admin default were ever allowed to override that, an admin who tried to open
 * the member panel would be sent to `/admin` instead and the member panel would
 * become unreachable for exactly the people who maintain it. The assertion below
 * is therefore the strongest available form: with a `returnUrl` present the
 * entitlement probe is not merely ignored, it is never issued at all.
 *
 * The template is overridden away because this suite is about the navigation
 * decision, not the split-screen layout — the hero panel pulls GSAP viewport
 * animations in behind it and none of that is under test here.
 */
describe('AuthPageComponent — post-login destination', () => {
  let fixture: ComponentFixture<AuthPageComponent>;
  let httpMock: HttpTestingController;
  let navigate: jest.SpyInstance;
  let store: MemberSessionStore;

  /** Query params the component reads once, in `ngOnInit`. */
  function configure(queryParams: Record<string, string>): void {
    const queryParamMap = {
      get: (key: string): string | null => queryParams[key] ?? null,
    };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { routeConfig: { path: 'login' }, queryParamMap },
          },
        },
        {
          provide: AuthApiService,
          useValue: {
            loginWithEmail: () => of({ success: true }),
          },
        },
      ],
    });

    TestBed.overrideTemplate(AuthPageComponent, '');

    httpMock = TestBed.inject(HttpTestingController);
    store = TestBed.inject(MemberSessionStore);
    navigate = jest
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);

    fixture = TestBed.createComponent(AuthPageComponent);
    fixture.detectChanges();
  }

  /** Signs in, then answers the entitlement probe if one was issued. */
  function signInAndResolve(body: MemberEntitlementResponse | null): void {
    fixture.componentInstance.handleFormSubmit({
      email: 'operator@example.com',
      password: 'correct horse battery staple',
    });
    if (body) httpMock.expectOne(MEMBER_ENTITLEMENT_URL).flush(body);
  }

  afterEach(() => {
    httpMock.verify();
    store.clear();
    localStorage.clear();
    jest.restoreAllMocks();
  });

  describe('RULE 1 — an explicit returnUrl always wins', () => {
    it('?returnUrl=/members lands on /members, and never probes for a default', () => {
      configure({ returnUrl: '/members' });
      signInAndResolve(null);

      expect(navigate).toHaveBeenCalledWith(['/members'], { queryParams: {} });
      expect(navigate).not.toHaveBeenCalledWith(['/admin']);
      // The probe is not just overruled — it is never issued. A `returnUrl` is
      // an explicit request and no identity lookup can change the answer.
      httpMock.expectNone(MEMBER_ENTITLEMENT_URL);
    });

    it('an ADMIN arriving with ?returnUrl=/members still lands on /members', () => {
      // The concrete regression this guards: MemberGuard's 401 path sets exactly
      // this returnUrl, and the person following it is an admin. Admin-ness is
      // made unambiguously visible to anything that might read it, so a future
      // "helpful" short-circuit off the store fails here rather than in a
      // browser.
      configure({ returnUrl: '/members' });
      store.set({ entitled: true, cohorts: [], isAdmin: true });
      signInAndResolve(null);

      expect(navigate).toHaveBeenCalledWith(['/members'], { queryParams: {} });
      expect(navigate).not.toHaveBeenCalledWith(['/admin']);
      httpMock.expectNone(MEMBER_ENTITLEMENT_URL);
    });

    it('a returnUrl to any other page is equally untouched by the admin default', () => {
      configure({ returnUrl: '/pricing', plan: 'builders' });
      signInAndResolve(null);

      expect(navigate).toHaveBeenCalledWith(['/pricing'], {
        queryParams: { autoCheckout: 'builders' },
      });
      httpMock.expectNone(MEMBER_ENTITLEMENT_URL);
    });
  });

  describe('RULE 3 — with no returnUrl, admin wins over member', () => {
    it('an admin who is also an entitled member lands on /admin', () => {
      configure({});
      signInAndResolve({ entitled: true, cohorts: [], isAdmin: true });

      expect(navigate).toHaveBeenCalledWith(['/admin']);
      expect(navigate).not.toHaveBeenCalledWith(['/members']);
      // ...and the member session is seeded on the way through, so the admin
      // sidebar's Member Panel link is visible on the page they just landed on.
      expect(store.entitled()).toBe(true);
    });

    it('an admin with no entitlement lands on /admin', () => {
      configure({});
      signInAndResolve({ entitled: false, cohorts: [], isAdmin: true });

      expect(navigate).toHaveBeenCalledWith(['/admin']);
      // Admin-ness carries no entitlement with it (R7.4).
      expect(store.entitled()).toBe(false);
    });

    it('an entitled non-admin lands on /members', () => {
      configure({});
      signInAndResolve({ entitled: true, cohorts: [], isAdmin: false });

      expect(navigate).toHaveBeenCalledWith(['/members']);
      expect(navigate).not.toHaveBeenCalledWith(['/admin']);
    });

    it('everyone else keeps the pre-existing /profile default', () => {
      configure({});
      signInAndResolve({ entitled: false, cohorts: [], isAdmin: false });

      expect(navigate).toHaveBeenCalledWith(['/profile']);
    });

    it('a failed probe falls back to /profile rather than stranding the visitor', () => {
      configure({});
      fixture.componentInstance.handleFormSubmit({
        email: 'operator@example.com',
        password: 'correct horse battery staple',
      });
      httpMock
        .expectOne(MEMBER_ENTITLEMENT_URL)
        .flush(null, { status: 500, statusText: 'Server Error' });

      expect(navigate).toHaveBeenCalledWith(['/profile']);
    });
  });
});
