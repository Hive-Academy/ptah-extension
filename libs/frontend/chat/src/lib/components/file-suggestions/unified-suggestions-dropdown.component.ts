import {
  Component,
  input,
  output,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { AgentSuggestion, CommandSuggestion } from '@ptah-extension/core';
import type { FileSuggestion } from '../../services/file-picker.service';

/**
 * Unified Suggestions Dropdown - Autocomplete UI for @agent, @file, /command
 *
 * ARCHITECTURE:
 * - Level 1 component (Simple presentation component)
 * - Supports 3 suggestion types via discriminated union
 * - Keyboard navigation (ArrowUp, ArrowDown, Enter, Escape)
 * - Pure VS Code theming - NO Tailwind classes
 *
 * DEPENDENCIES:
 * - Type imports from @ptah-extension/core (facades)
 * - CommonModule (Angular 20+)
 *
 * COMPLEXITY ASSESSMENT:
 * - Level: 2 (Medium) - Type discrimination, keyboard navigation
 * - Patterns: Composition (replaces FileSuggestionsDropdown)
 * - Rejected: Container/Presentational (pure presentation), State management (parent manages)
 */

// Type discriminated union for all suggestion types
// Note: FileSuggestion extended with icon/description, MCP support removed (TASK_2025_036)
export type SuggestionItem =
  | ({ type: 'file'; icon: string; description: string } & Omit<
      FileSuggestion,
      'type'
    >)
  | ({ type: 'agent' } & AgentSuggestion)
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
      class="dropdown-content menu bg-base-100 rounded-box shadow-lg border border-base-300 w-full max-h-64 overflow-hidden z-50"
      role="listbox"
    >
      <!-- Category Tabs (only for @ trigger mode) -->
      @if (showTabs()) {
      <div role="tablist" class="tabs tabs-boxed tabs-sm m-2 mb-0">
        <button
          role="tab"
          class="tab"
          [class.tab-active]="activeCategory() === 'all'"
          (click)="categoryChanged.emit('all')"
          type="button"
        >
          All
        </button>
        <button
          role="tab"
          class="tab"
          [class.tab-active]="activeCategory() === 'files'"
          (click)="categoryChanged.emit('files')"
          type="button"
        >
          📄 Files
        </button>
        <button
          role="tab"
          class="tab"
          [class.tab-active]="activeCategory() === 'agents'"
          (click)="categoryChanged.emit('agents')"
          type="button"
        >
          🤖 Agents
        </button>
      </div>
      }

      <!-- Loading State -->
      @if (isLoading()) {
      <div class="flex items-center justify-center gap-3 p-4">
        <span class="loading loading-spinner loading-md"></span>
        <span class="text-sm text-base-content/70">Loading suggestions...</span>
      </div>
      }

      <!-- Empty State -->
      @else if (suggestions().length === 0) {
      <div class="flex items-center justify-center p-4">
        <span class="text-sm text-base-content/60">No suggestions found</span>
      </div>
      }

      <!-- Suggestions List -->
      @else {
      <ul class="menu-compact overflow-y-auto max-h-80">
        @for (suggestion of suggestions(); track trackBy($index, suggestion);
        let i = $index) {
        <li>
          <a
            class="flex items-center gap-3 py-2"
            [class.active]="i === focusedIndex()"
            (click)="selectSuggestion(suggestion)"
            (mouseenter)="setFocusedIndex(i)"
            role="option"
            [attr.aria-selected]="i === focusedIndex()"
          >
            <span class="text-xl">{{ getIcon(suggestion) }}</span>

            <!-- Content area: File shows name+path stacked, Command/Agent show badges -->
            <div class="flex-1 min-w-0 flex items-center gap-2">
              @if (suggestion.type === 'file') {
              <!-- Files: Name prominent, directory secondary -->
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium truncate">
                  {{ getName(suggestion) }}
                </div>
                <div class="text-xs text-base-content/60 truncate">
                  {{ getDescription(suggestion) }}
                </div>
              </div>
              } @else {
              <!-- Commands/Agents: Badge for name, description alongside -->
              @if (suggestion.type === 'command') {
              <span class="badge badge-sm badge-primary">{{
                getName(suggestion)
              }}</span>
              } @if (suggestion.type === 'agent') {
              <span class="badge badge-sm badge-secondary">{{
                getName(suggestion)
              }}</span>
              }
              <div class="flex-1 min-w-0">
                <div class="text-xs text-base-content/60 truncate">
                  {{ getDescription(suggestion) }}
                </div>
              </div>
              }
            </div>

            @if (suggestion.type === 'agent' && suggestion.scope === 'builtin')
            {
            <span class="badge badge-accent badge-sm">Built-in</span>
            } @if (suggestion.type === 'command' && suggestion.scope ===
            'builtin') {
            <span class="badge badge-accent badge-sm">Built-in</span>
            }
          </a>
        </li>
        }
      </ul>
      }
    </div>
  `,
  styles: [
    `
      /* Position dropdown absolutely above the textarea */
      .dropdown-content {
        position: absolute;
        bottom: 100%;
        left: 0;
        right: 0;
        margin-bottom: 4px;
        z-index: 1000;
      }

      /* Smooth transitions */
      .tab {
        transition: all 0.15s ease;
      }

      /* Focus outline for accessibility */
      .menu li > a:focus {
        outline: 2px solid oklch(var(--p));
        outline-offset: -2px;
      }

      /* Reduced motion support */
      @media (prefers-reduced-motion: reduce) {
        .tab {
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
  readonly showTabs = input(false); // Show tabs for @ mode
  readonly activeCategory = input<'all' | 'files' | 'agents'>('all'); // Active tab

  // ANGULAR 20+ PATTERN: output() for event emitters
  readonly suggestionSelected = output<SuggestionItem>();
  readonly closed = output<void>();
  readonly categoryChanged = output<'all' | 'files' | 'agents'>(); // NEW: Tab change

  // ANGULAR 20 PATTERN: Private signals for component state
  private readonly _focusedIndex = signal(0);

  // ANGULAR 20 PATTERN: Readonly signals for template access
  readonly focusedIndex = this._focusedIndex.asReadonly();

  // Keyboard navigation
  onKeyDown(event: KeyboardEvent): void {
    const suggestions = this.suggestions();

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

      case 'Tab': {
        // NEW: Tab key cycles through categories (only in @ mode)
        if (this.showTabs()) {
          event.preventDefault();
          const categories: Array<'all' | 'files' | 'agents'> = [
            'all',
            'files',
            'agents',
          ];
          const currentIndex = categories.indexOf(this.activeCategory());
          const nextIndex = (currentIndex + 1) % categories.length;
          this.categoryChanged.emit(categories[nextIndex]);
        }
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
