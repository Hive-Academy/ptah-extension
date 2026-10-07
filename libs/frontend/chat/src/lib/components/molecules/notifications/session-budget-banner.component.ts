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
  SessionBudgetHandoffReadStatus,
  SessionBudgetState,
  SessionBudgetWindowReason,
} from '@ptah-extension/shared';
import {
  ArrowRightLeft,
  Gauge,
  LucideAngularModule,
  OctagonAlert,
  RefreshCw,
  type LucideIconData,
} from 'lucide-angular';
import { SessionRotationKeepService } from '../../../services/session-rotation-keep.service';
import type { SessionBudgetUsageSample } from '../../../services/session-budget-actions.service';

/** Stages that show a banner. `unknown` and `normal` show none. */
type BannerStage = 'rotation' | 'tighten' | 'handoff' | 'limit';

/** Meter and border tone. Tighten warns; handoff and the limit are errors. */
type BannerTone = 'warning' | 'error' | 'info';

interface BodyPart {
  readonly code: boolean;
  readonly text: string;
}

interface BudgetStats {
  readonly usedLabel: string;
  readonly used: string;
  readonly limit: string;
  readonly percent: string;
  readonly compactions: string;
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

/**
 * Why the tighten step did not lower auto-compact, in the user's words.
 * `restore-failed` comes with `applied: true` and never reaches this lookup.
 */
const WINDOW_REASON_TEXT: Readonly<
  Record<
    Exclude<SessionBudgetWindowReason, 'disabled' | 'restore-failed'>,
    string
  >
> = {
  'env-override': 'CLAUDE_CODE_AUTO_COMPACT_WINDOW is set',
  'already-lower': 'it is already at or below <target>',
  'not-honoured': 'this model ignored the lower auto-compact setting',
  failed: 'the change was rejected',
};

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
 * Stages: tighten and handoff are `role="status"`, limit is `role="alert"`.
 * A dismissed tighten or handoff stage stays hidden until a higher stage.
 * There is no per-turn usage series on `SessionBudgetState`, so the card
 * shows a meter and the current figures only.
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
            <div
              class="font-semibold leading-5"
              data-testid="session-budget-title"
            >
              {{ title() }}
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
                <div class="min-w-[4.5rem]">
                  <dt
                    class="text-[10px] uppercase tracking-wide text-base-content-muted"
                  >
                    {{ stats.usedLabel }}
                  </dt>
                  <dd
                    class="font-medium tabular-nums"
                    data-testid="session-budget-used"
                  >
                    {{ stats.used }}
                  </dd>
                </div>
                <div class="min-w-[4.5rem]">
                  <dt
                    class="text-[10px] uppercase tracking-wide text-base-content-muted"
                  >
                    Budget
                  </dt>
                  <dd
                    class="font-medium tabular-nums"
                    data-testid="session-budget-limit"
                  >
                    {{ stats.limit }}
                  </dd>
                </div>
                <div class="min-w-[3.5rem]">
                  <dt
                    class="text-[10px] uppercase tracking-wide text-base-content-muted"
                  >
                    Percent
                  </dt>
                  <dd
                    class="font-medium tabular-nums"
                    data-testid="session-budget-percent"
                  >
                    {{ stats.percent }}
                  </dd>
                </div>
                <div class="min-w-[4.5rem]">
                  <dt
                    class="text-[10px] uppercase tracking-wide text-base-content-muted"
                  >
                    Compactions
                  </dt>
                  <dd
                    class="font-medium tabular-nums"
                    data-testid="session-budget-compactions"
                  >
                    {{ stats.compactions }}
                  </dd>
                </div>
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

