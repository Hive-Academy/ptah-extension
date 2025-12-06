import {
  Component,
  input,
  output,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import type { CommandSuggestion } from '@ptah-extension/core';
import type { FileSuggestion } from '../../services/file-picker.service';

/**
 * Unified Suggestions Dropdown - Autocomplete UI for @file, /command
 *
 * ARCHITECTURE:
 * - Level 1 component (Pure presentation component)
 * - Supports file and command types via discriminated union
 * - Agents handled by dedicated AgentSelectorComponent (separate dropdown)
 * - Parent calls navigateUp/navigateDown/selectFocused methods directly
 *
 * KEYBOARD NAVIGATION:
 * - Parent component (chat-input) handles keydown events on textarea
 * - Parent calls public methods: navigateUp(), navigateDown(), selectFocused()
 * - This is the proper Angular pattern - no document-level listeners needed
 *
 * DEPENDENCIES:
 * - Type imports from @ptah-extension/core (facades)
 */

// Type discriminated union for file and command suggestions only
// Note: Agents handled by AgentSelectorComponent - not part of this dropdown
export type SuggestionItem =
  | ({ type: 'file'; icon: string; description: string } & Omit<
      FileSuggestion,
      'type'
    >)
  | ({ type: 'command' } & CommandSuggestion);

@Component({
  selector: 'ptah-unified-suggestions-dropdown',
  standalone: true,
  imports: [],
  template: `
    <div
      class="absolute bottom-full left-0 right-0 mb-1 z-50 flex flex-col max-h-80 p-1 shadow-lg bg-base-200 rounded-lg border border-base-300"
      role="listbox"
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

      <!-- Suggestions List - Single Column Vertical -->
      @else {
      <div class="flex flex-col overflow-y-auto overflow-x-hidden max-h-64 p-1">
        @for (suggestion of suggestions(); track trackBy($index, suggestion);
        let i = $index) {
        <button
          type="button"
          class="btn btn-ghost justify-start items-start gap-3 px-3 py-2 h-auto min-h-0 rounded-md w-full text-left font-normal"
          [class.btn-primary]="i === focusedIndex()"
          (click)="selectSuggestion(suggestion)"
          (mouseenter)="setFocusedIndex(i)"
          role="option"
          [attr.aria-selected]="i === focusedIndex()"
        >
          <!-- Icon -->
          <span
            class="shrink-0 w-5 h-5 flex items-center justify-center text-base"
          >
            {{ getIcon(suggestion) }}
          </span>

          <!-- Content area -->
          <div class="flex-1 min-w-0 flex flex-col gap-0.5">
            @if (suggestion.type === 'file') {
            <!-- Files/Folders: Name prominent, directory secondary -->
            <span class="font-medium text-sm truncate">{{
              getName(suggestion)
            }}</span>
            <span class="text-xs opacity-70 truncate">{{
              getDescription(suggestion)
            }}</span>
            } @else if (suggestion.type === 'command') {
            <!-- Commands: Name with badge styling -->
            <div class="flex items-center gap-2">
              <span class="font-medium text-sm truncate">{{
                getName(suggestion)
              }}</span>
              @if (suggestion.scope === 'builtin') {
              <span class="badge badge-accent badge-xs">Built-in</span>
              }
            </div>
            <span class="text-xs opacity-70 truncate">{{
              getDescription(suggestion)
            }}</span>
            }
          </div>
        </button>
        }
      </div>
      }
    </div>
  `,
  styles: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnifiedSuggestionsDropdownComponent {
  // ANGULAR 20+ PATTERN: input() for reactive inputs
  readonly suggestions = input.required<SuggestionItem[]>();
  readonly isLoading = input(false);

  // ANGULAR 20+ PATTERN: output() for event emitters
  readonly suggestionSelected = output<SuggestionItem>();
  readonly closed = output<void>();

  // ANGULAR 20 PATTERN: Private signals for component state
  private readonly _focusedIndex = signal(0);

  // ANGULAR 20 PATTERN: Readonly signals for template access
  readonly focusedIndex = this._focusedIndex.asReadonly();

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
   * Navigate to next item (ArrowDown)
   */
  navigateDown(): void {
    const suggestions = this.suggestions();
    if (suggestions.length === 0) return;
    this._focusedIndex.set((this._focusedIndex() + 1) % suggestions.length);
  }

  /**
   * Navigate to previous item (ArrowUp)
   */
  navigateUp(): void {
    const suggestions = this.suggestions();
    if (suggestions.length === 0) return;
    const newIndex = this._focusedIndex() - 1;
    this._focusedIndex.set(newIndex < 0 ? suggestions.length - 1 : newIndex);
  }

  /**
   * Select currently focused item (Enter)
   */
  selectFocused(): void {
    const suggestions = this.suggestions();
    const focused = suggestions[this._focusedIndex()];
    if (focused) {
      this.suggestionSelected.emit(focused);
    }
  }

  /**
   * Reset focused index (called when suggestions change)
   */
  resetFocus(): void {
    this._focusedIndex.set(0);
  }

  setFocusedIndex(index: number): void {
    this._focusedIndex.set(
      Math.max(0, Math.min(index, this.suggestions().length - 1))
    );
  }

  selectSuggestion(suggestion: SuggestionItem): void {
    this.suggestionSelected.emit(suggestion);
  }

  // Helper methods for type discrimination
  getIcon(item: SuggestionItem): string {
    return item.icon;
  }

  getName(item: SuggestionItem): string {
    return item.name;
  }

  getDescription(item: SuggestionItem): string {
    return item.description || '';
  }

  trackBy(index: number, item: SuggestionItem): string {
    return `${item.type}-${item.name}`;
  }
}
