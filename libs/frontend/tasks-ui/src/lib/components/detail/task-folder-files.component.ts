import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  ChevronRight,
  Circle,
  FileText,
  Link2,
  LucideAngularModule,
} from 'lucide-angular';
import type { LucideIconData } from 'lucide-angular';
import {
  joinFolderPath,
  type TaskFolderBreadcrumb,
  type TaskFolderEntry,
} from '../../services/task-folder-entries';
import type {
  TaskDocumentState,
  TaskFolderListing,
} from '../../services/task-folder.store';

/** What one row does when activated. */
type FolderRowAction = 'carrier' | 'read' | 'browse' | 'editor' | 'none';

/** One spec-folder row as the list renders it. */
interface FolderRow {
  readonly name: string;
  /** `prototype/` for a directory, the bare name otherwise. */
  readonly displayName: string;
  readonly kind: TaskFolderEntry['kind'];
  readonly presence: TaskFolderEntry['presence'];
  readonly action: FolderRowAction;
  /** Type or state in words, e.g. `Present`, `Folder`, `Legacy · Missing`. */
  readonly stateLabel: string;
  /** Accessible name of the row's control. */
  readonly actionLabel: string;
  readonly current: boolean;
  readonly icon: LucideIconData;
}

/** One labelled group of rows. */
interface FolderSection {
  readonly key: 'on-disk' | 'expected';
  readonly title: string;
  readonly rows: readonly FolderRow[];
}

/** Reader outcomes that are also a file state worth showing on the row. */
const ROW_READ_STATES: Partial<Record<TaskDocumentState['status'], string>> = {
  unreadable: 'Unreadable',
  binary: 'Binary',
  too_large: 'Too large',
  rejected: 'Rejected',
};

/** Why a listing is not shown. */
const LISTING_REASONS: Record<
  Exclude<TaskFolderListing['status'], 'ready' | 'error' | 'loading'>,
  string
> = {
  idle: 'No task folder is selected.',
  missing: 'This folder no longer exists on disk.',
  unreadable: 'This folder could not be read. Check its permissions on disk.',
  rejected:
    'This path was refused: only folders inside the task folder are listed.',
  too_many:
    'This folder holds too many entries to list here. Open it from your file manager.',
};

function typeLabel(entry: TaskFolderEntry): string {
  switch (entry.kind) {
    case 'directory':
      return 'Folder';
    case 'symlink':
      return 'Link · not followed';
    case 'other':
      return 'Other';
    case 'file':
      return /\.md$/i.test(entry.name) ? 'Markdown' : 'File';
  }
}

/**
 * The spec-folder file list: the task folder as it is on disk.
 *
 * At the folder root, **On disk** lists the actual entries (the carrier, the
 * workflow documents, other files, then folders) and **Expected workflow
 * files** lists the workflow documents the folder does not hold yet. Inside a
 * subfolder, breadcrumbs lead back and rows are navigation only.
 *
 * Presentational: rows and states come from `TasksStore` through the detail
 * panel. A folder is browsed, never read as markdown; a symlink is shown but
 * never followed.
 */
