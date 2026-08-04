import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';

import { AuthService, MemberSessionStore } from '@ptah-web/core';
import type { PanelNavGroup } from '@ptah-web/panel-ui';
import { PanelLayout } from '@ptah-web/panel-ui';
import { ADMIN_MEMBER_NAV_GROUP, ADMIN_NAV_GROUPS } from './admin-nav.config';

/**
 * AdminLayout — binds the admin dashboard's nav data and identity onto the
 * shared {@link PanelLayout} shell.
 *
 * The drawer, grouped sidebar, primary/secondary tiering, collapse state and
 * active-route highlighting all live in `@ptah-web/panel-ui` now; the member
 * panel mounts the same shell with a different nav array. What stays here is
 * genuinely admin-specific: which groups to show, the `operator-admin` theme,
 * and the signed-in operator's email.
 *
 * Security posture: `AdminAuthGuard` has already probed the backend before
 * this component activates, so we assume the current user IS an admin. The
 * email display is informational only — no authorization logic here.
 */
@Component({
  selector: 'ptah-admin-layout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PanelLayout],
  templateUrl: './admin-layout.html',
})
export class AdminLayout {
  private readonly auth = inject(AuthService);
  private readonly session = inject(MemberSessionStore);

  /**
   * Task-oriented nav groups — order drives visual order.
   *
   * Mirrors `MemberLayout`'s computed: `admin-nav.config.ts` stays static data
   * and the one condition that reshapes the sidebar lives here.
   *
   * The Member Panel escape hatch appears only when the entitlement probe has
   * confirmed a Builders membership for THIS operator — see
   * {@link ADMIN_MEMBER_NAV_GROUP} for why it is gated on entitlement rather
   * than on admin-ness, and for the cold-load case where it is hidden.
   */
  protected readonly navGroups = computed<readonly PanelNavGroup[]>(() =>
    this.session.entitled()
      ? [...ADMIN_NAV_GROUPS, ADMIN_MEMBER_NAV_GROUP]
      : ADMIN_NAV_GROUPS,
  );

  /** Current admin email for the top bar. Populated from AuthService. */
  protected readonly currentEmail = signal<string | null>(null);

  public constructor() {
    this.auth.getCurrentUser().subscribe((user) => {
      this.currentEmail.set(user?.email ?? null);
    });
  }
}
