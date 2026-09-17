import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GitBranchesService } from '../services/git-branches.service';

@Component({
  selector: 'ptah-branch-picker-dropdown',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'relative',
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'close()',
  },
  template: `
    @if (isOpen()) {
      <div
        role="dialog"
        aria-label="Branch picker"
        data-testid="branch-picker"
        class="absolute top-full left-0 z-50 mt-1 min-w-72 rounded border border-base-content/10 bg-base-200 shadow-lg"
      >
        <input
          class="input input-xs m-2 w-[calc(100%-1rem)]"
          aria-label="Search branches"
          placeholder="Search branches…"
          [ngModel]="query()"
          (ngModelChange)="query.set($event)"
        />
        @if (dirtyBranch()) {
          <div role="alert" class="p-2 text-xs bg-warning/10 text-warning">
            Force checkout will discard all uncommitted changes.
            <button class="btn btn-warning btn-xs" (click)="confirmForce()">
              Discard changes and checkout
            </button>
            <button
              class="btn btn-ghost btn-xs"
              (click)="dirtyBranch.set(null)"
            >
              Cancel
            </button>
          </div>
        }
        @if (error()) {
          <div role="alert" class="p-2 text-error text-xs">{{ error() }}</div>
        }
        <div class="max-h-72 overflow-auto p-1">
          @if (!query() && gitBranches.recentBranches().length) {
            <p class="px-2 text-[10px] uppercase opacity-50">Recent</p>
          }
          @for (name of recent(); track name) {
            <button
              class="btn btn-ghost btn-xs w-full justify-start"
              (click)="checkout(name)"
            >
              {{ name }}
            </button>
          }
          <p class="px-2 text-[10px] uppercase opacity-50">Local</p>
          @for (branch of local(); track branch.name) {
            <button
              class="btn btn-ghost btn-xs w-full justify-start"
              [disabled]="branch.isCurrent"
              (click)="checkout(branch.name)"
            >
              {{ branch.name }}
              @if (branch.ahead) {
                <span>↑{{ branch.ahead }}</span>
              }
              @if (branch.behind) {
                <span>↓{{ branch.behind }}</span>
              }
            </button>
          }
          <p class="px-2 text-[10px] uppercase opacity-50">Remote</p>
          @for (branch of remote(); track branch.name) {
            <button
              class="btn btn-ghost btn-xs w-full justify-start"
              (click)="checkout(branch.name)"
            >
              {{ branch.name }}
            </button>
          }
        </div>
        <div class="flex gap-1 border-t border-base-content/10 p-2">
          <input
            class="input input-xs flex-1"
            aria-label="New branch name"
            placeholder="New branch"
            [ngModel]="newBranch()"
            (ngModelChange)="newBranch.set($event)"
            (keydown.enter)="create()"
          />
          <button
            class="btn btn-primary btn-xs"
            [disabled]="!newBranch().trim()"
            (click)="create()"
          >
            Create
          </button>
        </div>
      </div>
    }
  `,
})
export class BranchPickerDropdownComponent {
  protected readonly gitBranches = inject(GitBranchesService);
  private readonly element = inject(ElementRef<HTMLElement>);
  readonly isOpen = input.required<boolean>();
  readonly closed = output<void>();
  readonly branchCheckedOut = output<string>();
  protected readonly query = signal('');
  protected readonly newBranch = signal('');
  protected readonly dirtyBranch = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  private readonly lowerQuery = computed(() =>
    this.query().trim().toLowerCase(),
  );
  protected readonly local = computed(() =>
    this.visibleBranches(this.gitBranches.localBranches()),
  );
  protected readonly remote = computed(() =>
    this.visibleBranches(this.gitBranches.remoteBranches()),
  );
  protected readonly recent = computed(() =>
    this.gitBranches
      .recentBranches()
      .filter((name) => name.toLowerCase().includes(this.lowerQuery())),
  );

  private visibleBranches<T extends { name: string; lastCommitTime?: number }>(
    branches: readonly T[],
  ): T[] {
    const query = this.lowerQuery();
    if (query) {
      return branches.filter((branch) =>
        branch.name.toLowerCase().includes(query),
      );
    }
    return [...branches]
      .sort(
        (left, right) =>
          (right.lastCommitTime ?? 0) - (left.lastCommitTime ?? 0) ||
          left.name.localeCompare(right.name),
      )
      .slice(0, 10);
  }

  protected async checkout(branch: string, force = false): Promise<void> {
    const result = await this.gitBranches.checkout({ branch, force });
    if (result.success) {
      this.gitBranches.recordVisitedBranch(branch);
      this.branchCheckedOut.emit(branch);
      this.close();
    } else if (result.dirty && !force) this.dirtyBranch.set(branch);
    else this.error.set(result.error ?? 'Checkout failed.');
  }
  protected confirmForce(): void {
    const branch = this.dirtyBranch();
    if (branch) void this.checkout(branch, true);
  }
  protected create(): void {
    const branch = this.newBranch().trim();
    if (branch) void this.createBranch(branch);
  }
  private async createBranch(branch: string): Promise<void> {
    const result = await this.gitBranches.checkout({ branch, createNew: true });
    if (result.success) {
      this.gitBranches.recordVisitedBranch(branch);
      this.branchCheckedOut.emit(branch);
      this.close();
    } else this.error.set(result.error ?? 'Branch creation failed.');
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
