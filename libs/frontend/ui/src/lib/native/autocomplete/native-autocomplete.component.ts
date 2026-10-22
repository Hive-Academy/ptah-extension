/**
 * NativeAutocompleteComponent - Native Autocomplete with Floating UI
 *
 * Input-triggered autocomplete that replaces CDK-based AutocompleteComponent.
 * Uses FloatingUIService for positioning and KeyboardNavigationService for navigation.
 *
 * Key differences from CDK AutocompleteComponent:
 * - No CDK Overlay (uses Floating UI for positioning)
 * - No ActiveDescendantKeyManager (uses KeyboardNavigationService signals)
 * - Active state passed as input to options, not managed by Highlightable interface
 * - Services provided at component level (not root)
 *
 * @example
 * ```typescript
 * <ptah-native-autocomplete
 *   [suggestions]="suggestions()"
 *   [isLoading]="isLoading()"
 *   [isOpen]="isOpen()"
 *   [suggestionTemplate]="suggestionTemplate"
 *   (suggestionSelected)="onSelect($event)"
 *   (closed)="onClose()">
 *
 *   <input type="text" autocompleteInput />
 * </ptah-native-autocomplete>
 *
 * <ng-template #suggestionTemplate let-suggestion>
 *   <div class="flex items-center gap-2">
 *     <span>{{ suggestion.icon }}</span>
 *     <span>{{ suggestion.name }}</span>
 *   </div>
 * </ng-template>
 * ```
 */
import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  viewChild,
  viewChildren,
  effect,
  computed,
  signal,
  untracked,
  OnDestroy,
  TemplateRef,
  ElementRef,
  inject,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { NativeOptionComponent } from '../option/native-option.component';
import {
  AUTOCOMPLETE_OVERLAY_OFFSET,
  FloatingUIService,
  KeyboardNavigationService,
} from '../shared';

/**
 * Monotonic counter backing the per-instance generated defaults of
 * {@link NativeAutocompleteComponent.optionIdPrefix} and
 * {@link NativeAutocompleteComponent.listboxId}. Each default advances it,
 * so it climbs by two per instance; the suffix is not an instance count.
 */
let nextAutocompleteInstanceId = 0;

/** A field-matched panel may grow past its field up to this width for longer rows (28rem). */
const MATCHED_PANEL_MAX_PX = 448;

/** Bound the initial placement so suggestions cannot remain invisible. */
export const AUTOCOMPLETE_POSITION_TIMEOUT_MS = 1000;

/**
 * Native autocomplete component using Floating UI and signal-based navigation.
 *
 * Designed to work in VS Code webview environments where CDK Overlay
 * has sandboxing conflicts. Provides the same API as AutocompleteComponent
 * for easy migration.
 *
 * Provider pattern: Services provided at component level for isolation.
 * Each autocomplete instance gets its own positioning and navigation state.
 */
