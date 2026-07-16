import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { Check, LucideAngularModule, Minus, X } from 'lucide-angular';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import type { TaskSpecDetail } from '@ptah-extension/shared';
import {
  TASK_STATUS_BADGE,
  TASK_STATUS_LABELS,
  WORKFLOW_ARTIFACTS,
} from '../../task-presentation';

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
          <div class="flex flex-col gap-1">
            <h2 class="text-base font-semibold leading-snug">
              {{ task.title }}
            </h2>
            @if (task.description) {
              <p class="text-xs text-base-content/60 leading-snug">
                {{ task.description }}
              </p>
            }
          </div>

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

          <!-- Workflow stage artifacts — presence signals the orchestration
               stage ran; a missing Review/Tests row on a Done task is the gap
               the board can't otherwise surface. -->
          <div class="flex flex-col gap-1">
            <span class="text-xs text-base-content/50">Workflow</span>
            <div class="flex flex-col gap-0.5">
              @for (stage of workflowArtifacts(); track stage.file) {
                @if (stage.present) {
                  <button
                    type="button"
                    class="flex items-center gap-1.5 text-xs text-left hover:text-primary"
                    [title]="'Open ' + stage.file"
                    (click)="openArtifact.emit(stage.file)"
                  >
                    <lucide-angular
                      [img]="CheckIcon"
                      class="w-3 h-3 text-success shrink-0"
                    />
                    <span>{{ stage.label }}</span>
                    <span class="font-mono text-base-content/40 truncate">{{
                      stage.file
                    }}</span>
                  </button>
                } @else {
                  <div
                    class="flex items-center gap-1.5 text-xs text-base-content/30"
                    [title]="stage.file + ' not generated'"
                  >
                    <lucide-angular
                      [img]="MinusIcon"
                      class="w-3 h-3 shrink-0"
                    />
                    <span>{{ stage.label }}</span>
                    <span class="italic">not generated</span>
                  </div>
                }
              }
            </div>
          </div>

          <!-- Artifacts — every filename present on disk in the task folder.
               Click to open in the editor (file:open). -->
          <div class="flex flex-col gap-1">
            <span class="text-xs text-base-content/50">
              Files ({{ task.artifacts.length }})
            </span>
            @if (task.artifacts.length > 0) {
              <div class="flex flex-wrap gap-1">
                @for (file of task.artifacts; track file) {
                  <button
                    type="button"
                    class="badge badge-xs badge-ghost font-mono hover:badge-primary cursor-pointer"
                    [title]="'Open ' + file"
                    (click)="openArtifact.emit(file)"
                  >
                    {{ file }}
                  </button>
                }
              </div>
            } @else {
              <span class="text-[11px] text-base-content/30 italic">
                No files in this task folder yet
              </span>
            }
          </div>

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
  /** Emits an artifact filename the host should open in the editor. */
  public readonly openArtifact = output<string>();

  protected readonly statusLabel = computed(() => {
    const task = this.detail();
    return task ? TASK_STATUS_LABELS[task.status] : '';
  });
  protected readonly statusBadge = computed(() => {
    const task = this.detail();
    return task ? TASK_STATUS_BADGE[task.status] : '';
  });

  /** Canonical workflow artifacts tagged with on-disk presence. */
  protected readonly workflowArtifacts = computed(() => {
    const present = new Set(this.detail()?.artifacts ?? []);
    return WORKFLOW_ARTIFACTS.map((stage) => ({
      ...stage,
      present: present.has(stage.file),
    }));
  });

  protected readonly XIcon = X;
  protected readonly CheckIcon = Check;
  protected readonly MinusIcon = Minus;
}
