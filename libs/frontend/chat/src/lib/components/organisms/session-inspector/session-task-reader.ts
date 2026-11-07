import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  AppStateManager,
  FILE_LINK_OPENER,
  LoggingService,
  VSCodeService,
  rpcCall,
} from '@ptah-extension/core';
import {
  BATCHES_FILE,
  CARRIER_FILE,
  LEGACY_BATCHES_FILE,
  isDocFile,
  isReadableTaskFolderMarkdownName,
  type SessionTaskLinkSummary,
  type TaskSpecDetail,
} from '@ptah-extension/shared';
import {
  TasksChangedFeed,
  deriveTaskStage,
  orderTaskDocuments,
} from '@ptah-extension/tasks-ui/presentation';
import { ChatStore } from '../../../services/chat.store';
import { SessionOrganizationCache } from '../../../services/session-organization/session-organization-cache.store';
import type {
  SectionState,
  TaskSectionData,
} from '../../../services/session-inspector';
import { normalizeWorkspaceRoot } from '../../../services/workspace-root';

/** Trailing debounce of `tasks:changed` refreshes. */
const REFRESH_DEBOUNCE_MS = 300;

/** The session's resolved task link; `null` = unknown (section not rendered). */
interface TaskLink {
  readonly lead: SessionTaskLinkSummary;
  readonly related: readonly SessionTaskLinkSummary[];
  readonly workspaceRoot: string | null;
}

/** Lead = the `primary` link, else the most recent `createdAt` (req 17, PM-12). */
function resolveLink(
  tasks: readonly SessionTaskLinkSummary[],
  workspaceRoot: string | null,
): TaskLink | null {
  if (tasks.length === 0) return null;
  const byNewest = [...tasks].sort((a, b) => b.createdAt - a.createdAt);
  const lead = tasks.find((task) => task.role === 'primary') ?? byNewest[0];
  return {
    lead,
    related: byNewest.filter((task) => task !== lead),
    workspaceRoot,
  };
}

function sameLink(a: TaskLink | null, b: TaskLink | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    normalizeWorkspaceRoot(a.workspaceRoot ?? '') ===
      normalizeWorkspaceRoot(b.workspaceRoot ?? '') &&
    a.lead.taskId === b.lead.taskId &&
    a.lead.missing === b.lead.missing &&
    a.related.length === b.related.length &&
    a.related.every((task, i) => task.taskId === b.related[i].taskId)
  );
}

function linkKey(link: TaskLink): string {
  return `${normalizeWorkspaceRoot(link.workspaceRoot ?? '')}\0${link.lead.taskId}`;
}

/** Documents of a read task: the carrier plus what exists, in board order. */
function documentsOf(task: TaskSpecDetail): readonly string[] {
  if (task.artifacts.length === 0) return [];
  return orderTaskDocuments(
    task.artifacts.includes(CARRIER_FILE)
      ? task.artifacts
      : [CARRIER_FILE, ...task.artifacts],
  );
}

