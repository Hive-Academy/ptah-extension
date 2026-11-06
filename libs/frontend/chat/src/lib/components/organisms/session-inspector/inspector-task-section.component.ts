import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
  viewChild,
  ElementRef,
} from '@angular/core';
import {
  BATCHES_FILE,
  CARRIER_FILE,
  IMPLEMENTATION_PLAN_FILE,
  LEGACY_BATCHES_FILE,
  TASK_DESCRIPTION_FILE,
  type TaskStatus,
} from '@ptah-extension/shared';
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

const PRIMARY_DOCUMENTS = [CARRIER_FILE, TASK_DESCRIPTION_FILE, IMPLEMENTATION_PLAN_FILE] as const;

function basename(file: string): string { return file.split(/[\\/]/).pop()?.toLowerCase() ?? ''; }

export function groupTaskDocuments(documents: readonly string[]): { primary: string[]; other: string[] } {
  const primary = PRIMARY_DOCUMENTS.flatMap(name => documents.filter(file => basename(file) === name));
  const list = documents.find(file => basename(file) === BATCHES_FILE)
    ?? documents.find(file => basename(file) === LEGACY_BATCHES_FILE);
  if (list) primary.push(list);
  return { primary, other: documents.filter(file => !primary.includes(file)) };
}

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
        (document:keydown.escape)="closeOnEscape()"
        (document:click)="closeOnOutsideClick($event)"
      >
        <div class="flex items-center justify-between gap-2">
          <h3
            [id]="headingId"
            class="sec-label text-[10.5px] font-semibold uppercase"
          >
            TASK
          </h3>
          @if (state.data?.task; as headingTask) {
            <span data-testid="task-id" class="badge badge-ghost badge-sm min-w-0 max-w-[70%] font-mono" [attr.title]="headingTask.id"><span class="truncate">{{ headingTask.id }}</span></span>
          }
        </div>

        @let data = state.data;
        @if (state.status === 'loading') {
          <div class="grid gap-1.5" aria-hidden="true">
            <span class="skeleton h-3 w-40"></span>
            <span class="skeleton h-2.5 w-56"></span>
          </div>
        } @else if (state.status === 'error' && !data?.task) {
          <div
            role="alert"
            class="alert alert-error alert-soft gap-2 px-2 py-1.5 text-xs"
          >
            <lucide-angular
              [img]="TriangleAlertIcon"
              class="size-3.5 shrink-0"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1">Could not load task</span>
            <button
              type="button"
              class="btn btn-ghost btn-xs shrink-0"
              aria-label="Retry loading task"
              (click)="reader.retry()"
            >
              Retry
            </button>
          </div>
        } @else if (data) {
          @if (data.task; as task) {
            <p
              class="mt-2 line-clamp-2 text-[13px] leading-snug font-semibold"
              [attr.title]="task.title"
            >
              {{ task.title }}
            </p>
            <div class="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
              <span
                data-testid="task-status"
                [class]="
                  'badge badge-sm gap-1 border-transparent bg-current/10 ' +
                  statusInk(task.status)
                "
              >
                <lucide-angular
                  [img]="statusIcon(task.status)"
                  class="size-3 shrink-0"
                  aria-hidden="true"
                />
                {{ statusLabel(task.status) }}
              </span>
              @if (data.stage; as stage) {
                <span class="text-base-content-muted">· {{ stage }}</span>
              }
            </div>
            @if (reader.progress(); as progress) {
              <div class="mt-1.5 flex items-center gap-2 text-[11px] text-base-content-muted">
                <progress class="progress h-1.5 min-w-0 flex-1" [value]="progress.done" [max]="progress.total" [attr.aria-label]="progress.done + ' of ' + progress.total + ' tasks complete'"></progress>
                <span class="shrink-0 tabular-nums">{{ progress.done }}/{{ progress.total }} tasks</span>
              </div>
            }
            @if (state.status === 'error') {
              <div
                role="alert"
                class="alert alert-error alert-soft mt-2 gap-2 px-2 py-1.5 text-xs"
              >
                <lucide-angular
                  [img]="TriangleAlertIcon"
                  class="size-3.5 shrink-0"
                  aria-hidden="true"
                />
                <span class="min-w-0 flex-1">Could not load task</span>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs shrink-0"
                  aria-label="Retry loading task"
                  (click)="reader.retry()"
                >
                  Retry
                </button>
              </div>
            }

            @if (relatedCount() > 0) {
              <div class="mt-1">
                <button type="button" class="btn btn-ghost btn-xs" [attr.aria-expanded]="relatedOpen()" [attr.aria-controls]="relatedId" [attr.aria-label]="relatedLabel()" (click)="relatedOpen.set(!relatedOpen())">+{{ relatedCount() }} more</button>
              </div>
            }

            @if (data.documents.length === 0) {
              <p class="mt-2 text-xs text-base-content-muted">No documents yet</p>
            } @else {
              <div [id]="documentsId" class="relative mt-2 flex flex-wrap items-center gap-1" aria-label="Task documents">
                @for (doc of groupedDocuments().primary; track doc) {
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs min-w-0 max-w-40 flex-nowrap font-mono font-normal"
                        [class.btn-active]="reader.preview()?.file === doc"
                        [attr.title]="doc"
                        [attr.aria-pressed]="reader.preview()?.file === doc"
                        [attr.aria-controls]="previewId"
                        (click)="toggleDocument(doc)"
                      >
                        <lucide-angular
                          [img]="FileTextIcon"
                          class="size-3 shrink-0 text-base-content-muted"
                          aria-hidden="true"
                        />
                        <span class="min-w-0 truncate">{{ doc }}</span>
                      </button>
                }
              @if (groupedDocuments().other.length) {
                <div #dropdownRoot class="dropdown static" [class.dropdown-open]="documentsOpen()">
                  <button #documentsToggle type="button" class="btn btn-ghost btn-xs font-mono" [attr.aria-expanded]="documentsOpen()" [attr.aria-controls]="documentsMenuId" (click)="documentsOpen.set(!documentsOpen())">+{{ groupedDocuments().other.length }} files</button>
                  @if (documentsOpen()) {
                    <ul [id]="documentsMenuId" class="dropdown-content menu menu-xs left-0 top-full z-20 mt-1 max-h-56 w-full flex-nowrap overflow-y-auto rounded-lg border border-surface-border bg-surface-1 p-1 shadow-lg" aria-label="Other task documents">
                      @for (doc of groupedDocuments().other; track doc) {
                        <li><button type="button" class="min-w-0 font-mono" [title]="doc" [attr.aria-controls]="previewId" [attr.aria-pressed]="reader.preview()?.file === doc" (click)="selectOtherDocument(doc)"><span class="truncate">{{ doc }}</span></button></li>
                      }
                    </ul>
                  }
                </div>
              }
              </div>
              @if (reader.preview(); as preview) {
                <div [id]="previewId" role="region" [attr.aria-label]="'Preview of ' + preview.file" class="mt-2 min-w-0 rounded-lg border border-surface-border bg-surface-1 p-3">
                  <div class="flex items-baseline justify-between gap-2 text-xs">
                    <span class="min-w-0 flex-1 truncate font-mono text-xs" [title]="preview.file">{{ preview.file }}</span>
                    @if (reader.canOpen) {
                      <button #openButton type="button" class="btn btn-ghost btn-xs" [attr.aria-describedby]="reader.openError()?.file === preview.file ? openErrorId : null" (click)="reader.openDocument(preview.file, openButton)">Open</button>
                    }
                    <button type="button" class="btn btn-ghost btn-xs btn-square" aria-label="Close document preview" (click)="reader.closePreview()">×</button>
                  </div>
                  @if (preview.status === 'loading') {
                    <div class="skeleton h-12 w-full" aria-label="Loading document preview"></div>
                  } @else if (preview.status === 'error') {
                    <p class="text-xs text-base-content-muted">Could not preview this document <button type="button" class="btn btn-ghost btn-xs" (click)="reader.previewDocument(preview.file)">Retry</button></p>
                  } @else {
                    <pre class="mt-1 max-h-[6lh] overflow-hidden whitespace-pre-wrap break-words font-mono text-xs leading-4 text-base-content-muted">{{ preview.content }}</pre>
                  }
                  @if (reader.openError()?.file === preview.file) {
                    <p [id]="openErrorId" role="alert" class="text-[11px] text-state-err">Could not open {{ preview.file }}</p>
                  }
                </div>
              }
            }
          } @else {
            <span class="badge badge-ghost badge-sm font-mono">
              {{ data.lead.taskId }}
            </span>
            <p class="mt-2 flex items-center gap-1.5 text-xs text-base-content-muted">
              <lucide-angular
                [img]="TriangleAlertIcon"
                class="size-3.5 shrink-0"
                aria-hidden="true"
              />
              Task folder not found
            </p>
          }

          @if (relatedOpen() && data.related.length > 0) {
            <ul
              [id]="relatedId"
              class="menu menu-xs mt-2 gap-0.5 border-t border-surface-border p-0 pt-2"
              aria-label="Other linked tasks"
            >
              @for (related of data.related; track related.taskId) {
                <li
                  class="min-w-0"
                  [attr.title]="related.title ?? related.taskId"
                >
                  <span class="min-w-0 truncate font-mono text-[11px] text-base-content-muted">
                    {{ related.taskId }}@if (related.title) {
                      · {{ related.title }}
                    }
                  </span>
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
  protected readonly documentsId = `ptah-task-documents-${this.sectionId}`;
  protected readonly documentsMenuId = `ptah-task-documents-menu-${this.sectionId}`;
  protected readonly openErrorId = `ptah-task-open-err-${this.sectionId}`;
  protected readonly dropdownRoot = viewChild<ElementRef<HTMLElement>>('dropdownRoot');
  protected readonly documentsToggle = viewChild<ElementRef<HTMLButtonElement>>('documentsToggle');

  protected readonly relatedOpen = signal(false);
  protected readonly documentsOpen = signal(false);

  protected readonly relatedCount = computed(
    () => this.reader.state()?.data?.related.length ?? 0,
  );

  protected readonly relatedLabel = computed(() => {
    const count = this.relatedCount();
    const noun = count === 1 ? 'linked task' : 'linked tasks';
    return `${this.relatedOpen() ? 'Hide' : 'Show'} ${count} more ${noun}`;
  });

  protected readonly groupedDocuments = computed(() => groupTaskDocuments(this.reader.state()?.data?.documents ?? []));

  protected readonly previewId = `ptah-task-preview-${this.sectionId}`;

  protected toggleDocument(file: string): void {
    if (this.reader.preview()?.file === file) this.reader.closePreview();
    else void this.reader.previewDocument(file);
  }

  protected selectOtherDocument(file: string): void {
    this.documentsOpen.set(false);
    this.documentsToggle()?.nativeElement.focus();
    this.toggleDocument(file);
  }

  protected closeOnEscape(): void {
    if (this.documentsOpen()) this.documentsToggle()?.nativeElement.focus();
    this.documentsOpen.set(false);
    this.reader.closePreview();
  }

  protected closeOnOutsideClick(event: MouseEvent): void {
    const target = event.target;
    const root = this.dropdownRoot()?.nativeElement;
    if (this.documentsOpen() && target instanceof Node && root && !root.contains(target)) {
      if (root.contains(document.activeElement)) this.documentsToggle()?.nativeElement.focus();
      this.documentsOpen.set(false);
    }
  }

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
