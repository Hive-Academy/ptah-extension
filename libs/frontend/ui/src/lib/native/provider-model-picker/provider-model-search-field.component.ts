/**
 * ProviderModelSearchFieldComponent — the one-row, type-to-filter model control. The picker
 * ({@link ProviderModelPickerComponent}) renders it in place of its model `<select>` when the host opts in with
 * `[searchable]="true"`; since TASK_2026_555 Batch 28b it is also exported from the barrel as the **compact**
 * searchable model control (no card chrome, no provider row), used where a whole picker card does not fit (the
 * Main Agent popover).
 *
 * The host owns the catalogue and hands this field the already-built option list (the picker: its load, the pinned
 * "not in current catalog" entry and the default-tier label). The field only filters, renders and reports the
 * chosen id — it injects nothing, so the picker's single-port boundary (`PROVIDER_MODELS_LOADER`) is unchanged.
 * Optional, off by default (the picker's output is unchanged): `inputId` (a `<label for>` target),
 * `includeDefault` (hide the `''` sentinel row) and `pinnedOption` (an action row always listed last, never
 * filtered, e.g. "Enter a model ID…").
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

/** Per-instance id root for the combobox's listbox and option ids. */
let nextPopupId = 0;

@Component({
  selector: 'ptah-provider-model-search-field',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NativeAutocompleteComponent],
  template: `
    <ptah-native-autocomplete
      #autocomplete
      [suggestions]="suggestions()"
      [isOpen]="open()"
      [listboxId]="listboxId"
      [optionIdPrefix]="optionIdPrefix"
      [openActiveIndex]="openActiveIndex()"
      [ariaLabel]="listAriaLabel()"
      [emptyMessage]="emptyMessage"
      [trackBy]="trackById"
      [suggestionTemplate]="compact() ? compactOptionTemplate : optionTemplate"
      [compact]="compact()"
      [matchInputWidth]="true"
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
          class="input input-bordered input-sm w-full pl-7 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
          data-testid="provider-model-picker-search"
          [attr.id]="inputId()"
          [value]="displayValue()"
          [placeholder]="placeholder() ?? selectedLabel()"
          [readOnly]="disabled()"
          [attr.aria-disabled]="disabled() ? 'true' : null"
          [attr.aria-label]="ariaLabel()"
          [attr.aria-expanded]="open()"
          [attr.aria-controls]="listboxId"
          [attr.aria-activedescendant]="
            open() ? autocomplete.getActiveDescendantId() : null
          "
          (focus)="openOnFocus() && openPanel()"
          (click)="openPanel()"
          (input)="onInput($event)"
          (keydown)="onKeyDown($event, autocomplete)"
        />
      </div>
    </ptah-native-autocomplete>

    <!-- Compact rows: the id in mono, the catalogue's display name (when it differs) muted after it, and the
         current selection marked with a check. -->
    <ng-template #compactOptionTemplate let-option>
      <span class="flex min-w-0 items-center gap-1.5 text-xs" [attr.data-current]="option.id === selectedId() ? 'true' : null">
        <span class="w-3 shrink-0 text-center" aria-hidden="true">{{ option.id === selectedId() ? '✓' : '' }}</span>
        <span class="truncate" [class.font-mono]="option.id !== '' && option.id !== pinnedOption()?.id">{{ compactLabel(option) }}</span>
        @if (option.id && option.name && option.name !== option.id && option.id !== pinnedOption()?.id) {
          <span class="truncate opacity-70">{{ option.name }}</span>
        }
        @if (option.id === selectedId()) { <span class="sr-only">(current)</span> }
      </span>
    </ng-template>

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

  /**
   * Disables the field (catalogue loading or whole-control disabled). It stays focusable: `aria-disabled` and read-only,
   * never native `disabled`, so a save started from this field never drops focus to the page (Batch 54.1).
   */
  readonly disabled = input<boolean>(false);

  /** Accessible name of the combobox. */
  readonly ariaLabel = input<string>('Model');

  /** `id` of the combobox input, for a host `<label for>`; none by default. */
  readonly inputId = input<string | null>(null);

  /** Lists the `''` sentinel row first (default). A host that cannot save `''` hides it. */
  readonly includeDefault = input<boolean>(true);

  /** An action row always listed last and never filtered out (e.g. "Enter a model ID…"); none by default. */
  readonly pinnedOption = input<ProviderModelSearchOption | null>(null);

  /**
   * Opt-in compact list (TASK_2026_555 Batch 30, the CLI matrix popover): dense `text-xs` rows showing the model id in
   * mono with its display name muted after it, the current one checked, in a list as wide as the field. Off by default.
   */
  readonly compact = input<boolean>(false);

  /**
   * Opens the list when the field takes focus (default). Off (the tier modal, Gate V 36 decision 2): click, typing or
   * ArrowDown open it, so one Esc leaves an enclosing dialog from a focused field whose list is closed.
   */
  readonly openOnFocus = input<boolean>(true);

  /** Placeholder of the open, empty search; `null` (default) shows the current selection's label. */
  readonly placeholder = input<string | null>(null);

  /** Fires with the chosen id when the user picks a different entry. */
  readonly modelSelected = output<string>();

  protected readonly emptyMessage = 'No models match';

  /**
   * Per-instance id root. The listbox id and the option id prefix derive from
   * it, so several fields on one page (tier pickers, matrix cells) never
   * produce colliding DOM ids or cross-instance aria pairings.
   */
  protected readonly popupId = `ptah-provider-model-search-${nextPopupId++}`;

  /** `aria-controls` target: the listbox panel inside this field's autocomplete. */
  protected readonly listboxId = `${this.popupId}-listbox`;

  /** Prefix for this field's option element ids. */
  protected readonly optionIdPrefix = `${this.popupId}-option`;

  /**
   * Row the autocomplete marks active when the panel opens: the current
   * selection's row, or `-1` when the selection is not in the list, so a
   * stale keyboard row never survives a close/reopen cycle.
   */
  protected readonly openActiveIndex = computed<number>(() =>
    this.suggestions().findIndex((option) => option.id === this.selectedId()),
  );

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
      ...(this.includeDefault()
        ? [{ id: '', name: this.defaultLabel(), supportsToolUse: null }]
        : []),
      ...this.options(),
    ],
  );

  /**
   * Case-insensitive name/id match, capped at {@link MAX_MODEL_SUGGESTIONS};
   * the pinned action row, if any, always follows.
   */
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
    const pinned = this.pinnedOption();
    return [
      ...matches.slice(0, MAX_MODEL_SUGGESTIONS),
      ...(pinned ? [pinned] : []),
    ];
  });

  /**
   * What the closed field shows: the current selection's label. In compact mode it matches the compact rows (the id;
   * the sentinel keeps its label), so a saved id the catalogue lacks shows the id, not the host's hint name.
   */
  protected readonly selectedLabel = computed<string>(() => {
    const id = this.selectedId();
    const option = this.allOptions().find((o) => o.id === id);
    if (!option) return id;
    return this.compact() ? this.compactLabel(option) : option.name;
  });

  protected readonly displayValue = computed<string>(() =>
    this._open() ? this._query() : this.selectedLabel(),
  );

  /** Compact rows lead with the id; the sentinel and the pinned action row keep their label. */
  protected compactLabel(option: ProviderModelSearchOption): string {
    return option.id === '' || option.id === this.pinnedOption()?.id ? option.name : option.id;
  }

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
    if (this.disabled()) return;
    this._query.set((event.target as HTMLInputElement).value);
    this._open.set(true);
  }

  protected onKeyDown(
    event: KeyboardEvent,
    autocomplete: NativeAutocompleteComponent<ProviderModelSearchOption>,
  ): void {
    // Disabled (a save runs, or the list is loading): the field keeps focus, so Esc still reaches an enclosing popover
    // or drawer, but nothing opens or changes (TASK_2026_555 Batch 54.1).
    if (this.disabled()) return;
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
    // Esc closes the open list only: it must not also reach an enclosing
    // popover or drawer, which close on the same key (the next Esc does).
    if (event.key === 'Escape') event.stopPropagation();
    if (autocomplete.onKeyDown(event)) event.preventDefault();
  }

  protected choose(option: ProviderModelSearchOption): void {
    this.close();
    if (option.id !== this.selectedId()) this.modelSelected.emit(option.id);
  }
}
