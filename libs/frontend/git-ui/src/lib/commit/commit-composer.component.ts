import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  Check,
  CircleAlert,
  LucideAngularModule,
  Sparkles,
  TriangleAlert,
} from 'lucide-angular';
import type { RpcCallResult } from '@ptah-extension/core';
import { GIT_LOCKED_MESSAGE } from '@ptah-extension/shared';
import type {
  GitCommitMessageUnavailableReason,
  GitCommitResult,
} from '@ptah-extension/shared';
import { GitOperationOutputService } from '../services/git-operation-output.service';
import { GitStatusService } from '../services/git-status.service';
import { SourceControlService } from '../services/source-control.service';

/**
 * Most characters of hook output kept on screen. The backend keeps a 256 KiB
 * tail for the result; the live view keeps less so a chatty hook cannot grow
 * the DOM without bound.
 */
export const COMMIT_LOG_RENDER_CAP = 64 * 1024;

const LOG_TRIMMED_LINE = '[earlier output not shown]\n';

const GENERATION_UNAVAILABLE =
  'Message generation unavailable — type your own.';

/** Why generation gave no message, completing {@link GENERATION_UNAVAILABLE}. */
const GENERATION_REASON_TEXT: Partial<
  Record<GitCommitMessageUnavailableReason, string>
> = {
  'no-staged-changes': 'Nothing is staged.',
  'no-provider': 'No AI provider is configured.',
  'rate-limited': 'The AI provider is rate-limited right now.',
  unreachable: 'The AI provider could not be reached.',
  empty: 'The AI provider returned no usable message.',
  timeout: 'The AI provider did not answer in time.',
};

/** The commit in flight; at most one at a time (git holds the index lock). */
interface RunningCommit {
  readonly operationId: string;
  readonly workspaceRoot: string;
  readonly cancelling: boolean;
}

/** Hook output of the latest commit, pinned to the workspace it ran in. */
interface CommitLog {
  readonly workspaceRoot: string;
  readonly text: string;
  /** Older output was dropped to stay under {@link COMMIT_LOG_RENDER_CAP}. */
  readonly trimmed: boolean;
}

/** The latest commit outcome, pinned to the workspace it ran in. */
type CommitOutcome =
  | {
      readonly kind: 'success';
      readonly workspaceRoot: string;
      readonly hash?: string;
      readonly subject?: string;
    }
  | { readonly kind: 'cancelled'; readonly workspaceRoot: string }
  | {
      readonly kind: 'failure';
      readonly workspaceRoot: string;
      readonly text: string;
      /** Hook output from the result, used when nothing was streamed. */
      readonly hookOutput?: string;
    };

/** A generation notice, pinned to the workspace it was asked for. */
interface GenerateNotice {
  readonly workspaceRoot: string;
  readonly text: string;
}

type GenerationAnswer =
  { readonly message: string } | { readonly reason: string };

/** Text for a call that never produced a git result (IPC failure, timeout, throw). */
function transportFailureText(detail: string | undefined): string {
  return `Could not reach git: ${detail || 'the request failed'}`;
}

function thrownDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read a `git:commit` reply. A transport failure is a failure — never read as
 * success (TASK_2026_576 RC1); a held lock reads as `GIT_LOCKED_MESSAGE`.
 */
function commitOutcomeFor(
  response: RpcCallResult<GitCommitResult>,
  workspaceRoot: string,
): CommitOutcome {
  if (!response.success) {
    return {
      kind: 'failure',
      workspaceRoot,
      text: `Commit failed: ${transportFailureText(response.error)}`,
    };
  }
  const data = response.data;
  if (!data) {
    return {
      kind: 'failure',
      workspaceRoot,
      text: 'Commit failed: git returned no result.',
    };
  }
  if (data.success) {
    return {
      kind: 'success',
      workspaceRoot,
      hash: data.commitHash,
      subject: data.subject,
    };
  }
  if (data.code === 'CANCELLED') return { kind: 'cancelled', workspaceRoot };
  const hookOutput = data.hookOutput?.trim() ? data.hookOutput : undefined;
  return {
    kind: 'failure',
    workspaceRoot,
    text: commitFailureText(data),
    ...(hookOutput ? { hookOutput } : {}),
  };
}

