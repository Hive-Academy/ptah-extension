/**
 * SessionOrganizationEditorComponent — the per-session organization dialog,
 * opened from a sidebar row's menu (TASK_2026_580, plan component 11).
 *
 * Edits priority, workflow status and pin; links and unlinks tasks; adds,
 * opens and removes PR links; shows the worktree path and branch.
 *
 * Every change is one mutation RPC. A successful result carries the whole
 * organization record, which replaces the dialog's copy; the sidebar list
 * refreshes from the `session:organizationChanged` push (C0.2). `ok: false`
 * and transport failures are shown inline (`role="alert"`), never thrown.
 *
 * PR links open as external links only when the URL is `https:`; anything
 * else is shown as text. The `https:` rule is checked before adding too, so
 * the user sees the reason without a round trip.
 *
 * "Open worktree" (Assumption A3): `editor:openWorkspace {target, root}`
 * accepts a directory and Electron serves it (`ElectronEditorLauncher`), but
 * it needs a detected editor target and refuses a root outside the open
 * workspace folders. So the dialog lists the detected editors, shows the
 * host's refusal inline, and always offers "Copy path" as well.
 */
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  Copy,
  ExternalLink,
  FolderOpen,
  LucideAngularModule,
  X,
} from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  SESSION_PRIORITIES,
  SESSION_TASK_LINK_ROLES,
  SESSION_WORKFLOW_STATUSES,
  type ChatSessionSummary,
  type EditorTarget,
  type EditorTargetId,
  type RpcMethodParams,
  type SessionOrganizationMutationResult,
  type SessionOrganizationSummary,
  type SessionPrLinkSummary,
  type SessionPriority,
  type SessionTaskLinkRole,
  type SessionWorkflowStatus,
} from '@ptah-extension/shared';
import {
  SESSION_PRIORITY_LABELS,
  SESSION_STATUS_LABELS,
} from '../../atoms/session-organization-chips/session-organization-labels';

/** Longest PR URL the host accepts (`SessionAddPrLinkParams`). */
const MAX_PR_URL_LENGTH = 2048;

/** The URL when it is a well-formed `https:` URL within the length cap. */
export function httpsUrlOrNull(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > MAX_PR_URL_LENGTH) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    // An unparsable URL is not a link; the caller shows it as text or
    // refuses it with a visible message.
    return null;
  }
}

/** The organization mutation RPCs; each answers `SessionOrganizationMutationResult`. */
type OrganizationMutation =
  | 'session:setOrganization'
  | 'session:linkTask'
  | 'session:unlinkTask'
  | 'session:addPrLink'
  | 'session:removePrLink';

/** One status line under an action: what happened, or why it did not. */
interface ActionNotice {
  readonly kind: 'success' | 'error';
  readonly message: string;
}

let nextId = 0;

