import { Injectable, computed, inject, signal } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  isDocFile,
  isReadableTaskFolderMarkdownName,
  type TaskSpecDetail,
  type TasksListFolderEntriesResult,
  type TasksReadFolderMarkdownResult,
} from '@ptah-extension/shared';
import {
  buildNestedFolderEntries,
  buildRootFolderEntries,
  folderBreadcrumbs,
  isValidFolderDirectory,
  parseFolderEntries,
  rootEntriesOf,
  type TaskFolderBreadcrumb,
  type TaskFolderEntry,
} from './task-folder-entries';

/** The typed non-ready states `tasks:readFolderMarkdown` can answer with. */
export type TaskDocumentUnavailableStatus = Exclude<
  TasksReadFolderMarkdownResult['state'],
  'ready'
>;

/**
 * What the in-place reader shows. Every outcome is a state: a rejected name, a
 * missing file or a failed call never throws out of the store.
 *
 * `missing` from a workflow document means the folder does not hold it yet,
 * which is ordinary, not an error.
 */
export type TaskDocumentState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly file: string }
  | { readonly status: 'ready'; readonly file: string; readonly content: string }
  | {
      readonly status: TaskDocumentUnavailableStatus;
      readonly file: string;
    }
  | { readonly status: 'error'; readonly file: string; readonly message: string };

/** The typed non-ready states `tasks:listFolderEntries` can answer with. */
export type TaskFolderListingUnavailableStatus = Exclude<
  TasksListFolderEntriesResult['state'],
  'ready'
>;

/** The directory currently shown in the folder browser. */
export interface TaskFolderListing {
  /** Relative to the task folder; `''` is the folder itself. */
  readonly directory: string;
  readonly status:
    | 'idle'
    | 'loading'
    | 'ready'
    | TaskFolderListingUnavailableStatus
    | 'error';
  readonly entries: readonly TaskFolderEntry[];
  /** Set only for `error`: the transport's message. */
  readonly message: string | null;
}

interface FolderContext {
  /** The selected task's folder name, as the caller selected it. */
  readonly taskId: string;
  readonly workspaceRoot: string | undefined;
}

const UNAVAILABLE_READ_STATES: readonly TaskDocumentUnavailableStatus[] = [
  'missing',
  'unreadable',
  'binary',
  'directory',
  'too_large',
  'rejected',
];

const UNAVAILABLE_LIST_STATES: readonly TaskFolderListingUnavailableStatus[] =
  ['missing', 'unreadable', 'rejected', 'too_many'];

function unavailableReadState(
  state: unknown,
): TaskDocumentUnavailableStatus | null {
  return UNAVAILABLE_READ_STATES.find((known) => known === state) ?? null;
}

function unavailableListState(
  state: unknown,
): TaskFolderListingUnavailableStatus | null {
  return UNAVAILABLE_LIST_STATES.find((known) => known === state) ?? null;
}

const IDLE_DOCUMENT: TaskDocumentState = { status: 'idle' };

/**
 * Document and folder-browser state for the task open in the detail panel.
 *
 * `TasksStore` owns task selection and drives this store through
 * {@link selectTask}, {@link setDetail} and {@link reset}; components read it
 * only through `TasksStore`'s facade.
 *
 * Two independent latest-request guards:
 * - {@link documentSeq} spans every document read, known workflow documents
 *   (`tasks:getArtifact`) and extra markdown (`tasks:readFolderMarkdown`)
 *   alike, so clicking three files quickly shows the last one clicked.
 * - {@link listingSeq} guards nested directory listings.
 * Both are bumped whenever the task or workspace root changes or the store is
 * reset, and a response is applied only when its `taskId` and name match the
 * request it answers.
 */
@Injectable({ providedIn: 'root' })
export class TaskFolderStore {
  private readonly rpc = inject(ClaudeRpcService);

  private readonly _context = signal<FolderContext | null>(null);
  private readonly _detail = signal<TaskSpecDetail | null>(null);
  private readonly _document = signal<TaskDocumentState>(IDLE_DOCUMENT);
  private readonly _directory = signal('');
  private readonly _nested = signal<TaskFolderListing | null>(null);

  private documentSeq = 0;
  private listingSeq = 0;

  /** The in-place reader's state. */
  public readonly document = this._document.asReadonly();

  /** The file the reader shows or is loading, or `null`. */
  public readonly openFile = computed<string | null>(() => {
    const state = this._document();
    return state.status === 'idle' ? null : state.file;
  });

  /** The browsed directory relative to the task folder (`''` = root). */
  public readonly directory = this._directory.asReadonly();

