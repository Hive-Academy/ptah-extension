import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GitReviewFileRowComponent } from './git-review-file-row.component';
import { GitReviewService } from '../services/git-review.service';
import {
  buildChangedFileTree,
  type ChangedFileTreeNode,
} from '../source-control/changed-file-tree';

@Component({
  selector: 'ptah-git-review-panel',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, GitReviewFileRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'review-host flex-1 min-h-0 block' },
  styles: [
    `
      .review-host {
        container-type: inline-size;
      }
      .review-layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 13rem;
      }
      @container (max-width:520px) {
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
      <div class="p-4">Loading review…</div>
    } @else if (review.error()) {
      <div role="alert" class="p-4 text-error">{{ review.error() }}</div>
    } @else {
      <div class="review-layout h-full">
        <section class="min-w-0 overflow-auto">
          @for (file of filteredFiles(); track file.path) {
            <ptah-git-review-file-row
              [file]="file"
              [workspaceRoot]="workspaceRoot()"
            />
          } @empty {
            <p class="p-4 opacity-60">No matching changed files.</p>
          }
        </section>
        <aside
          class="review-rail overflow-auto border-l border-base-content/10 p-2"
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
          <ng-template #treeNode let-node
            ><div [style.padding-left.px]="depth(node.path) * 10">
              <button
                class="truncate"
                [disabled]="node.kind === 'folder'"
                (click)="node.kind === 'file' && review.expand(node.path)"
              >
                {{ node.kind === 'folder' ? '▾' : '·' }} {{ node.name }}
                @if (node.kind === 'file') {
                  <span class="text-success">+{{ node.additions ?? '?' }}</span>
                  <span class="text-error">-{{ node.deletions ?? '?' }}</span>
                }
              </button>
            </div>
            @for (child of node.children; track child.path) {
              <ng-container
                [ngTemplateOutlet]="treeNode"
                [ngTemplateOutletContext]="{ $implicit: child }"
              />
            }
          </ng-template>
        </aside>
      </div>
    }`,
})
export class GitReviewPanelComponent {
  protected readonly review = inject(GitReviewService);
  readonly workspaceRoot = input.required<string>();
  protected readonly filteredFiles = computed(() => {
    const q = this.review.filterQuery().trim().toLowerCase();
    return q
      ? this.review.files().filter((f) => f.path.toLowerCase().includes(q))
      : this.review.files();
  });
  protected readonly tree = computed<ChangedFileTreeNode[]>(() =>
    buildChangedFileTree(this.review.files(), this.review.filterQuery()),
  );
  protected depth(path: string): number {
    return path.split('/').length - 1;
  }
}
