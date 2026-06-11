import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import type { CodeSymbolListItem } from '@ptah-extension/shared';

@Component({
  selector: 'ptah-memory-indexed-code',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div class="space-y-3" data-testid="memory-indexed-code">
      <div class="flex flex-wrap items-center gap-3">
        <input
          type="search"
          class="input input-sm input-bordered w-full max-w-sm"
          placeholder="Search indexed symbols..."
          [value]="searchValue()"
          (input)="onSearchInput($event)"
          aria-label="Search indexed code symbols"
        />
        <div
          class="ml-auto flex items-center gap-2 text-xs text-base-content/60"
        >
          <span data-testid="symbol-total">{{ total() }} symbols</span>
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            [disabled]="loading()"
            (click)="reload.emit()"
            aria-label="Reload symbol list"
          >
            @if (loading()) {
              <span class="loading loading-spinner loading-xs"></span>
            }
            Reload
          </button>
        </div>
      </div>

      @if (error()) {
        <div
          class="rounded-xl border border-error/40 bg-error/5 px-4 py-3"
          role="alert"
        >
          <span class="text-sm text-error">{{ error() }}</span>
        </div>
      }

      @if (loading() && items().length === 0) {
        <div
          class="overflow-hidden rounded-xl border border-base-300 bg-base-200/40"
        >
          <div class="divide-y divide-base-300/70">
            @for (n of skeletonRows; track n) {
              <div class="flex items-center gap-3 px-4 py-2.5">
                <div class="skeleton h-3 w-40"></div>
                <div class="skeleton h-3 flex-1"></div>
              </div>
            }
          </div>
        </div>
      } @else if (items().length === 0) {
        <div class="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <p class="text-sm font-medium">No indexed code symbols</p>
          <p class="text-xs text-base-content/60">
            Run the workspace index below to populate symbol search.
          </p>
        </div>
      } @else {
        <ul
          class="divide-y divide-base-300/70 overflow-hidden rounded-xl border border-base-300 bg-base-200/40"
        >
          @for (sym of items(); track sym.id) {
            <li
              class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 transition-colors duration-150 hover:bg-base-300/30"
            >
              <span class="font-mono text-sm text-base-content">
                {{ sym.symbolName }}
              </span>
              <span class="text-xs text-base-content/60">{{ sym.kind }}</span>
              <span
                class="min-w-0 flex-1 truncate text-xs text-base-content/60"
                [attr.title]="sym.filePath"
              >
                {{ relativePath(sym.filePath) }}
              </span>
              <span class="text-xs tabular-nums text-base-content/50">
                {{ sym.tokenCount }} tok
              </span>
            </li>
          }
        </ul>
      }

      <div
        class="flex items-center justify-between text-xs text-base-content/60"
      >
        <span>
          {{ offset() + 1 }}–{{ offset() + items().length }} of {{ total() }}
        </span>
        <div class="join">
          <button
            type="button"
            class="btn join-item btn-xs"
            [disabled]="prevDisabled() || loading()"
            (click)="prev.emit()"
            aria-label="Previous symbol page"
          >
            Prev
          </button>
          <button
            type="button"
            class="btn join-item btn-xs"
            [disabled]="nextDisabled() || loading()"
            (click)="next.emit()"
            aria-label="Next symbol page"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  `,
})
export class MemoryIndexedCodeComponent {
  public readonly searchValue = input<string>('');
  public readonly items = input.required<readonly CodeSymbolListItem[]>();
  public readonly total = input<number>(0);
  public readonly loading = input<boolean>(false);
  public readonly error = input<string | null>(null);
  public readonly offset = input<number>(0);
  public readonly prevDisabled = input<boolean>(false);
  public readonly nextDisabled = input<boolean>(false);
  public readonly workspaceRoot = input<string>('');

  public readonly searchInput = output<string>();
  public readonly reload = output<void>();
  public readonly prev = output<void>();
  public readonly next = output<void>();

  protected readonly skeletonRows = [0, 1, 2, 3, 4] as const;

  protected onSearchInput(event: Event): void {
    this.searchInput.emit((event.target as HTMLInputElement).value);
  }

  protected relativePath(filePath: string): string {
    const root = this.workspaceRoot();
    if (root.length === 0) return filePath;
    const normalizedRoot = root.replace(/\\/g, '/');
    const normalizedPath = filePath.replace(/\\/g, '/');
    if (
      normalizedPath === normalizedRoot ||
      normalizedPath.startsWith(normalizedRoot + '/')
    ) {
      return normalizedPath.slice(normalizedRoot.length + 1);
    }
    return filePath;
  }
}
