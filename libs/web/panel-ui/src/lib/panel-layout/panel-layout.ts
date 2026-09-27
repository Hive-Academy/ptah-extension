import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  signal,
} from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslocoPipe } from '@ptah-extension/i18n';
import { ChevronDown, LucideAngularModule } from 'lucide-angular';

import { LanguageSwitch } from '../language-switch/language-switch';
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
 *   `[panelTopBar]`       — end side of the header (identity, actions)
 *   `[panelSidebarFooter]`— pinned below the nav (user card, membership badge)
 *
 * i18n: `title`, `badgeLabel` and every nav label arrive ALREADY TRANSLATED by
 * the owning shell (`members`, `admin`); this component never translates them
 * (plan Component 5, rule 4). It translates only its own chrome (`panelUi.*`)
 * and renders the shared {@link LanguageSwitch} at the end of the top bar.
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
    TranslocoPipe,
    LanguageSwitch,
  ],
  templateUrl: './panel-layout.html',
  styleUrls: ['./panel-layout.css'],
})
export class PanelLayout {
  /**
   * Task-oriented nav groups, labels already translated. Array order drives
   * visual order.
   *
   * ⚠️ CONTRACT: collapse state is keyed by GROUP INDEX, not by label,
   * because labels are translated and change with the language (a label key
   * would silently expand every group on a switch). So the owning shell must:
   * - keep the group ORDER stable while the shell is mounted: translate
   *   labels in place, never reorder, insert or remove a group mid-array;
   * - add any conditional group only at the END, and make it `flat` (flat
   *   groups have no collapse state). Appending or dropping a trailing flat
   *   group leaves every other group's index, and so its collapse state,
   *   untouched. Both shells do exactly this: `MemberLayout` appends
   *   `MEMBER_ADMIN_NAV_GROUP`, `AdminLayout` appends `ADMIN_MEMBER_NAV_GROUP`.
   */
  public readonly navGroups = input.required<readonly PanelNavGroup[]>();

  /** daisyUI theme applied to the shell root via `data-theme`. */
  public readonly theme = input<string>('operator-admin');

  /** Header title, already translated by the owning shell. */
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
   * cannot see built at runtime. The rail is logical (`border-s`, `-ms`, `ps`)
   * so it sits on the reading-start edge in both directions.
   */
  protected readonly primaryActiveClass =
    'bg-primary/10 text-primary font-semibold border-s-2 border-primary -ms-0.5 ps-3';
  protected readonly secondaryActiveClass =
    'bg-surface-high text-primary font-medium';

  /**
   * Indexes (into `navGroups`) of the groups whose secondary-item disclosure
   * is collapsed. Keyed by POSITION, not by label: labels arrive translated,
   * so a label key would silently expand every group on a language switch.
   * The nav config is static per shell, so a group's index is stable.
   */
  private readonly collapsedGroups = signal<ReadonlySet<number>>(new Set());

  /** Whether a group has any secondary (collapsible) items. */
  protected hasSecondary(group: PanelNavGroup): boolean {
    return !group.flat && group.items.some((i) => !i.primary);
  }

  protected isCollapsed(index: number): boolean {
    return this.collapsedGroups().has(index);
  }

  protected toggleGroup(index: number): void {
    const next = new Set(this.collapsedGroups());
    if (next.has(index)) next.delete(index);
    else next.add(index);
    this.collapsedGroups.set(next);
  }
}
