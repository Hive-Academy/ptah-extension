import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ChevronDown, LucideAngularModule } from 'lucide-angular';

import type { PanelNavGroup } from '../panel-nav.types';

/**
 * PanelLayout — the drawer shell behind every authenticated panel.
 *
 * Generalised out of the admin dashboard's `AdminLayout`, which was already
 * config-driven: a `PanelNavGroup[]` drove the grouped sidebar, the two-tier
 * primary/secondary treatment, per-group collapse, and the active highlight.
 * Nothing in it was admin-specific except the nav array, the page title and
 * the theme name — so those became inputs and the rest is shared verbatim.
 *
 * Deliberately dumb: no auth, no data fetching, no route knowledge. The host
 * supplies nav config and projects its own top-bar content. Authorization is
 * enforced server-side; a shell must never imply otherwise.
 *
 * Projection slots:
 *   `[panelTopBar]`       — right side of the header (identity, actions)
 *   `[panelSidebarFooter]`— pinned below the nav (user card, membership badge)
 */
@Component({
  selector: 'ptah-panel-layout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    LucideAngularModule,
    NgTemplateOutlet,
  ],
  templateUrl: './panel-layout.html',
  styleUrls: ['./panel-layout.css'],
})
export class PanelLayout {
  /** Task-oriented nav groups — array order drives visual order. */
  public readonly navGroups = input.required<readonly PanelNavGroup[]>();

  /** daisyUI theme applied to the shell root via `data-theme`. */
  public readonly theme = input<string>('operator-admin');

  /** Header title. */
  public readonly title = input<string>('');

  /** Optional chip beside the title (e.g. "Restricted", "Founding"). */
  public readonly badgeLabel = input<string | null>(null);

  /** daisyUI modifier for `badgeLabel`. Literal strings for the scanner. */
  public readonly badgeClass = input<string>('badge-warning');

  /**
   * Unique id tying the drawer checkbox to its labels. Distinct per panel so
   * two shells can never collide if both are ever mounted.
   */
  public readonly drawerId = input<string>('panel-drawer');

  protected readonly ChevronDownIcon = ChevronDown;

  /**
   * Active-state class strings, kept as full literals so Tailwind's content
   * scanner preserves every modifier rather than tree-shaking a name it
   * cannot see built at runtime.
   */
  protected readonly primaryActiveClass =
    'bg-primary/10 text-primary font-semibold border-l-2 border-primary -ml-0.5 pl-3';
  protected readonly secondaryActiveClass =
    'bg-surface-high text-primary font-medium';

  /** Group labels whose secondary-item disclosure is currently collapsed. */
  private readonly collapsedGroups = signal<ReadonlySet<string>>(new Set());

  protected readonly menuLabel = computed(
    () => `Open ${this.title() || 'panel'} menu`,
  );

  /** Whether a group has any secondary (collapsible) items. */
  protected hasSecondary(group: PanelNavGroup): boolean {
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
