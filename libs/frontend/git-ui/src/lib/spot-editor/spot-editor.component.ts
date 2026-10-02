import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  ThemeService,
  VSCodeService,
  rpcCall,
  type RpcCallResult,
} from '@ptah-extension/core';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import type {
  EditorTarget,
  FileSaveContentParams,
  FileSaveContentResult,
} from '@ptah-extension/shared';
import { ArrowLeft, LucideAngularModule } from 'lucide-angular';
import {
  OpenInButtonComponent,
  type OpenInRequest,
} from '../open-in/open-in-button.component';
import { FileViewReaderService } from '../services/file-view-reader.service';
import { GitConfirmDialogComponent } from '../shared/git-confirm-dialog.component';
import {
  fileViewTabKey,
  type FileViewOpenRequest,
  type FileViewTabState,
} from '../types/diff-tab.types';
// Type-only: erased at build time, so CodeMirror stays out of this chunk.
import type { SpotEditorHandle } from './codemirror-setup';

/** Same ceiling as the read-only file view (`file-view.component.ts:32`). */
const MAX_MARKDOWN_PREVIEW_BYTES = 512 * 1024;

const SAVE_FAILED_MESSAGE = 'The file could not be saved.';
const SAVE_UNAVAILABLE_MESSAGE =
  'Saving is not available in this window. The file is open read-only.';
const EDITOR_LOAD_FAILED_MESSAGE = 'The editor could not be loaded.';
const UTF16_NOTE = 'UTF-16 files open read-only.';

/**
 * The RPC layer answers `Method not found: <method>` when the host never
 * registered the handler. `file:saveContent` is registered only where the host
 * profile enables `fileEditor` (Electron), and the webview has no read path
 * for host capabilities, so this answer is how the editor learns that saving
 * is unavailable.
 */
function isSaveUnavailable(error: string | undefined): boolean {
  return typeof error === 'string' && error.startsWith('Method not found');
}

function fileNameOf(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}

type DialogKind =
  'replace' | 'back' | 'leave' | 'reload' | 'conflict' | 'external';

interface DialogCopy {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  /** A third, explicit answer (the conflict's Reload). */
  secondaryLabel?: string;
  tone: 'danger' | 'warning';
}

/**
 * SpotEditorComponent — the Changes tab's single-file editing mode
 * (Requirement 7, design-spec §3.3 and §7). Not an IDE: one file, no tabs.
 *
 * - Reads through `FileViewReaderService` (`file:viewContent`), saves through
 *   `file:saveContent` with the read's `sha256` as `expectedSha256`.
 * - Opens read-only unless the host passes `startEditable` (the canvas "Edit"
 *   action); chat links open read-only by default and the header's Edit
 *   button switches to editing.
 * - UTF-16 files, and hosts without `file:saveContent`, stay read-only.
 * - CodeMirror is loaded with a dynamic `import()` of `codemirror-setup`, so
 *   it never enters the eager bundle.
 * - A conflict on save asks Overwrite, Reload or Keep editing. Only the two
 *   explicit buttons act; Escape keeps the edits and leaves the file marked
 *   stale, so Save asks again and the banner's Reload stays available.
 * - With unsaved changes, a second file, Back to review, the stale banner's
 *   Reload and a navigation that replaces the editor ({@link confirmLeave})
 *   all ask first.
 * - A question is never dropped for another: an open request or a leave that
 *   arrives while one is open waits (the latest wins) and is handled when it
 *   closes.
 * - The blocked state, Open-in and the outside-workspace confirmation are the
 *   read-only file view's, re-hosted.
 *
 * `notifyDiskChange` is the hook for `file:content-changed` pushes: with no
 * local edits the file reloads silently, with edits it is marked stale.
 */
