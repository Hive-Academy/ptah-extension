import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { AppStateManager } from '@ptah-extension/core';
import {
  CARRIER_FILE,
  type DocFile,
  type TaskGraph,
  type TaskSpecDetail,
} from '@ptah-extension/shared';
import { isOpenableRootFile } from '../../services/task-folder-entries';
import { TasksStore } from '../../services/tasks-store.service';
import {
  TASK_ESTIMATE_LABELS,
  TASK_STATUS_LABELS,
  labelChipClass,
} from '../../task-presentation';
import { deriveTaskStage } from '../../task-stage';
import type { TaskStartRequest } from '../../types/task-agent.types';
import type { TaskStatusChange } from '../board/task-card.component';
import { TaskActivityComponent } from './task-activity.component';
import { TaskDetailHeaderComponent } from './task-detail-header.component';
import {
  TaskDocumentReaderComponent,
  type TaskOpenDocumentState,
} from './task-document-reader.component';
import { TaskFolderFilesComponent } from './task-folder-files.component';
import { TaskFolderOverviewComponent } from './task-folder-overview.component';
import { TaskMetadataEditorComponent } from './task-metadata-editor.component';
import type { TaskMetadataWrite } from './task-metadata-write';
import { TaskRelationsComponent } from './task-relations.component';
import { TaskRunPlaceholderComponent } from './task-run-placeholder.component';

/**
 * The task detail as a spec-folder view: the file list, the reader (the
 * carrier overview, or the open document), and a rail with the carrier
 * metadata, relations, activity and the inactive Phase 2 run panel.
 *
 * A full page inside the Tasks surface (the host hides the board): a header
 * with Back, the breadcrumb, title and badges and the task actions, then the
 * body. Wide (container ≥ 980px): 248px files, flexible reader, 268px rail,
 * 16px gutters. Narrower: everything stacks, and the file list scrolls inside
 * a 290px box so the reader starts near the fold. The breakpoint is a
 * container query, so the layout follows the page's own width.
 *
 * Folder browsing and the reader's typed state come from {@link TasksStore}'s
 * public facade. `openDocument`, `documentContent`, `documentLoading` and
 * `readDocument` are kept as the host contract `tasks-view` binds; the reader
 * now reads the richer `documentState` so missing, binary, rejected and the
 * other states each render explicitly.
 *
 * NFR-10: every markdown body renders through the shared
 * `MarkdownBlockComponent` (the DOMPurify chokepoint), never `[innerHTML]`.
 */
