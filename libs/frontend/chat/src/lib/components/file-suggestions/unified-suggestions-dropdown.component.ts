import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  viewChild,
  viewChildren,
} from '@angular/core';
import {
  FloatingUIService,
  KeyboardNavigationService,
} from '@ptah-extension/ui';
import {
  SuggestionOptionComponent,
  type SuggestionItem,
} from './suggestion-option.component';

// Re-export for consumers
export type { SuggestionItem } from './suggestion-option.component';

/**
 * UnifiedSuggestionsDropdownComponent - Autocomplete UI with Native Floating UI
 *
 * ARCHITECTURE:
 * - Uses Floating UI for positioning (replaces CDK Overlay)
 * - Uses KeyboardNavigationService for signal-based navigation (replaces ActiveDescendantKeyManager)
 * - Options receive isActive as INPUT (not via Highlightable interface)
 * - Filter input INSIDE dropdown (Batch 13) - focus stays on filter input
 * - Supports file and command types via discriminated union
 * - Agents handled by dedicated AgentSelectorComponent
 *
 * KEYBOARD NAVIGATION:
 * - KeyboardNavigationService manages activeIndex signal
 * - Active state passed to options via [isActive]="i === activeIndex()"
 * - ArrowUp/ArrowDown/Home/End navigates the list
 * - Enter selects focused suggestion, Escape closes dropdown
 *
 * ACCESSIBILITY:
 * - role="listbox" on container
 * - role="option" on each item (via SuggestionOptionComponent)
 * - aria-activedescendant points to currently focused option
 *
 * MIGRATION NOTE (TASK_2025_092 Batch 4):
 * - Replaced CDK Overlay with Floating UI
 * - Replaced ActiveDescendantKeyManager with KeyboardNavigationService
 * - Options now receive isActive as input signal, not via setActiveStyles()
 * - This fixes the signal dependency loop causing VS Code webview hang
 */