export function documentExcerpt(content: string): string {
  const body = content.replace(/^\uFEFF?---[ \t]*\r?\n(?=---[ \t]*(?:\r?\n|$)|[ \t]*[A-Za-z_][\w-]*[ \t]*:)(?:(?![ \t]*\r?\n|#{1,6}[ \t])[^\r\n]*\r?\n)*?---[ \t]*(?:\r?\n|$)/, '').trim();
  if (!body) return 'No content';
  const lines = body.slice(0, 600).split(/\r?\n/);
  return lines.slice(0, 6).join('\n') + (body.length > 600 || lines.length > 6 ? '…' : '');
}

export function documentProgress(content: string, file: string = LEGACY_BATCHES_FILE): { done: number; total: number } | null {
  if (file === BATCHES_FILE) {
    const tasks = [...content.matchAll(/^### Task [^\r\n]+? [—-] (PENDING|IN_PROGRESS|IMPLEMENTED|COMPLETE|FAILED)\s*$/gm)];
    if (tasks.length) return { done: tasks.filter(match => match[1] === 'COMPLETE').length, total: tasks.length };
  }
  const checkboxes = [...content.matchAll(/^\s*[-*]\s+\[([ xX])\]/gm)];
  if (checkboxes.length) return { done: checkboxes.filter(match => match[1].toLowerCase() === 'x').length, total: checkboxes.length };
  const statuses = [...content.matchAll(/^\s*status:\s*(done|backlog|in_progress|in_review|blocked|cancelled)\s*$/gim)];
  return statuses.length ? { done: statuses.filter(match => match[1].toLowerCase() === 'done').length, total: statuses.length } : null;
}

/**
 * Reads the TASK section's data: resolves the session's lead task link from
 * the session organization, reads it with `tasks:get`, refreshes it on
 * `tasks:changed`, and opens its documents through `FILE_LINK_OPENER`.
 *
 * Component-scoped (provided by the TASK section), so a closed inspector
 * fetches nothing. One read in flight; a trigger during flight re-reads once
 * after it; a result for a lead that changed meanwhile is dropped.
 */
@Injectable()
export class SessionTaskReader {
  private readonly chatStore = inject(ChatStore);
  private readonly organizationCache = inject(SessionOrganizationCache);
  private readonly tabs = inject(TabManagerService);
  private readonly appState = inject(AppStateManager);
  private readonly vscode = inject(VSCodeService);
  private readonly feed = inject(TasksChangedFeed);
  private readonly opener = inject(FILE_LINK_OPENER, { optional: true });
  private readonly logger = inject(LoggingService);

  private readonly tabIdSource = signal<Signal<string> | null>(null);
  private readonly result = signal<{
    readonly key: string;
    readonly state: SectionState<TaskSectionData>;
  } | null>(null);
  private readonly _openError = signal<{ readonly file: string } | null>(null);
  private readonly _preview = signal<{ file: string; status: 'loading' | 'ready' | 'error'; content: string } | null>(null);
  readonly preview = computed(() => {
    const link = this.link();
    return (link ? linkKey(link) : null) === this.previewTaskKey ? this._preview() : null;
  });
  private readonly previewCache = new Map<string, string>();
  private readonly progressCache = new Map<string, { done: number; total: number } | null>();
  private readonly _progress = signal<{ key: string; done: number; total: number } | null>(null);
  readonly progress = computed(() => {
    const link = this.link();
    const value = this._progress();
    return link && value?.key === linkKey(link) ? value : null;
  });
  private previewSequence = 0;
  private previewTaskKey: string | null = null;
  private readonly progressGeneration = new Map<string, number>();

  private inFlight = false;
  private dirty = false;
  private destroyed = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** `tasks:changed` events up to this sequence predate the reader. */
  private readonly seenSeq = this.feed.changes()?.seq ?? 0;

  /** Whether documents can be opened in this host. */
  readonly canOpen = this.opener !== null;
  readonly openError = this._openError.asReadonly();

  readonly link = computed<TaskLink | null>(
    () => {
      const tabId = this.tabIdSource()?.();
      if (!tabId || !this.chatStore.organizationAvailable()) return null;
      const found = this.tabs.findTabByIdAcrossWorkspaces(tabId);
      const sessionId = found?.tab.claudeSessionId;
      if (!sessionId) return null;
      // The cache serves the loaded `session:list` row and, for a session
      // outside it (paging, filters), one `session:getOrganization` read that
      // `session:organizationChanged` refreshes — so the link also resolves
      // for tabs whose session row is not loaded (TASK_2026_854).
      const tasks = this.organizationCache.organizationFor(sessionId)()?.tasks;
      if (!tasks) return null;
      return resolveLink(
        tasks,
        found.workspacePath ?? this.appState.workspaceInfo()?.path ?? null,
      );
    },
    { equal: sameLink },
  );

  /** Section state; `null` while the link is unknown (no section, D27). */
  readonly state = computed<SectionState<TaskSectionData> | null>(() => {
    const link = this.link();
    if (!link) return null;
    const held = this.result();
    if (held && held.key === linkKey(link)) {
      if (!held.state.data) return held.state;
      return {
        ...held.state,
        data: { ...held.state.data, related: this.relatedOf(link) },
      };
    }
    return {
      status: 'loading',
      data: {
        lead: { taskId: link.lead.taskId, missing: link.lead.missing },
        task: null,
        stage: null,
        documents: [],
        related: this.relatedOf(link),
      },
    };
  });

  constructor() {
    // Re-read on every change of the resolved link (lead, root).
    effect(() => {
      const link = this.link();
      const key = link ? linkKey(link) : null;
      if (key !== this.previewTaskKey) {
        this.previewTaskKey = key;
        this.closePreview();
      }
      if (link) untracked(() => void this.read());
    });

    // Live refresh on `tasks:changed` for this workspace and task folder.
    effect(() => {
      const event = this.feed.changes();
      if (!event || event.seq <= this.seenSeq) return;
      untracked(() => {
        const link = this.link();
        if (!link?.workspaceRoot) return;
        const change = event.change;
        if (
          normalizeWorkspaceRoot(change.workspaceRoot) !==
          normalizeWorkspaceRoot(link.workspaceRoot)
        )
          return;
        const held = this.result();
        const folder = held?.key === linkKey(link)
          ? held.state.data?.task?.folderName
          : null;
        if (change.folderNames && folder && !change.folderNames.includes(folder))
          return;
        const key = linkKey(link);
        for (const cacheKey of this.previewCache.keys()) {
          if (cacheKey.startsWith(`${key}\0`)) this.previewCache.delete(cacheKey);
        }
        for (const cacheKey of this.progressCache.keys()) {
          if (cacheKey.startsWith(`${key}\0`)) this.progressCache.delete(cacheKey);
        }
        this.progressGeneration.set(key, (this.progressGeneration.get(key) ?? 0) + 1);
        const previewFile = this._preview()?.file;
        if (previewFile) void this.previewDocument(previewFile);
        this.scheduleRefresh();
      });
    });

    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    });
  }

  /** Bind the tab whose session is read (the section's `tabId` input). */
  bind(tabId: Signal<string>): void {
    this.tabIdSource.set(tabId);
  }

  /** `Retry loading task`. */
  retry(): void {
    void this.read();
  }

  closePreview(): void {
    this.previewSequence++;
    this._preview.set(null);
  }

  async previewDocument(file: string): Promise<void> {
    const link = this.link();
    const task = this.state()?.data?.task;
    if (!link || !task || !this.state()?.data?.documents.includes(file) ||
      (!isDocFile(file) && !isReadableTaskFolderMarkdownName(file))) return;
    const key = `${linkKey(link)}\0${file}`;
    const sequence = ++this.previewSequence;
    const cached = this.previewCache.get(key);
    if (cached !== undefined) {
      this._preview.set({ file, status: 'ready', content: cached });
      return;
    }
    this._preview.set({ file, status: 'loading', content: '' });
    try {
      let content: string | null = null;
      if (isDocFile(file)) {
        const response = await rpcCall<{ file: string; content: string | null }>(this.vscode, 'tasks:getArtifact', {
          workspaceRoot: link.workspaceRoot ?? undefined, taskId: task.id, file,
        });
        if (!response.success || response.data?.file !== file) throw new Error('Document unavailable');
        content = response.data.content;
      } else {
        const response = await rpcCall<{ taskId: string; file: string; state: string; content: string | null }>(this.vscode, 'tasks:readFolderMarkdown', {
          workspaceRoot: link.workspaceRoot ?? undefined, taskId: task.id, file,
        });
        if (!response.success || response.data?.taskId !== task.id || response.data?.file !== file || response.data.state !== 'ready') throw new Error('Document unavailable');
        content = response.data.content;
      }
      if (content === null) throw new Error('Document unavailable');
      const excerpt = documentExcerpt(content);
      if (!this.destroyed && sequence === this.previewSequence && this.isCurrent(linkKey(link))) {
        this.previewCache.set(key, excerpt);
        this._preview.set({ file, status: 'ready', content: excerpt });
      }
    } catch (error: unknown) {
      if (!this.destroyed && sequence === this.previewSequence && this.isCurrent(linkKey(link))) {
        this.logger.error('SessionTaskReader', 'Could not preview task document', error instanceof Error ? error : new Error(String(error)));
        this._preview.set({ file, status: 'error', content: '' });
      }
    }
  }

  /**
   * Open one document of the read task. Only files the folder listed (or the
   * carrier) are opened: a traversal guard, as on the Tasks board. A
   * rejection sets the row-level `openError`; a user cancel resolves quietly.
   */
  async openDocument(file: string, origin?: Element | null): Promise<void> {
    const link = this.link();
    const held = this.result();
    const task = link && held?.key === linkKey(link) ? held.state.data?.task : null;
    const root = link?.workspaceRoot;
    if (!task || !root || !this.opener) return;
    if (!task.artifacts.includes(file) && file !== CARRIER_FILE) return;
    const path = `${root.replace(/[\\/]+$/, '')}/.ptah/specs/${task.folderName}/${file}`;
    this._openError.set(null);
    try {
      await this.opener.open({ path, origin });
    } catch (error: unknown) {
      this.logger.error('SessionTaskReader', 'Could not open a task document', error instanceof Error ? error : new Error(String(error)));
      if (!this.destroyed) this._openError.set({ file });
    }
  }

  private relatedOf(link: TaskLink): TaskSectionData['related'] {
    return link.related.map((task) => ({
      taskId: task.taskId,
      title: null,
      status: null,
    }));
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.read();
    }, REFRESH_DEBOUNCE_MS);
  }

  private async read(): Promise<void> {
    if (this.destroyed) return;
    if (this.inFlight) {
      this.dirty = true;
      return;
    }
    const link = untracked(this.link);
    if (!link) return;
    const taskId = link.lead.taskId;
    const key = linkKey(link);
    this.inFlight = true;
    try {
      // Explicit result type: the untyped `string` overload is listed first
      // and would otherwise win with `{}` (shape = shared `TasksGetResult`).
      const response = await rpcCall<{ task: TaskSpecDetail | null }>(
        this.vscode,
        'tasks:get',
        {
          workspaceRoot: link.workspaceRoot ?? undefined,
          taskId,
        },
      );
      // A result for a lead that changed meanwhile is dropped; the dirty
      // re-read below fetches the current one.
      if (this.destroyed || !this.isCurrent(key))
        return;
      if (!response.success || !response.data) {
        this.setError(key, response.error ?? 'Could not load the task');
        return;
      }
      const task = response.data.task;
      const documents = task ? documentsOf(task) : [];
      this.setState(key, {
        status: task && documents.length === 0 ? 'partial' : 'ready',
        data: {
          lead: { taskId, missing: link.lead.missing || task === null },
          task,
          stage: task ? deriveTaskStage(task.artifacts) : null,
          documents,
          related: this.relatedOf(link),
        },
      });
      if (task) void this.loadProgress(link, task, documents);
    } catch (error: unknown) {
      this.logger.error('SessionTaskReader', 'Could not load the task', error instanceof Error ? error : new Error(String(error)));
      if (!this.destroyed && this.isCurrent(key))
        this.setError(key, 'Could not load the task');
    } finally {
      this.inFlight = false;
      if (this.dirty && !this.destroyed) {
        this.dirty = false;
        void this.read();
      }
    }
  }

  private async loadProgress(link: TaskLink, task: TaskSpecDetail, documents: readonly string[]): Promise<void> {
    const file = documents.includes(BATCHES_FILE) ? BATCHES_FILE
      : documents.includes(LEGACY_BATCHES_FILE) ? LEGACY_BATCHES_FILE : null;
    if (!file) { this._progress.set(null); return; }
    const key = linkKey(link);
    const generation = (this.progressGeneration.get(key) ?? 0) + 1;
    this.progressGeneration.set(key, generation);
    const cacheKey = `${key}\0${file}`;
    if (this.progressCache.has(cacheKey)) {
      const cached = this.progressCache.get(cacheKey);
      this._progress.set(cached ? { key, ...cached } : null);
      return;
    }
    try {
      const response = await rpcCall<{ taskId: string; file: string; state: string; content: string | null }>(this.vscode, 'tasks:readFolderMarkdown', {
        workspaceRoot: link.workspaceRoot ?? undefined, taskId: task.id, file,
      });
      const ready = response.success && response.data?.taskId === task.id && response.data.file === file && response.data.state === 'ready';
      const progress = ready && response.data?.content !== null && response.data?.content !== undefined
        ? documentProgress(response.data.content, file) : null;
      if (!this.destroyed && this.isCurrent(key) && this.progressGeneration.get(key) === generation) {
        if (ready) this.progressCache.set(cacheKey, progress);
        this._progress.set(progress ? { key, ...progress } : null);
      }
    } catch (error: unknown) {
      if (!this.destroyed && this.isCurrent(key) && this.progressGeneration.get(key) === generation)
        this.logger.error('SessionTaskReader', 'Could not load task progress', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** An error keeps the content already read for the same task. */
  private isCurrent(key: string): boolean {
    const link = untracked(this.link);
    return link !== null && linkKey(link) === key;
  }

  private setError(key: string, error: string): void {
    const held = untracked(this.result);
    this.setState(key, {
      status: 'error',
      data: held?.key === key ? held.state.data : null,
      error,
    });
  }

  private setState(key: string, state: SectionState<TaskSectionData>): void {
    this.result.set({ key, state });
  }
}
