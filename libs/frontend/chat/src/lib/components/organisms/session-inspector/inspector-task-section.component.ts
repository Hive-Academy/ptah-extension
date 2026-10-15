import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import type { TaskStatus } from '@ptah-extension/shared';
import {
  TASK_STATUS_INK,
  TASK_STATUS_LABELS,
} from '@ptah-extension/tasks-ui/presentation';
import {
  Ban,
  Circle,
  CircleCheck,
  CircleDot,
  CircleX,
  Eye,
  FileText,
  LucideAngularModule,
  TriangleAlert,
  type LucideIconData,
} from 'lucide-angular';
import { SessionTaskReader } from './session-task-reader';

/** Shape cue per status, so status is never carried by colour alone (17.2). */
const STATUS_ICON: Readonly<Record<TaskStatus, LucideIconData>> = {
  backlog: Circle,
  in_progress: CircleDot,
  in_review: Eye,
  blocked: Ban,
  done: CircleCheck,
  cancelled: CircleX,
};

let nextTaskSectionId = 0;

/**
 * The inspector TASK section (design 4.6, requirement 17): the session's lead
 * linked task (primary, else the most recently linked) with its ID, title,
 * status, derived stage and documents, kept current by `SessionTaskReader`.
 *
 * Renders nothing while the link is unknown or absent (D27, row 44). The
 * reader is provided here, so a closed inspector reads no task data (17.17).
 */
