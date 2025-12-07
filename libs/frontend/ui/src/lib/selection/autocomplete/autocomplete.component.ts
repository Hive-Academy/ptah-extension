import {
  Component,
  input,
  output,
  signal,
  viewChildren,
  effect,
  AfterViewInit,
  OnDestroy,
  TemplateRef,
  DestroyRef,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { OverlayModule, ConnectedPosition } from '@angular/cdk/overlay';
import { ActiveDescendantKeyManager } from '@angular/cdk/a11y';
import { NgTemplateOutlet } from '@angular/common';
import { OptionComponent } from '../option/option.component';
import { AUTOCOMPLETE_POSITIONS } from '../../overlays/shared/overlay-positions';

/**
 * AutocompleteComponent - Autocomplete with CDK Overlay
 *
 * Combines CDK Overlay portal rendering with ActiveDescendantKeyManager
 * for keyboard navigation. Focus stays on input element (aria-activedescendant).
 *
 * CRITICAL: Portal rendering solves textarea keyboard interception bug.
 * Dropdown renders in cdk-overlay-container at body level, NOT in component tree.
 *
 * @example
 * <ptah-autocomplete
 *   [suggestions]="suggestions()"
 *   [isLoading]="isLoading()"
 *   [isOpen]="isOpen()"
 *   [suggestionTemplate]="suggestionTemplate"
 *   (suggestionSelected)="onSelect($event)"
 *   (closed)="onClose()">
 *
 *   <input type="text" autocompleteInput />
 * </ptah-autocomplete>
 *
 * <ng-template #suggestionTemplate let-suggestion>
 *   <div class="flex items-center gap-2">
 *     <span>{{ suggestion.icon }}</span>
 *     <span>{{ suggestion.name }}</span>
 *   </div>
 * </ng-template>
 */
@Component({
  selector: 'ptah-autocomplete',
  standalone: true,
  imports: [OverlayModule, OptionComponent, NgTemplateOutlet],
  template: `
    <div cdkOverlayOrigin #inputOrigin="cdkOverlayOrigin">
      <ng-content select="[autocompleteInput]" />
    </div>

    <ng-template
      cdkConnectedOverlay
      [cdkConnectedOverlayOrigin]="inputOrigin"
      [cdkConnectedOverlayOpen]="isOpen()"
      [cdkConnectedOverlayPositions]="autocompletePositions"
      [cdkConnectedOverlayWidth]="
        inputOrigin.elementRef.nativeElement.offsetWidth
      "
      cdkConnectedOverlayPush
    >
      <div
        class="suggestions-panel bg-base-200 border border-base-300 rounded-lg shadow-lg max-h-80 flex flex-col"
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
          @for ( suggestion of suggestions(); track trackBy()($index,
          suggestion); let i = $index ) {
          <ptah-option
            [optionId]="'suggestion-' + i"
            [value]="suggestion"
            (selected)="handleSelection($event)"
            (hovered)="handleHover(i)"
          >
            <ng-container
              *ngTemplateOutlet="
                suggestionTemplate();
                context: { $implicit: suggestion }
              "
            />
          </ptah-option>
          }
        </div>
        }
      </div>
    </ng-template>
  `,
})
export class AutocompleteComponent<T = unknown>
  implements AfterViewInit, OnDestroy
{
  private readonly destroyRef = inject(DestroyRef);

  // Inputs
  readonly suggestions = input.required<T[]>();
  readonly isLoading = input(false);
  readonly isOpen = input.required<boolean>();
  readonly headerTitle = input<string>('');
  readonly ariaLabel = input('Suggestions');
  readonly emptyMessage = input('No matches found');
  readonly trackBy = input<(index: number, item: T) => unknown>(
    (i: number) => i
  );
  readonly suggestionTemplate = input.required<TemplateRef<{ $implicit: T }>>();

  // Outputs
  readonly suggestionSelected = output<T>();
  readonly closed = output<void>();

  // ViewChildren for ActiveDescendantKeyManager
  private readonly optionComponents = viewChildren(OptionComponent<T>);

  // ActiveDescendantKeyManager
  private keyManager: ActiveDescendantKeyManager<OptionComponent<T>> | null =
    null;

  // Active option ID for aria-activedescendant
  private readonly _activeOptionId = signal<string | null>(null);
  readonly activeOptionId = this._activeOptionId.asReadonly();

  // Autocomplete positions (below input, match width)
  readonly autocompletePositions: ConnectedPosition[] = AUTOCOMPLETE_POSITIONS;

  constructor() {
    // CRITICAL: Initialize/re-initialize key manager when options change
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
   * Pattern verified in unified-suggestions-dropdown.component.ts:109-165
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
   * Update the active option ID signal for aria-activedescendant
   */
  private updateActiveOptionId(): void {
    const activeItem = this.keyManager?.activeItem;
    if (activeItem) {
      this._activeOptionId.set(activeItem.optionId());
    }
  }

  // ============================================================
  // PUBLIC API - Called by parent for keyboard navigation
  // ============================================================

  /**
   * Handle keyboard events from parent
   * Returns true if event was handled (parent should preventDefault)
   *
   * CRITICAL: This is called by parent component (e.g., UnifiedSuggestionsDropdown)
   * to delegate keyboard navigation to ActiveDescendantKeyManager
   */
  onKeyDown(event: KeyboardEvent): boolean {
    if (!this.keyManager || this.isLoading()) return false;

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
   * Select the currently focused suggestion
   * Called by parent or internally on Enter key
   */
  selectFocused(): void {
    const activeItem = this.keyManager?.activeItem;
    if (activeItem) {
      this.suggestionSelected.emit(activeItem.value());
    }
  }

  /**
   * Handle mouse hover - update active item
   * Called by OptionComponent on mouseenter
   */
  handleHover(index: number): void {
    this.keyManager?.setActiveItem(index);
  }

  /**
   * Handle selection event from OptionComponent click
   * Emit suggestionSelected output
   */
  handleSelection(suggestion: T): void {
    this.suggestionSelected.emit(suggestion);
  }

  /**
   * Get the active descendant ID for aria-activedescendant attribute
   * Called by parent to update ARIA attributes on input element
   */
  getActiveDescendantId(): string | null {
    return this._activeOptionId();
  }
}
