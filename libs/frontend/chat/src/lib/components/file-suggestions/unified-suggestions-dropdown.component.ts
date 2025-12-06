import {
  Component,
  input,
  output,
  signal,
  computed,
  effect,
  viewChildren,
  ChangeDetectionStrategy,
  AfterViewInit,
  OnDestroy,
} from '@angular/core';
import { ActiveDescendantKeyManager } from '@angular/cdk/a11y';
import {
  SuggestionOptionComponent,
  type SuggestionItem,
} from './suggestion-option.component';

// Re-export for consumers
export type { SuggestionItem } from './suggestion-option.component';

/**
 * UnifiedSuggestionsDropdownComponent - Autocomplete UI with CDK A11y
 *
 * ARCHITECTURE:
 * - Uses ActiveDescendantKeyManager for keyboard navigation
 * - Focus stays on parent textarea (aria-activedescendant pattern)
 * - Supports file and command types via discriminated union
 * - Agents handled by dedicated AgentSelectorComponent
 *
 * KEYBOARD NAVIGATION:
 * - Parent component calls onKeyDown() with keyboard events
 * - ActiveDescendantKeyManager handles ArrowUp/ArrowDown
 * - Parent handles Enter (via selectFocused) and Escape (via close)
 *
 * ACCESSIBILITY:
 * - role="listbox" on container
 * - role="option" on each item
 * - aria-activedescendant points to currently focused option
 * - getActiveDescendantId() provides the ID for parent's aria-activedescendant
 */
@Component({
  selector: 'ptah-unified-suggestions-dropdown',
  standalone: true,
  imports: [SuggestionOptionComponent],
  template: `
    <div
      class="absolute bottom-full left-0 right-0 mb-1 z-50 flex flex-col max-h-80 p-1 shadow-lg bg-base-200 rounded-lg border border-base-300"
      role="listbox"
      [attr.aria-label]="getHeaderTitle()"
    >
      <!-- Header -->
      <div class="px-3 py-2 border-b border-base-300">
        <span
          class="text-xs font-semibold text-base-content/70 uppercase tracking-wide"
        >
          {{ getHeaderTitle() }}
        </span>
      </div>

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
        <span class="text-sm text-base-content/60">No matches found</span>
      </div>
      }

      <!-- Suggestions List -->
      @else {
      <div class="flex flex-col overflow-y-auto overflow-x-hidden max-h-64 p-1">
        @for (suggestion of suggestions(); track trackBy($index, suggestion);
        let i = $index) {
        <ptah-suggestion-option
          [suggestion]="suggestion"
          [optionId]="'suggestion-' + i"
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
export class UnifiedSuggestionsDropdownComponent
  implements AfterViewInit, OnDestroy
{
  // Inputs
  readonly suggestions = input.required<SuggestionItem[]>();
  readonly isLoading = input(false);

  // Outputs
  readonly suggestionSelected = output<SuggestionItem>();
  readonly closed = output<void>();

  // ViewChildren for ActiveDescendantKeyManager
  private readonly optionComponents = viewChildren(SuggestionOptionComponent);

  // ActiveDescendantKeyManager - manages keyboard navigation
  private keyManager: ActiveDescendantKeyManager<SuggestionOptionComponent> | null =
    null;

  // Track active option ID for aria-activedescendant
  private readonly _activeOptionId = signal<string | null>(null);
  readonly activeOptionId = this._activeOptionId.asReadonly();

  constructor() {
    // Re-initialize key manager when suggestions change
    effect(() => {
      const options = this.optionComponents();
      if (options.length > 0 && this.keyManager) {
        // Reset to first item when suggestions change
        this.keyManager.setFirstItemActive();
        this.updateActiveOptionId();
      }
    });
  }

  ngAfterViewInit(): void {
    this.initKeyManager();
  }

  ngOnDestroy(): void {
    this.keyManager?.destroy();
  }

  /**
   * Initialize the ActiveDescendantKeyManager
   */
  private initKeyManager(): void {
    const options = this.optionComponents();
    if (options.length === 0) return;

    this.keyManager = new ActiveDescendantKeyManager(options)
      .withVerticalOrientation()
      .withWrap()
      .withHomeAndEnd();

    // Set first item active initially
    this.keyManager.setFirstItemActive();
    this.updateActiveOptionId();

    // Subscribe to active item changes
    this.keyManager.change.subscribe(() => {
      this.updateActiveOptionId();
    });
  }

  /**
   * Update the active option ID for aria-activedescendant
   */
  private updateActiveOptionId(): void {
    const activeItem = this.keyManager?.activeItem;
    if (activeItem) {
      this._activeOptionId.set(activeItem.optionId());
    }
  }

  /**
   * Get the currently active option's ID for aria-activedescendant
   * Parent component should bind this to the input's aria-activedescendant
   */
  getActiveDescendantId(): string | null {
    return this._activeOptionId();
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
   * Handle keyboard events from parent
   * Call this from parent's (keydown) handler when dropdown is open
   *
   * @param event KeyboardEvent from parent textarea
   * @returns true if event was handled (parent should preventDefault)
   */
  onKeyDown(event: KeyboardEvent): boolean {
    if (!this.keyManager) return false;

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Home':
      case 'End':
        this.keyManager.onKeydown(event);
        return true;

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
    this.keyManager?.setNextItemActive();
  }

  /**
   * Navigate to previous item (ArrowUp)
   */
  navigateUp(): void {
    this.keyManager?.setPreviousItemActive();
  }

  /**
   * Select currently focused item (Enter)
   */
  selectFocused(): void {
    const activeItem = this.keyManager?.activeItem;
    if (activeItem) {
      this.suggestionSelected.emit(activeItem.suggestion());
    }
  }

  /**
   * Reset to first item
   */
  resetFocus(): void {
    this.keyManager?.setFirstItemActive();
  }

  /**
   * Handle mouse hover on option
   */
  handleHover(index: number): void {
    this.keyManager?.setActiveItem(index);
  }

  /**
   * Handle selection via click
   */
  handleSelection(suggestion: SuggestionItem): void {
    this.suggestionSelected.emit(suggestion);
  }

  trackBy(index: number, item: SuggestionItem): string {
    return `${item.type}-${item.name}`;
  }
}
