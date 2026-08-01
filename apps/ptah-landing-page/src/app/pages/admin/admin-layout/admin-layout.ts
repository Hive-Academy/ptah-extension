import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ChevronDown, LucideAngularModule } from 'lucide-angular';

import { AuthService } from '@ptah-web/core';
import { ADMIN_NAV_GROUPS, type AdminNavGroup } from './admin-nav.config';

/**
 * AdminLayout — DaisyUI drawer shell for the native admin dashboard.
 *
 * Renders a fixed, task-oriented grouped sidebar (design spec §2) driven by
 * `ADMIN_NAV_GROUPS` plus a top bar with the current admin's email. The main
 * content area hosts `<router-outlet />` for the `/admin/*` children.
 *
 * The sidebar tiers items into primary (bespoke, high-frequency — icon +
 * always visible) and secondary (utility — indented, hidden when the group's
 * disclosure is collapsed). Groups with a single always-visible item render
 * flat (no disclosure).
 *
 * Security posture: the `AdminAuthGuard` has already probed the backend before
 * this component activates, so we assume the current user IS an admin. The
 * email display is informational only — no authorization logic here.
 */
@Component({
  selector: 'ptah-admin-layout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    LucideAngularModule,
    NgTemplateOutlet,
  ],
  templateUrl: './admin-layout.html',
  styleUrls: ['./admin-layout.css'],
})
export class AdminLayout {
  private readonly auth = inject(AuthService);

  /** Task-oriented nav groups — order drives visual order. */
  protected readonly navGroups = ADMIN_NAV_GROUPS;

  protected readonly ChevronDownIcon = ChevronDown;

  /**
   * Active-state class strings, tiered per §2.3. Kept as full literals so
   * Tailwind's content scanner preserves every modifier.
   */
  protected readonly primaryActiveClass =
    'bg-amber-500/10 text-amber-400 font-semibold border-l-2 border-amber-500 -ml-0.5 pl-3';
  protected readonly secondaryActiveClass =
    'bg-base-300 text-amber-400 font-medium';

  /** Group labels whose secondary-item disclosure is currently collapsed. */
  private readonly collapsedGroups = signal<ReadonlySet<string>>(new Set());

  /** Current admin email for the top bar. Populated from AuthService. */
  protected readonly currentEmail = signal<string | null>(null);

  public constructor() {
    this.auth.getCurrentUser().subscribe((user) => {
      this.currentEmail.set(user?.email ?? null);
    });
  }

  /** Whether a group has any secondary (collapsible) items. */
  protected hasSecondary(group: AdminNavGroup): boolean {
    return !group.flat && group.items.some((i) => !i.primary);
  }

  protected isCollapsed(label: string): boolean {
    return this.collapsedGroups().has(label);
  }

  protected toggleGroup(label: string): void {
    const next = new Set(this.collapsedGroups());
    if (next.has(label)) next.delete(label);
    else next.add(label);
    this.collapsedGroups.set(next);
  }
}
