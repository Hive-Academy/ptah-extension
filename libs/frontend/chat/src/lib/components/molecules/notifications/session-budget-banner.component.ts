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
import {
  ArrowRightLeft,
  LucideAngularModule,
  OctagonAlert,
  RefreshCw,
  type LucideIconData,
} from 'lucide-angular';
import type { SessionBudgetUsageSample } from '../../../services/session-budget-actions.service';
import {
  budgetAmount,
  formatPercent,
  formatTokens,
  formatUsd,
  isCostMeasure,
  waitingLine,
} from './session-budget-format';

/** Stages that show a banner. `unknown` and `normal` show none. */
type BannerStage =
  | 'handoff'
  | 'limit'
  | 'agent-request'
  | 'handover-waiting'
  | 'handover-progress'
  | 'handover-failed';

/** Meter and border tone. */
type BannerTone = 'warning' | 'error' | 'info';

interface BodyPart {
  readonly code: boolean;
  readonly text: string;
}

/** One figure of the stats row. */
interface BudgetStat {
  readonly label: string;
  readonly value: string;
  readonly testId: string;
  /** A literal Tailwind min-width class. */
  readonly width: string;
}

interface BudgetMeter {
  /** Bar value, clamped to 0–100. */
  readonly value: number;
  readonly label: string;
}

interface BudgetSpark {
  readonly points: string;
  readonly label: string;
}


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

/** While a handover waits or is only requested, sends still reach the source. */
const SENDS_STAY = 'Messages you send now go to this session.';

const CONTINUE_OR_KEEP =
  'Continue in a new session that starts from the handoff, or keep working here.';

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';

/**
 * SessionBudgetBannerComponent - one session's budget stage (TASK_2026_597 N7)
 *
 * Dumb component: it renders the budget state it is given and emits the
 * user's choice. The parent calls `session:budgetAction` and starts the new
 * session. The handoff preview is plain text in a `<pre>` (text
 * interpolation, never HTML).
 *
 * The notification starts at the handoff stage (the higher of the
 * authoritative and the live stage, so it also shows while a turn streams)
 * and may transition into handover progress or failure. A dismissed handoff
 * stays hidden until the limit stage escalates it. A pending handover (an
 * agent's request, a parked one, or one waiting for running work) is always
 * shown, whatever the budget stage. Nothing here starts a handover on its own
 * (D22): every handover begins with a button the user pressed. No timers.
 */
