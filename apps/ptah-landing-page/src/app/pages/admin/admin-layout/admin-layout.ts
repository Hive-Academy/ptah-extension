import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AuthService } from '../../../services/auth.service';
import { ADMIN_MODEL_SPECS } from '../admin-models.config';

/**
 * AdminLayout — DaisyUI drawer shell for the native admin dashboard.
 *
 * Renders a fixed sidebar listing every `AdminModelSpec` plus a top bar with
 * the current admin's email. The main content area hosts `<router-outlet />`
 * for the `/admin/:model` and `/admin/:model/:id` children.
 *
 * Security posture: the `AdminAuthGuard` has already probed the backend
 * before this component activates, so we can assume the current user IS an
 * admin. The email display is informational only — no authorization logic.
 */
@Component({
  selector: 'ptah-admin-layout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './admin-layout.html',
  styleUrls: ['./admin-layout.css'],
})
export class AdminLayout {
  private readonly auth = inject(AuthService);

  /** Sidebar items — order drives visual order. */
  protected readonly specs = ADMIN_MODEL_SPECS;

  /** Current admin email for the top bar. Populated from AuthService. */
  protected readonly currentEmail = signal<string | null>(null);

  public constructor() {
    // Fire-and-forget fetch: fill the top-bar label once `/api/auth/me`
    // resolves. Guard already proved the user is authenticated, so we only
    // treat errors as "hide the label" (no redirect).
    this.auth.getCurrentUser().subscribe((user) => {
      this.currentEmail.set(user?.email ?? null);
    });
  }
}