@Component({
  selector: 'ptah-task-detail',
  standalone: true,
  imports: [
    TaskActivityComponent,
    TaskDetailHeaderComponent,
    TaskDocumentReaderComponent,
    TaskFolderFilesComponent,
    TaskFolderOverviewComponent,
    TaskMetadataEditorComponent,
    TaskRelationsComponent,
    TaskRunPlaceholderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .task-detail-scroll {
      container-type: inline-size;
    }
    .task-detail-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;
      padding: 20px;
      align-items: start;
    }
    .task-detail-files {
      display: block;
      max-height: 290px;
      overflow-y: auto;
      border-radius: var(--rounded-box, 1rem);
    }
    @container (min-width: 980px) {
      .task-detail-grid {
        grid-template-columns: 248px minmax(0, 1fr) 268px;
      }
      .task-detail-files {
        max-height: none;
        overflow: visible;
      }
    }

    /* Prose details the shared block leaves to its host (design-spec
       "Markdown reader spec"): underlined --ptah-link links, surface-3 code,
       and tables and fenced code that scroll inside their own block. */
    :host ::ng-deep .task-reader-body .prose a {
      color: var(--ptah-link);
      text-decoration: underline;
    }
    :host ::ng-deep .task-reader-body .prose :not(pre) > code {
      background: var(--surface-3);
      border-radius: 0.25rem;
      padding: 0 0.25rem;
      color: var(--fallback-bc, oklch(var(--bc)));
      /* The shared prose breaks code anywhere (word-break: break-all), which
         splits "New Task" into "Ne|w Task". Wrap at spaces, and break inside
         a token only when that token alone is wider than the line. */
      word-break: normal;
      overflow-wrap: anywhere;
      -webkit-box-decoration-break: clone;
      box-decoration-break: clone;
    }
    /* Plain headings like the prototype: the chat prose paints h1 gold with
       a rule and prefixes h1/h2 with a dot. Reader-scoped, so chat keeps its
       look. */
    :host ::ng-deep .task-reader-body .prose h1,
    :host ::ng-deep .task-reader-body .prose h2 {
      color: var(--fallback-bc, oklch(var(--bc)));
      border-bottom: 0;
      padding-bottom: 0;
    }
    :host ::ng-deep .task-reader-body .prose h1 {
      font-size: 1.45em;
    }
    :host ::ng-deep .task-reader-body .prose .prose-heading-accented {
      display: block;
    }
    :host ::ng-deep .task-reader-body .prose .prose-heading-dot {
      display: none;
    }
    :host ::ng-deep .task-reader-body .prose pre {
      background: var(--surface-3);
      border: 1px solid var(--surface-border);
      overflow-x: auto;
      max-width: 100%;
    }
    :host ::ng-deep .task-reader-body .prose table {
      display: block;
      overflow-x: auto;
      max-width: 100%;
    }
    :host ::ng-deep .task-reader-body .prose blockquote {
      border-left: 2px solid var(--surface-border);
    }
  `,
  template: `
    <!-- Full page inside the Tasks surface: the host hides the board while
         this is open, and Back closes the task (design-spec "Task detail"). -->
    <section
      class="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-base-100 text-base-content"
      aria-label="Task detail"
      data-testid="task-detail-page"
    >
      <ptah-task-detail-header
        [detail]="loading() ? null : detail()"
        [folderHint]="folderHint()"
        [busy]="busy()"
        [starting]="starting()"
        (back)="closed.emit()"
        (startTask)="startTask.emit($event)"
        (statusChange)="statusChange.emit($event)"
      />

      @if (loading()) {
        <div
          class="flex items-center justify-center flex-1"
          role="status"
          aria-label="Loading task"
        >
          <span class="loading loading-spinner loading-md"></span>
        </div>
      } @else if (detail(); as task) {
        <div class="task-detail-scroll flex-1 min-h-0 overflow-y-auto">
          <div class="task-detail-grid">
            <ptah-task-folder-files
              class="task-detail-files"
              [listing]="store.folderListing()"
              [breadcrumbs]="store.folderBreadcrumbs()"
              [openFile]="store.openFile()"
              [openStatus]="store.documentState().status"
              (readFile)="onReadFile($event)"
              (showCarrier)="onShowCarrier()"
              (openDirectory)="onOpenDirectory($event)"
              (openInEditor)="openArtifact.emit($event)"
            />

            <div class="min-w-0">
              @if (openDocumentState(); as state) {
                <ptah-task-document-reader
                  [state]="state"
                  [openable]="openFileOpenable()"
                  (openInEditor)="openArtifact.emit($event)"
                  (closed)="onShowCarrier()"
                />
              } @else {
                <ptah-task-folder-overview
                  [detail]="task"
                  [carrierOpenable]="carrierOpenable()"
                  (openInEditor)="openArtifact.emit($event)"
                />
              }
            </div>

            <div class="flex min-w-0 flex-col gap-4">
              <section
                class="bg-surface-2 border border-surface-border rounded-box p-4 flex flex-col gap-3 text-sm"
                aria-labelledby="task-detail-metadata-heading"
                data-testid="task-detail-metadata"
              >
                <h3
                  id="task-detail-metadata-heading"
                  class="text-sm font-semibold text-base-content"
                >
                  Carrier metadata
                </h3>
                <dl
                  class="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-2 gap-y-2 text-xs"
                >
                  <dt class="text-base-content-muted">ID</dt>
                  <dd class="font-mono break-all text-base-content">
                    {{ task.folderName }}
                  </dd>
                  <dt class="text-base-content-muted">Status</dt>
                  <dd class="text-base-content">{{ statusLabel() }}</dd>
                  <dt class="text-base-content-muted">Type</dt>
                  <dd class="text-base-content">{{ task.type ?? '—' }}</dd>
                  <dt class="text-base-content-muted">Stage</dt>
                  <dd class="text-base-content">{{ stage() ?? '—' }}</dd>
                  @if (task.executor) {
                    <dt class="text-base-content-muted">Executor</dt>
                    <dd class="break-all text-base-content">
                      {{ task.executor }}
                    </dd>
                  }
                  @if (task.estimate; as estimate) {
                    <dt class="text-base-content-muted">Estimate</dt>
                    <dd
                      class="text-base-content"
                      data-testid="task-detail-estimate"
                    >
                      {{ estimate }} — {{ estimateLabel() }}
                    </dd>
                  }
                  <dt class="text-base-content-muted">Created</dt>
                  <dd class="break-all text-base-content">
                    {{ task.created ?? '—' }}
                  </dd>
                  <dt class="text-base-content-muted">Updated</dt>
                  <dd class="break-all text-base-content">
                    {{ task.updated ?? '—' }}
                  </dd>
                </dl>

                <!-- Labels, verbatim and in authored order (NFR-4 / NFR-13). -->
                @if (task.labels.length > 0) {
                  <div
                    class="flex flex-col gap-1"
                    data-testid="task-detail-labels"
                  >
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

                <div class="border-t border-surface-border pt-3">
                  <ptah-task-relations
                    [task]="task"
                    [graph]="graph()"
                    [editable]="true"
                    [busy]="busy()"
                    (openTask)="openTask.emit($event)"
                    (apply)="applyMetadata.emit($event)"
                  />
                </div>

                <!-- Collapsed by default: a native disclosure, keyboard-operable
                     and announced with no JavaScript at all. -->
                <details class="text-xs" data-testid="task-detail-editor">
                  <summary
                    class="cursor-pointer select-none rounded-btn py-1 text-base-content-muted hover:text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
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
              </section>

              <ptah-task-activity [taskId]="task.id" />

              <ptah-task-run-placeholder
                [selectedTaskId]="task.folderName"
                [workspaceRoot]="workspaceRoot()"
              />
            </div>
          </div>
        </div>
      } @else {
        <div
          class="flex flex-1 items-center justify-center text-sm text-base-content-muted"
        >
          Task not found
        </div>
      }
    </section>
  `,
})
export class TaskDetailComponent {
  public readonly detail = input.required<TaskSpecDetail | null>();
  public readonly loading = input(false);
  /** The open task's id, for the breadcrumb while its detail loads. */
  public readonly folderHint = input('');
  /** This task is launching from the header's Start in chat. */
  public readonly starting = input(false);
  /**
   * The derived board graph, for the inverse relations no single-task fetch can
   * see: Blocks, Duplicated by, and the derived half of Related.
   */
  public readonly graph = input<TaskGraph | null>(null);
  /** The workspace label union, for label completion. */
  public readonly knownLabels = input<readonly string[]>([]);
  /** Board-visible task ids, for parent and relation completion. */
  public readonly knownTaskIds = input<readonly string[]>([]);
  /** Set while a write is outstanding, so a second cannot be queued behind it. */
  public readonly busy = input(false);

  /**
   * Host contract kept for `tasks-view`. The reader renders the store's typed
   * `documentState`, which carries these three values and every other state.
   */
  public readonly openDocument = input<DocFile | null>(null);
  /** Host contract kept for `tasks-view`; see {@link openDocument}. */
  public readonly documentContent = input<string | null>(null);
  /** Host contract kept for `tasks-view`; see {@link openDocument}. */
  public readonly documentLoading = input(false);

  /** Back: the host closes the task and shows the board again. */
  public readonly closed = output<void>();
  /** Start in chat, with the card's payload (no isolation, default agent). */
  public readonly startTask = output<TaskStartRequest>();
  /** Change status, with the card's payload. */
  public readonly statusChange = output<TaskStatusChange>();
  /** Emits a direct-child filename the host should open in the editor. */
  public readonly openArtifact = output<string>();
  /**
   * Host contract kept for `tasks-view`. Reads now go through the store's
   * `readFolderFile`, which covers workflow documents and other markdown alike.
   */
  public readonly readDocument = output<DocFile | null>();
  /** Emits the id of a related task the user asked to open. A read. */
  public readonly openTask = output<string>();
  /**
   * A requested carrier write, naming the task it targets — which is NOT always
   * the open one (FR-B4.3's "blocks" edge is authored on the other carrier).
   */
  public readonly applyMetadata = output<TaskMetadataWrite>();

  protected readonly store = inject(TasksStore);
  private readonly appState = inject(AppStateManager);

  protected readonly statusLabel = computed(() => {
    const task = this.detail();
    return task ? TASK_STATUS_LABELS[task.status] : '';
  });
  protected readonly estimateLabel = computed(() => {
    const estimate = this.detail()?.estimate;
    return estimate ? TASK_ESTIMATE_LABELS[estimate] : '';
  });
  protected readonly stage = computed(() =>
    deriveTaskStage(this.detail()?.artifacts ?? []),
  );

  /** The reader's state when a file is open; `null` shows the carrier overview. */
  protected readonly openDocumentState = computed<TaskOpenDocumentState | null>(
    () => {
      const state = this.store.documentState();
      return state.status === 'idle' ? null : state;
    },
  );

  /** The open file is a present regular file the editor opener accepts. */
  protected readonly openFileOpenable = computed(() => {
    const task = this.detail();
    const file = this.store.openFile();
    return task !== null && file !== null && isOpenableRootFile(task, file);
  });

  protected readonly carrierOpenable = computed(() => {
    const task = this.detail();
    return task !== null && isOpenableRootFile(task, CARRIER_FILE);
  });

  protected readonly workspaceRoot = computed(
    () => this.appState.workspaceInfo()?.path ?? null,
  );

  protected onReadFile(file: string): void {
    void this.store.readFolderFile(file);
  }

  protected onShowCarrier(): void {
    void this.store.readFolderFile(null);
  }

  protected onOpenDirectory(directory: string): void {
    void this.store.openFolderDirectory(directory);
  }

  /** Hashed chip classes for one label — see `labelChipClass`. */
  protected chipClass(label: string): string {
    return labelChipClass(label);
  }
}
