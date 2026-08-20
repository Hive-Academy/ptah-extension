import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import {
  Inbox,
  LucideAngularModule,
  type LucideIconData,
} from 'lucide-angular';

/**
 * EmptyState — shared "nothing here" placeholder for the admin dashboard.
 *
 * Presentational (design spec §7.5): centered muted icon + one-line message,
 * an optional secondary hint line, and an optional action projected via
 * `<ng-content>` (e.g. a "Clear filters" or "New record" button). Replaces
 * the ad-hoc `No records.` text rows scattered across the admin surface.
 *
 * Usage:
 *   <ptah-empty-state
 *     [icon]="PartyPopperIcon"
 *     message="Nobody's waiting — you're caught up">
 *     <button class="btn btn-sm btn-primary">Invite more</button>
 *   </ptah-empty-state>
 */
@Component({
  selector: 'ptah-empty-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  templateUrl: './empty-state.html',
})
export class EmptyState {
  /** Leading icon (lucide). Defaults to a neutral inbox glyph. */
  public readonly icon = input<LucideIconData>(Inbox);

  /** Primary one-line message. */
  public readonly message = input<string>('Nothing here yet.');

  /** Optional secondary/help line rendered under the message. */
  public readonly hint = input<string | null>(null);
}
