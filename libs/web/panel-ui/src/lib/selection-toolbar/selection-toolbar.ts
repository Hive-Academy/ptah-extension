import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { TranslocoPipe } from '@ptah-extension/i18n';

import { pluralCategory, type PluralI18nKeys } from '../i18n/plural';

/** "1 user selected" / "3 users selected". */
const SELECTION_COUNT_I18N_KEYS = {
  one: 'panelUi.selectionToolbar.countOne',
  other: 'panelUi.selectionToolbar.countOther',
} as const satisfies PluralI18nKeys;

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
  imports: [TranslocoPipe],
  templateUrl: './selection-toolbar.html',
  styleUrls: ['./selection-toolbar.css'],
})
export class SelectionToolbar {
  /** Number of selected items — the bar is hidden entirely when 0. */
  public readonly count = input<number>(0);

  /**
   * Singular noun for the count label ("user" → "3 users selected"), already
   * translated by the caller. `null` uses the shared default
   * (`panelUi.selectionToolbar.item`). Pluralisation lives in the
   * translation values (`countOne` / `countOther`), not in code: English
   * appends "s", Arabic names the noun without plural agreement.
   */
  public readonly itemNoun = input<string | null>(null);

  /** Emitted when the Clear link is pressed. */
  public readonly cleared = output<void>();

  protected readonly countI18nKeys = SELECTION_COUNT_I18N_KEYS;
  protected readonly pluralCategory = pluralCategory;
}
