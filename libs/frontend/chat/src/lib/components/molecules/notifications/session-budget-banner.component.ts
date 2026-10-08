import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import type {
  SessionBudgetHandoffReadStatus,
  SessionBudgetState,
  SessionHandoverState,
} from '@ptah-extension/shared';

/** Stages that show a banner. `unknown` and `normal` show none. */
type BannerStage =
  | 'handoff'
  | 'limit'
  | 'handover-progress'
  | 'handover-failed';

/** Why the handoff was built without the transcript, in the user's words. */
const READ_STATUS_TEXT: Readonly<
  Record<SessionBudgetHandoffReadStatus, string>
> = {
  'read-failed':
    'The transcript could not be read; the handoff may be incomplete.',
  'workspace-unknown':
    "This session's workspace is not known, so the transcript was not read; the handoff may be incomplete.",
};

/** M8: `/compact` lowers the context, never the cumulative budget measure. */
const COMPACT_NOTE =
  "/compact frees context but does not reset this session's budget";

/**
 * SessionBudgetBannerComponent - one session's budget stage (TASK_2026_597 N7)
 *
 * Dumb component: it renders the budget state it is given and emits the
 * user's choice. The parent calls `session:budgetAction` and starts the new
 * session. The handoff preview is plain text in a `<pre>` (text
 * interpolation, never HTML).
 *
 * The one notification starts at the configured handoff stage. Tighten and
 * rotation remain footer/stat-only states; limit updates this same message.
 * The backend normally arms handover automatically; the fallback may start it
 * if that state has not arrived yet. A dismissed handoff stays hidden until
 * the limit stage escalates it.
 */
