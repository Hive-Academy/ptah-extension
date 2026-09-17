import { Injectable, computed, inject, signal } from '@angular/core';
import { rpcCall, VSCodeService } from '@ptah-extension/core';
import type {
  GitReviewChangesResult,
  GitReviewFileResult,
} from '@ptah-extension/shared';

export type GitReviewMode = 'working-tree' | 'branch-review';
const VIEWED_KEY = 'gitReview.viewed.v1';
interface WorkspaceReviewState {
  base: string;
  head: string;
  result: GitReviewChangesResult | null;
  filter: string;
}

@Injectable({ providedIn: 'root' })
export class GitReviewService {
  private readonly vscode = inject(VSCodeService);
  private readonly _mode = signal<GitReviewMode>('working-tree');
  private readonly _workspace = signal<string | null>(null);
  private readonly _base = signal('main');
  private readonly _head = signal('HEAD');
  private readonly _result = signal<GitReviewChangesResult | null>(null);
  private readonly _file = signal<GitReviewFileResult | null>(null);
  private readonly _expanded = signal<string | null>(null);
  private readonly _filter = signal('');
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _viewed = signal<Set<string>>(
    new Set(this.vscode.getState<string[]>(VIEWED_KEY) ?? []),
  );
  private readonly workspaceStates = new Map<string, WorkspaceReviewState>();
  private generation = 0;

  readonly mode = this._mode.asReadonly();
  readonly workspace = this._workspace.asReadonly();
  readonly base = this._base.asReadonly();
  readonly head = this._head.asReadonly();
  readonly result = this._result.asReadonly();
  readonly file = this._file.asReadonly();
  readonly expandedPath = this._expanded.asReadonly();
  readonly filterQuery = this._filter.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly files = computed(() => this._result()?.files ?? []);

  setMode(mode: GitReviewMode): void {
    this._mode.set(mode);
    if (mode === 'branch-review') void this.refresh();
  }
  setBase(base: string): void {
    this._base.set(base);
    void this.refresh();
  }
  setHead(head: string): void {
    this._head.set(head);
    void this.refresh();
  }
  setFilter(query: string): void {
    this._filter.set(query);
  }

  switchWorkspace(workspace: string): void {
    if (workspace === this._workspace()) return;
    this.generation++;
    const previous = this._workspace();
    if (previous) {
      this.workspaceStates.set(previous, {
        base: this._base(),
        head: this._head(),
        result: this._result(),
        filter: this._filter(),
      });
    }
    const restored = this.workspaceStates.get(workspace);
    this._workspace.set(workspace);
    this._base.set(restored?.base ?? 'main');
    this._head.set(restored?.head ?? 'HEAD');
    this._result.set(restored?.result ?? null);
    this._filter.set(restored?.filter ?? '');
    this._file.set(null);
    this._expanded.set(null);
    this._error.set(null);
    if (this._mode() === 'branch-review') void this.refresh();
  }

  removeWorkspaceState(workspace: string): void {
    this.workspaceStates.delete(workspace);
    const viewedPrefix = `${workspace}\0`;
    const viewed = new Set(
      [...this._viewed()].filter((key) => !key.startsWith(viewedPrefix)),
    );
    this._viewed.set(viewed);
    this.vscode.setState(VIEWED_KEY, [...viewed]);
    if (this._workspace() === workspace) {
      this.generation++;
      this._workspace.set(null);
      this._result.set(null);
      this._file.set(null);
      this._expanded.set(null);
    }
  }

  async refresh(): Promise<void> {
    const workspaceRoot = this._workspace();
    if (!workspaceRoot || this._mode() !== 'branch-review') return;
    const generation = ++this.generation;
    this._loading.set(true);
    this._expanded.set(null);
    this._file.set(null);
    try {
      const response = await rpcCall<GitReviewChangesResult>(
        this.vscode,
        'git:reviewChanges',
        {
          workspaceRoot,
          base: this._base(),
          head: this._head(),
        },
      );
      if (generation !== this.generation || workspaceRoot !== this._workspace())
        return;
      const result = response.data;
      if (response.success && result?.success) {
        this._result.set(result);
        this._error.set(null);
      } else {
        this._result.set(null);
        this._error.set(result?.error ?? response.error ?? 'Review failed.');
      }
    } catch (error: unknown) {
      if (
        generation === this.generation &&
        workspaceRoot === this._workspace()
      ) {
        this._result.set(null);
        this._error.set(
          error instanceof Error ? error.message : 'Review failed.',
        );
      }
    } finally {
      if (generation === this.generation) this._loading.set(false);
    }
  }

  async expand(path: string): Promise<void> {
    if (this._expanded() === path) {
      this._expanded.set(null);
      this._file.set(null);
      return;
    }
    const result = this._result();
    const workspaceRoot = this._workspace();
    const entry = result?.files.find((file) => file.path === path);
    const baseSha = result?.mergeBaseSha;
    const headSha = result?.head?.sha;
    if (!entry || !workspaceRoot || !baseSha || !headSha) return;
    const generation = ++this.generation;
    this._expanded.set(path);
    this._file.set(null);
    try {
      const response = await rpcCall<GitReviewFileResult>(
        this.vscode,
        'git:reviewFile',
        {
          workspaceRoot,
          baseSha,
          headSha,
          path,
          ...(entry.originalPath ? { originalPath: entry.originalPath } : {}),
        },
      );
      if (generation !== this.generation || this._expanded() !== path) return;
      if (response.data?.success) this._file.set(response.data);
      else
        this._error.set(
          response.data?.error ?? response.error ?? 'Review file failed.',
        );
    } catch (error: unknown) {
      if (generation === this.generation && this._expanded() === path) {
        this._error.set(
          error instanceof Error ? error.message : 'Review file failed.',
        );
      }
    }
  }

  isViewed(path: string): boolean {
    return this._viewed().has(this.viewedKey(path));
  }
  toggleViewed(path: string): void {
    const key = this.viewedKey(path);
    if (!key) return;
    const next = new Set(this._viewed());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this._viewed.set(next);
    this.vscode.setState(VIEWED_KEY, [...next]);
  }

  private viewedKey(path: string): string {
    const result = this._result();
    return this._workspace() && result?.mergeBaseSha && result.head?.sha
      ? `${this._workspace()}\0${result.mergeBaseSha}\0${result.head.sha}\0${path}`
      : '';
  }
}
