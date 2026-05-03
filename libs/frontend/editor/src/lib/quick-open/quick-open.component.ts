import {
  Component,
  signal,
  computed,
  output,
  inject,
  ChangeDetectionStrategy,
  ElementRef,
  viewChild,
  afterNextRender,
  OnDestroy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Search, FileText } from 'lucide-angular';
import { VSCodeService, rpcCall } from '@ptah-extension/core';

/**
 * QuickOpenComponent - File picker modal (Ctrl+P / Cmd+P).
 *
 * Complexity Level: 2 (Medium - RPC fetch, fuzzy filtering, keyboard navigation)
 * Patterns: Standalone, OnPush, signal-based state, composition
 *
 * Displays a command-palette-style overlay at the top of the editor.
 * On open, fetches the full file list via `editor:listAllFiles` RPC and caches it.
 * The user types to fuzzy-filter files, navigates with Up/Down arrows,
 * and selects with Enter or click.
 */
@Component({
  selector: 'ptah-quick-open',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
  template: `
    <!-- Backdrop -->
    <div
      class="fixed inset-0 z-50 bg-black/40"
      (click)="close()"
      (keydown.escape)="close()"
    >
      <!-- Modal container - top-centered like VS Code command palette -->
      <div
        class="mx-auto mt-[10%] w-full max-w-lg"
        role="dialog"
        aria-label="Quick open file"
        (click)="$event.stopPropagation()"
      >
        <!-- Search input -->
        <div
          class="bg-base-200 rounded-t-lg border border-base-content/10 px-3 py-2 flex items-center gap-2"
        >
          <lucide-angular
            [img]="SearchIcon"
            class="w-4 h-4 opacity-40 flex-shrink-0"
          />
          <input
            #searchInput
            type="text"
            class="bg-transparent w-full text-sm outline-none placeholder:text-base-content/30"
            placeholder="Type a file name to open..."
            aria-label="File search query"
            [ngModel]="query()"
            (ngModelChange)="onQueryChanged($event)"
            (keydown)="onKeydown($event)"
          />
        </div>

        <!-- Results list -->
        <div
          class="bg-base-200 rounded-b-lg border border-t-0 border-base-content/10 max-h-[384px] overflow-y-auto scrollbar-thin"
          role="listbox"
          aria-label="File results"
        >
          @if (isLoading()) {
            <div class="flex items-center justify-center p-4">
              <span class="loading loading-spinner loading-sm"></span>
              <span class="text-xs opacity-60 ml-2">Loading files...</span>
            </div>
          } @else if (errorMessage()) {
            <div class="px-3 py-4 text-xs text-error text-center">
              {{ errorMessage() }}
            </div>
          } @else if (filteredFiles().length === 0 && query()) {
            <div class="px-3 py-4 text-[10px] opacity-40 text-center">
              No files match "{{ query() }}"
            </div>
          } @else if (filteredFiles().length === 0) {
            <div class="px-3 py-4 text-[10px] opacity-40 text-center">
              No files found in workspace
            </div>
          } @else {
            @for (file of filteredFiles(); track file; let i = $index) {
              <button
                type="button"
                class="flex items-center gap-2 w-full px-3 py-1.5 text-left transition-colors"
                [class.bg-primary/15]="i === selectedIndex()"
                [class.hover:bg-base-300]="i !== selectedIndex()"
                role="option"
                [attr.aria-selected]="i === selectedIndex()"
                (click)="selectFile(file)"
                (mouseenter)="selectedIndex.set(i)"
              >
                <lucide-angular
                  [img]="FileIcon"
                  class="w-3.5 h-3.5 opacity-40 flex-shrink-0"
                />
                <div class="flex flex-col min-w-0">
                  <span class="text-xs font-medium truncate">{{
                    getFileName(file)
                  }}</span>
                  <span class="text-[10px] opacity-40 truncate">{{
                    file
                  }}</span>
                </div>
              </button>
            }
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: contents;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuickOpenComponent implements OnDestroy {
  private readonly vscodeService = inject(VSCodeService);

  /** Emitted when the user selects a file */
  readonly fileSelected = output<{ filePath: string }>();

  /** Emitted when the modal should close */
  readonly closed = output<void>();

  // Icons
  readonly SearchIcon = Search;
  readonly FileIcon = FileText;

  // Reference to the search input for auto-focus
  private readonly searchInputRef =
    viewChild<ElementRef<HTMLInputElement>>('searchInput');

  // State
  protected readonly query = signal('');
  protected readonly isLoading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly selectedIndex = signal(0);

  /** Cached flat list of all workspace file paths */
  private readonly allFiles = signal<string[]>([]);

  /** Filtered and capped results based on query */
  protected readonly filteredFiles = computed(() => {
    const files = this.allFiles();
    const q = this.query().trim().toLowerCase();

    if (!q) {
      return files.slice(0, 50);
    }

    const matches: string[] = [];
    for (const filePath of files) {
      if (this.fuzzyMatch(filePath.toLowerCase(), q)) {
        matches.push(filePath);
        if (matches.length >= 50) break;
      }
    }
    return matches;
  });

  /** Global keydown handler reference for cleanup */
  private globalKeydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
    // Fetch files on creation
    void this.fetchFiles();

    // Auto-focus input after render
    afterNextRender(() => {
      const inputEl = this.searchInputRef()?.nativeElement;
      if (inputEl) {
        inputEl.focus();
      }
    });

    // Prevent Ctrl+P from firing again while open
    this.globalKeydownHandler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', this.globalKeydownHandler, true);
  }

  ngOnDestroy(): void {
    if (this.globalKeydownHandler) {
      document.removeEventListener('keydown', this.globalKeydownHandler, true);
      this.globalKeydownHandler = null;
    }
  }

  /**
   * Fetch the full flat file list from the backend via RPC.
   * Called once on open; the result is cached in allFiles signal.
   */
  private async fetchFiles(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    const result = await rpcCall<{ files: string[] }>(
      this.vscodeService,
      'editor:listAllFiles',
      {},
    );

    this.isLoading.set(false);

    if (result.success && result.data) {
      this.allFiles.set(result.data.files);
    } else {
      this.errorMessage.set(result.error ?? 'Failed to load file list');
    }
  }

  /** Handle query input changes — update signal and reset selection to top */
  protected onQueryChanged(value: string): void {
    this.query.set(value);
    this.selectedIndex.set(0);
  }

  /** Handle keyboard navigation within the input */
  protected onKeydown(event: KeyboardEvent): void {
    const files = this.filteredFiles();

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.selectedIndex.update((i) => (i < files.length - 1 ? i + 1 : 0));
        this.scrollSelectedIntoView();
        break;

      case 'ArrowUp':
        event.preventDefault();
        this.selectedIndex.update((i) => (i > 0 ? i - 1 : files.length - 1));
        this.scrollSelectedIntoView();
        break;

      case 'Enter':
        event.preventDefault();
        if (files.length > 0) {
          const idx = this.selectedIndex();
          const file = files[idx];
          if (file) {
            this.selectFile(file);
          }
        }
        break;

      case 'Escape':
        event.preventDefault();
        this.close();
        break;
    }
  }

  /** Select a file and emit the event */
  protected selectFile(filePath: string): void {
    this.fileSelected.emit({ filePath });
    this.close();
  }

  /** Close the modal */
  protected close(): void {
    this.closed.emit();
  }

  /**
   * Extract the file name from a relative path.
   * e.g. "libs/frontend/editor/src/lib/search/search-panel.component.ts" -> "search-panel.component.ts"
   */
  protected getFileName(filePath: string): string {
    const parts = filePath.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || filePath;
  }

  /**
   * Simple fuzzy match: checks if all characters of the query appear
   * in order within the target string.
   */
  private fuzzyMatch(target: string, query: string): boolean {
    let qi = 0;
    for (let ti = 0; ti < target.length && qi < query.length; ti++) {
      if (target[ti] === query[qi]) {
        qi++;
      }
    }
    return qi === query.length;
  }

  /**
   * Scroll the currently selected item into view within the results list.
   */
  private scrollSelectedIntoView(): void {
    // Use requestAnimationFrame to ensure DOM has updated
    requestAnimationFrame(() => {
      const selected = document.querySelector('[aria-selected="true"]');
      if (selected) {
        selected.scrollIntoView({ block: 'nearest' });
      }
    });
  }
}