  /** The browsed directory with its typed status and rows. */
  public readonly listing = computed<TaskFolderListing>(() => {
    const directory = this._directory();
    if (directory !== '') {
      return (
        this._nested() ?? {
          directory,
          status: 'loading',
          entries: [],
          message: null,
        }
      );
    }
    const context = this._context();
    if (context === null) {
      return { directory, status: 'idle', entries: [], message: null };
    }
    const detail = this._detail();
    if (detail === null) {
      return { directory, status: 'loading', entries: [], message: null };
    }
    return {
      directory,
      status: 'ready',
      entries: buildRootFolderEntries(rootEntriesOf(detail)),
      message: null,
    };
  });

  /** Rows of the browsed directory. */
  public readonly entries = computed(() => this.listing().entries);

  /** Breadcrumbs from the task folder to the browsed directory. */
  public readonly breadcrumbs = computed<readonly TaskFolderBreadcrumb[]>(() => {
    const label = this._detail()?.folderName ?? this._context()?.taskId ?? '';
    return folderBreadcrumbs(label, this._directory());
  });

  /**
   * Point the store at a task. Always clears the reader and returns the browser
   * to the folder root, and invalidates every request in flight; re-selecting
   * the same task is a re-read.
   */
  public selectTask(taskId: string, workspaceRoot: string | undefined): void {
    this.invalidate();
    this._context.set({ taskId, workspaceRoot });
    this._detail.set(null);
  }

  /**
   * Supply the selected task's detail (its root listing). A detail for another
   * folder than the selected one is ignored.
   */
  public setDetail(detail: TaskSpecDetail | null): void {
    const context = this._context();
    if (context === null) return;
    // A host answer without a task arrives here as a falsy value at runtime.
    if (!detail) {
      this._detail.set(null);
      return;
    }
    if (detail.folderName !== context.taskId && detail.id !== context.taskId) {
      return;
    }
    this._detail.set(detail);
  }

  /** Forget the task: no folder, no reader, nothing in flight. */
  public reset(): void {
    this.invalidate();
    this._context.set(null);
    this._detail.set(null);
  }

  /** Close the reader and drop any read in flight. */
  public closeDocument(): void {
    this.documentSeq++;
    this._document.set(IDLE_DOCUMENT);
  }

  /**
   * Read one direct-child file of the task folder into the reader.
   *
   * Workflow documents go through `tasks:getArtifact`, whose `content: null`
   * becomes `missing`. Any other name the shared predicate accepts goes through
   * `tasks:readFolderMarkdown`. A name it refuses becomes `rejected` without a
   * host call. Resolves to the state applied, or `null` when a newer request,
   * a task switch or a close superseded this one.
   */
  public async readFile(file: string | null): Promise<TaskDocumentState | null> {
    const context = this._context();
    if (file === null || context === null) {
      this.closeDocument();
      return null;
    }

    const seq = ++this.documentSeq;
    if (!isDocFile(file) && !isReadableTaskFolderMarkdownName(file)) {
      return this.applyDocument(seq, context, { status: 'rejected', file });
    }

    this._document.set({ status: 'loading', file });
    const taskId = this.rpcTaskId(context);
    const params = {
      taskId,
      file,
      ...workspaceParam(context),
    };
    let next: TaskDocumentState;
    try {
      if (isDocFile(file)) {
        const result = await this.rpc.call('tasks:getArtifact', {
          ...params,
          file,
        });
        next = result.isSuccess()
          ? parseArtifactResult(result.data, taskId, file)
          : failure(file, result.error, `Failed to read ${file}`);
      } else {
        const result = await this.rpc.call('tasks:readFolderMarkdown', params);
        next = result.isSuccess()
          ? parseMarkdownResult(result.data, taskId, file)
          : failure(file, result.error, `Failed to read ${file}`);
      }
    } catch (error: unknown) {
      next = failure(
        file,
        error instanceof Error ? error.message : undefined,
        `Failed to read ${file}`,
      );
    }
    return this.applyDocument(seq, context, next);
  }

