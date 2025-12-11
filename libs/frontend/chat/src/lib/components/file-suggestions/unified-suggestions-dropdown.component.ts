import { A11yModule, ActiveDescendantKeyManager } from '@angular/cdk/a11y';
import {
  CdkOverlayOrigin,
  ConnectedPosition,
  OverlayModule,
} from '@angular/cdk/overlay';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AUTOCOMPLETE_POSITIONS } from '@ptah-extension/ui';
import {
  SuggestionOptionComponent,
  type SuggestionItem,
} from './suggestion-option.component';

// Re-export for consumers
export type { SuggestionItem } from './suggestion-option.component';

/**
 * UnifiedSuggestionsDropdownComponent - Autocomplete UI with CDK Overlay Portal
 *
 * ARCHITECTURE:
 * - Uses CDK Overlay for portal rendering (solves textarea keyboard interception)
 * - Portal renders dropdown in cdk-overlay-container at body level
 * - Uses ActiveDescendantKeyManager for keyboard navigation
 * - Filter input INSIDE dropdown (new in Batch 13) - focus stays on filter input
 * - Supports file and command types via discriminated union
 * - Agents handled by dedicated AgentSelectorComponent
 *
 * KEYBOARD NAVIGATION:
 * - Filter input receives focus when dropdown opens
 * - Typing filters suggestions locally
 * - ActiveDescendantKeyManager handles ArrowUp/ArrowDown/Home/End
 * - Enter selects focused suggestion, Escape closes dropdown
 *
 * ACCESSIBILITY:
 * - role="listbox" on container
 * - role="option" on each item (via SuggestionOptionComponent)
 * - aria-activedescendant points to currently focused option
 * - Filter input has aria-label and placeholder
 *
 * MIGRATION NOTE (TASK_2025_048 Batch 13):
 * - Added filter input inside dropdown (previously filtered in parent)
 * - Filter input auto-focuses on open
 * - Parent only triggers open/close, dropdown handles filtering
 * - Simplified parent component - no more query extraction logic
 */
