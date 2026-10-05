import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import type {
  SessionBudgetState,
  SessionBudgetWindowReason,
} from '@ptah-extension/shared';
import { SessionRotationKeepService } from '../../../services/session-rotation-keep.service';

/** Stages that show a banner. `unknown` and `normal` show none. */
type BannerStage = 'rotation' | 'tighten' | 'handoff' | 'limit';

/** Why the tighten step did not lower auto-compact, in the user's words. */
const WINDOW_REASON_TEXT: Readonly<
  Record<Exclude<SessionBudgetWindowReason, 'disabled'>, string>
> = {
  'env-override': 'CLAUDE_CODE_AUTO_COMPACT_WINDOW is set',
  'already-lower': 'it is already at or below <target>',
  'not-honoured': 'this model ignored the lower auto-compact setting',
  failed: 'the change was rejected',
};

/**
 * SessionBudgetBannerComponent - one session's budget stage (TASK_2026_597 N7)
 *
 * Dumb component: it renders the budget state it is given and emits the
 * user's choice. The parent calls `session:budgetAction` and starts the new
 * session. The handoff preview is plain text in a `<pre>` (text
 * interpolation, never HTML).
 *
 * Stages: tighten and handoff are `role="status"`, limit is `role="alert"`.
 * A dismissed tighten or handoff stage stays hidden until a higher stage.
 */
