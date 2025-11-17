import {
  Component,
  computed,
  signal,
  HostListener,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FileSuggestion } from '../../services';

/**
 * File picker suggestion for @ syntax autocomplete
 */

/**
 * File Suggestions Dropdown - Pure Presentation Component
 * - Shows file suggestions for @ syntax autocomplete
 * - Handles keyboard navigation and selection
 * - No business logic or state management
 * - Pure VS Code styling - NO Tailwind classes
 */
@Component({
  selector: 'ptah-file-suggestions-dropdown',
  standalone: true,
  imports: [CommonModule],

  template: `
    <!-- eslint-disable-next-line @angular-eslint/template/no-inline-styles -->
    <div
      class="vscode-file-dropdown"
      [style.top.px]="positionTop()"
      [style.left.px]="positionLeft()"
    >
      @if (isLoading()) {
      <div class="vscode-file-dropdown-loading">
        <div class="vscode-file-loading-spinner"></div>
        <span>Loading workspace files...</span>
      </div>
      } @else if (filteredSuggestions().length === 0) {
      <div class="vscode-file-dropdown-empty">
        @if (searchQuery()) {
        <span>No files found matching "{{ searchQuery() }}"</span>
        } @else {
        <span>No files available in workspace</span>
        }
      </div>
      } @else {
      <div class="vscode-file-dropdown-list">
        @for (suggestion of filteredSuggestions(); track suggestion.path; let i
        = $index) {
        <div
          class="vscode-file-dropdown-item"
          [class.vscode-file-focused]="i === focusedIndex()"
          [class.vscode-file-image]="suggestion.isImage"
          [class.vscode-file-text]="suggestion.isText"
          (click)="selectSuggestion(suggestion)"
          (keydown.enter)="selectSuggestion(suggestion)"
          (mouseenter)="setFocusedIndex(i)"
          [attr.role]="'option'"
          [attr.aria-selected]="i === focusedIndex()"
          [attr.tabindex]="i === focusedIndex() ? 0 : -1"
        >
          <div class="vscode-file-icon">
            {{ getFileIcon(suggestion) }}
          </div>

          <div class="vscode-file-info">
            <div class="vscode-file-name">
              {{ suggestion.name }}
            </div>
            @if (suggestion.directory) {
            <div class="vscode-file-path">
              {{ suggestion.directory }}
            </div>
            }
          </div>

          @if (suggestion.size) {
          <div class="vscode-file-size">
            {{ formatFileSize(suggestion.size) }}
          </div>
          }
        </div>
        }
      </div>

      @if (filteredSuggestions().length > maxDisplayCount()) {
      <div class="vscode-file-dropdown-footer">
        Showing {{ maxDisplayCount() }} of
        {{ filteredSuggestions().length }} files
      </div>
      } }
    </div>
  `,
  styles: [
    `
      .vscode-file-dropdown {
        position: absolute;
        z-index: 1000;
        background-color: var(--vscode-dropdown-listBackground);
        border: 1px solid var(--vscode-widget-border);
        border-radius: 2px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        min-width: 300px;
        max-width: 500px;
        max-height: 250px;
        overflow: hidden;
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size, 13px);
        animation: vscode-file-dropdown-fadeIn 0.15s ease-out;
      }

      @keyframes vscode-file-dropdown-fadeIn {
        from {
          opacity: 0;
          transform: translateY(-4px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .vscode-file-dropdown-loading,
      .vscode-file-dropdown-empty {
        padding: 12px 16px;
        color: var(--vscode-descriptionForeground);
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .vscode-file-loading-spinner {
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

      .vscode-file-dropdown-list {
        max-height: 200px;
        overflow-y: auto;
        overflow-x: hidden;
      }

      .vscode-file-dropdown-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        cursor: pointer;
        border-bottom: 1px solid var(--vscode-panel-border);
        transition: background-color 0.1s ease;
      }

      .vscode-file-dropdown-item:last-child {
        border-bottom: none;
      }

      .vscode-file-dropdown-item:hover,
      .vscode-file-dropdown-item.vscode-file-focused {
        background-color: var(--vscode-list-hoverBackground);
      }

      .vscode-file-dropdown-item.vscode-file-focused {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: -1px;
      }

      .vscode-file-icon {
        flex-shrink: 0;
        font-size: 16px;
        width: 20px;
        text-align: center;
      }

      .vscode-file-info {
        flex: 1;
        min-width: 0;
      }

      .vscode-file-name {
        font-weight: 500;
        color: var(--vscode-foreground);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .vscode-file-path {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: 2px;
      }

      .vscode-file-size {
        flex-shrink: 0;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }

      .vscode-file-dropdown-footer {
        padding: 6px 16px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        background-color: var(--vscode-panel-border);
        border-top: 1px solid var(--vscode-panel-border);
      }

      /* File type styling */
      .vscode-file-dropdown-item.vscode-file-image .vscode-file-icon {
        color: var(--vscode-charts-blue);
      }

      .vscode-file-dropdown-item.vscode-file-text .vscode-file-icon {
        color: var(--vscode-charts-green);
      }

      /* High contrast mode */
      @media (prefers-contrast: high) {
        .vscode-file-dropdown {
          border-width: 2px;
        }

        .vscode-file-dropdown-item.vscode-file-focused {
          outline-width: 2px;
        }
      }

      /* Scrollbar styling */
      .vscode-file-dropdown-list::-webkit-scrollbar {
        width: 8px;
      }

      .vscode-file-dropdown-list::-webkit-scrollbar-track {
        background: var(--vscode-scrollbarSlider-background);
      }

      .vscode-file-dropdown-list::-webkit-scrollbar-thumb {
        background: var(--vscode-scrollbarSlider-hoverBackground);
        border-radius: 4px;
      }

      .vscode-file-dropdown-list::-webkit-scrollbar-thumb:hover {
        background: var(--vscode-scrollbarSlider-activeBackground);
      }

      /* Reduced motion support */
      @media (prefers-reduced-motion: reduce) {
        .vscode-file-dropdown,
        .vscode-file-dropdown-item {
          animation: none;
          transition: none;
        }
      }
    `,
  ],
})
export class FileSuggestionsDropdownComponent {
  // ANGULAR 20+ PATTERN: input() for reactive inputs
  readonly suggestions = input<FileSuggestion[]>([]);
  readonly searchQuery = input('');
  readonly isLoading = input(false);
  readonly positionTop = input(0);
  readonly positionLeft = input(0);
  readonly maxDisplayCount = input(15);

