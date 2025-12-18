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
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  viewChildren,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AUTOCOMPLETE_POSITIONS_ABOVE } from '@ptah-extension/ui';
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
      [cdkConnectedOverlayWidth]="getOverlayWidth()"
      [cdkConnectedOverlayHasBackdrop]="true"
      [cdkConnectedOverlayBackdropClass]="'cdk-overlay-transparent-backdrop'"
      cdkConnectedOverlayPush
      (backdropClick)="handleBackdropClick()"
    >
      <div
        [id]="listboxId"
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
        <div
          class="flex flex-col overflow-y-auto overflow-x-hidden max-h-64 p-1"
        >
          @for ( suggestion of suggestions(); track trackBy($index, suggestion);
          let i = $index ) {
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

  // ViewChildren for ActiveDescendantKeyManager
  private readonly optionComponents = viewChildren(SuggestionOptionComponent);

  // ActiveDescendantKeyManager - manages keyboard navigation
  private keyManager: ActiveDescendantKeyManager<SuggestionOptionComponent> | null =
    null;

  // Track active option ID for aria-activedescendant
  private readonly _activeOptionId = signal<string | null>(null);
  readonly activeOptionId = this._activeOptionId.asReadonly();

  // Overlay positions (above input preferred, fallback below)
  // Uses ABOVE variant for chat input at bottom of VS Code sidebar
  readonly dropdownPositions: ConnectedPosition[] =
    AUTOCOMPLETE_POSITIONS_ABOVE;

  // Unique ID for the listbox element (used by aria-controls on parent input)
  readonly listboxId = `suggestions-listbox-${Math.random()
    .toString(36)
    .substring(2, 9)}`;

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
   * Handle backdrop click - close dropdown
   */
  handleBackdropClick(): void {
    console.log('[UnifiedSuggestionsDropdown] Backdrop clicked, closing');
    this.closed.emit();
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

  /**
   * Get overlay width to match the origin element (textarea) width.
   * This ensures the dropdown doesn't exceed the VS Code sidebar width.
   *
   * Returns the origin element's offsetWidth, which is the rendered width
   * including padding and border but not margin.
   */
  getOverlayWidth(): number {
    const origin = this.overlayOrigin();
    if (!origin?.elementRef?.nativeElement) {
      return 300; // Fallback width
    }
    return origin.elementRef.nativeElement.offsetWidth;
  }

  // ============================================================
  // PUBLIC API - Called by parent component for keyboard navigation
  // ============================================================

  /**
   * Handle keyboard events from parent component
   *
   * CRITICAL: Must return FALSE when keyManager is not ready (null or loading).
   * This signals to the parent that the event was NOT handled, allowing
   * fallback behavior (e.g., normal textarea cursor movement).
   *
   * Pattern copied from @ptah-extension/ui AutocompleteComponent.
   *
   * @param event KeyboardEvent from parent
   * @returns true if event was handled, false if not ready to handle
   */
  onKeyDown(event: KeyboardEvent): boolean {
    // CRITICAL: Return false when not ready - don't claim to handle events we can't process
    // This was the root cause of arrow keys not working: returning true when keyManager was null
    if (!this.keyManager || this.isLoading()) {
      return false;
    }

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Home':
      case 'End':
        // Navigate options list - keyManager handles the navigation
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
    if (item.type === 'file') return `file-${item.path}`;
    return `${item.type}-${item.name}`;
  }
}
