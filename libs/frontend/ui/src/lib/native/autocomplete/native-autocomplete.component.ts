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
  OnDestroy,
  TemplateRef,
  ElementRef,
  inject,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { NativeOptionComponent } from '../option/native-option.component';
import { FloatingUIService, KeyboardNavigationService } from '../shared';

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
  template: `
    <div #inputOrigin class="autocomplete-input">
      <ng-content select="[autocompleteInput]" />
    </div>

    @if (isOpen()) {
    <div
      #floatingPanel
      class="suggestions-panel bg-base-200 border border-base-300 rounded-lg shadow-lg max-h-80 flex flex-col z-50"
      style="visibility: hidden;"
      role="listbox"
      [attr.aria-label]="ariaLabel()"
    >
      <!-- Header -->
      @if (headerTitle()) {
      <div class="px-3 py-2 border-b border-base-300">
        <span
          class="text-xs font-semibold text-base-content/70 uppercase tracking-wide"
        >
          {{ headerTitle() }}
        </span>
      </div>
      }

      <!-- Loading State -->
      @if (isLoading()) {
      <div class="flex items-center justify-center gap-3 p-4">
        <span class="loading loading-spinner loading-sm"></span>
        <span class="text-sm text-base-content/70">Loading...</span>
      </div>
      }

      <!-- Empty State -->
      @else if (suggestions().length === 0) {
      <div class="flex items-center justify-center p-4">
        <span class="text-sm text-base-content/60">{{ emptyMessage() }}</span>
      </div>
      }

      <!-- Suggestions List -->
      @else {
      <div class="flex flex-col overflow-y-auto overflow-x-hidden p-1">
        @for (suggestion of suggestions(); track trackBy()($index, suggestion);
        let i = $index) {
        <ptah-native-option
          [optionId]="'suggestion-' + i"
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
    }
  `,
})
export class NativeAutocompleteComponent<T = unknown> implements OnDestroy {
  private readonly floatingUI = inject(FloatingUIService);
  private readonly keyboardNav = inject(KeyboardNavigationService);

  // ============================================================
  // INPUTS
  // ============================================================

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
   * Track function for @for loop optimization.
   * @default (index) => index
   */
  readonly trackBy = input<(index: number, item: T) => unknown>(
    (i: number) => i
  );

  /**
   * Template for rendering each suggestion.
   * Receives suggestion as $implicit context.
   */
  readonly suggestionTemplate = input.required<TemplateRef<{ $implicit: T }>>();

  // ============================================================
  // OUTPUTS
  // ============================================================

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

  // ============================================================
  // VIEW REFERENCES
  // ============================================================

  /**
   * Reference to the input container element.
   * Used as anchor point for Floating UI positioning.
   */
  private readonly inputOrigin =
    viewChild<ElementRef<HTMLElement>>('inputOrigin');

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

  // ============================================================
  // SIGNALS FROM KEYBOARD NAVIGATION SERVICE
  // ============================================================

  /**
   * Current active index from keyboard navigation service.
   * Used to determine which option should be highlighted.
   */
  readonly activeIndex = this.keyboardNav.activeIndex;

  constructor() {
    // Configure keyboard navigation when suggestions change
    effect(() => {
      const count = this.suggestions().length;
      this.keyboardNav.configure({ itemCount: count, wrap: true });
    });

    // Position panel when opened, cleanup when closed
    effect(() => {
      if (this.isOpen()) {
        // Defer positioning to next microtask to ensure DOM is ready
        queueMicrotask(() => this.positionPanel());
      } else {
        this.floatingUI.cleanup();
      }
    });

    // Scroll active option into view when activeIndex changes
    effect(() => {
      const index = this.activeIndex();
      const options = this.optionComponents();
      if (index >= 0 && index < options.length) {
        options[index].scrollIntoView();
      }
    });
  }

  // ============================================================
  // POSITIONING
  // ============================================================

  /**
   * Position the floating panel relative to the input.
   * Uses Floating UI for viewport-aware positioning with flip/shift.
   */
  private async positionPanel(): Promise<void> {
    const origin = this.inputOrigin()?.nativeElement;
    const panel = this.floatingPanel()?.nativeElement;

    if (origin && panel) {
      await this.floatingUI.position(origin, panel, {
        placement: 'bottom-start',
        offset: 4,
        flip: true,
        shift: true,
      });
    }
  }

  // ============================================================
  // PUBLIC API - Called by parent for keyboard integration
  // ============================================================

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
        return this.keyboardNav.handleKeyDown(event);

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
    return index >= 0 ? `suggestion-${index}` : null;
  }

  // ============================================================
  // LIFECYCLE
  // ============================================================

  ngOnDestroy(): void {
    this.floatingUI.cleanup();
  }
}
