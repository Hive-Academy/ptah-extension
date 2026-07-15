import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule, X } from 'lucide-angular';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import type { TaskSpecDetail } from '@ptah-extension/shared';
import { TASK_STATUS_BADGE, TASK_STATUS_LABELS } from '../../task-presentation';

/**
 * Presentational task detail panel. Renders the frontmatter facts, the
 * `depends_on` list, any validation warnings, and the markdown body.
 *
 * NFR-10: the body is rendered ONLY through {@link MarkdownBlockComponent}
 * (the DOMPurify chokepoint) — never via `[innerHTML]`.
 */
@Component({
  selector: 'ptah-task-detail',
  standalone: true,
  imports: [LucideAngularModule, MarkdownBlockComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside
      class="flex flex-col h-full w-96 flex-shrink-0 border-l border-base-content/10 bg-base-100"
      aria-label="Task detail"
    >
      <header
        class="flex items-center justify-between gap-2 px-3 py-2 border-b border-base-content/10"
      >
        <span class="text-xs font-mono text-base-content/50 truncate">
          {{ detail()?.id }}
        </span>
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square"
          aria-label="Close detail"
          (click)="closed.emit()"
        >
          <lucide-angular [img]="XIcon" class="w-4 h-4" />
        </button>
      </header>

      @if (loading()) {
        <div class="flex items-center justify-center flex-1">
          <span class="loading loading-spinner loading-md"></span>
        </div>
      } @else if (detail(); as task) {
        <div class="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
          <h2 class="text-base font-semibold leading-snug">{{ task.title }}</h2>

          <!-- Frontmatter facts -->
          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt class="text-base-content/50">Status</dt>
            <dd>
              <span class="badge badge-xs" [class]="statusBadge()">
                {{ statusLabel() }}
              </span>
            </dd>
            <dt class="text-base-content/50">Type</dt>
            <dd>{{ task.type ?? '—' }}</dd>
            @if (task.executor) {
              <dt class="text-base-content/50">Executor</dt>
              <dd>{{ task.executor }}</dd>
            }
            <dt class="text-base-content/50">Created</dt>
            <dd>{{ task.created ?? '—' }}</dd>
            <dt class="text-base-content/50">Updated</dt>
            <dd>{{ task.updated ?? '—' }}</dd>
          </dl>

          <!-- depends_on -->
          @if (task.dependsOn.length > 0) {
            <div class="flex flex-col gap-1">
              <span class="text-xs text-base-content/50">Depends on</span>
              <div class="flex flex-wrap gap-1">
                @for (dep of task.dependsOn; track dep) {
                  <span class="badge badge-sm badge-outline font-mono">{{
                    dep
                  }}</span>
                }
              </div>
            </div>
          }

          <!-- Validation warnings -->
          @if (task.validationIssues.length > 0) {
            <div class="alert alert-warning py-2 px-3 text-xs">
              <ul class="list-disc pl-4">
                @for (issue of task.validationIssues; track issue.field) {
                  <li>{{ issue.field }}: {{ issue.message }}</li>
                }
              </ul>
            </div>
          }

          <!-- Artifacts -->
          @if (task.artifacts.length > 0) {
            <div class="flex flex-col gap-1">
              <span class="text-xs text-base-content/50">Files</span>
              <div class="flex flex-wrap gap-1">
                @for (file of task.artifacts; track file) {
                  <span class="badge badge-xs badge-ghost font-mono">{{
                    file
                  }}</span>
                }
              </div>
            </div>
          }

          <!-- Markdown body (chokepoint) -->
          @if (task.body.trim().length > 0) {
            <div class="divider my-0"></div>
            <ptah-markdown-block [content]="task.body" />
          }
        </div>
      } @else {
        <div
          class="flex flex-1 items-center justify-center text-sm text-base-content/40"
        >
          Task not found
        </div>
      }
    </aside>
  `,
})
export class TaskDetailComponent {
  public readonly detail = input.required<TaskSpecDetail | null>();
  public readonly loading = input(false);

  public readonly closed = output<void>();

  protected readonly statusLabel = computed(() => {
    const task = this.detail();
    return task ? TASK_STATUS_LABELS[task.status] : '';
  });
  protected readonly statusBadge = computed(() => {
    const task = this.detail();
    return task ? TASK_STATUS_BADGE[task.status] : '';
  });

  protected readonly XIcon = X;
}
