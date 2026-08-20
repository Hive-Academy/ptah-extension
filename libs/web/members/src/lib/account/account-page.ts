import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  ExternalLink,
  LogOut,
  LucideAngularModule,
  Moon,
  ShieldCheck,
  Sun,
} from 'lucide-angular';

import { AuthService, MemberSessionStore } from '@ptah-web/core';
import { EmptyState } from '@ptah-web/panel-ui';

import {
  MEMBER_THEME_DARK,
  MEMBER_THEME_LIGHT,
  MemberThemeService,
} from '../services/member-theme.service';

/**
 * AccountPage — `/members/account`.
 *
 * Everything here is already resolved: identity comes from `AuthService`,
 * entitlement and cohorts from the `MemberSessionStore` the guard seeded on
 * this navigation, and the theme from `MemberThemeService`. So this page issues
 * NO request of its own beyond the `auth/me` call `AuthService` already caches
 * for the shell.
 *
 * Billing deliberately links out to `/profile` rather than duplicating the
 * subscription surface. There is one place a subscription is managed and this
 * is not it; a second copy would drift the day the first one changes.
 */
@Component({
  selector: 'ptah-account-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule, EmptyState],
  template: `
    <div class="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <h1 class="text-2xl font-bold tracking-tight text-base-content">
          Account
        </h1>
        <p class="mt-1 text-sm text-base-content-muted">
          Your Ptah Builders membership and panel preferences.
        </p>
      </header>

      <section
        class="rounded-xl border border-hairline bg-base-200"
        aria-labelledby="account-identity"
      >
        <h2
          id="account-identity"
          class="border-b border-hairline px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-base-content-muted"
        >
          Identity
        </h2>
        <dl class="flex flex-col gap-3 p-4">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <dt class="text-sm text-base-content-muted">Email</dt>
            <dd class="font-mono text-sm text-base-content">
              {{ email() ?? 'Not available' }}
            </dd>
          </div>
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <dt class="text-sm text-base-content-muted">Cohorts</dt>
            <dd class="flex flex-wrap justify-end gap-1">
              @for (cohort of cohorts(); track cohort.key) {
                <span class="badge badge-primary badge-sm">
                  {{ cohort.name }}
                </span>
              } @empty {
                <span
                  class="badge badge-ghost badge-sm text-base-content-muted"
                >
                  No cohort assigned
                </span>
              }
            </dd>
          </div>
          @if (isAdmin()) {
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <dt class="text-sm text-base-content-muted">Staff</dt>
              <dd>
                <span
                  class="badge badge-outline badge-sm gap-1 text-base-content-muted"
                >
                  <lucide-angular
                    [img]="ShieldCheckIcon"
                    class="h-3 w-3"
                    aria-hidden="true"
                  />
                  Administrator
                </span>
              </dd>
            </div>
          }
        </dl>
      </section>

      @if (cohorts().length === 0) {
        <!--
          Not an error, and not hidden. An entitled member with no
          MemberGroupAssignment sees every member-visibility surface and no
          cohort-gated one (R7.8, A-2). Saying so is better than an unexplained
          absence of cohort-only content later.
        -->
        <div class="rounded-xl border border-hairline bg-base-200">
          <ptah-empty-state
            message="You are not in a cohort yet."
            hint="Your membership is fully active. Cohort-only sessions and content unlock when you are assigned to one."
          />
        </div>
      }

      <section
        class="rounded-xl border border-hairline bg-base-200"
        aria-labelledby="account-appearance"
      >
        <h2
          id="account-appearance"
          class="border-b border-hairline px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-base-content-muted"
        >
          Appearance
        </h2>
        <div class="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p class="text-sm text-base-content">Panel theme</p>
            <p class="text-xs text-base-content-muted">
              Saved on this device only.
            </p>
          </div>
          <div class="join">
            <button
              type="button"
              class="btn join-item btn-sm gap-2"
              [class.btn-primary]="theme.isDark()"
              [attr.aria-pressed]="theme.isDark()"
              (click)="theme.setTheme(DARK)"
            >
              <lucide-angular
                [img]="MoonIcon"
                class="h-4 w-4"
                aria-hidden="true"
              />
              Dark
            </button>
            <button
              type="button"
              class="btn join-item btn-sm gap-2"
              [class.btn-primary]="!theme.isDark()"
              [attr.aria-pressed]="!theme.isDark()"
              (click)="theme.setTheme(LIGHT)"
            >
              <lucide-angular
                [img]="SunIcon"
                class="h-4 w-4"
                aria-hidden="true"
              />
              Light
            </button>
          </div>
        </div>
      </section>

      <section
        class="rounded-xl border border-hairline bg-base-200"
        aria-labelledby="account-billing"
      >
        <h2
          id="account-billing"
          class="border-b border-hairline px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-base-content-muted"
        >
          Billing and profile
        </h2>
        <div class="flex flex-wrap items-center justify-between gap-3 p-4">
          <p class="text-sm text-base-content-muted">
            Subscription, invoices and profile details are managed in one place.
          </p>
          <a href="/profile" class="btn btn-sm gap-2">
            Open profile
            <lucide-angular
              [img]="ExternalLinkIcon"
              class="h-4 w-4"
              aria-hidden="true"
            />
          </a>
        </div>
      </section>

      <div class="flex justify-end">
        <button
          type="button"
          class="btn btn-ghost btn-sm gap-2 text-base-content-muted"
          [disabled]="signingOut()"
          (click)="signOut()"
        >
          <lucide-angular
            [img]="LogOutIcon"
            class="h-4 w-4"
            aria-hidden="true"
          />
          Sign out
        </button>
      </div>
    </div>
  `,
})
export class AccountPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly session = inject(MemberSessionStore);

  protected readonly theme = inject(MemberThemeService);

  protected readonly DARK = MEMBER_THEME_DARK;
  protected readonly LIGHT = MEMBER_THEME_LIGHT;

  protected readonly ShieldCheckIcon = ShieldCheck;
  protected readonly ExternalLinkIcon = ExternalLink;
  protected readonly LogOutIcon = LogOut;
  protected readonly SunIcon = Sun;
  protected readonly MoonIcon = Moon;

  protected readonly cohorts = this.session.cohorts;
  protected readonly isAdmin = this.session.isAdmin;

  protected readonly email = signal<string | null>(null);
  protected readonly signingOut = signal(false);

  public constructor() {
    this.auth.getCurrentUser().subscribe((user) => {
      this.email.set(user?.email ?? null);
    });
  }

  protected signOut(): void {
    this.signingOut.set(true);
    this.auth.logout().subscribe({
      next: () => this.leave(),
      // A failed logout call still has to clear the local session view —
      // leaving a member on a panel they believe they signed out of is worse
      // than a stale cookie the server will reject on the next request anyway.
      error: () => this.leave(),
    });
  }

  private leave(): void {
    this.session.clear();
    this.signingOut.set(false);
    void this.router.navigate(['/']);
  }
}
