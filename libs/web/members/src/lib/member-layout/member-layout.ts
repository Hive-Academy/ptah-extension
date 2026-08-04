import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, ShieldCheck } from 'lucide-angular';

import { AuthService, MemberSessionStore } from '@ptah-web/core';
import type { PanelNavGroup } from '@ptah-web/panel-ui';
import { PanelLayout } from '@ptah-web/panel-ui';

import {
  MEMBER_ADMIN_NAV_GROUP,
  MEMBER_NAV_GROUPS,
} from '../member-nav.config';
import { MemberThemeService } from '../services/member-theme.service';
import { MemberThemeToggle } from './member-theme-toggle';

/**
 * MemberLayout — binds the member panel's nav data, theme and identity onto the
 * shared {@link PanelLayout} shell.
 *
 * ⚠️ THERE IS NO SECOND SHELL (R9.1). The drawer, the grouped sidebar, the
 * primary/secondary tiering, the per-group collapse and the active-route
 * highlight all live in `@ptah-web/panel-ui` and are shared byte-for-byte with
 * `/admin`. What is member-specific and therefore lives here: which nav groups
 * to show, which of the two member themes is active, and the signed-in member's
 * identity. If this file ever needs something the shell cannot express, the
 * capability is added to `panel-ui` so the admin panel gets it too — it is not
 * reimplemented here (plan §5.3).
 *
 * `drawerId="member-drawer"` is deliberately distinct from the admin's
 * `admin-drawer` (`panel-layout.ts:61-65`) so the two checkbox-driven drawers
 * can never collide.
 *
 * Security posture: `MemberGuard` has already probed the backend before this
 * component activates. Everything rendered here is informational; authorization
 * is enforced server-side (NFR-S8).
 */
@Component({
  selector: 'ptah-member-layout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PanelLayout, LucideAngularModule, RouterLink, MemberThemeToggle],
  templateUrl: './member-layout.html',
})
export class MemberLayout {
  private readonly auth = inject(AuthService);
  private readonly session = inject(MemberSessionStore);

  /**
   * Read here only to bind `[theme]` onto the shell root. The control that
   * CHANGES it is {@link MemberThemeToggle}, projected into the top bar — the
   * layout does not also own a copy of the switching logic.
   */
  protected readonly theme = inject(MemberThemeService);

  protected readonly ShieldCheckIcon = ShieldCheck;

  /**
   * Task-oriented nav groups — array order drives visual order.
   *
   * ⚠️ THIS COMPUTED IS THE ONE PLACE THE MEMBER NAV IS RESHAPED (R9.3).
   * `member-nav.config.ts` stays static data; every condition that changes the
   * SHAPE of the sidebar belongs here, rebuilding the array. Batch 15's
   * Notifications `badgeCount` is committed to the same mechanism — see the
   * warning above `MEMBER_NAV_GROUPS` — so the two must not diverge into a
   * computed for one and a config function for the other.
   *
   * The Admin escape hatch appears only for an admin. `isAdmin` is refreshed by
   * `MemberGuard` on every `/members/*` activation, so it is already correct
   * before this shell first renders and never needs a probe of its own.
   */
  protected readonly navGroups = computed<readonly PanelNavGroup[]>(() =>
    this.session.isAdmin()
      ? [...MEMBER_NAV_GROUPS, MEMBER_ADMIN_NAV_GROUP]
      : MEMBER_NAV_GROUPS,
  );

  /** Cohort chips, `[]` for an entitled member with no assignment (R7.8). */
  protected readonly cohorts = this.session.cohorts;

  /**
   * Chip beside the panel title. `null` when the member holds no cohort, which
   * is the correct live default — inventing a placeholder label there would
   * claim a cohort membership the member does not have.
   */
  protected readonly cohortLabel = this.session.primaryCohortName;

  protected readonly isAdmin = this.session.isAdmin;

  /** Current member email for the top bar. Populated from AuthService. */
  protected readonly currentEmail = signal<string | null>(null);

  public constructor() {
    this.auth.getCurrentUser().subscribe((user) => {
      this.currentEmail.set(user?.email ?? null);
    });
  }
}