@Component({
  selector: 'ptah-session-budget-banner',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    @if (stage(); as current) {
      <div
        class="surface-2 mx-2 my-1 rounded-lg text-xs"
        [class.border-warning]="tone() === 'warning'"
        [class.border-error]="tone() === 'error'"
        [class.border-info]="tone() === 'info'"
        [attr.role]="current === 'limit' ? 'alert' : 'status'"
        [attr.aria-live]="current === 'limit' ? 'assertive' : 'polite'"
        data-testid="session-budget-banner"
      >
        <div class="flex items-start gap-2 px-2.5 pt-2">
          <lucide-angular
            [img]="stageIcon()"
            class="mt-0.5 h-4 w-4 shrink-0"
            [class.text-warning]="tone() === 'warning'"
            [class.text-error]="tone() === 'error'"
            [class.text-info]="tone() === 'info'"
            aria-hidden="true"
            data-testid="session-budget-icon"
          />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-x-1.5">
              <div
                class="font-semibold leading-5"
                data-testid="session-budget-title"
              >
                {{ title() }}
              </div>
              @if (estimate()) {
                <span
                  class="badge badge-ghost badge-xs"
                  title="Estimated from the running turn; the figures are from the last completed turn"
                  data-testid="session-budget-estimate"
                >
                  estimate
                </span>
              }
            </div>
            @if (meter(); as meter) {
              <progress
                class="progress mt-1.5 h-1.5 w-full"
                [class.progress-warning]="tone() === 'warning'"
                [class.progress-error]="tone() === 'error'"
                [class.progress-info]="tone() === 'info'"
                [value]="meter.value"
                max="100"
                aria-valuemin="0"
                aria-valuemax="100"
                [attr.aria-valuenow]="meter.value"
                [attr.aria-label]="meter.label"
                data-testid="session-budget-meter"
              ></progress>
            }
            @if (spark(); as spark) {
              <svg
                class="mt-1 h-6 w-full"
                viewBox="0 0 100 24"
                preserveAspectRatio="none"
                role="img"
                [attr.aria-label]="spark.label"
                data-testid="session-budget-sparkline"
              >
                <polyline
                  fill="none"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  [class.stroke-warning]="tone() === 'warning'"
                  [class.stroke-error]="tone() === 'error'"
                  [class.stroke-info]="tone() === 'info'"
                  [attr.points]="spark.points"
                />
              </svg>
            }
            @if (stats(); as stats) {
              <dl
                class="mt-2 flex flex-wrap gap-x-3 gap-y-1"
                aria-label="Session budget"
                data-testid="session-budget-stats"
              >
                @for (row of stats; track row.testId) {
                  <div class="{{ row.width }}">
                    <dt
                      class="text-[10px] uppercase tracking-wide text-base-content-muted"
                    >
                      {{ row.label }}
                    </dt>
                    <dd
                      class="font-medium tabular-nums"
                      [attr.data-testid]="row.testId"
                    >
                      {{ row.value }}
                    </dd>
                  </div>
                }
              </dl>
            }
          </div>
        </div>

        <p
          class="mt-1.5 px-2.5 leading-relaxed text-base-content-muted"
          data-testid="session-budget-body"
        >
          @for (part of bodyParts(); track $index) {
            @if (part.code) {
              <code
                class="rounded bg-base-300 px-1 font-mono text-[11px] text-base-content"
                >{{ part.text }}</code
              >
            } @else {
              {{ part.text }}
            }
          }
        </p>
        @if (writeErrorLine(); as errorLine) {
          <p
            class="mt-0.5 px-2.5 text-warning"
            data-testid="session-budget-write-error"
          >
            {{ errorLine }}
          </p>
        }
        @if (readStatusLine(); as readLine) {
          <p
            class="mt-0.5 px-2.5 text-warning"
            data-testid="session-budget-read-status"
          >
            {{ readLine }}
          </p>
        }
        @if (queuedMessageCarried() && current !== 'handover-failed') {
          <p
            class="mt-0.5 px-2.5 text-base-content-muted"
            data-testid="session-budget-queued-carried"
          >
            Your queued message will be sent in the new session.
          </p>
        }

        <div class="flex flex-wrap items-center gap-1 px-2.5 pb-2 pt-1.5">
          @if (current === 'handover-progress') {
            <span class="px-1 text-base-content-muted" data-testid="session-handover-progress">
              {{ handoverProgress() }}
            </span>
            <button
              type="button"
              class="btn btn-xs btn-outline {{ focus }}"
              [disabled]="busy()"
              (click)="cancelHandover.emit()"
            >
              Cancel (keep working)
            </button>
          } @else if (current === 'handover-failed') {
            <button
              type="button"
              class="btn btn-xs btn-primary {{ focus }}"
              [disabled]="busy()"
              (click)="continueInNewSession.emit()"
            >
              Retry
            </button>
            @if (handover()?.lostInputTexts?.length) {
              <button
                type="button"
                class="btn btn-xs btn-outline {{ focus }}"
                [disabled]="busy()"
                (click)="putLostInputsBack()"
              >
                Put back in composer
              </button>
            }
            <button
              type="button"
              class="btn btn-xs btn-outline {{ focus }}"
              [disabled]="busy()"
              (click)="cancelHandover.emit()"
            >
              Keep working
            </button>
          } @else if (current === 'handover-waiting') {
            <button
              type="button"
              class="btn btn-xs btn-primary {{ focus }}"
              aria-label="Continue in a new session now, without waiting for the running work"
              [disabled]="busy()"
              (click)="continueNowAnyway.emit()"
            >
              Continue now anyway
            </button>
            <button
              type="button"
              class="btn btn-xs btn-outline {{ focus }}"
              aria-label="Cancel the handover and keep working in this session"
              [disabled]="busy()"
              (click)="cancelHandover.emit()"
            >
              Cancel
            </button>
          } @else if (current === 'agent-request') {
            <button
              type="button"
              class="btn btn-xs btn-primary {{ focus }}"
              aria-label="Approve the agent's request to continue in a new session"
              [disabled]="busy()"
              (click)="approveAgentRequest.emit()"
            >
              Approve
            </button>
            <button
              type="button"
              class="btn btn-xs btn-outline {{ focus }}"
              aria-label="Decline the agent's request and keep working in this session"
              [disabled]="busy()"
              (click)="cancelHandover.emit()"
            >
              Cancel
            </button>
          } @else {
            @if (turnRunning()) {
              <button
                type="button"
                class="btn btn-xs btn-outline {{ focus }}"
                [attr.aria-label]="
                  wrapUpRequested()
                    ? 'The agent was already asked to wrap up at this stage'
                    : 'Ask the agent to wrap up its current turn'
                "
                [disabled]="busy() || wrapUpRequested()"
                (click)="requestWrapUp.emit()"
              >
                {{ wrapUpRequested() ? 'Wrap-up requested' : 'Ask agent to wrap up' }}
              </button>
            }
            <button
              type="button"
              class="btn btn-xs btn-primary {{ focus }}"
              [attr.aria-label]="current === 'limit' ? 'Continue in new session' : 'Start new session from handoff'"
              [disabled]="busy()"
              (click)="continueInNewSession.emit()"
            >
              {{ current === 'limit' ? 'New session' : 'Continue in new session' }}
            </button>
            @if (parkedHandover()) {
              <button
                type="button"
                class="btn btn-xs btn-outline {{ focus }}"
                [disabled]="busy()"
                (click)="cancelHandover.emit()"
              >
                Cancel handover
              </button>
            }
            <button
              type="button"
              class="btn btn-xs btn-outline {{ focus }}"
              [disabled]="busy()"
              [attr.aria-expanded]="previewOpen()"
              (click)="togglePreview()"
            >
              {{ previewOpen() ? 'Hide handoff' : 'Preview handoff' }}
            </button>
            @if (budget()?.stage === 'limit') {
              <button
                type="button"
                class="btn btn-xs btn-outline {{ focus }}"
                [disabled]="busy()"
                (click)="extend.emit()"
              >
                Allow 20% more
              </button>
            } @else if (current === 'handoff' && budget()?.stage === 'handoff' && !parkedHandover()) {
              <button
                type="button"
                class="btn btn-xs btn-outline {{ focus }}"
                aria-label="Dismiss and keep working"
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
          (current === 'handoff' || current === 'limit')
        ) {
          <div
            class="mx-2 mb-1.5 flex flex-wrap items-center gap-1 text-warning"
            data-testid="session-budget-preview-error"
          >
            <span>Could not load the handoff.</span>
            <button
              type="button"
              class="btn btn-xs btn-ghost {{ focus }}"
              [disabled]="busy()"
              (click)="previewRequested.emit()"
            >
              Try again
            </button>
          </div>
        } @else if (
          previewOpen() && (current === 'handoff' || current === 'limit')
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

  /** True while a budget action runs; disables the buttons. */
  readonly busy = input(false);

  /** Per-session usage samples. Fewer than two points hides the sparkline. */
  readonly usage = input<readonly SessionBudgetUsageSample[]>([]);

  /** True while the backend compacts this session. */
  readonly compacting = input(false);

  /** True while the agent produces a turn; offers "Ask agent to wrap up". */
  readonly turnRunning = input(false);

  /**
   * The live (estimated) stage of the running turn, already limited to a
   * streaming tab with a budget. The banner shows the higher of it and the
   * authoritative stage, marked "estimate" when the live stage is higher.
   */
  readonly liveStage = input<'handoff' | 'limit' | null>(null);

  /** True once "Ask agent to wrap up" was accepted at this stage in this turn. */
  readonly wrapUpRequested = input(false);

  /** True while the accepted handover carries the composer's queued message (R5). */
  readonly queuedMessageCarried = input(false);

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
  /** "New session" (handoff and limit). */
  readonly continueInNewSession = output<void>();
  /** Cancel a pending or failed handover, or decline an agent's request, and keep the source session. */
  readonly cancelHandover = output<void>();
  /** "Ask agent to wrap up" while a turn runs at handoff or limit. */
  readonly requestWrapUp = output<void>();
  /** "Continue now anyway": start without waiting for the running work. */
  readonly continueNowAnyway = output<void>();
  /** "Approve" an agent's request to continue in a new session. */
  readonly approveAgentRequest = output<void>();
  /** Restore source inputs which could not be returned after the source ended. */
  readonly restoreLostInputs = output<readonly string[]>();
  /** Retained action channel for the footer rotation advisory. */
  readonly rotate = output<void>();

  /** Shared focus ring, interpolated into every button class. */
  protected readonly focus = FOCUS;

  protected readonly previewOpen = signal(false);

  /**
   * The budget stage to show: the higher of the authoritative stage and the
   * live estimate (the parent passes the live stage only while the turn runs
   * and the tab has a budget). `null` without a budget.
   */
  private readonly displayStage = computed<SessionBudgetState['stage'] | null>(
    () => {
      const budget = this.budget();
      if (!budget) return null;
      const live = this.liveStage();
      if (live === 'limit') return 'limit';
      if (live === 'handoff' && budget.stage !== 'limit') return 'handoff';
      return budget.stage;
    },
  );

  /** True when the shown handoff or limit stage comes from the live estimate. */
  protected readonly estimate = computed(() => {
    const stage = this.stage();
    if (stage !== 'handoff' && stage !== 'limit') return false;
    const budget = this.budget();
    return !!budget && this.displayStage() !== budget.stage;
  });

  /** The stage to show, or `null` for none. */
  protected readonly stage = computed<BannerStage | null>(() => {
    const handover = this.handover();
    if (handover?.phase === 'failed') return 'handover-failed';
    if (
      handover &&
      ['writing-handoff', 'starting-successor', 'successor-confirmed', 'closing'].includes(handover.phase)
    ) {
      return 'handover-progress';
    }
    // A pending handover is shown whatever the budget says: a compact, an
    // extension or a dismissal must not leave it waiting unseen while the
    // coordinator still holds (or is about to hold) the source (627 6F S2).
    if (handover?.phase === 'waiting-for-turn-end') return 'handover-waiting';
    if (this.agentRequest()) return 'agent-request';
    const display = this.displayStage();
    if (this.parkedHandover()) {
      return display === 'limit' ? 'limit' : 'handoff';
    }
    if (display !== 'handoff' && display !== 'limit') return null;
    if (display === 'handoff' && this.budget()?.dismissedStage === 'handoff') {
      return null;
    }
    return display;
  });

  /**
   * An agent's request to continue in a new session (D23), parked until the
   * user approves (the normal begin, work gate included) or cancels.
   */
  private readonly agentRequest = computed(() => {
    const handover = this.handover();
    return (
      handover?.phase === 'awaiting-confirmation' &&
      handover.requestedBy === 'agent'
    );
  });

  /**
   * A handover the coordinator parked for the user's click (the blocking
   * limit, P9). "New session" confirms it; "Cancel handover" releases it.
   */
  protected readonly parkedHandover = computed(() => {
    const handover = this.handover();
    return (
      handover?.phase === 'awaiting-confirmation' &&
      handover.requestedBy !== 'agent'
    );
  });

  /**
   * The work a waiting handover names. Only while the phase is
   * `waiting-for-turn-end`: a cancelled or failed state can carry a stale
   * `waitingFor` (627-L2), and only that phase shows this line.
   */
  private readonly waitingCopy = computed(() =>
    waitingLine(this.handover()?.waitingFor, this.turnRunning()),
  );

  protected readonly tone = computed<BannerTone>(() => {
    switch (this.stage()) {
      case 'handover-progress':
      case 'handover-waiting':
        return 'info';
      case 'agent-request':
        return 'warning';
      case 'handoff':
      case 'limit':
      case 'handover-failed':
        return 'error';
      default:
        return 'info';
    }
  });

  protected readonly stageIcon = computed<LucideIconData>(() => {
    switch (this.stage()) {
      case 'handoff':
      case 'agent-request':
        return ArrowRightLeft;
      case 'limit':
      case 'handover-failed':
        return OctagonAlert;
      default:
        return RefreshCw;
    }
  });

  /** Current figures. No usage series exists on the budget state. */
  protected readonly stats = computed<readonly BudgetStat[] | null>(() => {
    const budget = this.budget();
    if (!budget || !this.stage()) return null;
    const cost = isCostMeasure(budget);
    const prefix = budget.lowerBound ? '≥ ' : '';
    const wide = 'min-w-[4.5rem]';
    return [
      {
        label: this.usedLabel(budget),
        value: `${prefix}${cost ? formatUsd(budget.used) : formatTokens(budget.used)}`,
        testId: 'session-budget-used',
        width: wide,
      },
      {
        label: 'Budget',
        value: cost ? formatUsd(budget.limit) : formatTokens(budget.limit),
        testId: 'session-budget-limit',
        width: wide,
      },
      {
        label: 'Percent',
        value:
          budget.percent === null ? '—' : formatPercent(budget.percent),
        testId: 'session-budget-percent',
        width: 'min-w-[3.5rem]',
      },
      {
        label: 'Compactions',
        value: String(budget.compactions),
        testId: 'session-budget-compactions',
        width: wide,
      },
    ];
  });

  /** Inline sparkline. Hidden until two samples exist. */
  protected readonly spark = computed<BudgetSpark | null>(() => {
    const samples = this.usage();
    if (samples.length < 2) return null;
    const last = samples.length - 1;
    const points = samples
      .map((sample, index) => {
        const percent =
          sample.percent !== null && Number.isFinite(sample.percent)
            ? Math.max(0, Math.min(100, sample.percent))
            : 0;
        const x = (index / last) * 100;
        const y = 22 - (percent / 100) * 20;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
    return {
      points,
      label: `Budget use over this session, ${samples.length} samples`,
    };
  });

  /** Linear meter of `percent`, clamped for the bar. Hidden with no figure. */
  protected readonly meter = computed<BudgetMeter | null>(() => {
    const budget = this.budget();
    if (!budget || !this.stage() || budget.percent === null) return null;
    const value = Math.max(0, Math.min(100, budget.percent));
    const shown = formatPercent(budget.percent);
    return {
      value,
      label:
        budget.percent > 100
          ? `${shown} of session budget, over the limit`
          : `${shown} of session budget`,
    };
  });

  protected readonly title = computed(() => {
    switch (this.stage()) {
      case 'handoff':
        return 'This session is near its budget';
      case 'agent-request':
        return 'The agent asks to continue in a new session';
      case 'handover-waiting':
        return 'Waiting to continue in a new session';
      case 'limit':
        return 'This session reached its budget';
      case 'handover-progress':
        return 'Continuing in a new session…';
      case 'handover-failed':
        return 'Could not continue in a new session';
      default:
        return '';
    }
  });

  protected readonly body = computed(() => {
    const stage = this.stage();
    if (stage === 'handover-progress') return this.handoverProgress();
    if (stage === 'handover-failed') {
      return this.handover()?.error ?? 'The handover did not complete. Your queued message remains in this composer.';
    }
    if (stage === 'handover-waiting') {
      return `${this.waitingCopy()} ${SENDS_STAY}`;
    }
    if (stage === 'agent-request') {
      return `Approve to continue in a new session that starts from the handoff, or cancel to keep working here. ${SENDS_STAY}`;
    }
    const budget = this.budget();
    if (stage === 'handoff') {
      if (!budget) return CONTINUE_OR_KEEP;
      return this.estimate()
        ? `The running turn is estimated to have reached the handoff point; the figures are from the last completed turn. ${CONTINUE_OR_KEEP}`
        : `This session has used ${budgetAmount(budget)}. ${CONTINUE_OR_KEEP}`;
    }
    if (!budget || !stage) return '';
    return this.limitBody(budget);
  });

  /** Splits `/compact` out so the template can render it as inline code. */
  protected readonly bodyParts = computed<readonly BodyPart[]>(() => {
    const text = this.body();
    if (!text) return [];
    const chunks = text.split('/compact');
    const parts: BodyPart[] = [];
    chunks.forEach((chunk, index) => {
      if (chunk) parts.push({ code: false, text: chunk });
      if (index < chunks.length - 1) {
        parts.push({ code: true, text: '/compact' });
      }
    });
    return parts;
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

  protected readonly handoverProgress = computed(() => {
    switch (this.handover()?.phase) {
      case 'writing-handoff':
        return 'Writing the handoff…';
      case 'starting-successor':
        return 'Starting the new session…';
      case 'successor-confirmed':
        return 'Switching to the successor session…';
      case 'closing':
        return 'Finishing the handover…';
      default:
        return 'Preparing the handover…';
    }
  });

  protected putLostInputsBack(): void {
    const texts = this.handover()?.lostInputTexts;
    if (texts?.length) this.restoreLostInputs.emit(texts);
  }

  private limitBody(budget: SessionBudgetState): string {
    const pause = this.pauseLine(budget);
    const handoff = budget.handoff;
    if (!handoff) return pause;
    const context = this.contextTokens();
    const instead =
      context !== null && context > 0
        ? ` instead of ${formatTokens(context)}`
        : '';
    const handoffLine = `Continue in a new session that starts with only the handoff (about ${formatTokens(Math.ceil(handoff.chars / 4))} tokens${instead}).`;
    return budget.blocked || this.estimate()
      ? `${pause} ${handoffLine}`
      : `${handoffLine} ${pause}`;
  }

  /**
   * Whether sends are paused. A live estimate comes before the authoritative
   * stage (and so `blocked`) catches up: it states the estimate instead.
   */
  private pauseLine(budget: SessionBudgetState): string {
    if (this.estimate()) {
      return "The running turn is estimated to have reached this session's budget; the figures are from the last completed turn.";
    }
    return budget.blocked
      ? `Limit reached — new turns are held until you continue (one queued message may still run). /clear still works. ${COMPACT_NOTE}; at the limit only a bare /compact is allowed.`
      : 'New messages are not paused (blocking is off in settings).';
  }

  private usedLabel(budget: SessionBudgetState): string {
    if (isCostMeasure(budget)) return 'Cost';
    return budget.measure === 'weighted-fallback' ? 'Used (est.)' : 'Used';
  }
}
