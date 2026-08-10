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
import { MemberNotificationsStore } from '../state/member-notifications.store';
import { MemberThemeToggle } from './member-theme-toggle';

/**
 * The nav item the unread badge attaches to, matched BY ROUTE.
 *
 * ⚠️ BY ROUTE, NOT BY LABEL AND NOT BY INDEX. A label is display copy that a
 * copy edit may change, and an index breaks the moment a group gains an item —
 * both fail SILENTLY, leaving the badge attached to nothing or to the wrong
 * link. The route is the item's identity and is the same string
 * `members.routes.ts` mounts.
 */
const NOTIFICATIONS_ROUTE = '/members/notifications';

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
   * 🔴 THE ONLY READER OF THE UNREAD COUNT IN THE PRODUCT (R9.3).
   *
   * Resolved from the `/members` ROUTE's `providers`, so this is the same
   * instance `NotificationsPage` injects. The layout also OWNS THE POLL's
   * lifetime: it calls `start()` once below, and the store dies with this
   * panel's injector.
   */
  private readonly notifications = inject(MemberNotificationsStore);

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
   * Notifications `badgeCount` is bound through the SAME mechanism — see the
   * warning above `MEMBER_NAV_GROUPS` — so the two have not diverged into a
   * computed for one and a config function for the other.
   *
   * ── 🔴 THE UNREAD BADGE, AND WHY IT IS HERE AND NOWHERE ELSE ─────────────
   * `PanelNavItem.badgeCount` was already declared and `PanelLayout` already
   * renders it in BOTH nav branches. So this task adds NO template and NO
   * primitive: it replaces one item's `badgeCount` inside this existing
   * computed and stops.
   *
   * The alternative — a bespoke chip in `member-layout.html`, or a second
   * `unreadCount()` read inside a page — WOULD ALSO WORK VISUALLY, which is
   * exactly why R9.3 names it. Two things would then claim to be "the unread
   * count" and they would disagree the first time one of them was missed.
   * `member-nav-badge.spec.ts` asserts, over the whole lib, that
   * `unreadCount()` is read in exactly ONE file and that no member template
   * carries a badge class of its own.
   *
   * ⚠️ `MEMBER_NAV_GROUPS` IS `readonly` AND IS NOT MUTATED. Every level is
   * MAPPED to a new object — group, items array, and the one item. Writing
   * `item.badgeCount = n` would leak the count into the module-level constant,
   * where it would survive across components and across tests.
   *
   * ⚠️ `0` IS PASSED, NOT `undefined`. The shell's `@if (item.badgeCount)`
   * already hides a zero, so adding a second falsy check here would be two
   * places deciding when the badge is invisible.
   *
   * The Admin escape hatch appears only for an admin, and COMPOSES with the
   * badge rather than forking from it — `isAdmin` is refreshed by `MemberGuard`
   * on every `/members/*` activation, so it is already correct before this
   * shell first renders and never needs a probe of its own.
   */
  protected readonly navGroups = computed<readonly PanelNavGroup[]>(() => {
    const unread = this.notifications.unreadCount();

    const groups = MEMBER_NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.map((item) =>
        item.route === NOTIFICATIONS_ROUTE
          ? { ...item, badgeCount: unread }
          : item,
      ),
    }));

    return this.session.isAdmin()
      ? [...groups, MEMBER_ADMIN_NAV_GROUP]
      : groups;
  });

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

    // 🔴 THE POLL IS STARTED HERE AND NOWHERE ELSE (R10.5, AD-14, RISK-AM).
    // The layout is the one component guaranteed to exist for exactly as long
    // as the member panel does, so it is the honest owner of a cadence scoped
    // to the panel. The store's constructor deliberately starts nothing, so
    // that injecting it in a test — or from a page — does not begin polling.
    this.notifications.start();
  }
}
