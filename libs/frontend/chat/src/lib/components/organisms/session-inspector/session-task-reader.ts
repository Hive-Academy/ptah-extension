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
  VSCodeService,
  rpcCall,
} from '@ptah-extension/core';
import {
  CARRIER_FILE,
  type SessionTaskLinkSummary,
  type TaskSpecDetail,
} from '@ptah-extension/shared';
import {
  TasksChangedFeed,
  deriveTaskStage,
  orderTaskDocuments,
} from '@ptah-extension/tasks-ui/presentation';
import { ChatStore } from '../../../services/chat.store';
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
    a.workspaceRoot === b.workspaceRoot &&
    a.lead.taskId === b.lead.taskId &&
    a.lead.missing === b.lead.missing &&
    a.related.length === b.related.length &&
    a.related.every((task, i) => task.taskId === b.related[i].taskId)
  );
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
  private readonly tabs = inject(TabManagerService);
  private readonly appState = inject(AppStateManager);
  private readonly vscode = inject(VSCodeService);
  private readonly feed = inject(TasksChangedFeed);
  private readonly opener = inject(FILE_LINK_OPENER, { optional: true });

  private readonly tabIdSource = signal<Signal<string> | null>(null);
  private readonly result = signal<{
    readonly taskId: string;
    readonly state: SectionState<TaskSectionData>;
  } | null>(null);
  private readonly _openError = signal<{ readonly file: string } | null>(null);

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
      const session = this.chatStore
        .sessions()
        .find((candidate) => candidate.id === sessionId);
      const tasks = session?.organization?.tasks;
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
    if (held && held.taskId === link.lead.taskId) {
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
      if (this.link()) untracked(() => void this.read());
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
        const folder = this.result()?.state.data?.task?.folderName;
        if (change.folderNames && folder && !change.folderNames.includes(folder))
          return;
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

  /**
   * Open one document of the read task. Only files the folder listed (or the
   * carrier) are opened: a traversal guard, as on the Tasks board. A
   * rejection sets the row-level `openError`; a user cancel resolves quietly.
   */
  async openDocument(file: string, origin?: Element | null): Promise<void> {
    const task = this.result()?.state.data?.task;
    const root = this.link()?.workspaceRoot;
    if (!task || !root || !this.opener) return;
    if (!task.artifacts.includes(file) && file !== CARRIER_FILE) return;
    const path = `${root.replace(/[\\/]+$/, '')}/.ptah/specs/${task.folderName}/${file}`;
    this._openError.set(null);
    try {
      await this.opener.open({ path, origin });
    } catch (error: unknown) {
      console.error('[SessionInspector] Could not open a task document', error);
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
      if (this.destroyed || untracked(this.link)?.lead.taskId !== taskId)
        return;
      if (!response.success || !response.data) {
        this.setError(taskId, response.error ?? 'Could not load the task');
        return;
      }
      const task = response.data.task;
      const documents = task ? documentsOf(task) : [];
      this.setState(taskId, {
        status: task && documents.length === 0 ? 'partial' : 'ready',
        data: {
          lead: { taskId, missing: link.lead.missing || task === null },
          task,
          stage: task ? deriveTaskStage(task.artifacts) : null,
          documents,
          related: this.relatedOf(link),
        },
      });
    } catch (error: unknown) {
      console.error('[SessionInspector] Could not load the task', error);
      if (!this.destroyed && untracked(this.link)?.lead.taskId === taskId)
        this.setError(taskId, 'Could not load the task');
    } finally {
      this.inFlight = false;
      if (this.dirty && !this.destroyed) {
        this.dirty = false;
        void this.read();
      }
    }
  }

  /** An error keeps the content already read for the same task. */
  private setError(taskId: string, error: string): void {
    const held = untracked(this.result);
    this.setState(taskId, {
      status: 'error',
      data: held?.taskId === taskId ? held.state.data : null,
      error,
    });
  }

  private setState(taskId: string, state: SectionState<TaskSectionData>): void {
    this.result.set({ taskId, state });
  }
}
