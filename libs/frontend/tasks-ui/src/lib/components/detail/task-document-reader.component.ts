import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { ExternalLink, LucideAngularModule, X } from 'lucide-angular';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import type { TaskDocumentState } from '../../services/task-folder.store';

/** A reader state that names a file (everything but `idle`). */
export type TaskOpenDocumentState = Exclude<
  TaskDocumentState,
  { readonly status: 'idle' }
>;

/** Badge text per reader state: document kind and state, in words. */
const STATE_BADGES: Record<TaskOpenDocumentState['status'], string> = {
  loading: 'Markdown · Loading',
  ready: 'Markdown · Present',
  missing: 'Missing',
  unreadable: 'Unreadable',
  binary: 'Binary',
  directory: 'Folder',
  too_large: 'Too large',
  rejected: 'Rejected',
  error: 'Read failed',
};

/** Why a non-ready file is not rendered. Specific, never "failed to load". */
const STATE_REASONS: Record<
  Exclude<TaskOpenDocumentState['status'], 'loading' | 'ready' | 'error'>,
  string
> = {
  missing:
    'This task folder does not contain this file yet. Absent is ordinary: the stage that writes it has not run.',
  unreadable:
    'The file exists but could not be read. Check its permissions on disk.',
  binary:
    'The file is not UTF-8 text, so it is not shown as markdown. Open it in the editor instead.',
  directory:
    'This is a folder, not a document. Browse it from the spec-folder list.',
  too_large:
    'The file is larger than the 1 MiB inline reader limit. Open it in the editor to read it.',
  rejected:
    'The reader refused this path: only lowercase .md files directly inside the task folder are read inline.',
};

/**
 * In-place reader for one spec-folder file.
 *
 * Every reader state is explicit: loading keeps the header and shows skeleton
 * lines; an empty file, a missing, unreadable, binary, oversized or rejected
 * file, a folder and a failed read each say what happened.
 *
 * NFR-10: content renders ONLY through the shared {@link MarkdownBlockComponent}
 * (marked + DOMPurify chokepoint) with the theme-aware `auto` variant, never
 * via `[innerHTML]`. These files are written by agents, so they are no more
 * trusted than the carrier body.
 */
@Component({
  selector: 'ptah-task-document-reader',
  standalone: true,
  imports: [LucideAngularModule, MarkdownBlockComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="bg-surface-2 border border-surface-border rounded-box p-4 flex flex-col gap-3 min-w-0"
      [attr.aria-label]="'Reader: ' + state().file"
      [attr.aria-busy]="state().status === 'loading'"
      data-testid="task-doc-panel"
      [attr.data-state]="state().status"
    >
      <header
        class="flex flex-wrap items-center gap-2 border-b border-surface-border pb-3"
      >
        <h3
          class="min-w-0 truncate font-mono text-sm font-semibold text-base-content"
          [title]="state().file"
          data-testid="task-doc-file"
        >
          {{ state().file }}
        </h3>
        <span
          class="badge badge-ghost badge-sm text-base-content"
          data-testid="task-doc-state"
          >{{ badge() }}</span
        >
        <span class="flex-1"></span>
        @if (editorAllowed()) {
          <button
            type="button"
            class="btn btn-primary btn-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
            [attr.aria-label]="'Open ' + state().file + ' in the editor'"
            data-testid="task-doc-open-editor"
            (click)="openInEditor.emit(state().file)"
          >
            Open in editor
            <lucide-angular
              [img]="ExternalLinkIcon"
              class="h-3.5 w-3.5"
              aria-hidden="true"
            />
          </button>
        }
        <button
          type="button"
          class="btn btn-ghost btn-sm btn-square focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
          [attr.aria-label]="'Close ' + state().file"
          title="Close document"
          data-testid="task-doc-close"
          (click)="closed.emit()"
        >
          <lucide-angular [img]="XIcon" class="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      @switch (state().status) {
        @case ('loading') {
          <div
            class="flex flex-col gap-2"
            role="status"
            [attr.aria-label]="'Loading ' + state().file"
            data-testid="task-doc-loading"
          >
            <span class="skeleton h-4 w-2/3"></span>
            <span class="skeleton h-3 w-full"></span>
            <span class="skeleton h-3 w-5/6"></span>
            <span class="skeleton h-3 w-3/4"></span>
          </div>
        }
        @case ('ready') {
          @if (content(); as body) {
            <div class="task-reader-body min-w-0" data-testid="task-doc-body">
              <ptah-markdown-block [content]="body" [variant]="'auto'" />
            </div>
          } @else {
            <p
              class="text-sm text-base-content-muted"
              data-testid="task-doc-empty"
            >
              This file has no readable body.
            </p>
          }
        }
        @case ('error') {
          <p
            class="text-sm text-error"
            role="alert"
            data-testid="task-doc-error"
          >
            Could not read {{ state().file }}: {{ errorMessage() }}
          </p>
        }
        @default {
          <p
            class="text-sm text-base-content-muted"
            [attr.data-testid]="'task-doc-' + state().status"
          >
            {{ reason() }}
          </p>
        }
      }
    </section>
  `,
})
export class TaskDocumentReaderComponent {
  /** The open file and its reader state. */
  public readonly state = input.required<TaskOpenDocumentState>();
  /**
   * The file is a present direct-child regular file the editor opener accepts
   * (`TaskFolderEntry.openable`). The reader never decides that itself.
   */
  public readonly openable = input(false);

  /** Hand the file to the editor opener. */
  public readonly openInEditor = output<string>();
  /** Close the reader. */
  public readonly closed = output<void>();

  protected readonly badge = computed(() => STATE_BADGES[this.state().status]);

  /** Trimmed-empty content is the "no readable body" state, not a blank block. */
  protected readonly content = computed<string | null>(() => {
    const state = this.state();
    if (state.status !== 'ready') return null;
    return state.content.trim().length > 0 ? state.content : null;
  });

  protected readonly reason = computed(() => {
    const status = this.state().status;
    return status === 'loading' || status === 'ready' || status === 'error'
      ? ''
      : STATE_REASONS[status];
  });

  protected readonly errorMessage = computed(() => {
    const state = this.state();
    return state.status === 'error' ? state.message : '';
  });

  /** Only an openable file, and never a path the reader rejected. */
  protected readonly editorAllowed = computed(
    () =>
      this.openable() &&
      this.state().status !== 'rejected' &&
      this.state().status !== 'missing' &&
      this.state().status !== 'directory',
  );

  protected readonly XIcon = X;
  protected readonly ExternalLinkIcon = ExternalLink;
}