@Component({
  selector: 'ptah-native-autocomplete',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NativeOptionComponent, NgTemplateOutlet],
  providers: [FloatingUIService, KeyboardNavigationService],
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'onEscapeKey()',
  },
  template: `
    <div #inputOrigin class="autocomplete-input">
      <ng-content select="[autocompleteInput]" />
    </div>

    @if (isOpen()) {
      <div #layerRef popover="manual" class="ptah-autocomplete-layer">
      <div
        #floatingPanel
        class="suggestions-panel surface-3 z-50 max-h-80 flex flex-col rounded-xl p-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]"
        style="visibility: hidden;"
        role="listbox"
        [attr.id]="listboxId()"
        [attr.aria-label]="ariaLabel()"
      >
        <!-- Header -->
        @if (headerTitle()) {
          <div class="px-3 py-2 border-b border-surface-border">
            <span
              class="text-xs font-semibold text-base-content-muted uppercase tracking-wide"
            >
              {{ headerTitle() }}
            </span>
          </div>
        }

        <!-- Loading State -->
        @if (isLoading()) {
          <div class="flex items-center justify-center gap-3 p-4">
            <span class="loading loading-spinner loading-sm"></span>
            <span class="text-sm text-base-content-muted">Loading...</span>
          </div>
        }

        <!-- Empty State -->
        @else if (suggestions().length === 0) {
          <div class="flex items-center justify-center p-4">
            <span class="text-sm text-base-content-muted">{{
              emptyMessage()
            }}</span>
          </div>
        }

        <!-- Suggestions List -->
        @else {
          <div class="flex flex-col overflow-y-auto overflow-x-hidden">
            @for (
              suggestion of suggestions();
              track trackBy()($index, suggestion);
              let i = $index
            ) {
              <ptah-native-option
                [class.!px-2]="compact()"
                [class.!py-1]="compact()"
                [optionId]="optionIdPrefix() + '-' + i"
                [value]="suggestion"
                [isActive]="i === activeIndex()"
                (selected)="handleSelection($event)"
                (hovered)="handleHover(i)"
              >
                <ng-container
                  *ngTemplateOutlet="
                    suggestionTemplate();
                    context: { $implicit: suggestion }
                  "
                />
              </ptah-native-option>
            }
          </div>
        }
      </div>
      </div>
    }
  `,
  styles: [`
    .ptah-autocomplete-layer {
      position: fixed;
      inset: 0;
      /* In-page fallback (no Popover API): keep the shell above sibling panes. */
      z-index: 50;
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      max-width: none;
      max-height: none;
      margin: 0;
      border: 0;
      padding: 0;
      overflow: visible;
      background: transparent;
      color: inherit;
      box-shadow: none;
      pointer-events: none;
    }
    .ptah-autocomplete-layer::backdrop {
      background: transparent !important;
      pointer-events: none !important;
    }
    .ptah-autocomplete-layer > .suggestions-panel {
      pointer-events: auto;
    }
  `],
})
export class NativeAutocompleteComponent<T = unknown> implements OnDestroy {
  private readonly floatingUI = inject(FloatingUIService);
  private readonly keyboardNav = inject(KeyboardNavigationService);

  /**
   * Array of suggestions to display.
   * Required input - empty array shows empty state message.
   */
  readonly suggestions = input.required<T[]>();

  /**
   * Whether suggestions are currently being loaded.
   * Shows loading spinner when true.
   */
  readonly isLoading = input<boolean>(false);

  /**
   * Whether the autocomplete panel is open.
   * Parent controls visibility via this input.
   */
  readonly isOpen = input.required<boolean>();

  /**
   * Optional header title shown above suggestions.
   * Useful for categorization (e.g., "Files", "Commands").
   */
  readonly headerTitle = input<string>('');

  /**
   * ARIA label for the suggestions listbox.
   * @default 'Suggestions'
   */
  readonly ariaLabel = input<string>('Suggestions');

  /**
   * Message shown when suggestions array is empty.
   * @default 'No matches found'
   */
  readonly emptyMessage = input<string>('No matches found');

  /**
   * Prefix for the option element ids inside the listbox.
   * Each rendered option gets `{prefix}-{index}` as its DOM id, and
   * getActiveDescendantId() reports the same value for aria-activedescendant.
   * Defaults to a per-instance generated value so two autocompletes on one
   * page never produce colliding ids.
   */
  readonly optionIdPrefix = input<string>(
    `ptah-native-autocomplete-option-${nextAutocompleteInstanceId++}`,
  );

  /**
   * DOM id of the listbox panel element.
   * Consumers bind their input's aria-controls to this value so it points at
   * the listbox itself. Defaults to a per-instance generated value.
   */
  readonly listboxId = input<string>(
    `ptah-native-autocomplete-listbox-${nextAutocompleteInstanceId++}`,
  );