function commitFailureText(data: GitCommitResult): string {
  if (data.code === 'HOOK_FAILED') return 'Commit blocked by a hook.';
  if (data.code === 'LOCKED') return `Commit failed: ${GIT_LOCKED_MESSAGE}`;
  return `Commit failed: ${data.error || 'git reported an error.'}`;
}

/** Append a chunk, keeping only the newest {@link COMMIT_LOG_RENDER_CAP} characters. */
function appendCapped(log: CommitLog, chunk: string): CommitLog {
  const text = log.text + chunk;
  if (text.length <= COMMIT_LOG_RENDER_CAP) return { ...log, text };
  let tail = text.slice(text.length - COMMIT_LOG_RENDER_CAP);
  // Start on a whole line when one begins inside the kept tail.
  const lineStart = tail.indexOf('\n');
  if (lineStart >= 0 && lineStart < tail.length - 1) {
    tail = tail.slice(lineStart + 1);
  }
  return { ...log, text: tail, trimmed: true };
}

function newOperationId(): string {
  return globalThis.crypto.randomUUID();
}

let instanceCount = 0;

/**
 * CommitComposerComponent — the body of the review shell's Commit tab
 * (implementation-plan §30, design-spec §9, Requirement 9).
 *
 * - **Message.** One draft per workspace, always editable except while its
 *   commit runs. Only a confirmed commit clears it; every failure keeps it.
 * - **Generate message.** Calls the provider only on click. A generated
 *   message fills the field unless the user typed while it was written; an
 *   unavailable result shows why and leaves the field as it was.
 * - **Commit.** Disabled without staged files or a message. Each commit sends
 *   a fresh `operationId`; its hook output streams in through
 *   {@link GitOperationOutputService} (`role="log"`), capped on screen. Cancel
 *   asks `git:cancelOperation` to stop it. A blocked commit keeps the log
 *   open; a successful one shows the hash and subject.
 */