        <div class="flex flex-wrap items-center gap-1 px-2.5 pb-2 pt-1.5">
          @if (current === 'rotation') {
            <button
              type="button"
              class="btn btn-xs btn-primary {{ focus }}"
              aria-label="Rotate session: start a new session from a handoff"
              [disabled]="busy()"
              (click)="rotate.emit()"
            >
              Rotate session
            </button>
            <button
              type="button"
              class="btn btn-xs btn-outline {{ focus }}"
              aria-label="Keep this session and hide this suggestion"
              (click)="keepSession()"
            >
              Keep this session
            </button>
          } @else if (current === 'tighten') {
            <button
              type="button"
              class="btn btn-xs btn-primary {{ focus }}"
              aria-label="Compact this session"
              [disabled]="busy() || compacting()"
              (click)="compact.emit()"
            >
              Compact
            </button>
            <button
              type="button"
              class="btn btn-xs btn-outline {{ focus }}"
              aria-label="Dismiss"
              [disabled]="busy()"
              (click)="dismiss.emit()"
            >
              Dismiss
            </button>
            @if (windowApplied()) {
              <button
                type="button"
                class="btn btn-xs btn-outline {{ focus }}"
                [disabled]="busy()"
                (click)="restoreWindow.emit()"
              >
                Restore auto-compact
              </button>
            }
          } @else {
            <button
              type="button"
              class="btn btn-xs btn-primary {{ focus }}"
              [attr.aria-label]="
                current === 'limit'
                  ? 'Continue in new session'
                  : 'Start new session from handoff'
              "
              [disabled]="busy()"
              (click)="continueInNewSession.emit()"
            >
              New session
            </button>
            @if (current === 'handoff') {
              <button
                type="button"
                class="btn btn-xs btn-outline {{ focus }}"
                aria-label="Compact this session"
                [disabled]="busy() || compacting()"
                (click)="compact.emit()"
              >
                Compact
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
            @if (current === 'limit') {
              <button
                type="button"
                class="btn btn-xs btn-outline {{ focus }}"
                [disabled]="busy()"
                (click)="extend.emit()"
              >
                Allow 20% more
              </button>
            } @else {
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
  /** The tab's budget state; `null` or a stage below tighten renders nothing. */
  readonly budget = input<SessionBudgetState | null>(null);

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

  /** True while this session's compaction is in flight. Disables Compact. */
  readonly compacting = input(false);

  /** "Dismiss" (tighten and handoff). */
  readonly dismiss = output<void>();
  /** "Allow 20% more" (limit). */
  readonly extend = output<void>();
  /** "Restore auto-compact" (tighten, only when the window was applied). */
  readonly restoreWindow = output<void>();
  /** The preview was opened; the parent loads the handoff text. */
  readonly previewRequested = output<void>();
  /** "New session" (handoff and limit). */
  readonly continueInNewSession = output<void>();
  /** "Rotate session" (rotation advisory). */
  readonly rotate = output<void>();
  /** "Compact" on tighten and handoff. The parent sends `/compact`. */
  readonly compact = output<void>();

  /** Shared focus ring, interpolated into every button class. */
  protected readonly focus = FOCUS;

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

  /** Tighten warns; handoff and the limit are errors. Rotation stays info. */
  protected readonly tone = computed<BannerTone>(() => {
    switch (this.stage()) {
      case 'tighten':
        return 'warning';
      case 'handoff':
      case 'limit':
        return 'error';
      default:
        return 'info';
    }
  });

  protected readonly stageIcon = computed<LucideIconData>(() => {
    switch (this.stage()) {
      case 'tighten':
        return Gauge;
      case 'handoff':
        return ArrowRightLeft;
      case 'limit':
        return OctagonAlert;
      default:
        return RefreshCw;
    }
  });

  protected readonly windowApplied = computed(
    () => this.budget()?.window?.applied === true,
  );

  /** Current figures. No usage series exists on the budget state. */
  protected readonly stats = computed<BudgetStats | null>(() => {
    const budget = this.budget();
    if (!budget || !this.stage()) return null;
    const cost = this.isCost(budget);
    const prefix = budget.lowerBound ? '≥ ' : '';
    return {
      usedLabel: cost
        ? 'Cost'
        : budget.measure === 'weighted-fallback'
          ? 'Used (est.)'
          : 'Used',
      used: `${prefix}${cost ? this.usd(budget.used) : this.tokens(budget.used)}`,
      limit: cost ? this.usd(budget.limit) : this.tokens(budget.limit),
      percent:
        budget.percent === null ? '—' : this.formatPercent(budget.percent),
      compactions: String(budget.compactions),
    };
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
    const shown = this.formatPercent(budget.percent);
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
    if (stage === 'tighten') return this.tightenBody(budget);
    if (stage === 'handoff') return this.handoffBody(budget);
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

  private tightenBody(budget: SessionBudgetState): string {
    const window = budget.window;
    if (!window || window.reason === 'disabled') {
      return `Run /compact or start a fresh session for unrelated work to slow the spend. ${COMPACT_NOTE}.`;
    }
    const target = this.tokens(window.target);
    if (window.applied && window.reason === 'restore-failed') {
      return `Ptah could not restore auto-compact; it stays at ${target} tokens for this session. Try Restore auto-compact again.`;
    }
    if (window.applied) {
      return `Ptah lowered auto-compact to ${target} tokens for this session. If the context is already above that, the next request compacts first. More compactions bring the handoff step sooner.`;
    }
    // `restore-failed` is only sent with `applied: true` (handled above).
    const reasonKey =
      window.reason === undefined || window.reason === 'restore-failed'
        ? 'failed'
        : window.reason;
    const reason = WINDOW_REASON_TEXT[reasonKey].replace('<target>', target);
    return `Ptah could not lower auto-compact here (${reason}). Use /compact or start a fresh session to slow the spend. ${COMPACT_NOTE}.`;
  }

  private handoffBody(budget: SessionBudgetState): string {
    const parts: string[] = [];
    if (budget.compactions > 0) {
      parts.push(
        `This session has compacted ${budget.compactions} ${budget.compactions === 1 ? 'time' : 'times'}, and each compaction loses detail.`,
      );
    }
    if (budget.handoff && !budget.handoff.writeError) {
      parts.push(
        'Ptah saved a handoff with the goal, decisions, changed files, open items and next step.',
      );
    }
    parts.push('At 100% new messages in this session pause.');
    return parts.join(' ');
  }

  private limitBody(budget: SessionBudgetState): string {
    const pause = budget.blocked
      ? `New messages here are paused after the current turn (one queued message may still run). /clear still works. ${COMPACT_NOTE}; at the limit only a bare /compact is allowed.`
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

  private isCost(budget: SessionBudgetState): boolean {
    return budget.measure === 'cost' || budget.measure === 'cost-lower-bound';
  }

  /** `50%`, `100.2%`. */
  private formatPercent(percent: number): string {
    const rounded = Math.round(percent * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
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
