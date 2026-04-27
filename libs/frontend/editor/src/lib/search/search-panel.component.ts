import {
  Component,
  signal,
  output,
  inject,
  ChangeDetectionStrategy,
  DestroyRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Search,
  X,
  CaseSensitive,
  Regex,
  FileText,
  ChevronRight,
  ChevronDown,
} from 'lucide-angular';
import { VSCodeService, rpcCall } from '@ptah-extension/core';
import type {
  SearchFileResult,
  SearchInFilesResult,
} from '../models/search.model';

/**
 * SearchPanelComponent - Multi-file search panel with debounced RPC calls.
 *
 * Complexity Level: 2 (Medium - debounce logic, RPC integration, match highlighting)
 * Patterns: Standalone, OnPush, signal-based state, composition
 *
 * Features:
 * - Search input with 300ms debounce
 * - Regex and case-sensitive toggle buttons
 * - Results grouped by file with collapsible sections
 * - Match text highlighting using column + matchLength
 * - Click-to-navigate emitting { filePath, line }
 * - Loading spinner, empty state, truncation warning
 * - Clear button to reset search
 *
 * TASK_2025_283 Batch 3, Task 3.1
 */
@Component({
  selector: 'ptah-search-panel',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
  template: `
    <div
      class="flex flex-col h-full overflow-hidden"
      role="search"
      aria-label="Search in files"
    >
      <!-- Search input area -->
      <div class="p-2 border-b border-base-300 flex-shrink-0">
        <div class="flex items-center gap-1">
          <div class="relative flex-1">
            <input
              type="text"
              class="input input-bordered input-xs w-full pr-7"
              placeholder="Search in files..."
              aria-label="Search query"
              [(ngModel)]="searchQuery"
              (ngModelChange)="onQueryChanged()"
            />
            @if (searchQuery) {
              <button
                class="absolute right-1 top-1/2 -translate-y-1/2 btn btn-ghost btn-xs p-0.5 h-auto min-h-0"
                title="Clear search"
                aria-label="Clear search"
                (click)="clearSearch()"
              >
                <lucide-angular [img]="XIcon" class="w-3 h-3" />
              </button>
            }
          </div>
        </div>
        <div class="flex items-center gap-1 mt-1">
          <button
            class="btn btn-ghost btn-xs p-1 h-auto min-h-0"
            [class.text-primary]="isRegex()"
            [class.bg-primary/10]="isRegex()"
            title="Use regular expression"
            aria-label="Toggle regular expression"
            [attr.aria-pressed]="isRegex()"
            (click)="toggleRegex()"
          >
            <lucide-angular [img]="RegexIcon" class="w-3.5 h-3.5" />
          </button>
          <button
            class="btn btn-ghost btn-xs p-1 h-auto min-h-0"
            [class.text-primary]="caseSensitive()"
            [class.bg-primary/10]="caseSensitive()"
            title="Match case"
            aria-label="Toggle case sensitivity"
            [attr.aria-pressed]="caseSensitive()"
            (click)="toggleCaseSensitive()"
          >
            <lucide-angular [img]="CaseSensitiveIcon" class="w-3.5 h-3.5" />
          </button>
          @if (totalMatches() > 0) {
            <span class="text-[10px] opacity-60 ml-auto">
              {{ totalMatches() }} match{{ totalMatches() === 1 ? '' : 'es' }}
            </span>
          }
        </div>
      </div>

      <!-- Results area -->
      <div class="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        @if (isSearching()) {
          <div class="flex items-center justify-center p-4">
            <span class="loading loading-spinner loading-sm"></span>
            <span class="text-xs opacity-60 ml-2">Searching...</span>
          </div>
        } @else if (errorMessage()) {
          <div class="p-3 text-xs text-error">
            {{ errorMessage() }}
          </div>
        } @else if (
          searchQuery && searchResults().length === 0 && hasSearched()
        ) {
          <div class="px-3 py-4 text-[10px] opacity-40 text-center">
            No results found
          </div>
        } @else {
          @if (truncated()) {
            <div
              class="px-2 py-1 text-[10px] text-warning bg-warning/10 border-b border-base-300"
            >
              Results were capped. Narrow your search for complete results.
            </div>
          }
          @for (file of searchResults(); track file.filePath) {
            <div class="border-b border-base-300/50">
              <!-- File header -->
              <button
                type="button"
                class="flex items-center gap-1 w-full px-2 py-1 text-[10px] font-semibold
                       hover:bg-base-200 transition-colors cursor-pointer text-left"
                [attr.aria-expanded]="isFileExpanded(file.filePath)"
                (click)="toggleFileExpanded(file.filePath)"
              >
                <lucide-angular
                  [img]="
                    isFileExpanded(file.filePath)
                      ? ChevronDownIcon
                      : ChevronRightIcon
                  "
                  class="w-3 h-3 flex-shrink-0 opacity-60"
                />
                <lucide-angular
                  [img]="FileTextIcon"
                  class="w-3 h-3 flex-shrink-0 opacity-60"
                />
                <span class="truncate" [attr.title]="file.relativePath">{{
                  file.fileName
                }}</span>
                <span class="badge badge-xs opacity-50 ml-auto flex-shrink-0">{{
                  file.matches.length
                }}</span>
              </button>
              <!-- Match rows -->
              @if (isFileExpanded(file.filePath)) {
                @for (match of file.matches; track $index) {
                  <button
                    type="button"
                    class="flex items-center w-full px-2 py-0.5 pl-7 text-[11px] font-mono
                           hover:bg-base-200 transition-colors cursor-pointer text-left gap-2"
                    [attr.aria-label]="
                      'Go to line ' + match.line + ' in ' + file.fileName
                    "
                    (click)="onMatchClick(file.filePath, match.line)"
                  >
                    <span
                      class="text-[10px] opacity-40 w-6 text-right flex-shrink-0"
                      >{{ match.line }}</span
                    >
                    <span
                      class="truncate min-w-0"
                      [innerHTML]="
                        highlightMatch(
                          match.lineText,
                          match.column,
                          match.matchLength
                        )
                      "
                    ></span>
                  </button>
                }
              }
            </div>
          }
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchPanelComponent {
  private readonly vscodeService = inject(VSCodeService);
  private readonly destroyRef = inject(DestroyRef);

  /** Emitted when user clicks a search result to navigate to it */
  readonly searchResultSelected = output<{ filePath: string; line: number }>();

  // Icons
  readonly SearchIcon = Search;
  readonly XIcon = X;
  readonly RegexIcon = Regex;
  readonly CaseSensitiveIcon = CaseSensitive;
  readonly FileTextIcon = FileText;
  readonly ChevronRightIcon = ChevronRight;

  readonly ChevronDownIcon = ChevronDown;

  // State signals
  protected searchQuery = '';
  protected readonly isRegex = signal(false);
  protected readonly caseSensitive = signal(false);
  protected readonly searchResults = signal<SearchFileResult[]>([]);
  protected readonly isSearching = signal(false);
  protected readonly totalMatches = signal(0);
  protected readonly truncated = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly hasSearched = signal(false);

  /** Tracks which files are expanded in the results list */
  private readonly expandedFiles = signal<Set<string>>(new Set());

  /** Debounce timer handle */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Request counter for stale response protection */
  private searchRequestId = 0;

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
    });
  }

  protected onQueryChanged(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    const query = this.searchQuery.trim();
    if (!query) {
      this.searchResults.set([]);
      this.totalMatches.set(0);
      this.truncated.set(false);
      this.errorMessage.set(null);
      this.hasSearched.set(false);
      return;
    }

    this.debounceTimer = setTimeout(() => {
      void this.performSearch(query);
    }, 300);
  }

  protected clearSearch(): void {
    this.searchQuery = '';
    this.searchResults.set([]);
    this.totalMatches.set(0);
    this.truncated.set(false);
    this.errorMessage.set(null);
    this.hasSearched.set(false);
    this.expandedFiles.set(new Set());

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  protected toggleRegex(): void {
    this.isRegex.update((v) => !v);
    // Re-trigger search with updated mode
    this.onQueryChanged();
  }

  protected toggleCaseSensitive(): void {
    this.caseSensitive.update((v) => !v);
    // Re-trigger search with updated mode
    this.onQueryChanged();
  }

  protected isFileExpanded(filePath: string): boolean {
    return this.expandedFiles().has(filePath);
  }

  protected toggleFileExpanded(filePath: string): void {
    this.expandedFiles.update((set) => {
      const next = new Set(set);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }

  protected onMatchClick(filePath: string, line: number): void {
    this.searchResultSelected.emit({ filePath, line });
  }

  /**
   * Highlight the matched substring within the line text.
   * Uses column (1-based) and matchLength to wrap the match in a <mark> element.
   * Escapes HTML in the line text to prevent XSS.
   */
  protected highlightMatch(
    lineText: string,
    column: number,
    matchLength: number,
  ): string {
    // column is 1-based, convert to 0-based for string slicing
    const start = column - 1;
    const end = start + matchLength;

    if (start < 0 || start >= lineText.length || matchLength <= 0) {
      return this.escapeHtml(lineText);
    }

    // Escape each segment individually to handle HTML entities at correct offsets
    const before = this.escapeHtml(lineText.substring(0, start));
    const match = this.escapeHtml(lineText.substring(start, end));
    const after = this.escapeHtml(lineText.substring(end));

    return `${before}<mark class="bg-warning/40 text-inherit rounded-sm px-0.5">${match}</mark>${after}`;
  }

  private async performSearch(query: string): Promise<void> {
    const requestId = ++this.searchRequestId;
    this.isSearching.set(true);
    this.errorMessage.set(null);

    const result = await rpcCall<SearchInFilesResult>(
      this.vscodeService,
      'editor:searchInFiles',
      {
        query,
        isRegex: this.isRegex(),
        caseSensitive: this.caseSensitive(),
      },
    );

    // Discard stale response if a newer search was issued while awaiting
    if (this.searchRequestId !== requestId) {
      return;
    }

    this.isSearching.set(false);
    this.hasSearched.set(true);

    if (result.success && result.data) {
      const data = result.data;
      this.searchResults.set(data.files);
      this.totalMatches.set(data.totalMatches);
      this.truncated.set(data.truncated);

      // Auto-expand all files on new search
      const expanded = new Set<string>();
      for (const file of data.files) {
        expanded.add(file.filePath);
      }
      this.expandedFiles.set(expanded);
    } else {
      this.searchResults.set([]);
      this.totalMatches.set(0);
      this.truncated.set(false);
      this.errorMessage.set(result.error ?? 'Search failed');
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
