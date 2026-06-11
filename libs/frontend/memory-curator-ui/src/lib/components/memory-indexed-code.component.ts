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
    <details
      class="collapse collapse-arrow rounded-lg border border-base-300 bg-base-100"
      [open]="open()"
      (toggle)="toggled.emit($event)"
      data-testid="memory-indexed-code-details"
    >
      <summary
        class="collapse-title min-h-0 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-base-content/70"
      >
        Indexed code
      </summary>
      <div class="collapse-content flex flex-col gap-2">
        <div class="flex flex-col gap-2 md:flex-row md:items-center">
          <input
            type="search"
            class="input input-sm input-bordered w-full md:max-w-md"
            placeholder="Search indexed symbols..."
            [value]="searchValue()"
            (input)="onSearchInput($event)"
            aria-label="Search indexed code symbols"
          />
          <div
            class="flex items-center gap-2 ml-auto text-xs text-base-content/70"
          >
            <span data-testid="symbol-total">{{ total() }} symbols</span>
            <button
              type="button"
              class="btn btn-xs btn-ghost"
              [disabled]="loading()"
              (click)="reload.emit()"
              aria-label="Reload symbol list"
            >
              @if (loading()) {
                <span class="loading loading-spinner loading-xs"></span>
              }
              Re-load
            </button>
          </div>
        </div>

        @if (error()) {
          <div role="alert" class="alert alert-error">
            <span class="text-sm">{{ error() }}</span>
          </div>
        }

        @if (loading() && items().length === 0) {
          <div class="flex items-center justify-center py-6">
            <span class="loading loading-spinner loading-md"></span>
          </div>
        } @else if (items().length === 0) {
          <div
            class="rounded-lg border border-dashed border-base-300 p-6 text-center text-sm text-base-content/60"
          >
            No indexed code symbols match the current search.
          </div>
        } @else {
          <ul class="flex flex-col gap-1">
            @for (sym of items(); track sym.id) {
              <li
                class="flex flex-col gap-1 rounded-lg border border-base-300 bg-base-100 p-2 md:flex-row md:items-center md:gap-3"
              >
                <span class="font-mono text-sm text-base-content">
                  {{ sym.symbolName }}
                </span>
                <span class="badge badge-sm badge-ghost">{{ sym.kind }}</span>
                <span
                  class="flex-1 truncate text-xs text-base-content/60"
                  [attr.title]="sym.filePath"
                >
                  {{ relativePath(sym.filePath) }}
                </span>
                <span class="badge badge-sm badge-outline">
                  {{ sym.tokenCount }} tok
                </span>
              </li>
            }
          </ul>
        }

        <div
          class="flex items-center justify-between pt-1 text-xs text-base-content/70"
        >
          <span>
            {{ offset() + 1 }}–{{ offset() + items().length }} of {{ total() }}
          </span>
          <div class="flex gap-1">
            <button
              type="button"
              class="btn btn-xs btn-ghost"
              [disabled]="prevDisabled() || loading()"
              (click)="prev.emit()"
              aria-label="Previous symbol page"
            >
              Prev
            </button>
            <button
              type="button"
              class="btn btn-xs btn-ghost"
              [disabled]="nextDisabled() || loading()"
              (click)="next.emit()"
              aria-label="Next symbol page"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </details>
  `,
})
export class MemoryIndexedCodeComponent {
  public readonly open = input<boolean>(false);
  public readonly searchValue = input<string>('');
  public readonly items = input.required<readonly CodeSymbolListItem[]>();
  public readonly total = input<number>(0);
  public readonly loading = input<boolean>(false);
  public readonly error = input<string | null>(null);
  public readonly offset = input<number>(0);
  public readonly prevDisabled = input<boolean>(false);
  public readonly nextDisabled = input<boolean>(false);
  public readonly workspaceRoot = input<string>('');

  public readonly toggled = output<Event>();
  public readonly searchInput = output<string>();
  public readonly reload = output<void>();
  public readonly prev = output<void>();
  public readonly next = output<void>();

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
