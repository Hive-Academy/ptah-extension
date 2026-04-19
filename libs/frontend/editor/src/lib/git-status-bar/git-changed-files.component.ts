import {
  Component,
  input,
  output,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  LucideAngularModule,
  FileEdit,
  FilePlus,
  FileMinus,
  FileQuestion,
  FileCode,
} from 'lucide-angular';
import type { GitFileStatus } from '@ptah-extension/shared';

/**
 * GitChangedFilesComponent - Dropdown panel listing all changed files grouped by status.
 *
 * Complexity Level: 1 (Simple atom - receives data via inputs, emits click events)
 * Patterns: Standalone component, OnPush, signal-based inputs
 *
 * Renders below the git status bar when toggled. Shows changed files grouped as:
 * - Staged changes (index)
 * - Unstaged changes (worktree)
 * Clicking a file emits the relative git path for the parent to resolve and open.
 */
@Component({
  selector: 'ptah-git-changed-files',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <div
      class="bg-base-300 border-b border-base-content/10 max-h-[280px] overflow-y-auto
             scrollbar-thin text-xs"
      role="list"
      aria-label="Changed files"
    >
      <!-- Staged changes -->
      @if (stagedFiles().length > 0) {
        <div
          class="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider
                 opacity-50 bg-base-200 sticky top-0 z-10"
        >
          Staged ({{ stagedFiles().length }})
        </div>
        @for (file of stagedFiles(); track file.path) {
          <button
            type="button"
            class="flex items-center gap-2 w-full px-3 py-1 text-left
                   hover:bg-base-content/10 transition-colors group"
            role="listitem"
            [title]="file.path"
            (click)="fileClicked.emit(file.path)"
          >
            <lucide-angular
              [img]="getStatusIcon(file.status)"
              [class]="
                'w-3.5 h-3.5 flex-shrink-0 ' + getStatusColor(file.status)
              "
              aria-hidden="true"
            />
            <span class="truncate opacity-80 group-hover:opacity-100">{{
              getFileName(file.path)
            }}</span>
            <span
              class="ml-auto text-[10px] font-mono opacity-40 flex-shrink-0"
              >{{ file.status }}</span
            >
          </button>
        }
      }

      <!-- Unstaged changes -->
      @if (unstagedFiles().length > 0) {
        <div
          class="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider
                 opacity-50 bg-base-200 sticky top-0 z-10"
        >
          Changes ({{ unstagedFiles().length }})
        </div>
        @for (file of unstagedFiles(); track file.path) {
          <button
            type="button"
            class="flex items-center gap-2 w-full px-3 py-1 text-left
                   hover:bg-base-content/10 transition-colors group"
            role="listitem"
            [title]="file.path"
            (click)="fileClicked.emit(file.path)"
          >
            <lucide-angular
              [img]="getStatusIcon(file.status)"
              [class]="
                'w-3.5 h-3.5 flex-shrink-0 ' + getStatusColor(file.status)
              "
              aria-hidden="true"
            />
            <span class="truncate opacity-80 group-hover:opacity-100">{{
              getFileName(file.path)
            }}</span>
            <span
              class="ml-auto text-[10px] font-mono opacity-40 flex-shrink-0"
              >{{ file.status }}</span
            >
          </button>
        }
      }

      <!-- Empty state -->
      @if (stagedFiles().length === 0 && unstagedFiles().length === 0) {
        <div class="px-3 py-3 text-center opacity-40">No changes detected</div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GitChangedFilesComponent {
  readonly files = input.required<GitFileStatus[]>();

  /** Emits the relative path of the clicked file. */
  readonly fileClicked = output<string>();

  protected readonly stagedFiles = computed(() =>
    this.files().filter((f) => f.staged),
  );

  protected readonly unstagedFiles = computed(() =>
    this.files().filter((f) => !f.staged),
  );

  protected getStatusIcon(status: string): typeof FileEdit {
    switch (status) {
      case 'M':
        return FileEdit;
      case 'A':
        return FilePlus;
      case 'D':
        return FileMinus;
      case '??':
        return FileQuestion;
      default:
        return FileCode;
    }
  }

  protected getStatusColor(status: string): string {
    switch (status) {
      case 'M':
        return 'text-warning';
      case 'A':
        return 'text-success';
      case 'D':
        return 'text-error';
      case '??':
        return 'text-info';
      default:
        return 'opacity-60';
    }
  }

  protected getFileName(path: string): string {
    return path.replace(/\\/g, '/').split('/').pop() ?? path;
  }
}
