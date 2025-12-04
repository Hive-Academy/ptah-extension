import {
  Component,
  input,
  output,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { CommandSuggestion } from '@ptah-extension/core';
import type { FileSuggestion } from '../../services/file-picker.service';

/**
 * Unified Suggestions Dropdown - Autocomplete UI for @file, /command
 *
 * ARCHITECTURE:
 * - Level 1 component (Simple presentation component)
 * - Supports file and command types via discriminated union
 * - Agents handled by dedicated AgentSelectorComponent (separate dropdown)
 * - Keyboard navigation (ArrowUp, ArrowDown, Enter, Escape)
 * - Full-width single-column layout matching Claude Code CLI style
 *
 * DEPENDENCIES:
 * - Type imports from @ptah-extension/core (facades)
 * - CommonModule (Angular 20+)
 *
 * COMPLEXITY ASSESSMENT:
 * - Level: 2 (Medium) - Type discrimination, keyboard navigation
 * - Patterns: Composition (replaces FileSuggestionsDropdown)
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
  imports: [CommonModule],
  host: {
    '(document:keydown)': 'onKeyDown($event)',
  },
  template: `
    <div
      class="suggestions-dropdown z-50 p-1 shadow-lg bg-base-200 rounded-lg border border-base-300"
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

      <!-- Suggestions List - Single Column -->
      @else {
      <ul class="menu menu-sm p-1 overflow-y-auto max-h-64">
        @for (suggestion of suggestions(); track trackBy($index, suggestion);
        let i = $index) {
        <li>
          <button
            type="button"
            class="flex items-start gap-3 py-2 px-3 rounded-md transition-colors w-full"
            [class.bg-primary]="i === focusedIndex()"
            [class.text-primary-content]="i === focusedIndex()"
            [class.hover:bg-base-300]="i !== focusedIndex()"
            (click)="selectSuggestion(suggestion)"
            (mouseenter)="setFocusedIndex(i)"
            role="option"
            [attr.aria-selected]="i === focusedIndex()"
          >
            <!-- Icon -->
            <div class="w-5 h-5 flex-shrink-0 flex items-center justify-center">
              <span class="text-base">{{ getIcon(suggestion) }}</span>
            </div>

            <!-- Content area -->
            <div class="flex flex-col items-start flex-1 min-w-0">
              @if (suggestion.type === 'file') {
              <!-- Files/Folders: Name prominent, directory secondary -->
              <span class="font-medium text-sm truncate w-full">{{
                getName(suggestion)
              }}</span>
              <span
                [class]="
                  'text-xs mt-0.5 truncate w-full ' +
                  (i === focusedIndex()
                    ? 'text-primary-content/70'
                    : 'text-base-content/60')
                "
              >
                {{ getDescription(suggestion) }}
              </span>
              } @else if (suggestion.type === 'command') {
              <!-- Commands: Name with badge styling -->
              <div class="flex items-center gap-2 w-full">
                <span class="font-medium text-sm">{{
                  getName(suggestion)
                }}</span>
                @if (suggestion.scope === 'builtin') {
                <span class="badge badge-accent badge-xs">Built-in</span>
                }
              </div>
              <span
                [class]="
                  'text-xs mt-0.5 truncate w-full ' +
                  (i === focusedIndex()
                    ? 'text-primary-content/70'
                    : 'text-base-content/60')
                "
              >
                {{ getDescription(suggestion) }}
              </span>
              }
            </div>
          </button>
        </li>
        }
      </ul>
      }
    </div>
  `,
  styles: [
    `
      /* Position dropdown absolutely above the textarea - full width */
      .suggestions-dropdown {
        position: absolute;
        bottom: 100%;
        left: 0;
        right: 0;
        margin-bottom: 4px;
        z-index: 1000;
      }

      /* Focus outline for accessibility */
      .menu li > button:focus {
        outline: 2px solid oklch(var(--p));
        outline-offset: -2px;
      }

      /* Ensure single column layout */
      .menu li {
        width: 100%;
      }

      /* Reduced motion support */
      @media (prefers-reduced-motion: reduce) {
        button {
          transition: none;
        }
      }
    `,
  ],
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

  // Keyboard navigation
  onKeyDown(event: KeyboardEvent): void {
    const suggestions = this.suggestions();
    if (suggestions.length === 0) return;

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        this.setFocusedIndex((this._focusedIndex() + 1) % suggestions.length);
        break;
      }

      case 'ArrowUp': {
        event.preventDefault();
        const newIndex = this._focusedIndex() - 1;
        this.setFocusedIndex(newIndex < 0 ? suggestions.length - 1 : newIndex);
        break;
      }

      case 'Enter': {
        event.preventDefault();
        const focused = suggestions[this._focusedIndex()];
        if (focused) {
          this.selectSuggestion(focused);
        }
        break;
      }

      case 'Escape': {
        event.preventDefault();
        this.closed.emit();
        break;
      }
    }
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