@Component({
  selector: 'ptah-session-organization-editor',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [':host { display: contents; }'],
  template: `
    @if (session(); as current) {
      <dialog
        class="modal modal-open"
        aria-modal="true"
        [attr.aria-labelledby]="titleId"
        (keydown.escape)="onEscape($event)"
        data-testid="session-organization-editor"
      >
        <div class="modal-box max-w-md p-4 text-sm text-base-content">
          <div
            class="flex items-center justify-between gap-2 pb-2 border-b border-base-300"
          >
            <h3 [id]="titleId" class="font-semibold text-base truncate">
              Organize “{{ current.name || 'Untitled session' }}”
            </h3>
            <button
              #closeButton
              type="button"
              class="btn btn-ghost btn-sm btn-circle"
              aria-label="Close dialog"
              (click)="close()"
              data-testid="session-org-close"
            >
              <lucide-angular
                [img]="XIcon"
                class="w-4 h-4"
                aria-hidden="true"
              />
            </button>
          </div>

          @if (organization(); as org) {
            <div class="flex flex-col gap-4 pt-3">
              @if (error(); as message) {
                <div
                  role="alert"
                  class="rounded border border-error/50 bg-error/10 px-2 py-1.5 text-xs"
                  data-testid="session-org-error"
                >
                  {{ message }}
                </div>
              }

              <!-- Priority, status, pin -->
              <div class="grid grid-cols-2 gap-2">
                <div class="flex flex-col gap-1">
                  <label class="text-xs font-semibold" [attr.for]="priorityId"
                    >Priority</label
                  >
                  <select
                    [id]="priorityId"
                    class="select select-bordered select-sm w-full"
                    [disabled]="busy()"
                    (change)="onPriority($event)"
                    data-testid="session-org-priority"
                  >
                    @for (value of priorities; track value) {
                      <option
                        [value]="value"
                        [selected]="value === org.priority"
                      >
                        {{ priorityLabels[value] }}
                      </option>
                    }
                  </select>
                </div>
                <div class="flex flex-col gap-1">
                  <label class="text-xs font-semibold" [attr.for]="statusId"
                    >Status</label
                  >
                  <select
                    [id]="statusId"
                    class="select select-bordered select-sm w-full"
                    [disabled]="busy()"
                    (change)="onStatus($event)"
                    data-testid="session-org-status"
                  >
                    @for (value of statuses; track value) {
                      <option [value]="value" [selected]="value === org.status">
                        {{ statusLabels[value] }}
                      </option>
                    }
                  </select>
                </div>
              </div>
              <label
                class="flex items-center gap-2 min-h-6 cursor-pointer self-start"
              >
                <input
                  type="checkbox"
                  class="toggle toggle-sm"
                  [checked]="org.pinned"
                  [disabled]="busy()"
                  (change)="onPinned($event)"
                  data-testid="session-org-pinned"
                />
                <span>Pin to the top of the list</span>
              </label>

              <!-- Tasks -->
              <section
                class="flex flex-col gap-1.5"
                [attr.aria-labelledby]="tasksId"
              >
                <h4 [id]="tasksId" class="text-xs font-semibold">
                  Linked tasks
                </h4>
                @if (org.tasks.length > 0) {
                  <ul class="flex flex-col gap-1">
                    @for (task of org.tasks; track task.taskId) {
                      <li
                        class="flex items-center gap-2 rounded bg-base-200 px-2 min-h-8"
                        data-testid="session-org-task"
                      >
                        <span class="truncate font-mono text-xs flex-1">{{
                          task.taskId
                        }}</span>
                        <span class="text-xs text-base-content-muted">{{
                          task.role === 'primary' ? 'Primary' : 'Related'
                        }}</span>
                        @if (task.missing) {
                          <span
                            class="text-xs rounded border border-dashed border-base-content/40 px-1"
                            >missing</span
                          >
                        }
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs h-6 min-h-6"
                          [disabled]="busy()"
                          [attr.aria-label]="'Unlink task ' + task.taskId"
                          (click)="unlinkTask(task.taskId)"
                          data-testid="session-org-unlink-task"
                        >
                          Unlink
                        </button>
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="text-xs text-base-content-muted">No linked task.</p>
                }
                <form
                  class="flex items-center gap-1.5"
                  (submit)="linkTask($event)"
                  data-testid="session-org-link-form"
                >
                  <label class="sr-only" [attr.for]="taskInputId"
                    >Task id to link</label
                  >
                  <input
                    [id]="taskInputId"
                    type="text"
                    class="input input-bordered input-sm flex-1 min-w-0 font-mono text-xs"
                    placeholder="TASK_2026_..."
                    [value]="taskDraft()"
                    (input)="taskDraft.set(inputValue($event))"
                    [disabled]="busy()"
                    data-testid="session-org-task-input"
                  />
                  <label class="sr-only" [attr.for]="roleId">Link role</label>
                  <select
                    [id]="roleId"
                    class="select select-bordered select-sm"
                    [disabled]="busy()"
                    (change)="onRole($event)"
                    data-testid="session-org-task-role"
                  >
                    @for (role of roles; track role) {
                      <option [value]="role" [selected]="role === taskRole()">
                        {{ role === 'primary' ? 'Primary' : 'Related' }}
                      </option>
                    }
                  </select>
                  <button
                    type="submit"
                    class="btn btn-sm"
                    [disabled]="busy() || !taskDraft().trim()"
                    data-testid="session-org-link-task"
                  >
                    Link
                  </button>
                </form>
              </section>

              <!-- Pull requests -->
              <section
                class="flex flex-col gap-1.5"
                [attr.aria-labelledby]="prsId"
              >
                <h4 [id]="prsId" class="text-xs font-semibold">
                  Pull requests
                </h4>
                @if (org.prLinks.length > 0) {
                  <ul class="flex flex-col gap-1">
                    @for (pr of org.prLinks; track pr.url) {
                      <li
                        class="flex items-center gap-2 rounded bg-base-200 px-2 min-h-8"
                        data-testid="session-org-pr"
                      >
                        @if (safeHref(pr.url); as href) {
                          <a
                            class="link inline-flex items-center gap-1 min-h-6 truncate flex-1 text-xs text-base-content"
                            [href]="href"
                            target="_blank"
                            rel="noopener noreferrer"
                            [attr.aria-label]="
                              'Open ' + prLabel(pr) + ' in the browser'
                            "
                            data-testid="session-org-pr-link"
                          >
                            <span class="truncate">{{ prLabel(pr) }}</span>
                            <lucide-angular
                              [img]="ExternalLinkIcon"
                              class="w-3 h-3 shrink-0"
                              aria-hidden="true"
                            />
                          </a>
                        } @else {
                          <span
                            class="truncate flex-1 text-xs"
                            data-testid="session-org-pr-text"
                            >{{ prLabel(pr) }}</span
                          >
                        }
                        @if (pr.state) {
                          <span class="text-xs text-base-content-muted">{{
                            pr.state
                          }}</span>
                        }
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs h-6 min-h-6"
                          [disabled]="busy()"
                          [attr.aria-label]="'Remove ' + prLabel(pr)"
                          (click)="removePr(pr.url)"
                          data-testid="session-org-remove-pr"
                        >
                          Remove
                        </button>
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="text-xs text-base-content-muted">
                    No pull request linked.
                  </p>
                }
                <form
                  class="flex items-center gap-1.5"
                  (submit)="addPr($event)"
                  data-testid="session-org-pr-form"
                >
                  <label class="sr-only" [attr.for]="prInputId"
                    >Pull request URL</label
                  >
                  <input
                    [id]="prInputId"
                    type="url"
                    class="input input-bordered input-sm flex-1 min-w-0 text-xs"
                    placeholder="https://github.com/owner/repo/pull/1"
                    [value]="prDraft()"
                    (input)="prDraft.set(inputValue($event))"
                    [disabled]="busy()"
                    data-testid="session-org-pr-input"
                  />
                  <button
                    type="submit"
                    class="btn btn-sm"
                    [disabled]="busy() || !prDraft().trim()"
                    data-testid="session-org-add-pr"
                  >
                    Add
                  </button>
                </form>
              </section>

              <!-- Worktree -->
              @if (org.worktreePath; as path) {
                <section
                  class="flex flex-col gap-1.5"
                  [attr.aria-labelledby]="worktreeId"
                  data-testid="session-org-worktree"
                >
                  <h4 [id]="worktreeId" class="text-xs font-semibold">
                    Worktree
                  </h4>
                  <code
                    class="block rounded bg-base-200 px-2 py-1 text-xs break-all select-all"
                    data-testid="session-org-worktree-path"
                    >{{ path }}</code
                  >
                  @if (org.branch) {
                    <p class="text-xs">
                      Branch:
                      <span class="font-mono">{{ org.branch }}</span>
                    </p>
                  }
                  <div class="flex flex-wrap items-center gap-1.5">
                    @if (targets().length > 0) {
                      <label class="sr-only" [attr.for]="targetId"
                        >Open with</label
                      >
                      <select
                        [id]="targetId"
                        class="select select-bordered select-sm"
                        (change)="onTarget($event)"
                        data-testid="session-org-editor-target"
                      >
                        @for (target of targets(); track target.id) {
                          <option
                            [value]="target.id"
                            [selected]="target.id === selectedTarget()"
                          >
                            {{ target.displayName }}
                          </option>
                        }
                      </select>
                      <button
                        type="button"
                        class="btn btn-sm gap-1"
                        [disabled]="opening()"
                        (click)="openWorktree(path)"
                        data-testid="session-org-open-worktree"
                      >
                        <lucide-angular
                          [img]="FolderOpenIcon"
                          class="w-4 h-4"
                          aria-hidden="true"
                        />
                        Open worktree
                      </button>
                    }
                    <button
                      type="button"
                      class="btn btn-sm btn-ghost gap-1"
                      (click)="copyPath(path)"
                      data-testid="session-org-copy-path"
                    >
                      <lucide-angular
                        [img]="CopyIcon"
                        class="w-4 h-4"
                        aria-hidden="true"
                      />
                      Copy path
                    </button>
                  </div>
                  @if (worktreeNotice(); as notice) {
                    <p
                      role="status"
                      class="text-xs"
                      [class.text-error]="notice.kind === 'error'"
                      data-testid="session-org-worktree-notice"
                    >
                      {{ notice.message }}
                    </p>
                  }
                </section>
              }
            </div>
          } @else {
            <p class="pt-3 text-xs text-base-content-muted">
              Organization is not available for this session.
            </p>
          }
        </div>
        <form method="dialog" class="modal-backdrop">
          <button type="button" tabindex="-1" (click)="close()">close</button>
        </form>
      </dialog>
    }
  `,
})
export class SessionOrganizationEditorComponent {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly injector = inject(Injector);

