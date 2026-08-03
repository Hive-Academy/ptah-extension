import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

/**
 * SelectionToolbar — contextual bulk-action bar (design spec §6.1, §8.6).
 *
 * A Gmail-style bar that appears only when rows are selected, replacing the
 * always-visible-but-disabled-until-selected header buttons. Dumb layout
 * shell: it renders the "N selected" count + a Clear link, and projects the
 * model-specific action buttons via `<ng-content>` so the business logic
 * stays in the parent view.
 *
 * Usage:
 *   <ptah-selection-toolbar
 *     [count]="selectedIds().length"
 *     itemNoun="webhook"
 *     (cleared)="clearSelection()">
 *     <button class="btn btn-sm btn-primary">Mark Resolved</button>
 *   </ptah-selection-toolbar>
 */
@Component({
  selector: 'ptah-selection-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './selection-toolbar.html',
  styleUrls: ['./selection-toolbar.css'],
})
export class SelectionToolbar {
  /** Number of selected items — the bar is hidden entirely when 0. */
  public readonly count = input<number>(0);

  /** Singular noun for the count label ("user" → "3 users selected"). */
  public readonly itemNoun = input<string>('item');

  /** Emitted when the Clear link is pressed. */
  public readonly cleared = output<void>();

  protected readonly countLabel = computed<string>(() => {
    const n = this.count();
    const noun = n === 1 ? this.itemNoun() : `${this.itemNoun()}s`;
    return `${n} ${noun} selected`;
  });
}