  // ANGULAR 20+ PATTERN: output() for event emitters
  readonly suggestionSelected = output<FileSuggestion>();
  readonly closed = output<void>();

  // ANGULAR 20 PATTERN: Private signals for component state
  private readonly _focusedIndex = signal(0);

  // ANGULAR 20 PATTERN: Readonly signals for template access
  readonly focusedIndex = this._focusedIndex.asReadonly();

  // ANGULAR 20 PATTERN: Computed signals for derived state
  readonly filteredSuggestions = computed(() =>
    this.suggestions().slice(0, this.maxDisplayCount())
  );

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    const suggestions = this.filteredSuggestions();

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
      Math.max(0, Math.min(index, this.filteredSuggestions().length - 1))
    );
  }

  selectSuggestion(suggestion: FileSuggestion): void {
    this.suggestionSelected.emit(suggestion);
  }

  getFileIcon(suggestion: FileSuggestion): string {
    if (suggestion.isImage) return '🖼️';
    if (suggestion.isText) return '📄';

    // File extension based icons
    const ext = suggestion.extension?.toLowerCase();
    switch (ext) {
      case '.ts':
        return '🔵';
      case '.js':
        return '🟡';
      case '.html':
        return '🌐';
      case '.css':
      case '.scss':
        return '🎨';
      case '.json':
        return '📋';
      case '.md':
        return '📝';
      case '.py':
        return '🐍';
      case '.java':
        return '☕';
      case '.go':
        return '🐹';
      case '.rs':
        return '🦀';
      case '.php':
        return '🐘';
      case '.rb':
        return '💎';
      default:
        return '📄';
    }
  }

  formatFileSize(size: number): string {
    if (size < 1024) return `${size}B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
    return `${(size / 1024 / 1024).toFixed(1)}MB`;
  }
}
