import { Component, input, output, signal, HostListener } from '@angular/core';
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
  template: `
    <div
      class="vscode-unified-dropdown"
      [style.top.px]="positionTop()"
      [style.left.px]="positionLeft()"
    >
      @if (isLoading()) {
      <div class="vscode-unified-loading">
        <div class="vscode-unified-spinner"></div>
        <span>Loading suggestions...</span>
      </div>
      } @else if (suggestions().length === 0) {
      <div class="vscode-unified-empty">
        <span>No suggestions found</span>
      </div>
      } @else {
      <div class="vscode-unified-list">
        @for (suggestion of suggestions(); track trackBy($index, suggestion);
        let i = $index) {
        <div
          class="vscode-unified-item"
          [class.vscode-unified-focused]="i === focusedIndex()"
          (click)="selectSuggestion(suggestion)"
          (keydown.enter)="selectSuggestion(suggestion)"
          (mouseenter)="setFocusedIndex(i)"
          [attr.role]="'option'"
          [attr.aria-selected]="i === focusedIndex()"
          [attr.tabindex]="i === focusedIndex() ? 0 : -1"
        >
          <span class="vscode-unified-icon">{{ getIcon(suggestion) }}</span>
          <div class="vscode-unified-content">
            <div class="vscode-unified-name">{{ getName(suggestion) }}</div>
            <div class="vscode-unified-description">
              {{ getDescription(suggestion) }}
            </div>
          </div>
        </div>
        }
      </div>
      }
    </div>
  `,
  styles: [
    `
      .vscode-unified-dropdown {
        position: absolute;
        z-index: 1000;
        background-color: var(
          --vscode-dropdown-listBackground,
          var(--vscode-editor-background, #1e1e1e)
        );
        border: 1px solid
          var(--vscode-widget-border, var(--vscode-panel-border, #454545));
        border-radius: 4px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
        min-width: 320px;
        max-width: 600px;
        max-height: 400px;
        overflow: hidden;
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size, 13px);
        animation: vscode-unified-fadeIn 0.15s ease-out;
      }

      @keyframes vscode-unified-fadeIn {
        from {
          opacity: 0;
          transform: translateY(-4px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .vscode-unified-loading,
      .vscode-unified-empty {
        padding: 16px;
        color: var(
          --vscode-descriptionForeground,
          var(--vscode-foreground, #cccccc)
        );
        display: flex;
        align-items: center;
        gap: 12px;
        justify-content: center;
        min-height: 80px;
      }

      .vscode-unified-spinner {
        width: 16px;
        height: 16px;
        border: 2px solid var(--vscode-progressBar-background);
        border-top: 2px solid var(--vscode-progressBar-foreground);
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(360deg);
        }
      }

      .vscode-unified-list {
        max-height: 300px;
        overflow-y: auto;
        overflow-x: hidden;
      }

      .vscode-unified-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 16px;
        cursor: pointer;
        border-bottom: 1px solid
          var(--vscode-panel-border, var(--vscode-widget-border, #454545));
        transition: background-color 0.1s ease;
        min-height: 44px;
      }

      .vscode-unified-item:last-child {
        border-bottom: none;
      }

      .vscode-unified-item:hover,
      .vscode-unified-item.vscode-unified-focused {
        background-color: var(
          --vscode-list-hoverBackground,
          var(--vscode-list-activeSelectionBackground, rgba(51, 153, 255, 0.2))
        );
      }

      .vscode-unified-item.vscode-unified-focused {
        outline: 2px solid var(--vscode-focusBorder, #007acc);
        outline-offset: -2px;
      }

      .vscode-unified-icon {
        flex-shrink: 0;
        font-size: 20px;
        width: 28px;
        height: 28px;
        text-align: center;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .vscode-unified-content {
        flex: 1;
        min-width: 0;
      }

      .vscode-unified-name {
        font-weight: 500;
        color: var(--vscode-foreground);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .vscode-unified-description {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: 2px;
      }

      /* Backdrop for visual separation */
      .vscode-unified-dropdown::before {
        content: '';
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: transparent;
        z-index: -1;
        pointer-events: none;
      }

      /* High contrast mode */
      @media (prefers-contrast: high) {
        .vscode-unified-dropdown {
          border-width: 2px;
        }

        .vscode-unified-item.vscode-unified-focused {
          outline-width: 2px;
        }
      }

      /* Scrollbar styling */
      .vscode-unified-list::-webkit-scrollbar {
        width: 8px;
      }

      .vscode-unified-list::-webkit-scrollbar-track {
        background: var(--vscode-scrollbarSlider-background);
      }

      .vscode-unified-list::-webkit-scrollbar-thumb {
        background: var(--vscode-scrollbarSlider-hoverBackground);
        border-radius: 4px;
      }

      .vscode-unified-list::-webkit-scrollbar-thumb:hover {
        background: var(--vscode-scrollbarSlider-activeBackground);
      }

      /* Reduced motion support */
      @media (prefers-reduced-motion: reduce) {
        .vscode-unified-dropdown,
        .vscode-unified-item {
          animation: none;
          transition: none;
        }
      }
    `,
  ],
})
export class UnifiedSuggestionsDropdownComponent {
  // ANGULAR 20+ PATTERN: input() for reactive inputs
  readonly suggestions = input.required<SuggestionItem[]>();
  readonly isLoading = input(false);
  readonly positionTop = input(0);
  readonly positionLeft = input(0);

  // ANGULAR 20+ PATTERN: output() for event emitters
  readonly suggestionSelected = output<SuggestionItem>();
  readonly closed = output<void>();

  // ANGULAR 20 PATTERN: Private signals for component state
  private readonly _focusedIndex = signal(0);

  // ANGULAR 20 PATTERN: Readonly signals for template access
  readonly focusedIndex = this._focusedIndex.asReadonly();

  // Keyboard navigation
  @HostListener('document:keydown', ['$event'])
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