@Component({
  selector: 'ptah-spot-editor',
  standalone: true,
  imports: [
    LucideAngularModule,
    MarkdownBlockComponent,
    OpenInButtonComponent,
    GitConfirmDialogComponent,
  ],
  host: { class: 'flex h-full min-h-0 flex-col' },
  template: `
    <div
      class="flex h-8 flex-shrink-0 items-center gap-2 border-b border-base-content/10 px-2"
    >
      <button
        #backButton
        type="button"
        class="btn btn-ghost btn-xs gap-1"
        data-testid="spot-editor-back"
        (click)="goBack()"
      >
        <lucide-angular [img]="BackIcon" class="h-3 w-3" aria-hidden="true" />
        Back to review
      </button>
      <span
        class="min-w-0 flex-1 truncate text-left font-mono text-xs [direction:rtl]"
        data-testid="spot-editor-path"
        [title]="file()?.absolutePath ?? request().path"
        ><bdi>{{ displayPath() }}</bdi></span
      >
      @if (!editable()) {
        <span class="badge badge-ghost badge-xs" data-testid="spot-editor-ro"
          >Read only</span
        >
      }
      @if (showEditButton()) {
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          data-testid="spot-editor-edit"
          (click)="startEditing()"
        >
          Edit
        </button>
      }
      @if (isMarkdown()) {
        <div class="join" role="group" aria-label="Markdown view">
          <button
            type="button"
            class="btn btn-ghost btn-xs join-item"
            data-testid="spot-editor-preview"
            [disabled]="!previewAvailable()"
            [attr.title]="previewSizeBlocked() ? previewLimitNote : null"
            [attr.aria-pressed]="previewVisible()"
            (click)="showPreview(true)"
          >
            Preview
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-xs join-item"
            data-testid="spot-editor-source"
            [disabled]="!previewAvailable()"
            [attr.title]="previewSizeBlocked() ? previewLimitNote : null"
            [attr.aria-pressed]="!previewVisible()"
            (click)="showPreview(false)"
          >
            Source
          </button>
        </div>
      }
      <button
        type="button"
        class="btn btn-primary btn-xs gap-1"
        data-testid="spot-editor-save"
        [disabled]="!canSave()"
        (click)="save()"
      >
        @if (saving()) {
          <span
            class="loading loading-spinner loading-xs"
            aria-hidden="true"
          ></span>
        }
        Save
      </button>
    </div>

    @if (readOnlyNote(); as note) {
      <p
        class="flex-shrink-0 border-b border-base-content/10 px-3 py-1 text-xs"
        data-testid="spot-editor-ro-note"
      >
        {{ note }}
      </p>
    }
    @if (stale()) {
      <div
        class="alert alert-warning flex-shrink-0 rounded-none px-3 py-1 text-xs"
        role="status"
        data-testid="spot-editor-stale"
      >
        <span>This file changed on disk since you opened it.</span>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          data-testid="spot-editor-stale-reload"
          (click)="reloadFromBanner()"
        >
          Reload
        </button>
      </div>
    }
    @if (saveError(); as message) {
      <div
        class="alert alert-error flex-shrink-0 rounded-none px-3 py-1 text-xs"
        role="alert"
        data-testid="spot-editor-save-error"
      >
        <span>{{ message }}</span>
      </div>
    }

    <div
      class="relative min-h-0 flex-1"
      data-ptah-file-links
      [attr.data-ptah-link-root]="file()?.workspaceRoot"
      [attr.data-ptah-link-document]="file()?.absolutePath"
    >
      <div
        #editorHost
        class="absolute inset-0"
        data-testid="spot-editor-body"
        [class.invisible]="!editorVisible()"
      ></div>

      @if (loading()) {
        <div
          class="flex h-full items-center justify-center gap-2 text-sm opacity-70"
          role="status"
          aria-busy="true"
        >
          <span
            class="loading loading-spinner loading-sm"
            aria-hidden="true"
          ></span>
          Loading file…
        </div>
      } @else if (file(); as current) {
        @if (current.status === 'blocked') {
          <div
            class="flex h-full flex-col items-center justify-center gap-3 p-6"
          >
            <div
              class="alert alert-warning max-w-xl text-xs"
              role="alert"
              data-testid="spot-editor-blocked"
            >
              <span>{{ current.failure?.message }}</span>
            </div>
            @if (current.failure?.externalOpenAllowed) {
              <ptah-open-in-button
                mode="full"
                [targets]="editorTargets()"
                [path]="current.absolutePath"
                [line]="current.reveal?.line"
                [root]="current.workspaceRoot ?? ''"
                (open)="requestExternalOpen($event)"
              />
            }
          </div>
        } @else if (current.status === 'error') {
          <div
            class="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 bg-error/15 px-3 py-2 text-xs"
            role="alert"
            data-testid="spot-editor-read-error"
          >
            <span>{{ current.failure?.message }}</span>
            <button type="button" class="btn btn-ghost btn-xs" (click)="retry()">
              Retry
            </button>
          </div>
        }
        @if (editorFailed()) {
          <div
            class="absolute inset-x-0 top-0 z-10 bg-error/15 px-3 py-2 text-xs"
            role="alert"
          >
            {{ editorLoadFailedMessage }}
          </div>
        }
        @if (previewVisible() && hasDocument()) {
          <div
            class="absolute inset-0 overflow-y-auto p-4"
            data-testid="spot-editor-preview-body"
          >
            <ptah-markdown-block [content]="previewText()" />
          </div>
        }
      }
    </div>

    <p class="sr-only" role="status" aria-live="polite">
      {{ statusMessage() }}
    </p>

    <ptah-git-confirm-dialog
      [title]="dialogCopy().title"
      [description]="dialogCopy().description"
      [confirmLabel]="dialogCopy().confirmLabel"
      [cancelLabel]="dialogCopy().cancelLabel"
      [secondaryLabel]="dialogCopy().secondaryLabel ?? null"
      [tone]="dialogCopy().tone"
      (confirmed)="onDialogConfirmed()"
      (cancelled)="onDialogCancelled()"
      (secondaryConfirmed)="onDialogSecondary()"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpotEditorComponent {
  /** What to open; a new object (even for the same path) is a new open. */
  readonly request = input.required<FileViewOpenRequest>();
  /** The canvas "Edit" action opens editable; chat links leave this false. */
  readonly startEditable = input(false);
  readonly editorTargets = input<readonly EditorTarget[]>([]);

  readonly backToReview = output<void>();
  readonly openExternal = output<OpenInRequest>();

  protected readonly BackIcon = ArrowLeft;
  protected readonly previewLimitNote =
    'Preview is disabled for files over 512 KB.';
  protected readonly editorLoadFailedMessage = EDITOR_LOAD_FAILED_MESSAGE;

  private readonly reader = inject(FileViewReaderService);
  private readonly vscode = inject(VSCodeService);
  private readonly theme = inject(ThemeService);

  protected readonly file = signal<FileViewTabState | null>(null);
  protected readonly loading = signal(false);
  /** The editor holds the current file's text. */
  protected readonly hasDocument = signal(false);
  protected readonly modified = signal(false);
  protected readonly saving = signal(false);
  protected readonly stale = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly statusMessage = signal('');
  protected readonly editorFailed = signal(false);
  /** Sticky for this component's life: the host has no `file:saveContent`. */
  private readonly saveUnavailable = signal(false);
  private readonly editRequested = signal(false);
  private readonly previewRequested = signal(false);
  protected readonly previewText = signal('');

  private readonly dialogKind = signal<DialogKind | null>(null);
  private readonly pendingExternal = signal<OpenInRequest | null>(null);
  /**
   * The latest open request that is waiting: the one the replace question is
   * about, or one that arrived while another question was open.
   */
  private pendingRequest: FileViewOpenRequest | null = null;
  /** Settles the waiting {@link confirmLeave}; the latest caller wins. */
  private pendingLeave: ((leave: boolean) => void) | null = null;

  private readonly dialog = viewChild.required(GitConfirmDialogComponent);
  private readonly backButton =
    viewChild.required<ElementRef<HTMLButtonElement>>('backButton');
  private readonly editorHost =
    viewChild.required<ElementRef<HTMLElement>>('editorHost');

  private handle: SpotEditorHandle | null = null;
  private editorPromise: Promise<SpotEditorHandle | null> | null = null;
  /** Bumped per read so only the latest read lands. */
  private readSeq = 0;
  private destroyed = false;

  protected readonly displayPath = computed(() => {
    const current = this.file();
    return current?.relativePath ?? current?.absolutePath ?? this.request().path;
  });

  protected readonly isMarkdown = computed(
    () => this.file()?.isMarkdown ?? false,
  );

  /** Editing needs a fresh UTF-8 read with a hash, on a host that can save. */
  private readonly canEdit = computed(() => {
    const current = this.file();
    return Boolean(
      current?.status === 'fresh' &&
      current.encoding === 'utf-8' &&
      current.sha256 &&
      !this.saveUnavailable(),
    );
  });

  protected readonly editable = computed(
    () => this.editRequested() && this.canEdit(),
  );

  protected readonly showEditButton = computed(
    () => !this.editable() && this.canEdit() && this.hasDocument(),
  );

  protected readonly canSave = computed(
    () => this.editable() && this.modified() && !this.saving(),
  );

  protected readonly readOnlyNote = computed(() => {
    const current = this.file();
    if (current?.encoding && current.encoding !== 'utf-8') return UTF16_NOTE;
    return null;
  });

  protected readonly previewAvailable = computed(() => {
    const current = this.file();
    return Boolean(
      current?.isMarkdown &&
      current.sizeBytes !== null &&
      current.sizeBytes <= MAX_MARKDOWN_PREVIEW_BYTES,
    );
  });

  protected readonly previewSizeBlocked = computed(() => {
    const current = this.file();
    return Boolean(
      current?.isMarkdown &&
      current.sizeBytes !== null &&
      current.sizeBytes > MAX_MARKDOWN_PREVIEW_BYTES,
    );
  });

  protected readonly previewVisible = computed(
    () => this.previewAvailable() && this.previewRequested(),
  );

  protected readonly editorVisible = computed(
    () =>
      this.hasDocument() &&
      !this.loading() &&
      !this.previewVisible() &&
      this.file()?.status !== 'blocked',
  );

  protected readonly dialogCopy = computed<DialogCopy>(() => {
    switch (this.dialogKind()) {
      case 'conflict':
        return {
          title: 'This file changed on disk since you opened it.',
          description:
            'Overwrite it with your version, or reload the version on disk and drop your edits. Keep editing changes nothing.',
          confirmLabel: 'Overwrite',
          secondaryLabel: 'Reload',
          cancelLabel: 'Keep editing',
          tone: 'danger',
        };
      case 'reload':
        return {
          title: 'Reload from disk?',
          description: `Your unsaved edits to ${this.displayPath()} will be dropped.`,
          confirmLabel: 'Discard and reload',
          cancelLabel: 'Keep editing',
          tone: 'danger',
        };
      case 'leave':
        return {
          title: 'Discard unsaved changes?',
          description: `Your edits to ${this.displayPath()} have not been saved. Leaving the editor discards them.`,
          confirmLabel: 'Discard and leave',
          cancelLabel: 'Keep editing',
          tone: 'danger',
        };
      case 'back':
        return {
          title: 'Discard unsaved changes?',
          description: `Your edits to ${this.displayPath()} have not been saved.`,
          confirmLabel: 'Discard and go back',
          cancelLabel: 'Cancel',
          tone: 'danger',
        };
      case 'external': {
        const pending = this.pendingExternal();
        return {
          title: 'Open outside the workspace?',
          description: pending
            ? `Open ${pending.path ?? 'this file'} in ${this.editorName(pending.target)}?`
            : '',
          confirmLabel: 'Open',
          cancelLabel: 'Cancel',
          tone: 'warning',
        };
      }
      case 'replace':
      default:
        return {
          title: 'Discard unsaved changes?',
          description: `Your edits to ${this.displayPath()} have not been saved. Opening another file replaces them.`,
          confirmLabel: 'Discard and open',
          cancelLabel: 'Cancel',
          tone: 'danger',
        };
    }
  });

  constructor() {
    effect(() => {
      const request = this.request();
      untracked(() => this.requestOpen(request));
    });
    effect(() => {
      const editable = this.editable();
      untracked(() => this.handle?.setEditable(editable));
    });
    effect(() => {
      const dark = this.theme.isDarkMode();
      untracked(() => this.handle?.setDark(dark));
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.handle?.destroy();
      this.handle = null;
      // Whatever replaced the editor already won; the waiting navigation lost.
      this.settleLeave(false);
    });
  }

  /**
   * Asked by the shell before a navigation replaces the editor: `true` at
   * once with nothing unsaved, otherwise the answer to a discard question
   * (Keep editing is `false`). A second call while one waits takes its place
   * and the first answers `false`. A call made while another question is open
   * waits for it to close.
   */
  confirmLeave(): boolean | Promise<boolean> {
    if (!this.modified()) return true;
    return new Promise<boolean>((resolve) => {
      this.settleLeave(false);
      this.pendingLeave = resolve;
      if (this.dialogKind() === null) this.askDialog('leave');
    });
  }

  /**
   * A `file:content-changed` push. With no local edits the open file reloads
   * silently; with edits it is marked stale and the next save asks first.
   */
  notifyDiskChange(filePaths: readonly string[], truncated: boolean): void {
    const current = this.file();
    if (!current || current.status === 'blocked' || !this.hasDocument()) {
      return;
    }
    const key = fileViewTabKey(current.absolutePath);
    if (!truncated && !filePaths.some((path) => fileViewTabKey(path) === key)) {
      return;
    }
    if (this.modified() || this.saving()) {
      this.stale.set(true);
      return;
    }
    void this.reload();
  }

  protected startEditing(): void {
    this.editRequested.set(true);
    this.previewRequested.set(false);
    this.handle?.focus();
  }

  protected showPreview(preview: boolean): void {
    if (!this.previewAvailable()) return;
    if (preview && this.handle) this.previewText.set(this.handle.text());
    this.previewRequested.set(preview);
    if (!preview) this.handle?.focus();
  }

  protected goBack(): void {
    if (this.modified()) {
      this.askDialog('back');
      return;
    }
    this.backToReview.emit();
  }

  /** The stale banner's Reload drops edits, so it asks when there are any. */
  protected reloadFromBanner(): void {
    if (this.modified()) {
      this.askDialog('reload');
      return;
    }
    void this.reload();
  }

  protected retry(): void {
    if (this.hasDocument()) {
      void this.reload();
      return;
    }
    void this.open(this.request());
  }

  protected requestExternalOpen(request: OpenInRequest): void {
    this.pendingExternal.set(request);
    if (!this.askDialog('external')) this.pendingExternal.set(null);
  }

  protected onDialogConfirmed(): void {
    const kind = this.dialogKind();
    this.dialogKind.set(null);
    switch (kind) {
      case 'replace': {
        const next = this.pendingRequest;
        this.pendingRequest = null;
        if (next) void this.open(next);
        this.resumeWaiting();
        return;
      }
      case 'back':
        // Leaving: a request that waited behind this question is older than
        // the navigation Back makes.
        this.pendingRequest = null;
        this.backToReview.emit();
        return;
      case 'leave':
        this.pendingRequest = null;
        this.settleLeave(true);
        return;
      case 'reload':
        void this.reload().then(() => this.resumeWaiting());
        return;
      case 'conflict':
        void this.save(true).then(() => this.resumeWaiting());
        return;
      case 'external': {
        const pending = this.pendingExternal();
        this.pendingExternal.set(null);
        if (pending) this.openExternal.emit(pending);
        this.resumeWaiting();
        return;
      }
      default:
        return;
    }
  }

  /**
   * Cancel, Escape and the UA's close request: the safe choice of each
   * question, and none of them touches the buffer. For a conflict that is
   * Keep editing: the edits, the undo history and the stale mark all stay, so
   * the user can copy their work, save again (which asks again) or reload
   * explicitly.
   */
  protected onDialogCancelled(): void {
    const kind = this.dialogKind();
    this.dialogKind.set(null);
    if (kind === 'replace') this.pendingRequest = null;
    if (kind === 'external') this.pendingExternal.set(null);
    if (kind === 'leave') this.settleLeave(false);
    this.resumeWaiting();
  }

  /** The conflict's explicit Reload: the version on disk wins. */
  protected onDialogSecondary(): void {
    const kind = this.dialogKind();
    this.dialogKind.set(null);
    if (kind !== 'conflict') return;
    void this.reload().then(() => this.resumeWaiting());
  }

  protected async save(overwrite = false): Promise<void> {
    const current = this.file();
    const handle = this.handle;
    if (!current?.sha256 || !handle || !this.editable() || this.saving()) {
      return;
    }
    if (!overwrite && !this.modified()) return;

    const content = handle.text();
    const readSeq = this.readSeq;
    this.saving.set(true);
    this.saveError.set(null);
    this.statusMessage.set('');

    let response: RpcCallResult<FileSaveContentResult> | null = null;
    try {
      response = await rpcCall<FileSaveContentResult>(
        this.vscode,
        'file:saveContent',
        {
          path: current.absolutePath,
          ...(current.workspaceRoot
            ? { workspaceRoot: current.workspaceRoot }
            : {}),
          content,
          expectedSha256: current.sha256,
          ...(overwrite ? { overwrite: true } : {}),
        } satisfies FileSaveContentParams,
      );
    } catch (error: unknown) {
      console.error('[SpotEditor] file:saveContent threw', error);
    }
    this.saving.set(false);
    if (this.destroyed || readSeq !== this.readSeq) return;

    if (!response?.success) {
      if (isSaveUnavailable(response?.error)) {
        this.saveUnavailable.set(true);
        this.saveError.set(SAVE_UNAVAILABLE_MESSAGE);
      } else {
        this.saveError.set(SAVE_FAILED_MESSAGE);
      }
      return;
    }
    const result = response.data;
    if (!result) {
      this.saveError.set(SAVE_FAILED_MESSAGE);
      return;
    }
    if (result.success) {
      this.file.set({ ...current, content, sha256: result.sha256 });
      handle.markSaved(content);
      this.stale.set(false);
      this.statusMessage.set('Saved.');
      return;
    }
    if (result.reason === 'conflict') {
      // The disk moved on: after Keep editing the banner still offers Reload.
      this.stale.set(true);
      this.askDialog('conflict');
      return;
    }
    this.saveError.set(
      typeof result.error === 'string' && result.error
        ? result.error
        : SAVE_FAILED_MESSAGE,
    );
  }

  /** Re-read the open file, keeping the cursor. Drops local edits. */
  protected async reload(): Promise<void> {
    const current = this.file();
    if (!current) return;
    const cursor = this.handle?.cursor() ?? null;
    const seq = ++this.readSeq;
    const result = await this.reader.read(
      current.request,
      seq,
      current.status === 'blocked' ? undefined : current,
    );
    if (this.destroyed || seq !== this.readSeq) return;
    this.stale.set(false);
    this.saveError.set(null);
    const unchanged =
      result.status === 'fresh' &&
      result.sha256 === current.sha256 &&
      !this.modified();
    this.file.set(result);
    // Our own save echoes back as a push: same bytes, so keep undo history.
    if (unchanged || result.status !== 'fresh') return;
    await this.mountDocument(result, cursor);
  }

  /**
   * While any question is open the request waits and the latest wins: the
   * replace question then covers it, and any other question hands it on when
   * it closes ({@link resumeWaiting}).
   */
  private requestOpen(request: FileViewOpenRequest): void {
    if (this.dialogKind() !== null) {
      this.pendingRequest = request;
      return;
    }
    if (!this.modified()) {
      void this.open(request);
      return;
    }
    this.pendingRequest = request;
    this.askDialog('replace');
  }

  /**
   * After a question closes and its action settled: ask the waiting leave, or
   * open the waiting request. A leave goes first — when it is granted the
   * editor is replaced, and the request with it.
   */
  private resumeWaiting(): void {
    if (this.destroyed || this.dialogKind() !== null) return;
    if (this.pendingLeave) {
      if (this.modified()) {
        this.askDialog('leave');
        return;
      }
      this.pendingRequest = null;
      this.settleLeave(true);
      return;
    }
    const next = this.pendingRequest;
    this.pendingRequest = null;
    if (next) this.requestOpen(next);
  }

  private settleLeave(leave: boolean): void {
    const settle = this.pendingLeave;
    this.pendingLeave = null;
    settle?.(leave);
  }

  private async open(request: FileViewOpenRequest): Promise<void> {
    const seq = ++this.readSeq;
    this.loading.set(true);
    this.hasDocument.set(false);
    this.modified.set(false);
    this.stale.set(false);
    this.saveError.set(null);
    this.statusMessage.set('');
    this.editRequested.set(this.startEditable());
    this.previewRequested.set(!this.startEditable());

    const result = await this.reader.read(request, seq);
    if (this.destroyed || seq !== this.readSeq) return;
    this.file.set(result);
    this.loading.set(false);
    if (result.status !== 'fresh') return;
    await this.mountDocument(result, result.reveal);
  }

  private async mountDocument(
    state: FileViewTabState,
    reveal: { line: number; column: number } | null,
  ): Promise<void> {
    const seq = this.readSeq;
    const handle = await this.ensureEditor();
    if (!handle || this.destroyed || seq !== this.readSeq) return;
    handle.load(
      state.content,
      fileNameOf(state.absolutePath),
      `Contents of ${state.relativePath ?? state.absolutePath}`,
    );
    if (reveal) handle.reveal(reveal.line, reveal.column);
    this.previewText.set(state.content);
    this.hasDocument.set(true);
  }

  private ensureEditor(): Promise<SpotEditorHandle | null> {
    this.editorPromise ??= this.createEditor();
    return this.editorPromise;
  }

  private async createEditor(): Promise<SpotEditorHandle | null> {
    try {
      const setup = await import('./codemirror-setup');
      if (this.destroyed) return null;
      this.handle = setup.createSpotEditor({
        parent: this.editorHost().nativeElement,
        editable: this.editable(),
        dark: this.theme.isDarkMode(),
        onModifiedChange: (modified) => this.modified.set(modified),
        onSaveRequest: () => void this.save(),
      });
      this.editorFailed.set(false);
      return this.handle;
    } catch (error: unknown) {
      console.error('[SpotEditor] editor failed to load', error);
      this.editorFailed.set(true);
      // Let the next open try again.
      this.editorPromise = null;
      return null;
    }
  }

  /** `false` when another question is already open; that one wins. */
  private askDialog(kind: DialogKind): boolean {
    if (this.dialogKind() !== null) return false;
    this.dialogKind.set(kind);
    this.dialog().open(this.focusReturnTarget());
    return true;
  }

  private focusReturnTarget(): HTMLElement {
    const active = document.activeElement;
    return active instanceof HTMLElement && active !== document.body
      ? active
      : this.backButton().nativeElement;
  }

  protected editorName(targetId: string): string {
    return (
      this.editorTargets().find((target) => target.id === targetId)
        ?.displayName ?? targetId
    );
  }
}
