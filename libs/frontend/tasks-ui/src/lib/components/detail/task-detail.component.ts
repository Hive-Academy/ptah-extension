import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { Check, LucideAngularModule, Minus, X } from 'lucide-angular';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import type { TaskGraph, TaskSpecDetail } from '@ptah-extension/shared';
import {
  TASK_ESTIMATE_LABELS,
  TASK_STATUS_BADGE,
  TASK_STATUS_LABELS,
  WORKFLOW_ARTIFACTS,
  labelChipClass,
} from '../../task-presentation';
import { TaskMetadataEditorComponent } from './task-metadata-editor.component';
import type { TaskMetadataWrite } from './task-metadata-write';
import { TaskRelationsComponent } from './task-relations.component';

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
  imports: [
    LucideAngularModule,
    MarkdownBlockComponent,
    TaskMetadataEditorComponent,
    TaskRelationsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside
      class="flex flex-col h-full w-96 flex-shrink-0 border-l border-base-content/10 bg-base-100"
      aria-label="Task detail"
    >
      <header
        class="flex items-center justify-between gap-2 px-3 py-2 border-b border-base-content/10"
      >
        <span class="text-xs font-mono text-base-content-muted truncate">
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
              <p class="text-xs text-base-content-muted leading-snug">
                {{ task.description }}
              </p>
            }
          </div>

          <!-- Frontmatter facts -->
          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt class="text-base-content-muted">Status</dt>
            <dd>
              <span class="badge badge-xs" [class]="statusBadge()">
                {{ statusLabel() }}
              </span>
            </dd>
            <dt class="text-base-content-muted">Type</dt>
            <dd>{{ task.type ?? '—' }}</dd>
            @if (task.estimate; as estimate) {
              <dt class="text-base-content-muted">Estimate</dt>
              <dd data-testid="task-detail-estimate">
                {{ estimate }} — {{ estimateLabel() }}
              </dd>
            }
            @if (task.executor) {
              <dt class="text-base-content-muted">Executor</dt>
              <dd>{{ task.executor }}</dd>
            }
            <dt class="text-base-content-muted">Created</dt>
            <dd>{{ task.created ?? '—' }}</dd>
            <dt class="text-base-content-muted">Updated</dt>
            <dd>{{ task.updated ?? '—' }}</dd>
          </dl>

          <!-- Labels. Rendered as interpolated text, verbatim, in the order the
               author typed them (NFR-4 / NFR-13). -->
          @if (task.labels.length > 0) {
            <div class="flex flex-col gap-1" data-testid="task-detail-labels">
              <span class="text-xs text-base-content-muted">Labels</span>
              <div class="flex flex-wrap gap-1">
                @for (label of task.labels; track $index) {
                  <span
                    class="badge badge-sm border font-normal max-w-full truncate"
                    [class]="chipClass(label)"
                    [title]="label"
                    >{{ label }}</span
                  >
                }
              </div>
            </div>
          }

          <!-- Relations — five groups, read-only. Supersedes the old
               depends_on list: that WAS the "Blocked by" group, and one
               renderer cannot disagree with itself about how an edge is shown. -->
          <ptah-task-relations
            [task]="task"
            [graph]="graph()"
            [editable]="true"
            [busy]="busy()"
            (openTask)="openTask.emit($event)"
            (apply)="applyMetadata.emit($event)"
          />

          <!-- Metadata editor. Collapsed by default: the panel above is the
               read view, and a task carrying none of these fields should not
               open onto a form asking for them. A native disclosure element
               rather than a signal-driven block, so it is keyboard-operable
               and screen-reader announced with no JavaScript at all. -->
          <details class="text-xs" data-testid="task-detail-editor">
            <summary
              class="cursor-pointer select-none text-base-content-muted hover:text-base-content"
            >
              Edit metadata
            </summary>
            <div class="pt-2">
              <ptah-task-metadata-editor
                [task]="task"
                [knownLabels]="knownLabels()"
                [knownTaskIds]="knownTaskIds()"
                [busy]="busy()"
                (apply)="applyMetadata.emit($event)"
              />
            </div>
          </details>

          <!-- Validation warnings.
               The track key must be unique per ROW, and the field name is not:
               duplicates and relates_to are arrays, so one field carries one
               issue per bad entry and every one of them agrees on the field.
               The ref narrows that to the offending entry, but it is optional
               AND it repeats when the same bad entry is listed twice in one
               array — two issues with an identical (field, code, ref), which
               FR-B4.8 explicitly permits. So the position is folded in as
               well: the index is unique by construction, and the semantic
               prefix keeps the key stable across re-renders of the same list.
               Anything less throws NG0955. -->
          @if (task.validationIssues.length > 0) {
            <div class="alert alert-warning py-2 px-3 text-xs">
              <ul class="list-disc pl-4" data-testid="task-detail-issues">
                @for (
                  issue of task.validationIssues;
                  track issue.code +
                    '|' +
                    issue.field +
                    '|' +
                    (issue.ref ?? '') +
                    '|' +
                    $index
                ) {
                  <li>{{ issue.field }}: {{ issue.message }}</li>
                }
              </ul>
            </div>
          }

          <!-- Workflow stage artifacts — presence signals the orchestration
               stage ran; a missing Review/Tests row on a Done task is the gap
               the board can't otherwise surface. -->
          <div class="flex flex-col gap-1">
            <span class="text-xs text-base-content-muted">Workflow</span>
            <div class="flex flex-col gap-0.5">
              @for (stage of workflowArtifacts(); track stage.label) {
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
                    <span class="font-mono text-base-content-muted truncate">{{
                      stage.file
                    }}</span>
                  </button>
                } @else {
                  <div
                    class="flex items-center gap-1.5 text-xs text-base-content-muted"
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
            <span class="text-xs text-base-content-muted">
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
              <span class="text-[11px] text-base-content-muted italic">
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
          class="flex flex-1 items-center justify-center text-sm text-base-content-muted"
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
  /**
   * The derived board graph, for the inverse relations no single-task fetch can
   * see: Blocks, Duplicated by, and the derived half of Related. `TasksGetResult`
   * is deliberately unchanged — the inverses are a property of the whole board.
   */
  public readonly graph = input<TaskGraph | null>(null);

  /**
   * The workspace label union, for label completion. There is no registry file
   * — the union of what every carrier declares IS the completion source.
   */
  public readonly knownLabels = input<readonly string[]>([]);
  /** Board-visible task ids, for parent and relation completion. */
  public readonly knownTaskIds = input<readonly string[]>([]);
  /** Set while a write is outstanding, so a second cannot be queued behind it. */
  public readonly busy = input(false);

  public readonly closed = output<void>();
  /** Emits an artifact filename the host should open in the editor. */
  public readonly openArtifact = output<string>();
  /** Emits the id of a related task the user asked to open. A read. */
  public readonly openTask = output<string>();
  /**
   * A requested carrier write, naming the task it targets — which is NOT always
   * the open one (FR-B4.3's "blocks" edge is authored on the other carrier).
   * The host routes it to the single client mutation funnel.
   */
  public readonly applyMetadata = output<TaskMetadataWrite>();

  protected readonly estimateLabel = computed(() => {
    const estimate = this.detail()?.estimate;
    return estimate ? TASK_ESTIMATE_LABELS[estimate] : '';
  });

  protected readonly statusLabel = computed(() => {
    const task = this.detail();
    return task ? TASK_STATUS_LABELS[task.status] : '';
  });
  protected readonly statusBadge = computed(() => {
    const task = this.detail();
    return task ? TASK_STATUS_BADGE[task.status] : '';
  });

  /**
   * Canonical workflow artifacts tagged with on-disk presence.
   *
   * A stage carries one or more accepted filenames (the batch breakdown accepts
   * both its current and its pre-rename name). The stage resolves to whichever
   * of them is actually on disk; when none is, it falls back to the canonical
   * name purely so the "not generated" row can name the file to create.
   */
  protected readonly workflowArtifacts = computed(() => {
    const present = new Set(this.detail()?.artifacts ?? []);
    return WORKFLOW_ARTIFACTS.map((stage) => {
      const found = stage.files.find((file) => present.has(file));
      return {
        label: stage.label,
        file: found ?? stage.files[0],
        present: found !== undefined,
      };
    });
  });

  protected readonly XIcon = X;
  protected readonly CheckIcon = Check;
  protected readonly MinusIcon = Minus;

  /** Hashed chip classes for one label — see `labelChipClass`. */
  protected chipClass(label: string): string {
    return labelChipClass(label);
  }
}