  /** The session being edited; `null` keeps the dialog closed. */
  readonly session = input<ChatSessionSummary | null>(null);

  /** The user dismissed the dialog. */
  readonly closed = output<void>();

  protected readonly XIcon = X;
  protected readonly ExternalLinkIcon = ExternalLink;
  protected readonly FolderOpenIcon = FolderOpen;
  protected readonly CopyIcon = Copy;

  protected readonly priorities = SESSION_PRIORITIES;
  protected readonly statuses = SESSION_WORKFLOW_STATUSES;
  protected readonly roles = SESSION_TASK_LINK_ROLES;
  protected readonly priorityLabels = SESSION_PRIORITY_LABELS;
  protected readonly statusLabels = SESSION_STATUS_LABELS;

  private readonly idSuffix = nextId++;
  protected readonly titleId = `session-org-title-${this.idSuffix}`;
  protected readonly priorityId = `session-org-priority-${this.idSuffix}`;
  protected readonly statusId = `session-org-status-${this.idSuffix}`;
  protected readonly tasksId = `session-org-tasks-${this.idSuffix}`;
  protected readonly taskInputId = `session-org-task-${this.idSuffix}`;
  protected readonly roleId = `session-org-role-${this.idSuffix}`;
  protected readonly prsId = `session-org-prs-${this.idSuffix}`;
  protected readonly prInputId = `session-org-pr-${this.idSuffix}`;
  protected readonly worktreeId = `session-org-worktree-${this.idSuffix}`;
  protected readonly targetId = `session-org-target-${this.idSuffix}`;

