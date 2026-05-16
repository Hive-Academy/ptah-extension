import {
  Component,
  input,
  output,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Plus,
  Minus,
  ChevronDown,
  ChevronRight,
} from 'lucide-angular';
import type { GitFileStatus } from '@ptah-extension/shared';
import { SourceControlService } from '../services/source-control.service';
import { SourceControlFileComponent } from './source-control-file.component';
import { WorktreeSectionComponent } from '../worktree/worktree-section.component';

/**
 * SourceControlPanelComponent - Main source control panel with commit UI and file groups.
 *
 * Complexity Level: 2 (Medium - service injection, computed signals, commit workflow)
 * Patterns: Standalone, OnPush, signal-based, facade service delegation
 *
 * Layout (top to bottom):
 * 1. Commit message textarea + commit button
 * 2. Collapsible "Staged Changes (N)" section
 * 3. Collapsible "Changes (N)" section
 *
 * After stage/unstage/discard/commit, the GitStatusService auto-refreshes
 * via push events from the backend watcher (no manual refresh needed).
 */
@Component({
  selector: 'ptah-source-control-panel',
  standalone: true,
  imports: [
    FormsModule,
    LucideAngularModule,
    SourceControlFileComponent,
    WorktreeSectionComponent,
  ],
  template: `
    <div
      class="flex flex-col h-full overflow-y-auto scrollbar-thin"
      role="region"
      aria-label="Source Control"
    >
      <!-- Commit area -->
      <div class="p-2 border-b border-base-300 flex-shrink-0">
        <textarea
          class="textarea textarea-bordered textarea-xs w-full resize-none"
          rows="3"
          placeholder="Commit message"
          aria-label="Commit message"
          [(ngModel)]="commitMessage"
          [disabled]="isCommitting()"
        ></textarea>
        <button
          class="btn btn-primary btn-xs w-full mt-1"
          [disabled]="!canCommit"
          (click)="onCommit()"
        >
          @if (isCommitting()) {
            <span class="loading loading-spinner loading-xs"></span>
            Committing...
          } @else {
            Commit ({{ stagedFiles().length }})
          }
        </button>
      </div>

      <!-- Staged Changes section -->
      <div class="flex-shrink-0">
        <button
          type="button"
          class="flex items-center gap-1 w-full px-2 py-1 text-[10px] font-semibold
                 uppercase tracking-wider opacity-70 hover:opacity-100
                 bg-base-200 transition-opacity cursor-pointer"
          (click)="stagedExpanded.set(!stagedExpanded())"
          aria-label="Toggle staged changes section"
        >
          <lucide-angular
            [img]="stagedExpanded() ? ChevronDownIcon : ChevronRightIcon"
            class="w-3 h-3 flex-shrink-0"
          />
          <span>Staged Changes ({{ stagedFiles().length }})</span>
          @if (stagedFiles().length > 0) {
            <button
              type="button"
              class="btn btn-ghost btn-xs p-0.5 h-auto min-h-0 ml-auto"
              title="Unstage all"
              aria-label="Unstage all files"
              (click)="onUnstageAll($event)"
            >
              <lucide-angular [img]="MinusIcon" class="w-3.5 h-3.5" />
            </button>
          }
        </button>
        @if (stagedExpanded()) {
          <div role="list" aria-label="Staged files">
            @for (file of stagedFiles(); track file.path) {
              <ptah-source-control-file
                [file]="file"
                [staged]="true"
                (unstage)="onUnstageFile($event)"
                (discard)="onDiscardFile($event)"
                (openDiff)="diffRequested.emit($event)"
                (openFile)="fileClicked.emit($event)"
              />
            }
            @if (stagedFiles().length === 0) {
              <div class="px-3 py-2 text-[10px] opacity-40 text-center">
                No staged changes
              </div>
            }
          </div>
        }
      </div>

      <!-- Unstaged Changes section -->
      <div class="flex-shrink-0">
        <button
          type="button"
          class="flex items-center gap-1 w-full px-2 py-1 text-[10px] font-semibold
                 uppercase tracking-wider opacity-70 hover:opacity-100
                 bg-base-200 transition-opacity cursor-pointer"
          (click)="unstagedExpanded.set(!unstagedExpanded())"
          aria-label="Toggle changes section"
        >
          <lucide-angular
            [img]="unstagedExpanded() ? ChevronDownIcon : ChevronRightIcon"
            class="w-3 h-3 flex-shrink-0"
          />
          <span>Changes ({{ unstagedFiles().length }})</span>
          @if (unstagedFiles().length > 0) {
            <button
              type="button"
              class="btn btn-ghost btn-xs p-0.5 h-auto min-h-0 ml-auto"
              title="Stage all"
              aria-label="Stage all files"
              (click)="onStageAll($event)"
            >
              <lucide-angular [img]="PlusIcon" class="w-3.5 h-3.5" />
            </button>
          }
        </button>
        @if (unstagedExpanded()) {
          <div role="list" aria-label="Changed files">
            @for (file of unstagedFiles(); track file.path) {
              <ptah-source-control-file
                [file]="file"
                [staged]="false"
                (stage)="onStageFile($event)"
                (discard)="onDiscardFile($event)"
                (openDiff)="diffRequested.emit($event)"
                (openFile)="fileClicked.emit($event)"
              />
            }
            @if (unstagedFiles().length === 0) {
              <div class="px-3 py-2 text-[10px] opacity-40 text-center">
                No changes
              </div>
            }
          </div>
        }
      </div>

      <!-- Worktrees section (collapsible, below Changes) -->
      <ptah-worktree-section />
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourceControlPanelComponent {
  private readonly sourceControl = inject(SourceControlService);

  readonly files = input.required<GitFileStatus[]>();

  readonly fileClicked = output<string>();
  readonly diffRequested = output<string>();

  // UI state
  protected commitMessage = '';
  protected readonly isCommitting = signal(false);
  protected readonly stagedExpanded = signal(true);
  protected readonly unstagedExpanded = signal(true);

  // Icons
  readonly PlusIcon = Plus;
  readonly MinusIcon = Minus;
  readonly ChevronDownIcon = ChevronDown;
  readonly ChevronRightIcon = ChevronRight;

  // Computed file groups
  protected readonly stagedFiles = computed(() =>
    this.files().filter((f) => f.staged),
  );

  protected readonly unstagedFiles = computed(() =>
    this.files().filter((f) => !f.staged),
  );

  /**
   * Whether the commit button should be enabled.
   * Uses a getter instead of computed() because commitMessage is a plain string
   * bound via ngModel (not a signal). The getter re-evaluates on each change
   * detection cycle triggered by user input events.
   */
  protected get canCommit(): boolean {
    return (
      this.stagedFiles().length > 0 &&
      this.commitMessage.trim().length > 0 &&
      !this.isCommitting()
    );
  }

  protected async onStageFile(path: string): Promise<void> {
    await this.sourceControl.stageFile(path);
  }

  protected async onUnstageFile(path: string): Promise<void> {
    await this.sourceControl.unstageFile(path);
  }

  protected async onDiscardFile(path: string): Promise<void> {
    await this.sourceControl.discardChanges(path);
  }

  protected onStageAll(event: MouseEvent): void {
    event.stopPropagation();
    void this.sourceControl.stageAll();
  }

  protected onUnstageAll(event: MouseEvent): void {
    event.stopPropagation();
    void this.sourceControl.unstageAll();
  }

  protected async onCommit(): Promise<void> {
    const message = this.commitMessage.trim();
    if (!message || this.stagedFiles().length === 0) return;

    this.isCommitting.set(true);

    const result = await this.sourceControl.commit(message);

    if (result.success) {
      this.commitMessage = '';
    }

    this.isCommitting.set(false);
  }
}
