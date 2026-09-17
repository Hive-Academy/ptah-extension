import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import type { GitStashFileEntry, StashEntry } from '@ptah-extension/shared';
import {
  GitStashService,
  type GitStashMutation,
} from '../services/git-stash.service';
import { GitStatusService } from '../services/git-status.service';

const STATUS_LABELS: Record<GitStashFileEntry['status'], string> = {
  A: 'Added',
  M: 'Modified',
  D: 'Deleted',
  R: 'Renamed',
};

/** Coarse "3h ago" style age; empty when the backend sent no time. */
export function stashAge(
  epochMs: number | undefined,
  now = Date.now(),
): string {
  if (!epochMs) return '';
  const minutes = Math.max(0, Math.floor((now - epochMs) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(epochMs).toLocaleDateString();
}

/**
 * Stash viewer popover for the git dock header. Lists `stash@{N}` entries;
 * selecting one lists its files, a file opens a parent-vs-stash diff tab, and
 * each entry offers Apply / Pop / Drop (Drop confirms inline).
 */
@Component({
  selector: 'ptah-stash-popover',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'relative',
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'close()',
  },
  template: `@if (isOpen()) {
    <div
      role="dialog"
      aria-label="Stashes"
      data-testid="stash-popover"
      class="absolute top-full left-0 z-50 mt-1 w-96 max-w-[80vw] rounded border border-base-content/10 bg-base-200 text-xs shadow-lg"
    >
      @if (stash.error(); as error) {
        <div role="alert" class="p-2 text-error">{{ error }}</div>
      }
      @if (stash.listLoading() && stash.entries().length === 0) {
        <p class="p-3 opacity-60">Loading stashes…</p>
      } @else if (stash.entries().length === 0) {
        <p class="p-3 opacity-60" data-testid="stash-empty">No stashes.</p>
      } @else {
        <ul class="max-h-80 overflow-auto p-1" aria-label="Stash entries">
          @for (entry of stash.entries(); track entry.hash) {
            <li class="rounded" [class.bg-base-300]="isSelected(entry)">
              <div class="flex items-start gap-1 p-1">
                <button
                  type="button"
                  class="btn btn-ghost btn-xs h-auto min-h-0 flex-1 flex-col items-start gap-0 py-1 text-left font-normal"
                  data-testid="stash-entry"
                  [attr.aria-expanded]="isSelected(entry)"
                  [disabled]="stash.busy()"
                  (click)="stash.select(entry)"
                >
                  <span class="flex w-full gap-2">
                    <span class="font-mono opacity-70">{{
                      stashRef(entry)
                    }}</span>
                    <span class="ml-auto opacity-60">{{ age(entry) }}</span>
                  </span>
                  <span class="w-full truncate" [title]="entry.message">{{
                    entry.message
                  }}</span>
                  @if (entry.branch) {
                    <span class="opacity-60">on {{ entry.branch }}</span>
                  }
                </button>
              </div>
              <div class="flex gap-1 px-2 pb-1">
                @if (confirmDrop() === entry.hash) {
                  <span role="alert" class="mr-auto self-center text-warning"
                    >Drop this stash permanently?</span
                  >
                  <button
                    type="button"
                    class="btn btn-error btn-xs"
                    data-testid="stash-drop-confirm"
                    [disabled]="stash.busy()"
                    [attr.aria-label]="'Confirm drop ' + stashRef(entry)"
                    (click)="run('drop', entry)"
                  >
                    Drop
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs"
                    (click)="confirmDrop.set(null)"
                  >
                    Cancel
                  </button>
                } @else {
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs"
                    data-testid="stash-apply"
                    [disabled]="stash.busy()"
                    [attr.aria-label]="'Apply ' + stashRef(entry)"
                    (click)="run('apply', entry)"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs"
                    data-testid="stash-pop"
                    [disabled]="stash.busy()"
                    [attr.aria-label]="'Pop ' + stashRef(entry)"
                    (click)="run('pop', entry)"
                  >
                    Pop
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs text-error"
                    data-testid="stash-drop"
                    [disabled]="stash.busy()"
                    [attr.aria-label]="'Drop ' + stashRef(entry)"
                    (click)="confirmDrop.set(entry.hash)"
                  >
                    Drop
                  </button>
                }
              </div>
              @if (isSelected(entry)) {
                @if (stash.filesLoading()) {
                  <p class="px-3 pb-2 opacity-60">Loading files…</p>
                } @else {
                  <ul class="px-2 pb-2" aria-label="Files in stash">
                    @for (file of stash.files(); track file.path) {
                      <li>
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs w-full justify-start gap-2 font-normal"
                          data-testid="stash-file"
                          [title]="'Open diff for ' + file.path"
                          [disabled]="stash.busy()"
                          (click)="stash.openFileDiff(file)"
                        >
                          <span
                            class="w-3 font-mono"
                            [attr.aria-label]="statusLabel(file)"
                            >{{ file.status }}</span
                          >
                          <span class="truncate">{{ file.path }}</span>
                        </button>
                      </li>
                    } @empty {
                      <li class="px-1 opacity-60">No file changes.</li>
                    }
                  </ul>
                }
              }
            </li>
          }
        </ul>
      }
    </div>
  }`,
})
export class StashPopoverComponent {
  protected readonly stash = inject(GitStashService);
  private readonly gitStatus = inject(GitStatusService, { optional: true });
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly isOpen = input.required<boolean>();
  readonly closed = output<void>();
  protected readonly confirmDrop = linkedSignal<
    readonly unknown[],
    string | null
  >({
    source: () => [
      this.isOpen(),
      this.gitStatus?.activeWorkspacePath() ?? null,
      this.stash
        .entries()
        .map((e) => e.hash)
        .join(','),
    ],
    computation: () => null,
  });

  constructor() {
    effect(() => {
      if (this.isOpen()) void this.stash.loadList();
    });
  }

  protected isSelected(entry: StashEntry): boolean {
    return this.stash.selectedIndex() === entry.index;
  }

  protected stashRef(entry: StashEntry): string {
    return `stash@{${entry.index}}`;
  }

  protected age(entry: StashEntry): string {
    return stashAge(entry.time);
  }

  protected statusLabel(file: GitStashFileEntry): string {
    return STATUS_LABELS[file.status];
  }

  protected async run(
    kind: GitStashMutation,
    entry: StashEntry,
  ): Promise<void> {
    this.confirmDrop.set(null);
    await this.stash.mutate(kind, entry);
  }

  close(): void {
    if (this.isOpen()) this.closed.emit();
  }

  onDocumentClick(event: MouseEvent): void {
    if (
      this.isOpen() &&
      event.target instanceof Node &&
      !this.element.nativeElement.contains(event.target)
    )
      this.close();
  }
}
