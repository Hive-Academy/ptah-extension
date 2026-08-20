import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';
import {
  Check,
  ChevronDown,
  ExternalLink,
  LucideAngularModule,
  Minus,
  X,
} from 'lucide-angular';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import type {
  DocFile,
  TaskGraph,
  TaskSpecDetail,
} from '@ptah-extension/shared';
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
    <!-- Two widths, one panel. Beside the Kanban this is a fixed 384px column
         so the board keeps the space; beside the list rail it takes the
         remainder, because there the panel IS the reading surface and the
         markdown body is the thing being read. -->
    <aside
      class="flex flex-col h-full border-l border-base-content/10 bg-base-100"
      [class.w-96]="!wide()"
      [class.flex-shrink-0]="!wide()"
      [class.flex-1]="wide()"
      [class.min-w-0]="wide()"
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
               the board can't otherwise surface.

               A present stage now has TWO actions, and they are separate
               controls rather than one overloaded click: reading the document
               here, and opening it in the editor. They are different intents —
               one is "show me the plan", the other is "I am about to change
               it" — and collapsing them meant the panel could only ever do the
               second. -->
          <div class="flex flex-col gap-1">
            <span class="text-xs text-base-content-muted">Workflow</span>
            <div class="flex flex-col gap-0.5">
              @for (stage of workflowArtifacts(); track stage.label) {
                @if (stage.present) {
                  <div class="flex items-center gap-1">
                    <button
                      type="button"
                      class="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs hover:text-primary"
                      [attr.aria-expanded]="openDocument() === stage.file"
                      [attr.data-testid]="'task-doc-read-' + stage.file"
                      [title]="
                        openDocument() === stage.file
                          ? 'Hide ' + stage.file
                          : 'Read ' + stage.file + ' here'
                      "
                      (click)="onToggleDocument(stage.file)"
                    >
                      <lucide-angular
                        [img]="
                          openDocument() === stage.file
                            ? ChevronDownIcon
                            : CheckIcon
                        "
                        class="h-3 w-3 shrink-0"
                        [class.text-success]="openDocument() !== stage.file"
                        aria-hidden="true"
                      />
                      <span>{{ stage.label }}</span>
                      <span
                        class="truncate font-mono text-base-content-muted"
                        >{{ stage.file }}</span
                      >
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs btn-square shrink-0"
                      [attr.aria-label]="
                        'Open ' + stage.file + ' in the editor'
                      "
                      [title]="'Open ' + stage.file + ' in the editor'"
                      [attr.data-testid]="'task-doc-open-' + stage.file"
                      (click)="openArtifact.emit(stage.file)"
                    >
                      <lucide-angular
                        [img]="ExternalLinkIcon"
                        class="h-3 w-3"
                      />
                    </button>
                  </div>
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

          <!-- The opened document, rendered in place.
               NFR-10: through MarkdownBlockComponent, the DOMPurify chokepoint,
               exactly like the carrier body above it. These files are written
               by agents, so they are no more trusted than the body is. -->
          @if (openDocument(); as file) {
            <div
              #docPanel
              class="flex flex-col gap-1 rounded border border-base-content/10 bg-base-200/40 p-2"
              data-testid="task-doc-panel"
            >
              <div class="flex items-center gap-2">
                <span class="flex-1 truncate font-mono text-[11px]">{{
                  file
                }}</span>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs btn-square"
                  aria-label="Close document"
                  title="Close document"
                  data-testid="task-doc-close"
                  (click)="readDocument.emit(null)"
                >
                  <lucide-angular [img]="XIcon" class="h-3 w-3" />
                </button>
              </div>
              @if (documentLoading()) {
                <span
                  class="loading loading-spinner loading-xs"
                  role="status"
                  [attr.aria-label]="'Loading ' + file"
                ></span>
              } @else if (documentContent(); as content) {
                <ptah-markdown-block [content]="content" />
              } @else {
                <!-- Absent is not broken. A task with no plan has not been
                     planned; saying "failed to load" about the ordinary case
                     sends the user looking for a fault that is not there. -->
                <p
                  class="text-[11px] text-base-content-muted"
                  data-testid="task-doc-absent"
                >
                  This task folder does not contain {{ file }} yet.
                </p>
              }
            </div>
          }

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
   * Take the remaining width instead of a fixed 384px column.
   *
   * Set by the host when the surface is in list mode, where the list collapses
   * to a rail and this panel becomes the reading surface. Defaults to `false`,
   * so every existing use — and the Kanban — renders exactly as before.
   */
  public readonly wide = input(false);
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

  /**
   * Which workflow document is expanded in place, or `null` for none.
   *
   * Owned by the HOST, not by this panel: the content is fetched over
   * `tasks:getArtifact` and a panel that held its own "which file" would be a
   * second opinion about the same thing as the content beside it, free to
   * disagree while a fetch is in flight.
   */
  public readonly openDocument = input<DocFile | null>(null);
  /** The expanded document's markdown, or `null` when absent from the folder. */
  public readonly documentContent = input<string | null>(null);
  public readonly documentLoading = input(false);

  public readonly closed = output<void>();
  /** Emits an artifact filename the host should open in the editor. */
  public readonly openArtifact = output<string>();
  /**
   * Read a workflow document in place, or `null` to close the one that is open.
   *
   * Distinct from {@link openArtifact}, which hands the file to the editor.
   * Reading and editing are different intents and this panel can now serve
   * both — see the Workflow section's two controls.
   */
  public readonly readDocument = output<DocFile | null>();
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

  /**
   * The expanded document panel, scrolled to as soon as it exists.
   *
   * The Workflow list is fifteen stages tall, so the panel opens well below the
   * fold on any but the tallest window: the user clicks Read and nothing they
   * can see happens. The Electron pass caught it and the e2e assertion missed
   * it first time round — Playwright's `toBeVisible` means laid out and not
   * hidden, NOT on screen, so it passed over a panel nobody could see. The spec
   * now asserts `toBeInViewport`.
   *
   * `block: 'start'`, not `'nearest'`. `'nearest'` satisfies "on screen" by
   * parking the panel's top edge at the BOTTOM of the scrollport, which the
   * visual pass showed as a document whose title bar is visible and whose text
   * is not — technically in view, still unreadable. The user asked to read
   * this, so it is positioned to be read.
   *
   * The effect fires when the panel is created, not on every pass: the
   * viewChild signal changes only as the element appears. Switching between two
   * documents reuses the same element, and by then it is already in place.
   */
  private readonly docPanel = viewChild<ElementRef<HTMLElement>>('docPanel');

  public constructor() {
    effect(() => {
      this.docPanel()?.nativeElement.scrollIntoView({
        block: 'start',
        behavior: 'smooth',
      });
    });
  }

  /** Clicking the open document's own row closes it — one control, one place. */
  protected onToggleDocument(file: DocFile): void {
    this.readDocument.emit(this.openDocument() === file ? null : file);
  }

  protected readonly XIcon = X;
  protected readonly CheckIcon = Check;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly ExternalLinkIcon = ExternalLink;
  protected readonly MinusIcon = Minus;

  /** Hashed chip classes for one label — see `labelChipClass`. */
  protected chipClass(label: string): string {
    return labelChipClass(label);
  }
}