  /**
   * List index to mark active when the panel opens: the index of the selected
   * suggestion, `-1` for no active row, or `null` to reset to the first row.
   * Without this, the keyboard-active row survives a close/reopen cycle and
   * Enter picks a row the user never navigated to. The requested state holds
   * only until the suggestion list changes (the user types): a changed list
   * makes its first row active, including after a `-1` open.
   * @default null
   */
  readonly openActiveIndex = input<number | null>(null);

  /**
   * Track function for @for loop optimization.
   * @default (index) => index
   */
  readonly trackBy = input<(index: number, item: T) => unknown>(
    (i: number) => i,
  );

  /**
   * Template for rendering each suggestion.
   * Receives suggestion as $implicit context.
   */
  readonly suggestionTemplate = input.required<TemplateRef<{ $implicit: T }>>();

  /**
   * Opt-in: the panel is at least as wide as the projected input, so it reads as that field's own list (TASK_2026_555
   * Batch 30; Batch 53.3 made it a minimum). Longer content may widen it up to `MATCHED_PANEL_MAX_PX` (or the field,
   * if wider). Off by default: the panel sizes to its content, as before.
   */
  readonly matchInputWidth = input<boolean>(false);

  /** Opt-in: denser rows (`px-2 py-1` instead of `px-3 py-2`) for a compact list. Off by default. */
  readonly compact = input<boolean>(false);

  /**
   * Emitted when a suggestion is selected (click or Enter key).
   * Parent should handle insertion logic.
   */
  readonly suggestionSelected = output<T>();

  /**
   * Emitted when panel should close (Escape key or selection).
   * Parent should update isOpen to false.
   */
  readonly closed = output<void>();

  /**
   * Reference to the input container element.
   * Used as anchor point for Floating UI positioning.
   */
  private readonly inputOrigin =
    viewChild<ElementRef<HTMLElement>>('inputOrigin');

  /**
   * Whether the panel was open on the previous effect run.
   * Gates the reopen reset to the false→true transition only.
   */
  private panelWasOpen = false;
  private readonly layerRef = viewChild<ElementRef<HTMLElement>>('layerRef');
  private layerElement: HTMLElement | null = null;
  private layerShowing = false;
  private destroyed = false;
  private openGeneration = 0;
  private positionTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * True while the panel intentionally shows no active row
   * (openActiveIndex `-1` on open). Keyboard navigation, hover, or a changed
   * suggestion list (the user typed) clears it.
   */
  private readonly _noActiveItem = signal<boolean>(false);

  /**
   * Current active index from keyboard navigation service.
   * Used to determine which option should be highlighted.
   */
  readonly activeIndex = computed<number>(() =>
    this._noActiveItem() ? -1 : this.keyboardNav.activeIndex(),
  );

  /**
   * Reference to the floating suggestions panel.
   * Positioned relative to inputOrigin using Floating UI.
   */
  private readonly floatingPanel =
    viewChild<ElementRef<HTMLElement>>('floatingPanel');

  /**
   * Query for all NativeOptionComponents.
   * Used to scroll active option into view.
   */
  private readonly optionComponents = viewChildren(NativeOptionComponent);

  constructor() {
    effect(() => {
      const count = this.suggestions().length;
      // A changed suggestion list while the panel is open means the user
      // typed (or the parent re-filtered): the first match becomes the
      // active row, so Enter never stays inert after a suppressed reopen.
      // applyOpenActiveIndex() re-applies the open contract after this
      // effect when the change lands on the same tick as the open.
      this._noActiveItem.set(false);
      this.keyboardNav.configure({ itemCount: count, wrap: true });
    });
    effect(() => {
      const open = this.isOpen();
      const generation = ++this.openGeneration;
      if (open) {
        if (!this.panelWasOpen) {
          untracked(() => this.applyOpenActiveIndex());
        }
        queueMicrotask(() => {
          if (!this.destroyed && this.isOpen() && generation === this.openGeneration) {
            void this.positionPanel(generation);
          }
        });
      } else {
        this.clearPositionTimer();
        this.hideLayer();
        this.floatingUI.cleanup();
      }
      this.panelWasOpen = open;
    });
    effect(() => {
      const index = this.activeIndex();
      const options = this.optionComponents();
      if (index >= 0 && index < options.length) {
        options[index].scrollIntoView();
      }
    });
  }