@Component({
  selector: 'ptah-unified-suggestions-dropdown',
  standalone: true,
  imports: [OverlayModule, A11yModule, SuggestionOptionComponent],
  template: `
    <!--Portal-rendered dropdown (rendered in cdk-overlay-container at body level) -->
    <!-- Origin is passed from parent component's textarea element -->
    <ng-template
      cdkConnectedOverlay
      [cdkConnectedOverlayOrigin]="overlayOrigin()"
      [cdkConnectedOverlayOpen]="true"
      [cdkConnectedOverlayPositions]="dropdownPositions"
      [cdkConnectedOverlayHasBackdrop]="true"
      [cdkConnectedOverlayBackdropClass]="'cdk-overlay-transparent-backdrop'"
      cdkConnectedOverlayPush
      (backdropClick)="handleBackdropClick()"
      (attached)="handleAttached()"
    >
      <div
        cdkTrapFocus
        [cdkTrapFocusAutoCapture]="true"
        class="suggestions-panel flex flex-col max-h-96 shadow-lg bg-base-200 rounded-lg border border-base-300 z-50 overflow-hidden"
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

        <!-- Filter Input -->
        <div class="px-2 py-1.5 border-b border-base-300">
          <input
            #filterInput
            cdkFocusInitial
            type="text"
            class="input input-sm input-bordered w-full text-xs"
            placeholder="Type to filter..."
            [value]="filterQuery()"
            (input)="onFilterInput($event)"
            (keydown)="onKeyDown($event)"
            aria-label="Filter suggestions"
            [attr.aria-activedescendant]="activeOptionId()"
          />
        </div>

        <!-- Loading State -->
        @if (isLoading()) {
        <div class="flex items-center justify-center gap-2 p-3">
          <span class="loading loading-spinner loading-xs"></span>
          <span class="text-xs text-base-content/70">Loading...</span>
        </div>
        }

        <!-- Empty State -->
        @else if (filteredSuggestions().length === 0) {
        <div class="flex items-center justify-center p-3">
          <span class="text-xs text-base-content/60">No matches found</span>
        </div>
        }

        <!-- Suggestions List -->
        @else {
        <div
          class="flex flex-col overflow-y-auto overflow-x-hidden max-h-64 p-1"
        >
          @for ( suggestion of filteredSuggestions(); track trackBy($index,
          suggestion); let i = $index ) {
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
    </ng-template>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnifiedSuggestionsDropdownComponent
  implements AfterViewInit, OnDestroy
{
  private readonly elementRef = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  // Inputs
  readonly overlayOrigin = input.required<CdkOverlayOrigin>(); // Origin element (textarea) from parent
  readonly suggestions = input.required<SuggestionItem[]>();
  readonly isLoading = input(false);

  // Outputs
  readonly suggestionSelected = output<SuggestionItem>();
  readonly closed = output<void>();
  readonly filterChanged = output<string>(); // New: emit filter changes to parent

  // ViewChild for filter input (auto-focus)
  private readonly filterInputRef =
    viewChild<ElementRef<HTMLInputElement>>('filterInput');

  // ViewChildren for ActiveDescendantKeyManager
  private readonly optionComponents = viewChildren(SuggestionOptionComponent);

  // ActiveDescendantKeyManager - manages keyboard navigation
  private keyManager: ActiveDescendantKeyManager<SuggestionOptionComponent> | null =
    null;

  // Track active option ID for aria-activedescendant
  private readonly _activeOptionId = signal<string | null>(null);
  readonly activeOptionId = this._activeOptionId.asReadonly();

  // Filter state (NEW: Batch 13)
  private readonly _filterQuery = signal('');
  readonly filterQuery = this._filterQuery.asReadonly();

  // Filtered suggestions based on local filter query
  readonly filteredSuggestions = computed(() => {
    const query = this._filterQuery().toLowerCase().trim();
    const allSuggestions = this.suggestions();

    if (!query) return allSuggestions;

    return allSuggestions.filter((suggestion) => {
      if (suggestion.type === 'file') {
        return (
          suggestion.name.toLowerCase().includes(query) ||
          suggestion.path.toLowerCase().includes(query)
        );
      } else if (suggestion.type === 'command') {
        return (
          suggestion.name.toLowerCase().includes(query) ||
          suggestion.description.toLowerCase().includes(query)
        );
      }
      return false;
    });
  });

  // Overlay positions (above input, fallback below)
  readonly dropdownPositions: ConnectedPosition[] = AUTOCOMPLETE_POSITIONS;

  constructor() {
    // Initialize/re-initialize key manager when options change
    // This handles both initial render AND subsequent suggestion changes
    effect(() => {
      const options = this.optionComponents();

      if (options.length === 0) {
        // Destroy keyManager when no options to prevent stale references
        if (this.keyManager) {
          this.keyManager.destroy();
          this.keyManager = null;
          this._activeOptionId.set(null);
        }
        return;
      }

      // Create/update keyManager when options exist
      if (options.length > 0) {
        if (this.keyManager) {
          // Key manager exists - just reset to first item
          this.keyManager.setFirstItemActive();
          this.updateActiveOptionId();
        } else {
          // First time options are available - initialize key manager
          this.initKeyManager();
        }
      }
    });
  }

  ngAfterViewInit(): void {
    // Key manager may already be initialized by effect() if options were available
    if (!this.keyManager) {
      this.initKeyManager();
    }
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

    // Subscribe to active item changes (auto-unsubscribes on component destroy)
    this.keyManager.change
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
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
   * Handle overlay attached - auto-focus filter input with retry
   * Using 'attached' event for reliable DOM access
   */
  handleAttached(): void {
    // Try immediate focus
    this.focusFilterInput();

    // Retry after a small delay if initial focus failed (safety net)
    setTimeout(() => {
      const filterInput = this.filterInputRef()?.nativeElement;
      if (filterInput && document.activeElement !== filterInput) {
        console.warn(
          '[UnifiedSuggestionsDropdown] Initial focus failed, retrying...'
        );
        this.focusFilterInput();
      }
    }, 50);
  }

  /**
   * Focus the filter input element
   */
  private focusFilterInput(): void {
    const filterInput = this.filterInputRef()?.nativeElement;
    if (filterInput) {
      filterInput.focus();
      console.log('[UnifiedSuggestionsDropdown] Filter input focused');
    }
  }

  /**
   * Handle backdrop click - close dropdown
   */
  handleBackdropClick(): void {
    console.log('[UnifiedSuggestionsDropdown] Backdrop clicked, closing');
    this.closed.emit();
  }

  /**
   * Handle filter input changes
   */
  onFilterInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this._filterQuery.set(value);

    // Emit filter change to parent (for server-side filtering if needed)
    this.filterChanged.emit(value);

    // Reset key manager to first item when filter changes
    if (this.keyManager) {
      this.keyManager.setFirstItemActive();
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
   * Handle keyboard events from filter input
   *
   * @param event KeyboardEvent from filter input
   * @returns true if event was handled
   */
  onKeyDown(event: KeyboardEvent): boolean {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Home':
      case 'End':
        // Navigate options list
        if (this.keyManager) {
          event.preventDefault();
          this.keyManager.onKeydown(event);
        }
        return true;

      case 'Enter':
        event.preventDefault();
        this.selectFocused();
        return true;

      case 'Escape':
        event.preventDefault();
        this.closed.emit();
        return true;

      default:
        // Let typing happen in filter input
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
