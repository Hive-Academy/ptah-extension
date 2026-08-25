import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LucideAngularModule, Moon, Sun } from 'lucide-angular';

import { MemberThemeService } from '../services/member-theme.service';

/**
 * MemberThemeToggle — the one visible control that switches the member panel
 * between `operator-member` and `operator-member-light` (R9.6).
 *
 * ⚠️ IT OWNS NO STATE AND NO PERSISTENCE. Every decision — which theme is
 * active, what the label says, where the preference is stored — belongs to
 * {@link MemberThemeService}, which already reads and writes the single
 * `ptah.members.theme` key. This component is the affordance, nothing more. A
 * second storage key or a `class="dark"` side effect here would give the panel
 * two sources of truth about one preference.
 *
 * ⚠️ IT IS NOT IN `@ptah-web/panel-ui`, ON PURPOSE (plan §5.3). A capability
 * moves into the shared shell when a second panel would plausibly render it,
 * and the admin panel is deliberately dark-only — `member-theme.service.ts`
 * namespaces its storage key precisely so an admin toggle, if one is ever
 * added, cannot inherit a member's light preference. A shared primitive would
 * therefore need the service injected out into inputs and outputs to serve a
 * consumer that does not exist. It stays private until one does.
 *
 * Accessibility (audited again in B15):
 * - A real `<button type="button">`, so it is in the tab order and responds to
 *   Enter and Space with no key handling of our own. It is NOT a `<div>` with
 *   a click listener and not a bare icon.
 * - The accessible name describes the DESTINATION ("Switch to light theme"),
 *   which is what a screen-reader user needs before activating it; announcing
 *   the current state instead leaves them guessing what the click does.
 * - The visible caption is a substring of that name (WCAG 2.5.3, Label in
 *   Name), so speech input matches what is on screen. See
 *   `MemberThemeService.destinationLabel`.
 * - The icon is `aria-hidden` — it repeats the caption and would otherwise be
 *   announced twice.
 * - `btn btn-sm` gives a 2rem hit target and daisyUI's focus-visible ring;
 *   the caption collapses below `sm` where the top bar is tight, and the
 *   `aria-label` carries the name on its own there.
 *
 * Surfaces follow `docs/design-system/panel-theme-spec.md`: it sits on the
 * `base-200` header, takes the same `border-hairline` boundary every other
 * edge in the panel takes, and lifts to `surface-high` on hover. No `base-300`
 * border — that token is a fill and is invisible at 1.036:1 against a card.
 */
@Component({
  selector: 'ptah-member-theme-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  template: `
    <button
      type="button"
      class="btn btn-sm gap-2 border border-hairline bg-base-200 font-medium text-base-content-muted hover:bg-surface-high hover:text-base-content"
      [attr.aria-label]="theme.toggleLabel()"
      [title]="theme.toggleLabel()"
      (click)="theme.toggle()"
    >
      <lucide-angular
        [img]="theme.isDark() ? SunIcon : MoonIcon"
        class="h-4 w-4"
        aria-hidden="true"
      />
      <span class="hidden sm:inline">{{ theme.destinationLabel() }}</span>
    </button>
  `,
})
export class MemberThemeToggle {
  protected readonly theme = inject(MemberThemeService);

  /** Shows where the click LEADS: a sun when dark is active, and vice versa. */
  protected readonly SunIcon = Sun;
  protected readonly MoonIcon = Moon;
}