  /**
   * Position the floating panel relative to the input.
   * Uses Floating UI for viewport-aware positioning with flip/shift.
   */
  private async positionPanel(generation: number): Promise<void> {
    const origin = this.inputOrigin()?.nativeElement;
    const panel = this.floatingPanel()?.nativeElement;
    if (!origin || !panel) return;

    this.showLayer();
    if (this.matchInputWidth()) {
      const width = origin.getBoundingClientRect().width;
      panel.style.minWidth = `${width}px`;
      panel.style.maxWidth = `${Math.max(width, MATCHED_PANEL_MAX_PX)}px`;
    }
    this.clearPositionTimer();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), AUTOCOMPLETE_POSITION_TIMEOUT_MS);
      this.positionTimer = timer;
    });
    let positioned = false;
    try {
      positioned = await Promise.race([
        this.floatingUI.position(origin, panel, {
          placement: 'bottom-start',
          offset: AUTOCOMPLETE_OVERLAY_OFFSET,
          flip: true,
          shift: true,
        }).then(() => true),
        timedOut,
      ]);
    } catch {
      // degradation-audit: optional-capability - smart placement failed; reveal below the input.
    } finally {
      if (this.positionTimer === timer) this.clearPositionTimer();
    }
    if (this.destroyed || !this.isOpen() || generation !== this.openGeneration) return;
    if (!positioned) {
      const rect = origin.getBoundingClientRect();
      Object.assign(panel.style, {
        position: 'fixed',
        left: `${rect.left}px`,
        top: `${rect.bottom + AUTOCOMPLETE_OVERLAY_OFFSET}px`,
        visibility: 'visible',
      });
    }
  }

  private clearPositionTimer(): void {
    if (this.positionTimer !== undefined) {
      clearTimeout(this.positionTimer);
      this.positionTimer = undefined;
    }
  }

  private showLayer(): void {
    const layer = this.layerRef()?.nativeElement;
    if (!layer || this.destroyed) return;
    this.layerElement = layer;
    if (this.layerShowing) return;
    if (typeof layer.showPopover === 'function') {
      try {
        layer.showPopover();
        this.layerShowing = true;
        layer.style.display = '';
        return;
      } catch {
        // degradation-audit: optional-capability - promotion refused; keep suggestions visible in-page.
      }
    }
    layer.style.display = 'block';
  }

  private hideLayer(): void {
    const layer = this.layerElement;
    const showing = this.layerShowing;
    this.layerElement = null;
    this.layerShowing = false;
    if (!layer) return;
    layer.style.display = '';
    if (!showing || typeof layer.hidePopover !== 'function') return;
    try {
      layer.hidePopover();
    } catch {
      // degradation-audit: optional-capability - a detached or already hidden shell needs no dismissal.
    }
  }

  /**
   * Apply the reopen contract to a freshly opened panel: point the keyboard
   * active row at openActiveIndex, or reset it when none was requested.
   * `-1` (or an out-of-range index) leaves the panel with no active row.
   */
  private applyOpenActiveIndex(): void {
    const requested = this.openActiveIndex();
    const count = this.suggestions().length;
    const valid = requested !== null && requested >= 0 && requested < count;
    this._noActiveItem.set(requested !== null && !valid);
    if (valid) {
      this.keyboardNav.setActiveIndex(requested);
    } else {
      this.keyboardNav.reset();
    }
  }

  /**
   * Handle arrow/Home/End navigation.
   * From the no-active-row state, ArrowDown enters at the first row and
   * ArrowUp at the last row, mirroring the listbox keyboard pattern.
   */
  private navigateActiveRow(event: KeyboardEvent): boolean {
    if (this._noActiveItem()) {
      this._noActiveItem.set(false);
      if (event.key === 'ArrowDown') {
        this.keyboardNav.setFirstItemActive();
        return true;
      }
      if (event.key === 'ArrowUp') {
        this.keyboardNav.setLastItemActive();
        return true;
      }
    }
    return this.keyboardNav.handleKeyDown(event);
  }

  /**
   * Handle keyboard events from parent component.
   * Returns true if event was handled (caller should preventDefault).
   *
   * Supported keys:
   * - ArrowDown: Move to next suggestion
   * - ArrowUp: Move to previous suggestion
   * - Home: Move to first suggestion
   * - End: Move to last suggestion
   * - Enter: Select active suggestion
   * - Escape: Close panel
   *
   * @param event - Keyboard event from parent's input element
   * @returns True if event was handled
   *
   * @example
   * ```typescript
   * // In parent component
   * onKeyDown(event: KeyboardEvent): void {
   *   if (this.autocomplete().onKeyDown(event)) {
   *     event.preventDefault();
   *   }
   * }
   * ```
   */
  onKeyDown(event: KeyboardEvent): boolean {
    if (this.isLoading()) {
      return false;
    }

    switch (event.key) {
      case 'Enter':
        this.selectFocused();
        return true;

      case 'Escape':
        this.closed.emit();
        return true;

      case 'ArrowDown':
      case 'ArrowUp':
      case 'Home':
      case 'End':
        return this.navigateActiveRow(event);

      default:
        return false;
    }
  }

  /**
   * Select the currently active suggestion.
   * Emits suggestionSelected with the active item.
   * Called internally on Enter key or externally by parent.
   */
  selectFocused(): void {
    const index = this.activeIndex();
    const suggestions = this.suggestions();
    if (index >= 0 && index < suggestions.length) {
      this.suggestionSelected.emit(suggestions[index]);
    }
  }

  /**
   * Handle mouse hover on an option.
   * Updates active index to match hovered option.
   *
   * @param index - Index of the hovered option
   */
  handleHover(index: number): void {
    this._noActiveItem.set(false);
    this.keyboardNav.setActiveIndex(index);
  }

  /**
   * Handle selection event from NativeOptionComponent click.
   * Emits suggestionSelected output.
   *
   * @param suggestion - Selected suggestion value
   */
  handleSelection(suggestion: T): void {
    this.suggestionSelected.emit(suggestion);
  }

  /**
   * Get the ID of the currently active option.
   * Used by parent for aria-activedescendant attribute on input element.
   *
   * @returns Option ID string or null if no active option
   *
   * @example
   * ```html
   * <input
   *   [attr.aria-activedescendant]="autocomplete().getActiveDescendantId()"
   * />
   * ```
   */
  getActiveDescendantId(): string | null {
    const index = this.activeIndex();
    return index >= 0 ? `${this.optionIdPrefix()}-${index}` : null;
  }

  /**
   * Close the panel when clicking outside the input and floating panel.
   * Uses the same pattern as NativeDropdownComponent.
   */
  onDocumentClick(event: MouseEvent): void {
    if (!this.isOpen()) return;

    const target = event.target as HTMLElement;
    const origin = this.inputOrigin()?.nativeElement;
    const panel = this.floatingPanel()?.nativeElement;

    const clickedInside =
      (origin && origin.contains(target)) || (panel && panel.contains(target));

    if (!clickedInside) {
      this.closed.emit();
    }
  }

  /**
   * Close the panel on Escape key press.
   * Handles Escape globally so the parent doesn't need to wire up (keydown).
   */
  onEscapeKey(): void {
    if (this.isOpen()) {
      this.closed.emit();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.openGeneration++;
    this.clearPositionTimer();
    this.hideLayer();
    this.floatingUI.cleanup();
  }
}
