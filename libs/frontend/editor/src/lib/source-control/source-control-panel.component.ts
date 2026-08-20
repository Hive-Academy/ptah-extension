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
import type { OpenDiffRequest } from '../services/editor/editor-tab.types';
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
        <!-- Header bar is a PRESENTATIONAL row: the disclosure toggle and the
             unstage-all action are SIBLINGS. Nesting the action inside the
             toggle (as this was) is invalid HTML and was the only reason
             onUnstageAll needed stopPropagation (D1 AC1/AC5).

             Two AC6 details that are easy to lose:
             - opacity-70/hover:opacity-100 stays on the ROW, not the toggle,
               so the action button's resting opacity and the whole-header
               hover response are exactly what they were.
             - the toggle repeats the uppercase class. Tailwind preflight resets
               text-transform to none on <button>, so the label would silently
               drop out of caps now that the text lives inside a button rather
               than being the button (measured: 108.39px -> 96.78px). -->
        <div
          class="flex items-center gap-1 w-full px-2 py-1 text-[10px] font-semibold
                 uppercase tracking-wider opacity-70 hover:opacity-100
                 bg-base-200 transition-opacity"
        >
          <button
            type="button"
            class="flex flex-1 items-center gap-1 -my-1 -ml-2 py-1 pl-2 uppercase
                   cursor-pointer focus-visible:outline focus-visible:outline-2
                   focus-visible:outline-offset-[-2px]
                   focus-visible:outline-[oklch(var(--s))]"
            [attr.aria-expanded]="stagedExpanded()"
            [attr.aria-controls]="stagedListId"
            aria-label="Toggle staged changes section"
            (click)="stagedExpanded.set(!stagedExpanded())"
          >
            <lucide-angular
              [img]="stagedExpanded() ? ChevronDownIcon : ChevronRightIcon"
              class="w-3 h-3 flex-shrink-0"
            />
            <span>Staged Changes ({{ stagedFiles().length }})</span>
          </button>
          @if (stagedFiles().length > 0) {
            <button
              type="button"
              class="btn btn-ghost btn-xs p-0.5 h-auto min-h-0 ml-auto
                     focus-visible:outline focus-visible:outline-2
                     focus-visible:outline-offset-[-2px]
                     focus-visible:outline-[oklch(var(--s))]"
              title="Unstage all"
              aria-label="Unstage all files"
              (click)="onUnstageAll()"
            >
              <lucide-angular [img]="MinusIcon" class="w-3.5 h-3.5" />
            </button>
          }
        </div>
        @if (stagedExpanded()) {
          <div [id]="stagedListId" role="list" aria-label="Staged files">
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
            <!-- role="listitem" is load-bearing, not decoration. This div is a
                 CHILD of the role="list" region above, and the list role
                 declares listitem as its required owned role — so a plain
                 <div> here is a CRITICAL aria-required-children violation,
                 live on the most common state there is (most working trees
                 have nothing staged). It now reads as "list, 1 item, No staged
                 changes" rather than as an unowned orphan. Same at the Changes
                 section below; the two must not drift (TASK_2026_211). -->
            @if (stagedFiles().length === 0) {
              <div
                role="listitem"
                class="px-3 py-2 text-[10px] opacity-40 text-center"
              >
                No staged changes
              </div>
            }
          </div>
        }
      </div>

      <!-- Unstaged Changes section — same de-nested shape as Staged above. -->
      <div class="flex-shrink-0">
        <div
          class="flex items-center gap-1 w-full px-2 py-1 text-[10px] font-semibold
                 uppercase tracking-wider opacity-70 hover:opacity-100
                 bg-base-200 transition-opacity"
        >
          <button
            type="button"
            class="flex flex-1 items-center gap-1 -my-1 -ml-2 py-1 pl-2 uppercase
                   cursor-pointer focus-visible:outline focus-visible:outline-2
                   focus-visible:outline-offset-[-2px]
                   focus-visible:outline-[oklch(var(--s))]"
            [attr.aria-expanded]="unstagedExpanded()"
            [attr.aria-controls]="unstagedListId"
            aria-label="Toggle changes section"
            (click)="unstagedExpanded.set(!unstagedExpanded())"
          >
            <lucide-angular
              [img]="unstagedExpanded() ? ChevronDownIcon : ChevronRightIcon"
              class="w-3 h-3 flex-shrink-0"
            />
            <span>Changes ({{ unstagedFiles().length }})</span>
          </button>
          @if (unstagedFiles().length > 0) {
            <button
              type="button"
              class="btn btn-ghost btn-xs p-0.5 h-auto min-h-0 ml-auto
                     focus-visible:outline focus-visible:outline-2
                     focus-visible:outline-offset-[-2px]
                     focus-visible:outline-[oklch(var(--s))]"
              title="Stage all"
              aria-label="Stage all files"
              (click)="onStageAll()"
            >
              <lucide-angular [img]="PlusIcon" class="w-3.5 h-3.5" />
            </button>
          }
        </div>
        @if (unstagedExpanded()) {
          <div [id]="unstagedListId" role="list" aria-label="Changed files">
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
            <!-- role="listitem" for the same reason as the staged empty state
                 above — see that comment (TASK_2026_211). -->
            @if (unstagedFiles().length === 0) {
              <div
                role="listitem"
                class="px-3 py-2 text-[10px] opacity-40 text-center"
              >
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
  /** Structured diff request — carries which comparison the row represents. */
  readonly diffRequested = output<OpenDiffRequest>();
  protected commitMessage = '';
  protected readonly isCommitting = signal(false);
  protected readonly stagedExpanded = signal(true);
  protected readonly unstagedExpanded = signal(true);

  /**
   * Per-instance ids for the two `role="list"` regions, so each disclosure
   * toggle can point `aria-controls` at the region it expands (D1 AC3/AC4)
   * without two mounted panels ever emitting a duplicate id.
   */
  private static instanceCount = 0;
  private readonly instanceId = SourceControlPanelComponent.instanceCount++;
  protected readonly stagedListId = `sc-staged-list-${this.instanceId}`;
  protected readonly unstagedListId = `sc-unstaged-list-${this.instanceId}`;
  readonly PlusIcon = Plus;
  readonly MinusIcon = Minus;
  readonly ChevronDownIcon = ChevronDown;
  readonly ChevronRightIcon = ChevronRight;
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

  /**
   * Stage-all / unstage-all take no event. Both buttons are SIBLINGS of the
   * section disclosure toggle rather than children of it, so activating them
   * cannot toggle the section. The isolation is structural — there is no
   * `stopPropagation()` to forget (D1 AC5).
   */
  protected onStageAll(): void {
    void this.sourceControl.stageAll();
  }

  protected onUnstageAll(): void {
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