@Component({
  selector: 'ptah-task-folder-files',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav
      class="bg-surface-2 border border-surface-border rounded-box p-4 flex flex-col gap-1 min-w-0 text-sm"
      aria-labelledby="task-folder-files-heading"
      data-testid="task-folder-files"
    >
      <h3
        id="task-folder-files-heading"
        class="text-sm font-semibold text-base-content"
      >
        Spec folder
        @if (listing().status === 'ready') {
          <span
            class="text-xs font-normal text-base-content-muted"
            data-testid="task-folder-count"
            >· {{ countLabel() }}</span
          >
        }
      </h3>

      @if (breadcrumbs().length > 1) {
        <ol
          class="flex flex-wrap items-center gap-1 font-mono text-xs"
          aria-label="Folder path"
          data-testid="task-folder-breadcrumbs"
        >
          @for (crumb of breadcrumbs(); track crumb.path; let last = $last) {
            <li class="flex min-w-0 items-center gap-1">
              @if (last) {
                <span
                  class="truncate text-base-content"
                  aria-current="location"
                  >{{ crumb.label }}</span
                >
              } @else {
                <button
                  type="button"
                  class="min-h-8 truncate rounded-sm px-1 text-[color:var(--ptah-link)] underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                  [attr.aria-label]="'Back to ' + crumb.label"
                  data-testid="task-folder-crumb"
                  [attr.data-path]="crumb.path"
                  (click)="openDirectory.emit(crumb.path)"
                >
                  {{ crumb.label }}
                </button>
                <lucide-angular
                  [img]="ChevronRightIcon"
                  class="h-3 w-3 shrink-0 text-base-content-muted"
                  aria-hidden="true"
                />
              }
            </li>
          }
        </ol>
      }

      @switch (listing().status) {
        @case ('ready') {
          @if (sections().length === 0) {
            <p
              class="text-xs text-base-content-muted"
              data-testid="task-folder-empty"
            >
              This folder is empty.
            </p>
          }
          @for (section of sections(); track section.key) {
            <h4
              class="mt-2 mb-1 text-[11px] font-bold uppercase tracking-wider text-base-content-muted"
              [id]="'task-folder-group-' + section.key"
            >
              {{ section.title }}
            </h4>
            <ul
              class="flex flex-col"
              [attr.aria-labelledby]="'task-folder-group-' + section.key"
              [attr.data-testid]="'task-folder-' + section.key"
            >
              @for (row of section.rows; track row.name) {
                <li>
                  @if (row.action === 'none') {
                    <div
                      class="flex min-h-9 items-center gap-2 rounded-btn px-2 py-1.5 text-xs text-base-content-muted"
                      [attr.data-testid]="'task-folder-row-' + row.name"
                      [attr.data-presence]="row.presence"
                      [attr.data-kind]="row.kind"
                    >
                      <lucide-angular
                        [img]="row.icon"
                        class="h-3.5 w-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      <span
                        class="min-w-0 flex-1 truncate font-mono"
                        [title]="row.displayName"
                        >{{ row.displayName }}</span
                      >
                      <span class="shrink-0 text-[11px]">{{
                        row.stateLabel
                      }}</span>
                    </div>
                  } @else {
                    <button
                      type="button"
                      class="flex min-h-9 w-full items-center gap-2 rounded-btn border-l-2 px-2 py-1.5 text-left text-xs text-base-content hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      [class.border-transparent]="!row.current"
                      [class.border-primary]="row.current"
                      [class.bg-surface-3]="row.current"
                      [attr.aria-current]="row.current ? 'true' : null"
                      [attr.aria-label]="row.actionLabel"
                      [title]="row.actionLabel"
                      [attr.data-testid]="'task-folder-row-' + row.name"
                      [attr.data-presence]="row.presence"
                      [attr.data-kind]="row.kind"
                      [attr.data-action]="row.action"
                      (click)="activate(row)"
                    >
                      <lucide-angular
                        [img]="row.icon"
                        class="h-3.5 w-3.5 shrink-0 text-base-content-muted"
                        aria-hidden="true"
                      />
                      <span class="min-w-0 flex-1 truncate font-mono">{{
                        row.displayName
                      }}</span>
                      <span
                        class="shrink-0 text-[11px] text-base-content-muted"
                        >{{ row.stateLabel }}</span
                      >
                    </button>
                  }
                </li>
              }
            </ul>
          }
        }
        @case ('loading') {
          <div
            class="flex flex-col gap-2 py-1"
            role="status"
            aria-label="Loading folder"
            aria-busy="true"
            data-testid="task-folder-loading"
          >
            <span class="skeleton h-4 w-full"></span>
            <span class="skeleton h-4 w-5/6"></span>
            <span class="skeleton h-4 w-4/6"></span>
          </div>
        }
        @case ('error') {
          <p
            class="text-xs text-error"
            role="alert"
            data-testid="task-folder-error"
          >
            Could not list this folder: {{ listing().message }}
          </p>
        }
        @default {
          <p
            class="text-xs text-base-content-muted"
            [attr.data-testid]="'task-folder-' + listing().status"
          >
            {{ listingReason() }}
          </p>
        }
      }
    </nav>
  `,
})
export class TaskFolderFilesComponent {
  /** The browsed directory, with its typed status and rows. */
  public readonly listing = input.required<TaskFolderListing>();
  /** Breadcrumbs from the task folder to the browsed directory. */
  public readonly breadcrumbs = input<readonly TaskFolderBreadcrumb[]>([]);
  /** The file open in the reader, or `null` while the carrier overview shows. */
  public readonly openFile = input<string | null>(null);
  /** The reader's status for {@link openFile}, so its row can say Binary etc. */
  public readonly openStatus = input<TaskDocumentState['status']>('idle');

  /** Read a direct-child markdown file in the reader. */
  public readonly readFile = output<string>();
  /** Show the carrier overview (`task.md`); closes any open document. */
  public readonly showCarrier = output<void>();
  /** Browse a folder: `''` is the task folder, otherwise a relative path. */
  public readonly openDirectory = output<string>();
  /** Hand a non-markdown direct-child file to the editor opener. */
  public readonly openInEditor = output<string>();

  private readonly rows = computed<readonly FolderRow[]>(() => {
    const listing = this.listing();
    const openFile = this.openFile();
    const openStatus = this.openStatus();
    return listing.entries.map((entry) =>
      this.toRow(entry, listing.directory === '', openFile, openStatus),
    );
  });

  protected readonly sections = computed<readonly FolderSection[]>(() => {
    const present = this.rows().filter((row) => row.presence === 'present');
    const missing = this.rows().filter((row) => row.presence === 'missing');
    const sections: FolderSection[] = [];
    if (present.length > 0) {
      sections.push({ key: 'on-disk', title: 'On disk', rows: present });
    }
    if (missing.length > 0) {
      sections.push({
        key: 'expected',
        title: 'Expected workflow files',
        rows: missing,
      });
    }
    return sections;
  });

  protected readonly countLabel = computed(() => {
    const present = this.rows().filter((row) => row.presence === 'present');
    const folders = present.filter((row) => row.kind === 'directory').length;
    const files = present.length - folders;
    const fileWord = files === 1 ? 'file' : 'files';
    if (folders === 0) return `${files} ${fileWord}`;
    return `${files} ${fileWord}, ${folders} ${folders === 1 ? 'folder' : 'folders'}`;
  });

  protected readonly listingReason = computed(() => {
    const status = this.listing().status;
    return status === 'ready' || status === 'error' || status === 'loading'
      ? ''
      : LISTING_REASONS[status];
  });

  protected activate(row: FolderRow): void {
    switch (row.action) {
      case 'carrier':
        this.showCarrier.emit();
        return;
      case 'read':
        this.readFile.emit(row.name);
        return;
      case 'browse':
        this.openDirectory.emit(
          joinFolderPath(this.listing().directory, row.name),
        );
        return;
      case 'editor':
        this.openInEditor.emit(row.name);
        return;
      case 'none':
        return;
    }
  }

  private toRow(
    entry: TaskFolderEntry,
    atRoot: boolean,
    openFile: string | null,
    openStatus: TaskDocumentState['status'],
  ): FolderRow {
    const base = {
      name: entry.name,
      displayName: entry.kind === 'directory' ? `${entry.name}/` : entry.name,
      kind: entry.kind,
      presence: entry.presence,
    };
    const legacy = entry.role === 'legacy' ? 'Legacy · ' : '';
    const type = typeLabel(entry);

    if (entry.presence === 'missing') {
      return {
        ...base,
        action: 'none',
        stateLabel: `${legacy}Missing`,
        actionLabel: `${entry.name} is missing`,
        current: false,
        icon: Circle,
      };
    }
    if (entry.role === 'carrier' && atRoot) {
      return {
        ...base,
        action: 'carrier',
        stateLabel: 'Carrier',
        actionLabel: `Show the ${entry.name} carrier overview`,
        current: openFile === null,
        icon: FileText,
      };
    }
    if (entry.kind === 'directory') {
      return {
        ...base,
        action: 'browse',
        stateLabel: 'Folder',
        actionLabel: `Open folder ${entry.name}`,
        current: false,
        icon: ChevronRight,
      };
    }
    if (entry.readable) {
      const isOpen = atRoot && openFile === entry.name;
      const readState = isOpen ? ROW_READ_STATES[openStatus] : undefined;
      const stateLabel = `${legacy}${readState ?? 'Present'}`;
      return {
        ...base,
        action: 'read',
        stateLabel,
        actionLabel: `Read ${entry.name}, ${type}, ${stateLabel}`,
        current: isOpen,
        icon: FileText,
      };
    }
    if (entry.openable) {
      return {
        ...base,
        action: 'editor',
        // "Markdown" beside "Present" read as a second state; say what the
        // row does instead. Same document glyph as every other file row.
        stateLabel: 'Opens in editor',
        actionLabel: `Open ${entry.name} (${type}) in the editor`,
        current: false,
        icon: FileText,
      };
    }
    return {
      ...base,
      action: 'none',
      stateLabel: type,
      actionLabel: entry.name,
      current: false,
      icon: entry.kind === 'symlink' ? Link2 : FileText,
    };
  }

  protected readonly ChevronRightIcon = ChevronRight;
}