  /** The dialog's copy of the record; replaced by every successful mutation. */
  readonly organization = linkedSignal<SessionOrganizationSummary | null>(
    () => this.session()?.organization ?? null,
  );
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  protected readonly taskDraft = signal('');
  protected readonly taskRole = signal<SessionTaskLinkRole>('related');
  protected readonly prDraft = signal('');

  protected readonly targets = signal<readonly EditorTarget[]>([]);
  protected readonly selectedTarget = linkedSignal<EditorTargetId | null>(
    () => this.targets()[0]?.id ?? null,
  );
  protected readonly opening = signal(false);
  protected readonly worktreeNotice = signal<ActionNotice | null>(null);

  private readonly closeButton =
    viewChild<ElementRef<HTMLButtonElement>>('closeButton');
  private readonly sessionId = computed(() => this.session()?.id ?? null);
  private destroyed = false;
  private detectionRequested = false;
  /** Focus to restore when the dialog closes. */
  private returnFocus: HTMLElement | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
    });

    // Open/close bookkeeping per session: reset drafts and messages, move
    // focus into the dialog, and give it back on close.
    effect(() => {
      const id = this.sessionId();
      untracked(() => this.onSessionChange(id));
    });

    // Detect editors once, the first time a worktree is shown.
    effect(() => {
      if (!this.organization()?.worktreePath || this.detectionRequested) return;
      this.detectionRequested = true;
      untracked(() => void this.detectTargets());
    });
  }

  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected safeHref(url: string): string | null {
    return httpsUrlOrNull(url);
  }

  protected prLabel(pr: SessionPrLinkSummary): string {
    return pr.repo && pr.number !== null ? `${pr.repo}#${pr.number}` : pr.url;
  }

  protected close(): void {
    this.closed.emit();
  }

  protected onEscape(event: Event): void {
    event.preventDefault();
    this.close();
  }

  protected onPriority(event: Event): void {
    const priority = (event.target as HTMLSelectElement)
      .value as SessionPriority;
    void this.mutate('session:setOrganization', (sessionId) => ({
      sessionId,
      priority,
    }));
  }

  protected onStatus(event: Event): void {
    const status = (event.target as HTMLSelectElement)
      .value as SessionWorkflowStatus;
    void this.mutate('session:setOrganization', (sessionId) => ({
      sessionId,
      status,
    }));
  }

  protected onPinned(event: Event): void {
    const pinned = (event.target as HTMLInputElement).checked;
    void this.mutate('session:setOrganization', (sessionId) => ({
      sessionId,
      pinned,
    }));
  }

  protected onRole(event: Event): void {
    this.taskRole.set(
      (event.target as HTMLSelectElement).value as SessionTaskLinkRole,
    );
  }

  protected async linkTask(event: Event): Promise<void> {
    event.preventDefault();
    const taskId = this.taskDraft().trim();
    if (!taskId) return;
    const role = this.taskRole();
    const saved = await this.mutate('session:linkTask', (sessionId) => ({
      sessionId,
      taskId,
      role,
      source: 'user',
    }));
    if (saved) this.taskDraft.set('');
  }

  protected unlinkTask(taskId: string): void {
    void this.mutate('session:unlinkTask', (sessionId) => ({
      sessionId,
      taskId,
    }));
  }

  protected async addPr(event: Event): Promise<void> {
    event.preventDefault();
    const url = httpsUrlOrNull(this.prDraft());
    if (!url) {
      this.error.set(
        'Enter a full https:// link to the pull request (at most 2048 characters).',
      );
      return;
    }
    const saved = await this.mutate('session:addPrLink', (sessionId) => ({
      sessionId,
      url,
    }));
    if (saved) this.prDraft.set('');
  }

  protected removePr(url: string): void {
    void this.mutate('session:removePrLink', (sessionId) => ({
      sessionId,
      url,
    }));
  }

  protected onTarget(event: Event): void {
    this.selectedTarget.set(
      (event.target as HTMLSelectElement).value as EditorTargetId,
    );
  }

  protected async openWorktree(root: string): Promise<void> {
    const target = this.selectedTarget();
    if (!target || this.opening()) return;
    this.opening.set(true);
    this.worktreeNotice.set(null);
    try {
      const result = await this.rpc.call('editor:openWorkspace', {
        target,
        root,
      });
      if (this.destroyed) return;
      const opened = result.isSuccess() && result.data.success;
      this.worktreeNotice.set(
        opened
          ? { kind: 'success', message: 'Opened the worktree.' }
          : {
              kind: 'error',
              message: `${
                result.data?.error ?? result.error ?? 'The editor did not open.'
              } Use Copy path to open it yourself.`,
            },
      );
    } finally {
      if (!this.destroyed) this.opening.set(false);
    }
  }

  protected async copyPath(path: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(path);
      if (!this.destroyed) {
        this.worktreeNotice.set({ kind: 'success', message: 'Path copied.' });
      }
    } catch {
      // degradation-audit: reported - the clipboard refusal is shown inline;
      // the path stays visible and selectable above.
      if (!this.destroyed) {
        this.worktreeNotice.set({
          kind: 'error',
          message: 'Could not copy. Select the path above and copy it.',
        });
      }
    }
  }

  /**
   * Run one organization mutation and apply its result. A response for a
   * session the dialog no longer shows is dropped.
   */
  private async mutate<M extends OrganizationMutation>(
    method: M,
    params: (sessionId: string) => RpcMethodParams<M>,
  ): Promise<boolean> {
    const sessionId = this.sessionId();
    if (!sessionId || this.busy()) return false;
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await this.rpc.call(method, params(sessionId));
      if (this.destroyed || this.sessionId() !== sessionId) return false;
      if (!result.isSuccess()) {
        this.error.set(result.error ?? 'The change could not be saved.');
        return false;
      }
      const outcome = result.data as SessionOrganizationMutationResult;
      if (!outcome.ok) {
        this.error.set(outcome.message);
        return false;
      }
      this.organization.set(outcome.organization);
      return true;
    } finally {
      if (!this.destroyed) this.busy.set(false);
    }
  }

  private async detectTargets(): Promise<void> {
    const result = await this.rpc.call('editor:detectTargets', {});
    if (this.destroyed) return;
    if (result.isSuccess() && result.data.success) {
      this.targets.set(result.data.targets);
      return;
    }
    // No editor list: "Copy path" remains the way to the worktree.
    this.worktreeNotice.set({
      kind: 'error',
      message: 'No editor could be detected. Use Copy path instead.',
    });
  }

  private onSessionChange(id: string | null): void {
    this.error.set(null);
    this.worktreeNotice.set(null);
    this.taskDraft.set('');
    this.prDraft.set('');
    this.taskRole.set('related');
    if (id) {
      if (!this.returnFocus) {
        const active = document.activeElement;
        this.returnFocus = active instanceof HTMLElement ? active : null;
      }
      afterNextRender(() => this.closeButton()?.nativeElement.focus(), {
        injector: this.injector,
      });
      return;
    }
    if (this.returnFocus?.isConnected) this.returnFocus.focus();
    this.returnFocus = null;
  }
}