@Component({
  selector: 'ptah-session-budget-banner',
  template: `
    @if (stage(); as current) {
      <div
        class="mx-2 my-1 rounded border bg-base-300/30 text-xs"
        [class.border-info]="current === 'tighten' || current === 'rotation'"
        [class.border-warning]="current === 'handoff'"
        [class.border-error]="current === 'limit'"
        [attr.role]="current === 'limit' ? 'alert' : 'status'"
        data-testid="session-budget-banner"
      >
        <div class="px-2 py-1.5">
          <div class="font-semibold" data-testid="session-budget-title">
            {{ title() }}
          </div>
          <p
            class="mt-0.5 text-base-content-muted"
            data-testid="session-budget-body"
          >
            {{ body() }}
          </p>
          @if (writeErrorLine(); as errorLine) {
            <p
              class="mt-0.5 text-warning"
              data-testid="session-budget-write-error"
            >
              {{ errorLine }}
            </p>
          }
        </div>

        <div class="flex flex-wrap items-center gap-1 px-2 pb-1.5">
          @if (current === 'rotation') {
            <button
              type="button"
              class="btn btn-xs btn-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
              aria-label="Rotate session: start a new session from a handoff"
              [disabled]="busy()"
              (click)="rotate.emit()"
            >
              Rotate session
            </button>
            <button
              type="button"
              class="btn btn-xs btn-ghost"
              aria-label="Keep this session and hide this suggestion"
              (click)="keepSession()"
            >
              Keep this session
            </button>
          } @else if (current === 'tighten') {
            <button
              type="button"
              class="btn btn-xs btn-ghost"
              [disabled]="busy()"
              (click)="dismiss.emit()"
            >
              OK
            </button>
            @if (windowApplied()) {
              <button
                type="button"
                class="btn btn-xs btn-outline"
                [disabled]="busy()"
                (click)="restoreWindow.emit()"
              >
                Restore auto-compact
              </button>
            }
          } @else {
            <button
              type="button"
              class="btn btn-xs btn-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
              [disabled]="busy()"
              (click)="continueInNewSession.emit()"
            >
              {{
                current === 'limit'
                  ? 'Continue in new session'
                  : 'Start new session from handoff'
              }}
            </button>
            <button
              type="button"
              class="btn btn-xs btn-outline"
              [disabled]="busy()"
              [attr.aria-expanded]="previewOpen()"
              (click)="togglePreview()"
            >
              {{ previewOpen() ? 'Hide handoff' : 'Preview handoff' }}
            </button>
            @if (current === 'limit') {
              <button
                type="button"
                class="btn btn-xs btn-ghost"
                [disabled]="busy()"
                (click)="extend.emit()"
              >
                Allow 20% more
              </button>
            } @else {
              <button
                type="button"
                class="btn btn-xs btn-ghost"
                [disabled]="busy()"
                (click)="dismiss.emit()"
              >
                Keep working
              </button>
            }
          }
        </div>

        @if (previewOpen() && (current === 'handoff' || current === 'limit')) {
          <pre
            class="mx-2 mb-1.5 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-base-200 p-2 font-mono text-[11px]"
            tabindex="0"
            aria-label="Handoff preview"
            data-testid="session-budget-preview"
            >{{ preview() ?? 'Loading the handoff…' }}</pre>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionBudgetBannerComponent {
  /** The tab's budget state; `null` or a stage below tighten renders nothing. */
  readonly budget = input<SessionBudgetState | null>(null);

  /** Handoff text from `preview-handoff`; `null` while it loads. */
  readonly preview = input<string | null>(null);

  /** Main-context tokens of the latest request, for the limit comparison. */
  readonly contextTokens = input<number | null>(null);

  /** True while a budget action runs; disables the buttons. */
  readonly busy = input(false);

  /** "OK" (tighten) and "Keep working" (handoff). */
  readonly dismiss = output<void>();
  /** "Allow 20% more" (limit). */
  readonly extend = output<void>();
  /** "Restore auto-compact" (tighten, only when the window was applied). */
  readonly restoreWindow = output<void>();
  /** The preview was opened; the parent loads the handoff text. */
  readonly previewRequested = output<void>();
  /** "Continue in new session" / "Start new session from handoff". */
  readonly continueInNewSession = output<void>();
  /** "Rotate session" (rotation advisory). */
  readonly rotate = output<void>();

  protected readonly previewOpen = signal(false);

  /** Kept rotation keys live in a root store; this banner is rebuilt on tab switches. */
  private readonly rotationKeep = inject(SessionRotationKeepService);

  constructor() {
    // Forget a session's kept keys once its rotation advisory is gone, so a
    // later crossing shows the banner again.
    effect(() => {
      const budget = this.budget();
      if (!budget || budget.rotation) return;
      untracked(() => this.rotationKeep.forgetSession(budget.sessionId));
    });
  }

  /** The stage to show, or `null` for none. */
  protected readonly stage = computed<BannerStage | null>(() => {
    const budget = this.budget();
    if (!budget) return null;
    const { stage } = budget;
    if (
      budget.rotation &&
      stage !== 'handoff' &&
      stage !== 'limit' &&
      !this.rotationKeep.isKept(budget.sessionId, budget.rotation.threshold)
    ) {
      return 'rotation';
    }
    if (stage !== 'tighten' && stage !== 'handoff' && stage !== 'limit') {
      return null;
    }
    if (stage !== 'limit' && budget.dismissedStage === stage) return null;
    return stage;
  });

  protected readonly windowApplied = computed(
    () => this.budget()?.window?.applied === true,
  );

  protected readonly title = computed(() => {
    switch (this.stage()) {
      case 'rotation':
        return 'This session is getting large';
      case 'tighten':
        return "Half of this session's budget is used";
      case 'handoff':
        return 'Time to hand off this session';
      case 'limit':
        return 'This session reached its budget';
      default:
        return '';
    }
  });

  protected readonly body = computed(() => {
    const budget = this.budget();
    const stage = this.stage();
    if (!budget || !stage) return '';
    if (stage === 'rotation' && budget.rotation) {
      return `The context is about ${this.tokens(budget.rotation.contextTokens)} tokens. A new session that starts from a handoff keeps the goal and decisions and answers faster. Rotate to start a new session from the handoff, or keep this one.`;
    }
    const amount = this.amount(budget);
    if (stage === 'tighten') return this.tightenBody(budget, amount);
    if (stage === 'handoff') return this.handoffBody(budget, amount);
    return this.limitBody(budget, amount);
  });

  /** Shown on handoff and limit when the file could not be written. */
  protected readonly writeErrorLine = computed(() => {
    const error = this.budget()?.handoff?.writeError;
    const stage = this.stage();
    if (!error || (stage !== 'handoff' && stage !== 'limit')) return null;
    return `Ptah could not save the handoff file (${error}). You can still start a new session; the handoff text is kept until this session closes.`;
  });

  protected keepSession(): void {
    const budget = this.budget();
    if (!budget?.rotation) return;
    this.rotationKeep.keep(budget.sessionId, budget.rotation.threshold);
  }

  protected togglePreview(): void {
    const open = !this.previewOpen();
    this.previewOpen.set(open);
    if (open) this.previewRequested.emit();
  }

  /** "<used> of <limit> <unit>", formatted like the stats chip. */
  private amount(budget: SessionBudgetState): string {
    switch (budget.measure) {
      case 'tokens':
        return `${this.tokens(budget.used)} of ${this.tokens(budget.limit)} tokens`;
      case 'weighted-fallback':
        return `${this.tokens(budget.used)} of ${this.tokens(budget.limit)} weighted tokens (estimate)`;
      case 'cost-lower-bound':
        return `≥ ${this.usd(budget.used)} of ${this.usd(budget.limit)} of cost`;
      case 'cost':
        return `${this.usd(budget.used)} of ${this.usd(budget.limit)} of cost`;
    }
  }

  private tightenBody(budget: SessionBudgetState, amount: string): string {
    const window = budget.window;
    if (!window || window.reason === 'disabled') {
      return `${amount}. Run /compact or start a fresh session for unrelated work to slow the spend.`;
    }
    const target = this.tokens(window.target);
    if (window.applied) {
      return `${amount}. Ptah lowered auto-compact to ${target} tokens for this session. If the context is already above that, the next request compacts first. More compactions bring the handoff step sooner.`;
    }
    const reason = WINDOW_REASON_TEXT[window.reason ?? 'failed'].replace(
      '<target>',
      target,
    );
    return `${amount}. Ptah could not lower auto-compact here (${reason}). Use /compact or start a fresh session to slow the spend.`;
  }

  private handoffBody(budget: SessionBudgetState, amount: string): string {
    const parts: string[] = [];
    if (budget.percent !== null) {
      parts.push(`${amount} (${Math.floor(budget.percent)}%).`);
    }
    if (budget.compactions > 0) {
      parts.push(
        `This session has compacted ${budget.compactions} ${budget.compactions === 1 ? 'time' : 'times'}, and each compaction loses detail.`,
      );
    }
    if (parts.length === 0) parts.push(`${amount}.`);
    if (budget.handoff && !budget.handoff.writeError) {
      parts.push(
        'Ptah saved a handoff with the goal, decisions, changed files, open items and next step.',
      );
    }
    parts.push('At 100% new messages in this session pause.');
    return parts.join(' ');
  }

  private limitBody(budget: SessionBudgetState, amount: string): string {
    const pause = budget.blocked
      ? 'New messages here are paused after the current turn (one queued message may still run). /compact and /clear still work.'
      : 'New messages are not paused (blocking is off in settings).';
    const handoff = budget.handoff;
    if (!handoff) return `${amount}. ${pause}`;
    const context = this.contextTokens();
    const instead =
      context !== null && context > 0
        ? ` instead of ${this.tokens(context)}`
        : '';
    const handoffLine = `Continue in a new session that starts with only the handoff (about ${this.tokens(Math.ceil(handoff.chars / 4))} tokens${instead}).`;
    return budget.blocked
      ? `${amount}. ${pause} ${handoffLine}`
      : `${amount}. ${handoffLine} ${pause}`;
  }

  /** Same scale as the stats chip: `14.1M`, `950.0k`, `812`. */
  private tokens(count: number | null): string {
    if (count === null) return '—';
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
    return String(count);
  }

  /** Same scale as the stats chip: `$8.96`, `$0.0042`. */
  private usd(amount: number | null): string {
    if (amount === null) return '—';
    if (Number.isInteger(amount)) return `$${amount}`;
    return amount < 0.01 ? `$${amount.toFixed(4)}` : `$${amount.toFixed(2)}`;
  }
}
