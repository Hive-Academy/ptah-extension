import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import {
  LucideAngularModule,
  GitBranch,
  ArrowUp,
  ArrowDown,
  FileEdit,
} from 'lucide-angular';
import { GitStatusService } from '../services/git-status.service';

/**
 * GitStatusBarComponent - Horizontal bar showing git branch info, ahead/behind counts,
 * and changed file count.
 *
 * Complexity Level: 1 (Simple - pure presentation, delegates entirely to GitStatusService)
 * Patterns: Standalone component, OnPush, signal-based delegation
 *
 * Renders only when the active workspace is a git repository (isGitRepo guard).
 * Placed between the editor toolbar and the content area in EditorPanelComponent.
 */
@Component({
  selector: 'ptah-git-status-bar',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    @if (gitStatus.isGitRepo()) {
      <div
        class="flex items-center gap-3 h-7 px-3 bg-base-200 border-b border-base-content/10
               text-xs select-none flex-shrink-0"
        role="status"
        aria-label="Git status"
      >
        <!-- Branch name -->
        <div class="flex items-center gap-1 opacity-80">
          <lucide-angular
            [img]="GitBranchIcon"
            class="w-3.5 h-3.5"
            aria-hidden="true"
          />
          <span
            class="font-medium truncate max-w-[160px]"
            [title]="gitStatus.branchName()"
          >
            {{ gitStatus.branchName() }}
          </span>
        </div>

        <!-- Ahead/Behind indicators (only when tracking an upstream) -->
        @if (gitStatus.branch().upstream) {
          @if (gitStatus.branch().ahead > 0) {
            <div
              class="flex items-center gap-0.5 text-info"
              [title]="
                gitStatus.branch().ahead +
                ' commit(s) ahead of ' +
                gitStatus.branch().upstream
              "
            >
              <lucide-angular
                [img]="ArrowUpIcon"
                class="w-3 h-3"
                aria-hidden="true"
              />
              <span>{{ gitStatus.branch().ahead }}</span>
            </div>
          }
          @if (gitStatus.branch().behind > 0) {
            <div
              class="flex items-center gap-0.5 text-warning"
              [title]="
                gitStatus.branch().behind +
                ' commit(s) behind ' +
                gitStatus.branch().upstream
              "
            >
              <lucide-angular
                [img]="ArrowDownIcon"
                class="w-3 h-3"
                aria-hidden="true"
              />
              <span>{{ gitStatus.branch().behind }}</span>
            </div>
          }
        }

        <!-- Changed files count (pushed to the right) -->
        @if (gitStatus.hasChanges()) {
          <div
            class="flex items-center gap-1 ml-auto opacity-80"
            [title]="gitStatus.changedFileCount() + ' changed file(s)'"
          >
            <lucide-angular
              [img]="FileEditIcon"
              class="w-3 h-3"
              aria-hidden="true"
            />
            <span>{{ gitStatus.changedFileCount() }}</span>
          </div>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GitStatusBarComponent {
  protected readonly gitStatus = inject(GitStatusService);

  protected readonly GitBranchIcon = GitBranch;
  protected readonly ArrowUpIcon = ArrowUp;
  protected readonly ArrowDownIcon = ArrowDown;
  protected readonly FileEditIcon = FileEdit;
}