@Component({
  selector: 'ptah-inspector-task-section',
  standalone: true,
  imports: [LucideAngularModule],
  providers: [SessionTaskReader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (reader.state(); as state) {
      <section
        class="border-t border-surface-border p-4"
        [attr.aria-labelledby]="headingId"
        [attr.aria-busy]="state.status === 'loading' ? 'true' : null"
      >
        <div class="mb-2 flex items-center justify-between gap-2">
          <h3 [id]="headingId" class="sec-label text-[10.5px] font-semibold uppercase">TASK</h3>
          @if (relatedCount() > 0) {
            <button
              type="button"
              class="inline-flex h-6 min-w-6 items-center px-1.5 text-xs font-medium text-[var(--ptah-link)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              [attr.aria-expanded]="relatedOpen()"
              [attr.aria-controls]="relatedId"
              [attr.aria-label]="relatedLabel()"
              (click)="relatedOpen.set(!relatedOpen())"
            >
              +{{ relatedCount() }} more
            </button>
          }
        </div>

        @let data = state.data;
        @if (state.status === 'loading') {
          <div class="grid gap-1.5" aria-hidden="true">
            <span class="h-3 w-40 rounded bg-surface-2 animate-pulse motion-reduce:animate-none"></span>
            <span class="h-2.5 w-56 rounded bg-surface-2 animate-pulse motion-reduce:animate-none"></span>
          </div>
        } @else if (state.status === 'error' && !data?.task) {
          <div role="alert" class="flex items-center gap-1.5 text-xs text-state-err">
            <lucide-angular [img]="TriangleAlertIcon" class="size-3.5 shrink-0" aria-hidden="true" />
            <span class="min-w-0 flex-1">Could not load task</span>
            <button
              type="button"
              class="inline-flex h-6 min-w-6 items-center px-1.5 text-xs font-medium text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              aria-label="Retry loading task"
              (click)="reader.retry()"
            >
              Retry
            </button>
          </div>
        } @else if (data) {
          @if (data.task; as task) {
            <p class="font-mono text-[11px] text-base-content-muted">{{ task.id }}</p>
            <p class="mt-0.5 truncate text-[13px] font-semibold" [attr.title]="task.title">{{ task.title }}</p>
            <p class="mt-1 flex items-center gap-1.5 text-xs">
              <lucide-angular
                [img]="statusIcon(task.status)"
                [class]="'size-3.5 shrink-0 ' + statusInk(task.status)"
                aria-hidden="true"
              />
              <span class="font-medium">{{ statusLabel(task.status) }}</span>
              @if (data.stage; as stage) {
                <span class="text-base-content-muted">· {{ stage }}</span>
              }
            </p>
            @if (state.status === 'error') {
              <div role="alert" class="mt-2 flex items-center gap-1.5 text-xs text-state-err">
                <lucide-angular [img]="TriangleAlertIcon" class="size-3.5 shrink-0" aria-hidden="true" />
                <span class="min-w-0 flex-1">Could not load task</span>
                <button
                  type="button"
                  class="inline-flex h-6 min-w-6 items-center px-1.5 text-xs font-medium text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  aria-label="Retry loading task"
                  (click)="reader.retry()"
                >
                  Retry
                </button>
              </div>
            }
            @if (data.documents.length === 0) {
              <p class="mt-2 text-xs text-base-content-muted">No documents yet</p>
            } @else {
              <ul class="mt-2 grid gap-0.5" aria-label="Task documents">
                @for (doc of data.documents; track doc) {
                  <li>
                    @if (reader.canOpen) {
                      <button
                        #docButton
                        type="button"
                        class="flex h-6 w-full min-w-0 items-center gap-1.5 text-left text-xs text-[var(--ptah-link)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                        [attr.title]="doc"
                        [attr.aria-describedby]="reader.openError()?.file === doc ? openErrorId : null"
                        (click)="reader.openDocument(doc, docButton)"
                      >
                        <lucide-angular [img]="FileTextIcon" class="size-3.5 shrink-0" aria-hidden="true" />
                        <span class="min-w-0 truncate font-mono">{{ doc }}</span>
                      </button>
                    } @else {
                      <span class="flex h-6 min-w-0 items-center gap-1.5 text-xs text-base-content-muted">
                        <lucide-angular [img]="FileTextIcon" class="size-3.5 shrink-0" aria-hidden="true" />
                        <span class="min-w-0 truncate font-mono" [attr.title]="doc">{{ doc }}</span>
                      </span>
                    }
                    @if (reader.openError()?.file === doc) {
                      <p [id]="openErrorId" role="alert" class="ml-5 text-[11px] text-state-err">
                        Could not open {{ doc }}
                      </p>
                    }
                  </li>
                }
              </ul>
            }
          } @else {
            <p class="font-mono text-[11px] text-base-content-muted">{{ data.lead.taskId }}</p>
            <p class="mt-0.5 flex items-center gap-1.5 text-xs text-base-content-muted">
              <lucide-angular [img]="TriangleAlertIcon" class="size-3.5 shrink-0" aria-hidden="true" />
              Task folder not found
            </p>
          }

          @if (relatedOpen() && data.related.length > 0) {
            <ul [id]="relatedId" class="mt-2 grid gap-0.5 border-t border-surface-border pt-2" aria-label="Other linked tasks">
              @for (related of data.related; track related.taskId) {
                <li class="truncate font-mono text-[11px] text-base-content-muted" [attr.title]="related.title ?? related.taskId">
                  {{ related.taskId }}@if (related.title) { · {{ related.title }} }
                </li>
              }
            </ul>
          }
        }
      </section>
    }
  `,
})
export class InspectorTaskSectionComponent {
  protected readonly reader = inject(SessionTaskReader);

  readonly tabId = input.required<string>();

  protected readonly FileTextIcon = FileText;
  protected readonly TriangleAlertIcon = TriangleAlert;
  private readonly sectionId = ++nextTaskSectionId;
  protected readonly headingId = `ptah-task-h-${this.sectionId}`;
  protected readonly relatedId = `ptah-task-related-${this.sectionId}`;
  protected readonly openErrorId = `ptah-task-open-err-${this.sectionId}`;

  protected readonly relatedOpen = signal(false);

  protected readonly relatedCount = computed(
    () => this.reader.state()?.data?.related.length ?? 0,
  );

  protected readonly relatedLabel = computed(() => {
    const count = this.relatedCount();
    const noun = count === 1 ? 'linked task' : 'linked tasks';
    return `${this.relatedOpen() ? 'Hide' : 'Show'} ${count} more ${noun}`;
  });

  constructor() {
    this.reader.bind(this.tabId);
  }

  protected statusIcon(status: TaskStatus): LucideIconData {
    return STATUS_ICON[status];
  }

  protected statusInk(status: TaskStatus): string {
    return TASK_STATUS_INK[status];
  }

  protected statusLabel(status: TaskStatus): string {
    return TASK_STATUS_LABELS[status];
  }
}
