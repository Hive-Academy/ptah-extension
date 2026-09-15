import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GitBranchesService } from '../services/git-branches.service';
import {
  GitReviewService,
  type GitReviewMode,
} from '../services/git-review.service';

@Component({
  selector: 'ptah-git-review-toolbar',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div
    class="flex flex-col gap-1 border-b border-base-content/10 bg-base-200 px-2 py-1 text-xs"
    data-testid="git-review-toolbar"
  >
    <div role="group" aria-label="Review mode" class="join self-start">
      <button
        class="btn btn-xs join-item"
        [class.btn-active]="review.mode() === 'working-tree'"
        (click)="mode('working-tree')"
      >
        Working tree</button
      ><button
        class="btn btn-xs join-item"
        [class.btn-active]="review.mode() === 'branch-review'"
        (click)="mode('branch-review')"
      >
        Branch review
      </button>
    </div>
    @if (review.mode() === 'branch-review') {
      <div class="flex min-w-0 items-center gap-1.5">
        <label class="sr-only" for="git-review-base">Base</label>
        <select
          id="git-review-base"
          class="select select-xs min-w-0 flex-1 truncate"
          aria-label="Review base"
          [ngModel]="review.base()"
          (ngModelChange)="review.setBase($event)"
        >
          @for (branch of branches.localBranches(); track branch.name) {
            <option [value]="branch.name">{{ branch.name }}</option>
          }
        </select>
        <span class="shrink-0 opacity-50" aria-hidden="true">←</span>
        <label class="sr-only" for="git-review-head">Head</label>
        <select
          id="git-review-head"
          class="select select-xs min-w-0 flex-1 truncate"
          aria-label="Review head"
          [ngModel]="review.head()"
          (ngModelChange)="review.setHead($event)"
        >
          <option value="HEAD">HEAD</option>
          @for (branch of branches.localBranches(); track branch.name) {
            <option [value]="branch.name">{{ branch.name }}</option>
          }
        </select>
        @if (review.result(); as result) {
          <span
            class="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap"
          >
            <span>{{ result.files.length }} files changed</span>
            <span class="text-success">+{{ result.totals.additions }}</span>
            <span class="text-error">-{{ result.totals.deletions }}</span>
            @if (result.totals.binaryFiles) {
              <span class="opacity-60"
                >{{ result.totals.binaryFiles }} binary</span
              >
            }
          </span>
        }
      </div>
    }
  </div>`,
})
export class GitReviewToolbarComponent {
  protected readonly review = inject(GitReviewService);
  protected readonly branches = inject(GitBranchesService);

  protected mode(mode: GitReviewMode): void {
    this.review.setMode(mode);
  }
}
