import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';

import { AuthService } from '@ptah-web/core';
import { PanelLayout } from '@ptah-web/panel-ui';
import { ADMIN_NAV_GROUPS } from './admin-nav.config';

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

  /** Task-oriented nav groups — order drives visual order. */
  protected readonly navGroups = ADMIN_NAV_GROUPS;

  /** Current admin email for the top bar. Populated from AuthService. */
  protected readonly currentEmail = signal<string | null>(null);

  public constructor() {
    this.auth.getCurrentUser().subscribe((user) => {
      this.currentEmail.set(user?.email ?? null);
    });
  }
}
