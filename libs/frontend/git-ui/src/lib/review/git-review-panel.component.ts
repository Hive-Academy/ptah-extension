import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AlertCircle,
  File,
  Files,
  Folder,
  FolderOpen,
  LoaderCircle,
  LucideAngularModule,
} from 'lucide-angular';
import type { GitReviewFile } from '@ptah-extension/shared';
import { GitReviewFileRowComponent } from './git-review-file-row.component';
import { GitReviewService } from '../services/git-review.service';
import {
  buildChangedFileTree,
  type ChangedFileTreeNode,
} from '../source-control/changed-file-tree';

type ReviewTreeNode = ChangedFileTreeNode<GitReviewFile>;

@Component({
  selector: 'ptah-git-review-panel',
  standalone: true,
  imports: [
    FormsModule,
    NgTemplateOutlet,
    LucideAngularModule,
    GitReviewFileRowComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'review-host flex-1 min-h-0 block' },
  styles: [
    `
      .review-host {
        container-type: inline-size;
      }
      .review-layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr) clamp(10rem, 28%, 16rem);
      }
      @container (max-width: 520px) {
        .review-layout {
          grid-template-columns: 1fr;
          grid-template-rows: minmax(0, 1fr) auto;
        }
        .review-rail {
          max-height: 12rem;
          border-left: 0;
          border-top: 1px solid oklch(var(--bc) / 0.1);
        }
      }
    `,
  ],
  template: `@if (review.loading()) {
      <div
        class="flex h-full flex-col items-center justify-center gap-2 p-6 text-sm opacity-60"
        role="status"
      >
        <lucide-angular
          [img]="LoaderIcon"
          class="h-6 w-6 animate-spin"
          aria-hidden="true"
        />
        Loading review…
      </div>
    } @else if (review.error()) {
      <div
        role="alert"
        class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-error"
      >
        <lucide-angular [img]="ErrorIcon" class="h-6 w-6" aria-hidden="true" />
        {{ review.error() }}
      </div>
    } @else if (!review.files().length) {
      <div
        class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm opacity-60"
      >
        <lucide-angular [img]="EmptyIcon" class="h-6 w-6" aria-hidden="true" />
        No files changed between these branches.
      </div>
    } @else {
      <div class="review-layout h-full">
        <section class="min-w-0 overflow-auto" aria-label="Changed files">
          @for (file of filteredFiles(); track file.path) {
            <ptah-git-review-file-row
              [file]="file"
              [workspaceRoot]="workspaceRoot()"
            />
          } @empty {
            <div
              class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm opacity-60"
            >
              <lucide-angular
                [img]="EmptyIcon"
                class="h-6 w-6"
                aria-hidden="true"
              />
              No matching changed files.
            </div>
          }
        </section>
        <aside
          class="review-rail overflow-auto border-l border-base-content/10 p-2"
          aria-label="Changed file tree"
        >
          <input
            class="input input-xs w-full"
            aria-label="Filter files"
            placeholder="Filter files"
            [ngModel]="review.filterQuery()"
            (ngModelChange)="review.setFilter($event)"
          />
          <div role="tree" class="mt-2 text-xs">
            @for (node of tree(); track node.path) {
              <ng-container
                [ngTemplateOutlet]="treeNode"
                [ngTemplateOutletContext]="{ $implicit: node }"
              />
            }
          </div>
          <ng-template #treeNode let-node>
            <div [style.padding-left.px]="depth(node.path) * 10">
              @if (node.kind === 'folder') {
                <button
                  type="button"
                  role="treeitem"
                  class="flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-base-content/10"
                  [attr.aria-expanded]="!isCollapsed(node.path)"
                  aria-selected="false"
                  [title]="node.path"
                  (click)="toggleFolder(node.path)"
                >
                  <lucide-angular
                    [img]="isCollapsed(node.path) ? FolderIcon : FolderOpenIcon"
                    class="h-3.5 w-3.5 shrink-0 text-warning"
                    aria-hidden="true"
                  />
                  <span class="truncate">{{ node.name }}</span>
                </button>
              } @else {
                <button
                  type="button"
                  role="treeitem"
                  class="flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-base-content/10"
                  [class.bg-base-content/10]="
                    review.expandedPath() === node.path
                  "
                  [attr.aria-selected]="review.expandedPath() === node.path"
                  [attr.aria-current]="
                    review.expandedPath() === node.path ? 'true' : null
                  "
                  [title]="node.path"
                  (click)="openTreeFile(node.path)"
                >
                  <lucide-angular
                    [img]="FileIcon"
                    [class]="
                      'h-3.5 w-3.5 shrink-0 ' + statusColor(node.file.status)
                    "
                    aria-hidden="true"
                  />
                  <span class="min-w-0 flex-1 truncate">{{ node.name }}</span>
                  @if (node.file.binary) {
                    <span class="shrink-0 opacity-50">binary</span>
                  } @else {
                    <span class="shrink-0 text-success"
                      >+{{ node.additions ?? '?' }}</span
                    >
                    <span class="shrink-0 text-error"
                      >-{{ node.deletions ?? '?' }}</span
                    >
                  }
                </button>
              }
            </div>
            @if (node.kind === 'folder' && !isCollapsed(node.path)) {
              @for (child of node.children; track child.path) {
                <ng-container
                  [ngTemplateOutlet]="treeNode"
                  [ngTemplateOutletContext]="{ $implicit: child }"
                />
              }
            }
          </ng-template>
        </aside>
      </div>
    }`,
})
export class GitReviewPanelComponent {
  protected readonly review = inject(GitReviewService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly workspaceRoot = input.required<string>();

  protected readonly LoaderIcon = LoaderCircle;
  protected readonly ErrorIcon = AlertCircle;
  protected readonly EmptyIcon = Files;
  protected readonly FolderIcon = Folder;
  protected readonly FolderOpenIcon = FolderOpen;
  protected readonly FileIcon = File;
  private readonly collapsedFolders = signal<ReadonlySet<string>>(new Set());

  protected readonly filteredFiles = computed(() => {
    const q = this.review.filterQuery().trim().toLowerCase();
    return q
      ? this.review
          .files()
          .filter((file) => file.path.toLowerCase().includes(q))
      : this.review.files();
  });
  protected readonly tree = computed<ReviewTreeNode[]>(() =>
    buildChangedFileTree(this.review.files(), this.review.filterQuery()),
  );

  protected depth(path: string): number {
    return path.split('/').length - 1;
  }

  protected isCollapsed(path: string): boolean {
    return this.collapsedFolders().has(path);
  }

  protected toggleFolder(path: string): void {
    const next = new Set(this.collapsedFolders());
    if (next.has(path)) next.delete(path);
    else next.add(path);
    this.collapsedFolders.set(next);
  }

  protected openTreeFile(path: string): void {
    if (this.review.expandedPath() !== path) void this.review.expand(path);
    queueMicrotask(() => {
      const row = Array.from(
        this.host.nativeElement.querySelectorAll<HTMLElement>(
          '[data-review-path]',
        ),
      ).find((element) => element.dataset['reviewPath'] === path);
      row?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  protected statusColor(status: GitReviewFile['status']): string {
    switch (status) {
      case 'A':
        return 'text-success';
      case 'M':
        return 'text-warning';
      case 'D':
        return 'text-error';
      case 'R':
      case 'C':
        return 'text-info';
    }
  }
}