  /**
   * Browse to a directory of the task folder (`''` = the folder itself).
   * Nested directories are listed through `tasks:listFolderEntries`; a path the
   * local check refuses becomes `rejected` without a host call.
   */
  public async openDirectory(directory: string): Promise<void> {
    const context = this._context();
    const seq = ++this.listingSeq;
    this._directory.set(directory);
    this._nested.set(null);
    if (directory === '' || context === null) return;

    if (!isValidFolderDirectory(directory)) {
      this._nested.set({
        directory,
        status: 'rejected',
        entries: [],
        message: null,
      });
      return;
    }

    const taskId = this.rpcTaskId(context);
    let next: TaskFolderListing;
    try {
      const result = await this.rpc.call('tasks:listFolderEntries', {
        taskId,
        directory,
        ...workspaceParam(context),
      });
      next = result.isSuccess()
        ? parseListingResult(result.data, taskId, directory)
        : listingFailure(directory, result.error);
    } catch (error: unknown) {
      next = listingFailure(
        directory,
        error instanceof Error ? error.message : undefined,
      );
    }
    if (seq !== this.listingSeq || this._context() !== context) return;
    this._nested.set(next);
  }

  private applyDocument(
    seq: number,
    context: FolderContext,
    next: TaskDocumentState,
  ): TaskDocumentState | null {
    if (seq !== this.documentSeq || this._context() !== context) return null;
    this._document.set(next);
    return next;
  }

  /** The folder name wins over a frontmatter id once the detail is known. */
  private rpcTaskId(context: FolderContext): string {
    return this._detail()?.folderName ?? context.taskId;
  }

  private invalidate(): void {
    this.documentSeq++;
    this.listingSeq++;
    this._document.set(IDLE_DOCUMENT);
    this._directory.set('');
    this._nested.set(null);
  }
}

function workspaceParam(context: FolderContext): { workspaceRoot?: string } {
  return context.workspaceRoot ? { workspaceRoot: context.workspaceRoot } : {};
}

function failure(
  file: string,
  message: string | undefined,
  fallback: string,
): TaskDocumentState {
  return { status: 'error', file, message: message || fallback };
}

function mismatch(file: string): TaskDocumentState {
  return {
    status: 'error',
    file,
    message: `The host answered for a different document than ${file}.`,
  };
}

/** Validate a `tasks:getArtifact` answer for exactly this request. */
function parseArtifactResult(
  data: unknown,
  taskId: string,
  file: string,
): TaskDocumentState {
  if (typeof data !== 'object' || data === null) return mismatch(file);
  const resultFile: unknown = Reflect.get(data, 'file');
  const resultTask: unknown = Reflect.get(data, 'taskId');
  const content: unknown = Reflect.get(data, 'content');
  if (resultFile !== file) return mismatch(file);
  if (resultTask !== undefined && resultTask !== taskId) return mismatch(file);
  if (content === null) return { status: 'missing', file };
  if (typeof content !== 'string') return mismatch(file);
  return { status: 'ready', file, content };
}

/** Validate a `tasks:readFolderMarkdown` answer for exactly this request. */
function parseMarkdownResult(
  data: unknown,
  taskId: string,
  file: string,
): TaskDocumentState {
  if (typeof data !== 'object' || data === null) return mismatch(file);
  const resultFile: unknown = Reflect.get(data, 'file');
  const resultTask: unknown = Reflect.get(data, 'taskId');
  const state: unknown = Reflect.get(data, 'state');
  const content: unknown = Reflect.get(data, 'content');
  if (resultFile !== file || resultTask !== taskId) return mismatch(file);
  if (state === 'ready') {
    return typeof content === 'string'
      ? { status: 'ready', file, content }
      : mismatch(file);
  }
  const unavailable = unavailableReadState(state);
  return unavailable === null ? mismatch(file) : { status: unavailable, file };
}

function listingFailure(
  directory: string,
  message: string | undefined,
): TaskFolderListing {
  return {
    directory,
    status: 'error',
    entries: [],
    message: message || `Failed to list ${directory}`,
  };
}

/** Validate a `tasks:listFolderEntries` answer for exactly this request. */
function parseListingResult(
  data: unknown,
  taskId: string,
  directory: string,
): TaskFolderListing {
  const invalid = listingFailure(
    directory,
    `The host answered for a different folder than ${directory}.`,
  );
  if (typeof data !== 'object' || data === null) return invalid;
  const resultTask: unknown = Reflect.get(data, 'taskId');
  const resultDirectory: unknown = Reflect.get(data, 'directory');
  const state: unknown = Reflect.get(data, 'state');
  if (resultTask !== taskId || resultDirectory !== directory) return invalid;
  if (state !== 'ready') {
    const unavailable = unavailableListState(state);
    if (unavailable === null) return invalid;
    return { directory, status: unavailable, entries: [], message: null };
  }
  return {
    directory,
    status: 'ready',
    entries: buildNestedFolderEntries(
      parseFolderEntries(Reflect.get(data, 'entries')),
    ),
    message: null,
  };
}
