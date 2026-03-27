import {
  Component,
  inject,
  signal,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, GitFork, X } from 'lucide-angular';
import { WorktreeService } from '../services/worktree.service';

/**
 * AddWorktreeDialogComponent - Modal dialog for creating a new git worktree.
 *
 * Complexity Level: 1 (Simple - form signals, output events, DaisyUI modal)
 * Patterns: Standalone OnPush component, signal-based form state, output events
 *
 * Responsibilities:
 * - Collect branch name, optional custom path, and create-new-branch flag
 * - Call WorktreeService.addWorktree() on submit
 * - Display loading state during RPC and error messages on failure
 * - Emit worktreeCreated on success or cancelled on dismiss
 *
 * Placed inside GitStatusBarComponent, toggled via a signal.
 */
@Component({
  selector: 'ptah-add-worktree-dialog',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
  template: `
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-worktree-title"
      (click)="onBackdropClick($event)"
      (keydown.escape)="cancel()"
    >
      <div
        class="bg-base-100 rounded-lg shadow-xl w-full max-w-md p-6 border border-base-content/10"
        (click)="$event.stopPropagation()"
      >
        <!-- Header -->
        <div class="flex items-center justify-between mb-4">
          <h3
            id="add-worktree-title"
            class="text-lg font-semibold flex items-center gap-2"
          >
            <lucide-angular
              [img]="GitForkIcon"
              class="w-5 h-5"
              aria-hidden="true"
            />
            Add Worktree
          </h3>
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-square"
            aria-label="Close dialog"
            (click)="cancel()"
          >
            <lucide-angular [img]="XIcon" class="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <!-- Form -->
        <form (ngSubmit)="submit()" class="flex flex-col gap-4">
          <!-- Branch name -->
          <div class="form-control">
            <label class="label" for="worktree-branch">
              <span class="label-text">Branch Name</span>
            </label>
            <input
              id="worktree-branch"
              type="text"
              class="input input-bordered input-sm w-full"
              placeholder="e.g. feature/my-branch"
              [ngModel]="branchName()"
              (ngModelChange)="branchName.set($event)"
              name="branchName"
              required
              [disabled]="isSubmitting()"
              autocomplete="off"
            />
          </div>

          <!-- Custom path (optional) -->
          <div class="form-control">
            <label class="label" for="worktree-path">
              <span class="label-text">Custom Path</span>
              <span class="label-text-alt opacity-60">Optional</span>
            </label>
            <input
              id="worktree-path"
              type="text"
              class="input input-bordered input-sm w-full"
              placeholder="Defaults to ../<branch-name>"
              [ngModel]="customPath()"
              (ngModelChange)="customPath.set($event)"
              name="customPath"
              [disabled]="isSubmitting()"
              autocomplete="off"
            />
          </div>

          <!-- Create new branch checkbox -->
          <div class="form-control">
            <label class="label cursor-pointer justify-start gap-2">
              <input
                type="checkbox"
                class="checkbox checkbox-sm"
                [ngModel]="createNewBranch()"
                (ngModelChange)="createNewBranch.set($event)"
                name="createNewBranch"
                [disabled]="isSubmitting()"
              />
              <span class="label-text">Create new branch</span>
            </label>
          </div>

          <!-- Error message -->
          @if (errorMessage()) {
            <div class="alert alert-error text-sm py-2" role="alert">
              <span>{{ errorMessage() }}</span>
            </div>
          }

          <!-- Actions -->
          <div class="flex justify-end gap-2 mt-2">
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              (click)="cancel()"
              [disabled]="isSubmitting()"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="btn btn-primary btn-sm"
              [disabled]="!canSubmit()"
            >
              @if (isSubmitting()) {
                <span class="loading loading-spinner loading-xs"></span>
                Creating...
              } @else {
                Create Worktree
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddWorktreeDialogComponent {
  private readonly worktreeService = inject(WorktreeService);

  // ============================================================================
  // OUTPUT EVENTS
  // ============================================================================

  /** Emitted when a worktree is successfully created. */
  readonly worktreeCreated = output<void>();

  /** Emitted when the dialog is cancelled/dismissed. */
  readonly cancelled = output<void>();

  // ============================================================================
  // FORM STATE
  // ============================================================================

  /** Branch name input value. */
  readonly branchName = signal('');

  /** Optional custom path for the worktree directory. */
  readonly customPath = signal('');

  /** Whether to create a new branch (vs checkout an existing one). */
  readonly createNewBranch = signal(false);

  /** Whether a create request is in flight. */
  readonly isSubmitting = signal(false);

  /** Error message from the last failed attempt. */
  readonly errorMessage = signal('');

  // ============================================================================
  // ICONS
  // ============================================================================

  protected readonly GitForkIcon = GitFork;
  protected readonly XIcon = X;

  // ============================================================================
  // COMPUTED
  // ============================================================================

  /** Whether the form can be submitted (branch name is non-empty and not already submitting). */
  canSubmit(): boolean {
    return this.branchName().trim().length > 0 && !this.isSubmitting();
  }

  // ============================================================================
  // ACTIONS
  // ============================================================================

  /**
   * Submit the form: call WorktreeService.addWorktree().
   * On success, emit worktreeCreated and reset form.
   * On failure, display error message.
   */
  async submit(): Promise<void> {
    if (!this.canSubmit()) return;

    this.isSubmitting.set(true);
    this.errorMessage.set('');

    const result = await this.worktreeService.addWorktree(
      this.branchName().trim(),
      {
        path: this.customPath().trim() || undefined,
        createBranch: this.createNewBranch(),
      },
    );

    this.isSubmitting.set(false);

    if (result.success) {
      this.resetForm();
      this.worktreeCreated.emit();
    } else {
      this.errorMessage.set(result.error || 'Failed to create worktree');
    }
  }

  /** Cancel the dialog and emit the cancelled event. */
  cancel(): void {
    this.resetForm();
    this.cancelled.emit();
  }

  /** Close dialog on backdrop click (click outside the modal card). */
  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.cancel();
    }
  }

  // ============================================================================
  // PRIVATE
  // ============================================================================

  /** Reset all form fields to their defaults. */
  private resetForm(): void {
    this.branchName.set('');
    this.customPath.set('');
    this.createNewBranch.set(false);
    this.errorMessage.set('');
  }
}