@Component({
  selector: 'ptah-session-budget-banner',
  template: `
    @if (stage(); as current) {
      <div
        class="mx-2 my-1 rounded border bg-base-300/30 text-xs"
        [class.border-info]="current === 'handover-progress'"
        [class.border-warning]="current === 'handoff'"
        [class.border-error]="current === 'limit'"
        [attr.role]="current === 'limit' ? 'alert' : 'status'"
        [attr.aria-live]="current === 'limit' ? 'assertive' : 'polite'"
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
          @if (budget(); as currentBudget) {
            <div class="mt-1 flex flex-wrap items-center gap-x-1.5 text-base-content-muted" data-testid="session-budget-stats">
              @if (currentBudget.unit === 'cost') { <span>Cost</span> }
              <span data-testid="session-budget-used">{{ statValue(currentBudget, currentBudget.used, true) }}</span>
              <span>of</span>
              <span data-testid="session-budget-limit">{{ statValue(currentBudget, currentBudget.limit, false) }}</span>
              @if (currentBudget.percent !== null) {
                <span data-testid="session-budget-percent">{{ percent(currentBudget.percent) }}</span>
              }
              @if (currentBudget.compactions > 0) {
                <span data-testid="session-budget-compactions">{{ currentBudget.compactions }}</span>
              }
            </div>
            <progress
              class="progress mt-1 w-full"
              [class.progress-error]="current === 'handoff' || current === 'limit'"
              [value]="meterValue(currentBudget.percent)"
              max="100"
              [attr.aria-valuenow]="meterValue(currentBudget.percent)"
              [attr.aria-label]="meterLabel(currentBudget.percent)"
              data-testid="session-budget-meter"
            ></progress>
            @if (usage().length >= 2) {
              <svg class="mt-1 h-4 w-full" viewBox="0 0 100 20" role="img" [attr.aria-label]="'Budget use over this session, ' + usage().length + ' samples'" data-testid="session-budget-sparkline">
                <polyline fill="none" class="stroke-error" stroke-width="2" [attr.points]="sparklinePoints()"></polyline>
              </svg>
            }
          }
          @if (writeErrorLine(); as errorLine) {
            <p
              class="mt-0.5 text-warning"
              data-testid="session-budget-write-error"
            >
              {{ errorLine }}
            </p>
          }
          @if (readStatusLine(); as readLine) {
            <p
              class="mt-0.5 text-warning"
              data-testid="session-budget-read-status"
            >
              {{ readLine }}
            </p>
          }
        </div>

        <div class="flex flex-wrap items-center gap-1 px-2 pb-1.5">
          @if (current === 'handover-progress') {
            <span class="px-1 text-base-content-muted" data-testid="session-handover-progress">{{ handoverProgress() }}</span>
            <button type="button" class="btn btn-xs btn-ghost" [disabled]="busy()" (click)="cancelHandover.emit()">Cancel (keep working)</button>
          } @else if (current === 'handover-failed') {
            <button type="button" class="btn btn-xs btn-primary" [disabled]="busy()" (click)="continueInNewSession.emit()">Retry</button>
            @if (handover()?.lostInputTexts?.length) {
              <button type="button" class="btn btn-xs btn-ghost" [disabled]="busy()" (click)="putLostInputsBack()">Put back in composer</button>
            }
            <button type="button" class="btn btn-xs btn-ghost" [disabled]="busy()" (click)="cancelHandover.emit()">Keep working</button>
          } @else if (current === 'handoff') {
            <button
              type="button"
              class="btn btn-xs btn-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
              [disabled]="busy()"
              (click)="continueInNewSession.emit()"
            >
              Continue now
            </button>
          } @else {
            <button
              type="button"
              class="btn btn-xs btn-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
              [disabled]="busy()"
              [attr.aria-label]="current === 'limit' ? 'Continue in new session' : 'Start new session from handoff'"
              (click)="continueInNewSession.emit()"
            >
              {{
                'New session'
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
                Dismiss
              </button>
            }
          }
        </div>

        @if (
          previewOpen() &&
          previewFailed() &&
          current === 'limit'
        ) {
          <div
            class="mx-2 mb-1.5 flex flex-wrap items-center gap-1 text-warning"
            data-testid="session-budget-preview-error"
          >
            <span>Could not load the handoff.</span>
            <button
              type="button"
              class="btn btn-xs btn-ghost"
              [disabled]="busy()"
              (click)="previewRequested.emit()"
            >
              Try again
            </button>
          </div>
        } @else if (
          previewOpen() && current === 'limit'
        ) {
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
  /** The tab's budget state; only handoff and limit render a notification. */
  readonly budget = input<SessionBudgetState | null>(null);

  /** Coordinator lifecycle companion to the budget snapshot. */
  readonly handover = input<SessionHandoverState | null>(null);

  /** Handoff text from `preview-handoff`; `null` while it loads. */
  readonly preview = input<string | null>(null);

  /** True when the last `preview-handoff` failed; shows the error with Try again. */
  readonly previewFailed = input(false);

  /** Main-context tokens of the latest request, for the limit comparison. */
  readonly contextTokens = input<number | null>(null);

  /** Recent budget samples for the lightweight trend sparkline. */
  readonly usage = input<
    readonly { readonly at: number; readonly used: number; readonly percent: number | null }[]
  >([]);

  /** True while the backend compacts this session. */
  readonly compacting = input(false);

  /** True while a budget action runs; disables the buttons. */
  readonly busy = input(false);

  /** Hide the handoff notification until the limit stage escalates it. */
  readonly dismiss = output<void>();
  /** "Allow 20% more" (limit). */
  readonly extend = output<void>();
  /** Retained action channel for the host-side auto-compact policy. */
  readonly restoreWindow = output<void>();
  /** Ask the parent to compact the current session. */
  readonly compact = output<void>();
  /** The preview was opened; the parent loads the handoff text. */
  readonly previewRequested = output<void>();
  /** "Continue in new session" / "Start new session from handoff". */
  readonly continueInNewSession = output<void>();
  /** Cancel a failed handover and retain the source session. */
  readonly cancelHandover = output<void>();
  /** Restore source inputs which could not be returned after the source ended. */
  readonly restoreLostInputs = output<readonly string[]>();
  /** Retained action channel for the footer rotation advisory. */
  readonly rotate = output<void>();

  protected readonly previewOpen = signal(false);

  /** The stage to show, or `null` for none. */
  protected readonly stage = computed<BannerStage | null>(() => {
    const budget = this.budget();
    if (!budget || (budget.stage !== 'handoff' && budget.stage !== 'limit')) {
      return null;
    }
    const handover = this.handover();
    if (handover?.phase === 'failed') return 'handover-failed';
    if (
      handover &&
      ['writing-handoff', 'starting-successor', 'successor-confirmed', 'closing'].includes(handover.phase)
    ) {
      return 'handover-progress';
    }
    if (budget.stage === 'handoff' && budget.dismissedStage === 'handoff') {
      return null;
    }
    return budget.stage;
  });

  protected readonly title = computed(() => {
    if (this.stage() === 'handover-progress') return 'Continuing in a new session…';
    if (this.stage() === 'handover-failed') return 'Could not continue in a new session';
    switch (this.stage()) {
      case 'handoff':
        return 'Preparing to continue in a new session…';
      case 'limit':
        return 'This session reached its budget';
      default:
        return '';
    }
  });

  protected readonly body = computed(() => {
    const handover = this.handover();
    if (this.stage() === 'handover-progress') return this.handoverProgress();
    if (this.stage() === 'handover-failed') return handover?.error ?? 'The handover did not complete. Your queued message remains in this composer.';
    const budget = this.budget();
    const stage = this.stage();
    if (!budget || !stage) return '';
    if (stage === 'handoff') {
      return `Waiting for handover to start at ${this.amount(budget)}. You can continue now if needed.`;
    }
    return this.limitBody(budget);
  });

  protected readonly handoverProgress = computed(() => {
    switch (this.handover()?.phase) {
      case 'writing-handoff': return 'Writing the handoff…';
      case 'starting-successor': return 'Starting the new session…';
      case 'successor-confirmed': return 'Switching to the successor session…';
      case 'closing': return 'Finishing the handover…';
      default: return 'Preparing the handover…';
    }
  });

  /** Shown on handoff and limit when the file could not be written. */
  protected readonly writeErrorLine = computed(() => {
    const error = this.budget()?.handoff?.writeError;
    const stage = this.stage();
    if (!error || (stage !== 'handoff' && stage !== 'limit')) return null;
    return `Ptah could not save the handoff file (${error}). You can still start a new session; the handoff text is kept until this session closes.`;
  });

  /** Shown on handoff and limit when the handoff was built without the transcript. */
  protected readonly readStatusLine = computed(() => {
    const readStatus = this.budget()?.handoff?.readStatus;
    const stage = this.stage();
    if (!readStatus || (stage !== 'handoff' && stage !== 'limit')) return null;
    return READ_STATUS_TEXT[readStatus];
  });

  protected togglePreview(): void {
    const open = !this.previewOpen();
    this.previewOpen.set(open);
    if (open) this.previewRequested.emit();
  }

  protected putLostInputsBack(): void {
    const texts = this.handover()?.lostInputTexts;
    if (texts?.length) this.restoreLostInputs.emit(texts);
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

  private limitBody(budget: SessionBudgetState): string {
    const pause = budget.blocked
      ? `Limit reached — new turns are held until you continue (one queued message may still run). /clear still works. ${COMPACT_NOTE}; at the limit only a bare /compact is allowed.`
      : 'New messages are not paused (blocking is off in settings).';
    const handoff = budget.handoff;
    if (!handoff) return pause;
    const context = this.contextTokens();
    const instead =
      context !== null && context > 0
        ? ` instead of ${this.tokens(context)}`
        : '';
    const handoffLine = `Continue in a new session that starts with only the handoff (about ${this.tokens(Math.ceil(handoff.chars / 4))} tokens${instead}).`;
    return budget.blocked
      ? `${pause} ${handoffLine}`
      : `${handoffLine} ${pause}`;
  }

  protected statValue(
    budget: SessionBudgetState,
    value: number | null,
    isUsed: boolean,
  ): string {
    const formatted = budget.unit === 'cost' ? this.usd(value) : this.tokens(value);
    return isUsed && budget.lowerBound ? `≥ ${formatted}` : formatted;
  }

  protected percent(value: number): string {
    return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
  }

  protected meterValue(value: number | null): number {
    return Math.max(0, Math.min(100, value ?? 0));
  }

  protected meterLabel(value: number | null): string {
    return value !== null && value > 100
      ? `Budget use: ${this.percent(value)}, over the limit`
      : `Budget use: ${this.percent(value ?? 0)}`;
  }

  protected sparklinePoints(): string {
    const samples = this.usage();
    const width = Math.max(samples.length - 1, 1);
    return samples
      .map((sample, index) => {
        const x = (index / width) * 100;
        const y = 20 - (this.meterValue(sample.percent) / 100) * 20;
        return `${x},${y}`;
      })
      .join(' ');
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
