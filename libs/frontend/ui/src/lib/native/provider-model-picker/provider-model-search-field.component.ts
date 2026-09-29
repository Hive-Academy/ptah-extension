/**
 * ProviderModelSearchFieldComponent — the type-to-filter model control that
 * {@link ProviderModelPickerComponent} renders in place of its model
 * `<select>` when the host opts in with `[searchable]="true"`.
 *
 * INTERNAL TO THE PICKER. It is deliberately not exported from the barrel:
 * the picker owns the catalogue load, the pinned "not in current catalog"
 * entry and the default-tier sentinel label, and hands this field the
 * already-built option list. The field only filters, renders and reports the
 * chosen id — it injects nothing, so the picker's single-port boundary
 * (`PROVIDER_MODELS_LOADER`) is unchanged.
 *
 * Built on {@link NativeAutocompleteComponent}: the panel, Floating UI
 * positioning, arrow/Home/End/Enter/Escape handling and outside-click close
 * all come from that primitive. The list is filtered in a `computed` and
 * capped at {@link MAX_MODEL_SUGGESTIONS}, so a large catalogue never renders
 * more than that many rows.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';

import { NativeAutocompleteComponent } from '../autocomplete/native-autocomplete.component';

/** One entry of the searchable model list. */
export interface ProviderModelSearchOption {
  /** Model id, or `''` for the "use the provider's default tier" sentinel. */
  readonly id: string;
  /** Rendered label. */
  readonly name: string;
  /**
   * `true` when the catalogue reports tool-use support, `false` when it
   * reports none, `null` when unknown (the sentinel, or a pinned id the
   * catalogue does not know). Only `true` renders a marker — absence of
   * evidence is not rendered as a negative claim.
   */
  readonly supportsToolUse: boolean | null;
}

/** Upper bound on rendered suggestions (restores the old #34 behaviour). */
export const MAX_MODEL_SUGGESTIONS = 50;

/** Per-instance suffix for the combobox's `aria-controls` target. */
let nextPopupId = 0;

@Component({
  selector: 'ptah-provider-model-search-field',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NativeAutocompleteComponent],
  template: `
    <ptah-native-autocomplete
      #autocomplete
      [attr.id]="popupId"
      [suggestions]="suggestions()"
      [isOpen]="open()"
      [ariaLabel]="listAriaLabel()"
      [emptyMessage]="emptyMessage"
      [trackBy]="trackById"
      [suggestionTemplate]="optionTemplate"
      (suggestionSelected)="choose($event)"
      (closed)="close()"
    >
      <div autocompleteInput class="relative">
        <svg
          class="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-base-content-muted"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          role="combobox"
          aria-autocomplete="list"
          autocomplete="off"
          class="input input-bordered input-sm w-full pl-7"
          data-testid="provider-model-picker-search"
          [value]="displayValue()"
          [placeholder]="selectedLabel()"
          [disabled]="disabled()"
          [attr.aria-label]="ariaLabel()"
          [attr.aria-expanded]="open()"
          [attr.aria-controls]="popupId"
          [attr.aria-activedescendant]="
            open() ? autocomplete.getActiveDescendantId() : null
          "
          (focus)="openPanel()"
          (click)="openPanel()"
          (input)="onInput($event)"
          (keydown)="onKeyDown($event, autocomplete)"
        />
      </div>
    </ptah-native-autocomplete>

    <ng-template #optionTemplate let-option>
      <span class="flex min-w-0 items-center justify-between gap-2 text-sm">
        <span class="truncate">{{ option.name }}</span>
        @if (option.supportsToolUse === true) {
          <span
            class="badge badge-xs shrink-0 border-success/20 bg-success/10 text-success"
            data-testid="provider-model-picker-tooluse-marker"
            >Tool use</span
          >
        }
      </span>
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class ProviderModelSearchFieldComponent {
  /** Catalogue options, already including any pinned out-of-catalogue id. */
  readonly options = input<readonly ProviderModelSearchOption[]>([]);

  /** Label of the `''` sentinel, e.g. "Default (active provider's haiku tier)". */
  readonly defaultLabel = input<string>('Default');

  /** Currently selected model id (`''` = the sentinel). */
  readonly selectedId = input<string>('');

  /** Disables the input (catalogue loading or whole-control disabled). */
  readonly disabled = input<boolean>(false);

  /** Accessible name of the combobox. */
  readonly ariaLabel = input<string>('Model');

  /** Fires with the chosen id when the user picks a different entry. */
  readonly modelSelected = output<string>();

  protected readonly emptyMessage = 'No models match';

  /**
   * `aria-controls` target. `NativeAutocompleteComponent` does not let a host
   * set an id on its listbox, so this names the autocomplete element that
   * contains it — unique per field so several pickers on one page do not
   * collide.
   */
  protected readonly popupId = `ptah-provider-model-search-${nextPopupId++}`;

  protected readonly trackById = (
    _index: number,
    option: ProviderModelSearchOption,
  ): string => option.id;

  private readonly _query = signal<string>('');
  private readonly _open = signal<boolean>(false);

  protected readonly open = this._open.asReadonly();

  protected readonly listAriaLabel = computed(
    () => `${this.ariaLabel()} suggestions`,
  );

  /** The sentinel first, then the catalogue — the same order as the select. */
  private readonly allOptions = computed<readonly ProviderModelSearchOption[]>(
    () => [
      { id: '', name: this.defaultLabel(), supportsToolUse: null },
      ...this.options(),
    ],
  );

  /** Case-insensitive name/id match, capped at {@link MAX_MODEL_SUGGESTIONS}. */
  protected readonly suggestions = computed<ProviderModelSearchOption[]>(() => {
    const query = this._query().trim().toLowerCase();
    const all = this.allOptions();
    const matches = query
      ? all.filter(
          (o) =>
            o.name.toLowerCase().includes(query) ||
            (o.id !== '' && o.id.toLowerCase().includes(query)),
        )
      : all;
    return matches.slice(0, MAX_MODEL_SUGGESTIONS);
  });

  /** What the closed field shows: the current selection's label. */
  protected readonly selectedLabel = computed<string>(() => {
    const id = this.selectedId();
    return this.allOptions().find((o) => o.id === id)?.name ?? id;
  });

  protected readonly displayValue = computed<string>(() =>
    this._open() ? this._query() : this.selectedLabel(),
  );

  protected openPanel(): void {
    if (this.disabled() || this._open()) return;
    this._query.set('');
    this._open.set(true);
  }

  protected close(): void {
    this._open.set(false);
    this._query.set('');
  }

  protected onInput(event: Event): void {
    this._query.set((event.target as HTMLInputElement).value);
    this._open.set(true);
  }

  protected onKeyDown(
    event: KeyboardEvent,
    autocomplete: NativeAutocompleteComponent<ProviderModelSearchOption>,
  ): void {
    if (!this._open()) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.openPanel();
      }
      return;
    }
    if (event.key === 'Tab') {
      this.close();
      return;
    }
    if (autocomplete.onKeyDown(event)) event.preventDefault();
  }

  protected choose(option: ProviderModelSearchOption): void {
    this.close();
    if (option.id !== this.selectedId()) this.modelSelected.emit(option.id);
  }
}