@Component({
  selector: 'ptah-commit-composer',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section
      class="flex flex-col gap-2 p-3 text-base-content"
      aria-label="Commit"
      data-testid="commit-composer"
    >
      <div class="flex items-center justify-between gap-2 text-xs">
        <span
          class="text-base-content-muted"
          data-testid="commit-staged-count"
          >{{ stagedLabel() }}</span
        >
        <button
          type="button"
          class="btn btn-outline btn-xs gap-1"
          data-testid="commit-generate"
          [disabled]="!canGenerate()"
          (click)="onGenerate()"
        >
          @if (generating()) {
            <span
              class="loading loading-spinner loading-xs"
              aria-hidden="true"
            ></span>
            Generating…
          } @else {
            <lucide-angular
              [img]="SparklesIcon"
              class="h-3 w-3"
              aria-hidden="true"
            />
            Generate message
          }
        </button>
      </div>

      <label class="sr-only" [for]="messageId">Commit message</label>
      <textarea
        class="textarea textarea-bordered w-full font-mono text-sm"
        rows="4"
        data-testid="commit-message"
        [id]="messageId"
        [placeholder]="placeholder()"
        [value]="message()"
        [disabled]="isRunning()"
        [attr.aria-describedby]="generateNotice() ? noticeId : null"
        (input)="onMessageInput($event)"
      ></textarea>

      @if (generateNotice(); as notice) {
        <p
          role="status"
          class="m-0 flex items-start gap-1 text-xs text-base-content"
          data-testid="commit-generate-notice"
          [id]="noticeId"
        >
          <lucide-angular
            [img]="WarningIcon"
            class="mt-0.5 h-3 w-3 flex-shrink-0 text-warning"
            aria-hidden="true"
          />
          <span>{{ notice }}</span>
        </p>
      }

      <div class="flex justify-end gap-2">
        @if (isRunning()) {
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            data-testid="commit-cancel"
            [disabled]="cancelling()"
            (click)="onCancel()"
          >
            {{ cancelling() ? 'Cancelling…' : 'Cancel' }}
          </button>
        }
        <button
          type="button"
          class="btn btn-primary btn-sm"
          data-testid="commit-submit"
          [disabled]="!canCommit()"
          (click)="onCommit()"
        >
          @if (isRunning()) {
            <span
              class="loading loading-spinner loading-xs"
              aria-hidden="true"
            ></span>
            Committing…
          } @else {
            Commit
          }
        </button>
      </div>

      @if (outcome(); as result) {
        @switch (result.kind) {
          @case ('success') {
            <div
              role="status"
              class="flex min-w-0 items-center gap-2 text-xs"
              data-testid="commit-success"
            >
              <span class="badge badge-success badge-sm gap-1">
                <lucide-angular
                  [img]="CheckIcon"
                  class="h-3 w-3"
                  aria-hidden="true"
                />
                committed
              </span>
              <span class="min-w-0 truncate">
                @if (successHash(); as hash) {
                  <span class="font-mono">{{ hash }}</span>
                }
                {{ successSubject() }}</span
              >
            </div>
          }
          @case ('cancelled') {
            <p
              role="status"
              class="m-0 text-xs text-base-content"
              data-testid="commit-cancelled"
            >
              Commit cancelled. Your message was kept.
            </p>
          }
          @default {
            <!-- text-base-content on the error tint: text-error on base fails
                 AA in both themes (design-spec §0). -->
            <div
              role="alert"
              class="flex items-start gap-1 rounded border border-error/60 bg-error/10 px-1.5 py-1 text-xs text-base-content"
              data-testid="commit-failure"
            >
              <lucide-angular
                [img]="ErrorIcon"
                class="mt-0.5 h-3 w-3 flex-shrink-0 text-error"
                aria-hidden="true"
              />
              <span class="min-w-0 flex-1 break-words"
                >{{ failureText() }} Your message was kept.</span
              >
            </div>
          }
        }
      }

      @if (showLog()) {
        <!-- tabindex="0" makes the capped log keyboard-scrollable. -->
        <pre
          #logView
          role="log"
          aria-live="polite"
          aria-label="Commit hook output"
          tabindex="0"
          data-testid="commit-hook-output"
          class="m-0 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded bg-base-300/50 p-2 font-mono text-[11px] text-base-content"
          >{{ renderedLog() }}</pre>
      }
    </section>
  `,
})
export class CommitComposerComponent {
  private readonly gitStatus = inject(GitStatusService);
  private readonly sourceControl = inject(SourceControlService);
  private readonly operationOutput = inject(GitOperationOutputService);

  protected readonly SparklesIcon = Sparkles;
  protected readonly WarningIcon = TriangleAlert;
  protected readonly CheckIcon = Check;
  protected readonly ErrorIcon = CircleAlert;

  private readonly instanceId = instanceCount++;
  protected readonly messageId = `commit-message-${this.instanceId}`;
  protected readonly noticeId = `commit-generate-notice-${this.instanceId}`;

  private readonly logView = viewChild<ElementRef<HTMLElement>>('logView');

  private readonly drafts = signal<ReadonlyMap<string, string>>(new Map());
  private readonly running = signal<RunningCommit | null>(null);
  private readonly log = signal<CommitLog | null>(null);
  private readonly lastOutcome = signal<CommitOutcome | null>(null);
  private readonly notice = signal<GenerateNotice | null>(null);
  protected readonly generating = signal(false);
  private releaseOutput: (() => void) | null = null;

  /** The workspace whose staged files are shown; `''` before one is known. */
  private readonly workspaceRoot = computed(
    () => this.gitStatus.activeWorkspacePath() ?? '',
  );

  protected readonly message = computed(
    () => this.drafts().get(this.workspaceRoot()) ?? '',
  );

  private readonly stagedCount = computed(() => this.gitStatus.stagedCount());

  protected readonly stagedLabel = computed(() => {
    const count = this.stagedCount();
    return `Staged: ${count} ${count === 1 ? 'file' : 'files'}`;
  });

  protected readonly placeholder = computed(() =>
    this.stagedCount() > 0
      ? 'Commit message'
      : 'Nothing staged yet — stage changes in the Changes tab.',
  );

  protected readonly isRunning = computed(() => this.running() !== null);
  protected readonly cancelling = computed(
    () => this.running()?.cancelling === true,
  );

  protected readonly canCommit = computed(
    () =>
      this.stagedCount() > 0 &&
      this.message().trim().length > 0 &&
      !this.isRunning() &&
      !this.generating(),
  );

  protected readonly canGenerate = computed(
    () => this.stagedCount() > 0 && !this.isRunning() && !this.generating(),
  );

  protected readonly generateNotice = computed(() => {
    const notice = this.notice();
    return notice?.workspaceRoot === this.workspaceRoot() ? notice.text : null;
  });

  /** The displayed workspace's last commit outcome; hidden while one runs. */
  protected readonly outcome = computed(() => {
    const outcome = this.lastOutcome();
    if (this.isRunning() || outcome?.workspaceRoot !== this.workspaceRoot()) {
      return null;
    }
    return outcome;
  });

  protected readonly successHash = computed(() => {
    const outcome = this.outcome();
    return outcome?.kind === 'success' ? (outcome.hash ?? null) : null;
  });

  protected readonly successSubject = computed(() => {
    const outcome = this.outcome();
    return outcome?.kind === 'success' ? (outcome.subject ?? '') : '';
  });

  protected readonly failureText = computed(() => {
    const outcome = this.outcome();
    return outcome?.kind === 'failure' ? outcome.text : '';
  });

  /**
   * The text in the log: the streamed output, or — when nothing streamed (a
   * host without streaming) — the hook output the failed result carried.
   */
  protected readonly renderedLog = computed(() => {
    const log = this.log();
    const streamed = log?.workspaceRoot === this.workspaceRoot() ? log : null;
    if (streamed?.text) {
      return streamed.trimmed
        ? LOG_TRIMMED_LINE + streamed.text
        : streamed.text;
    }
    const outcome = this.outcome();
    return outcome?.kind === 'failure' ? (outcome.hookOutput ?? '') : '';
  });

  /** Open while a commit runs, and after one that did not succeed if it printed anything. */
  protected readonly showLog = computed(() => {
    if (this.isRunning()) return true;
    const kind = this.outcome()?.kind;
    return (
      (kind === 'failure' || kind === 'cancelled') &&
      this.renderedLog().length > 0
    );
  });

  constructor() {
    // Follow the newest output while the log is open.
    afterRenderEffect(() => {
      this.renderedLog();
      const view = this.logView()?.nativeElement;
      if (view) view.scrollTop = view.scrollHeight;
    });
    inject(DestroyRef).onDestroy(() => {
      this.releaseOutput?.();
      this.releaseOutput = null;
    });
  }

  protected onMessageInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    this.setDraft(this.workspaceRoot(), target.value);
  }

  protected async onGenerate(): Promise<void> {
    if (!this.canGenerate()) return;
    const workspaceRoot = this.workspaceRoot();
    const before = this.draftFor(workspaceRoot);
    this.generating.set(true);
    this.notice.set(null);

    const answer = await this.requestMessage();
    this.generating.set(false);

    if ('reason' in answer) {
      this.notice.set({
        workspaceRoot,
        text: `${GENERATION_UNAVAILABLE} ${answer.reason}`,
      });
      return;
    }
    // Never overwrite text typed while the message was being written.
    if (this.draftFor(workspaceRoot) !== before) {
      this.notice.set({
        workspaceRoot,
        text: 'A message was generated, but the field changed meanwhile — your text was kept.',
      });
      return;
    }
    this.setDraft(workspaceRoot, answer.message);
  }

  protected async onCommit(): Promise<void> {
    // The disabled button is the first guard; this one also covers a second
    // activation that lands before the next render.
    if (!this.canCommit()) return;
    const workspaceRoot = this.workspaceRoot();
    const message = this.message().trim();
    const operationId = newOperationId();

    this.running.set({ operationId, workspaceRoot, cancelling: false });
    this.lastOutcome.set(null);
    this.log.set({ workspaceRoot, text: '', trimmed: false });
    this.releaseOutput = this.operationOutput.listen(operationId, (output) =>
      this.log.update((log) => (log ? appendCapped(log, output.chunk) : log)),
    );

    let outcome: CommitOutcome;
    try {
      outcome = commitOutcomeFor(
        await this.sourceControl.commit(message, operationId),
        workspaceRoot,
      );
    } catch (error: unknown) {
      outcome = {
        kind: 'failure',
        workspaceRoot,
        text: `Commit failed: ${transportFailureText(thrownDetail(error))}`,
      };
    }
    // Every chunk is pushed before the commit reply, so nothing is lost here.
    this.releaseOutput?.();
    this.releaseOutput = null;

    // Only a confirmed commit clears the draft — the one of the workspace the
    // commit ran in, even if another is displayed now.
    if (outcome.kind === 'success') this.setDraft(workspaceRoot, '');
    this.lastOutcome.set(outcome);
    this.running.set(null);
    this.refreshStatus();
  }

  protected async onCancel(): Promise<void> {
    const run = this.running();
    if (!run || run.cancelling) return;
    this.running.set({ ...run, cancelling: true });
    let asked = false;
    try {
      asked = (await this.sourceControl.cancelOperation(run.operationId))
        .success;
    } catch (error: unknown) {
      console.error('[CommitComposer] git:cancelOperation threw', error);
    }
    // The request never reached git: let the user try again. When it did, the
    // commit's own result reports CANCELLED (or that it finished first).
    const current = this.running();
    if (!asked && current?.operationId === run.operationId) {
      this.running.set({ ...current, cancelling: false });
    }
  }

  private async requestMessage(): Promise<GenerationAnswer> {
    try {
      const response = await this.sourceControl.generateCommitMessage();
      if (!response.success) return { reason: 'The request failed.' };
      const result = response.data;
      if (result?.status === 'generated' && result.message.trim()) {
        return { message: result.message };
      }
      if (result?.status === 'unavailable') {
        return {
          reason:
            GENERATION_REASON_TEXT[result.reason] ??
            'The AI provider could not write one.',
        };
      }
      return { reason: 'The AI provider returned no usable message.' };
    } catch (error: unknown) {
      console.error('[CommitComposer] git:generateCommitMessage threw', error);
      return { reason: 'The request failed.' };
    }
  }

  private draftFor(workspaceRoot: string): string {
    return this.drafts().get(workspaceRoot) ?? '';
  }

  private setDraft(workspaceRoot: string, message: string): void {
    const next = new Map(this.drafts());
    if (message) next.set(workspaceRoot, message);
    else next.delete(workspaceRoot);
    this.drafts.set(next);
  }

  /**
   * Re-read the status after a commit. `GitStatusService.refresh()` reports
   * its own read failures as a stale / unavailable notice; the catch only
   * keeps a future rejection from going unhandled.
   */
  private refreshStatus(): void {
    this.gitStatus.refresh().catch(() => {
      // degradation-audit: reported - GitStatusService surfaces a failed
      // re-read as a stale / unavailable status notice.
    });
  }
}