@Component({
  selector: 'ptah-unified-suggestions-dropdown',
  standalone: true,
  imports: [SuggestionOptionComponent],
  providers: [FloatingUIService, KeyboardNavigationService],
  template: `
    <!-- Panel positioned by Floating UI relative to overlayOrigin -->
    <div
      #floatingPanel
      [id]="listboxId"
      class="suggestions-panel flex flex-col max-h-96 shadow-lg bg-base-200 rounded-lg border border-base-300 z-50 overflow-hidden"
      style="visibility: hidden; position: absolute;"
      role="listbox"
      [attr.aria-label]="getHeaderTitle()"
    >
      <!-- Header -->
      <div class="px-2 py-1.5 border-b border-base-300">
        <span
          class="text-[11px] font-semibold text-base-content/70 uppercase tracking-wide"
        >
          {{ getHeaderTitle() }}
        </span>
      </div>

      <!-- Loading State -->
      @if (isLoading()) {
      <div class="flex items-center justify-center gap-2 p-3">
        <span class="loading loading-spinner loading-xs"></span>
        <span class="text-xs text-base-content/70">Loading...</span>
      </div>
      }

      <!-- Empty State -->
      @else if (suggestions().length === 0) {
      <div class="flex items-center justify-center p-3">
        <span class="text-xs text-base-content/60">No matches found</span>
      </div>
      }

      <!-- Suggestions List -->
      @else {
      <div class="flex flex-col overflow-y-auto overflow-x-hidden max-h-64 p-1">
        @for ( suggestion of suggestions(); track trackBy($index, suggestion);
        let i = $index ) {
        <ptah-suggestion-option
          [suggestion]="suggestion"
          [optionId]="'suggestion-' + i"
          [isActive]="i === activeIndex()"
          (selected)="handleSelection($event)"
          (hovered)="handleHover(i)"
        />
        }
      </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnifiedSuggestionsDropdownComponent implements OnDestroy {
  private readonly floatingUI = inject(FloatingUIService);
  private readonly keyboardNav = inject(KeyboardNavigationService);

  // Inputs
  readonly overlayOrigin = input.required<{ elementRef: ElementRef }>(); // Origin element (textarea) from parent
  readonly suggestions = input.required<SuggestionItem[]>();
  readonly isLoading = input(false);

  // Outputs
  readonly suggestionSelected = output<SuggestionItem>();
  readonly closed = output<void>();

  // ViewChild for floating panel
  private readonly floatingPanel =
    viewChild<ElementRef<HTMLElement>>('floatingPanel');

  // ViewChildren for option components (for scroll into view)
  private readonly optionComponents = viewChildren(SuggestionOptionComponent);

  // Expose activeIndex from keyboard navigation service
  readonly activeIndex = this.keyboardNav.activeIndex;

  // Unique ID for the listbox element (used by aria-controls on parent input)
  readonly listboxId = `suggestions-listbox-${Math.random()
    .toString(36)
    .substring(2, 9)}`;

  constructor() {
    // Configure keyboard navigation when suggestions change
    effect(() => {
      const count = this.suggestions().length;
      this.keyboardNav.configure({ itemCount: count, wrap: true });
    });

    // Position panel relative to origin
    effect(() => {
      const panel = this.floatingPanel()?.nativeElement;
      const origin = this.overlayOrigin()?.elementRef?.nativeElement;

      if (panel && origin) {
        // Position using Floating UI
        queueMicrotask(() => this.positionPanel());
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

  ngOnDestroy(): void {
    this.floatingUI.cleanup();
  }

  /**
   * Position the floating panel relative to the origin element
   */
  private async positionPanel(): Promise<void> {
    const panel = this.floatingPanel()?.nativeElement;
    const origin = this.overlayOrigin()?.elementRef?.nativeElement;

    if (panel && origin) {
      // Set width to match origin
      panel.style.width = `${origin.offsetWidth}px`;

      await this.floatingUI.position(origin, panel, {
        placement: 'top-start', // Above textarea (chat input at bottom of sidebar)
        offset: 4,
        flip: true,
        shift: true,
      });
    }
  }

  /**
   * Get the currently active option's ID for aria-activedescendant
   * Parent component should bind this to the input's aria-activedescendant
   */
  getActiveDescendantId(): string | null {
    const index = this.activeIndex();
    return index >= 0 ? `suggestion-${index}` : null;
  }

  /**
   * Get header title based on suggestion types
   */
  getHeaderTitle(): string {
    const suggestions = this.suggestions();
    if (suggestions.length === 0) return 'Suggestions';

    const firstType = suggestions[0]?.type;
    if (firstType === 'file') return 'Files & Folders';
    if (firstType === 'command') return 'Slash Commands';
    return 'Suggestions';
  }

  // ============================================================
  // PUBLIC API - Called by parent component for keyboard navigation
  // ============================================================

  /**
   * Handle keyboard events from parent component
   *
   * CRITICAL: Must return FALSE when not ready to handle events.
   * This signals to the parent that the event was NOT handled, allowing
   * fallback behavior (e.g., normal textarea cursor movement).
   *
   * @param event KeyboardEvent from parent
   * @returns true if event was handled, false if not ready to handle
   */
  onKeyDown(event: KeyboardEvent): boolean {
    // Don't handle if loading
    if (this.isLoading()) {
      return false;
    }

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Home':
      case 'End':
        // Navigate options list - keyboardNav handles the navigation
        return this.keyboardNav.handleKeyDown(event);

      case 'Enter':
        this.selectFocused();
        return true;

      case 'Escape':
        this.closed.emit();
        return true;

      default:
        return false;
    }
  }

  /**
   * Navigate to next item (ArrowDown)
   */
  navigateDown(): void {
    this.keyboardNav.setNext();
  }

  /**
   * Navigate to previous item (ArrowUp)
   */
  navigateUp(): void {
    this.keyboardNav.setPrevious();
  }

  /**
   * Select currently focused item (Enter)
   */
  selectFocused(): void {
    const index = this.activeIndex();
    const suggestions = this.suggestions();
    if (index >= 0 && index < suggestions.length) {
      this.suggestionSelected.emit(suggestions[index]);
    }
  }

  /**
   * Reset to first item
   */
  resetFocus(): void {
    this.keyboardNav.setFirstItemActive();
  }

  /**
   * Handle mouse hover on option
   */
  handleHover(index: number): void {
    this.keyboardNav.setActiveIndex(index);
  }

  /**
   * Handle selection via click
   */
  handleSelection(suggestion: SuggestionItem): void {
    this.suggestionSelected.emit(suggestion);
  }

  trackBy(index: number, item: SuggestionItem): string {
    if (item.type === 'file') return `file-${item.path}`;
    return `${item.type}-${item.name}`;
  }
}
