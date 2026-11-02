import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  Check,
  Circle,
  LucideAngularModule,
  X,
  type LucideIconData,
} from 'lucide-angular';

/** One step of a staged load (workspace preparation, in-app loading). */
export interface StagedStep {
  readonly id: string;
  readonly label: string;
  readonly state: 'pending' | 'active' | 'done' | 'failed';
  readonly done?: number;
  readonly total?: number;
  readonly detail?: string;
}

type StepState = StagedStep['state'];

/** Icon shape per state: never colour alone. The active row draws the pulse
 * (TASK_2026_860) instead of an icon, so it is absent from this record. */
const STATE_ICON: Record<Exclude<StepState, 'active'>, LucideIconData> = {
  pending: Circle,
  done: Check,
  failed: X,
};

const STATE_WORD: Record<StepState, string> = {
  pending: 'pending',
  active: 'in progress',
  done: 'done',
  failed: 'failed',
};

interface StepView {
  readonly id: string;
  readonly label: string;
  readonly state: StepState;
  /** `null` on the active row, which draws the pulse instead. */
  readonly icon: LucideIconData | null;
  readonly word: string;
  /** Right-hand figure: the detail, else "done / total", else empty. */
  readonly aside: string;
  /** The aside is the ticking "done / total" count, hidden from the live region. */
  readonly asideIsCount: boolean;
  /** Active rows only: 0-1 when `total` is known, `null` = indeterminate. */
  readonly fraction: number | null;
  readonly done: number | null;
  readonly total: number | null;
}

function knownTotal(step: StagedStep): number | null {
  return typeof step.total === 'number' &&
    Number.isFinite(step.total) &&
    step.total > 0
    ? step.total
    : null;
}

function knownDone(step: StagedStep, total: number | null): number | null {
  if (total === null) return null;
  const done =
    typeof step.done === 'number' && Number.isFinite(step.done) ? step.done : 0;
  return Math.min(total, Math.max(0, done));
}

/**
 * StagedStepsComponent — the staged-load checklist (option-ab.mjs:185-195).
 * Each row is an icon plus a word, with a right-hand figure (detail or
 * "done / total"); the active row draws the TASK_2026_860 pulse in place of
 * an icon and carries a progress bar: determinate when
 * `total` is known, otherwise indeterminate. Wrapped in `role="status"` with
 * `aria-busy` while any step is unfinished. The right-hand figure is
 * `aria-hidden` when it is the "done / total" count, so count ticks do not
 * make the live region re-read the list; the determinate bar carries the
 * same numbers as its value. A `detail` aside stays readable.
 */
@Component({
  selector: 'ptah-staged-steps',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div role="status" [attr.aria-busy]="busy()">
      <ul
        class="ptah-staged-steps__list"
        role="list"
        [attr.aria-label]="ariaLabel()"
      >
        @for (step of views(); track step.id) {
          <li class="ptah-staged-steps__row" [attr.data-state]="step.state">
            @if (step.icon; as icon) {
              <lucide-angular
                [img]="icon"
                [size]="18"
                [class]="
                  'ptah-staged-steps__icon ptah-staged-steps__icon--' + step.state
                "
                aria-hidden="true"
              />
            } @else {
              <span
                class="ptah-staged-steps__pulse"
                data-testid="staged-step-pulse"
                aria-hidden="true"
              ></span>
            }
            <div class="ptah-staged-steps__body">
              <span class="ptah-staged-steps__label">{{ step.label }}</span>
              <span class="sr-only">, {{ step.word }}</span>
              @if (step.state === 'active') {
                @if (step.fraction !== null) {
                  <div
                    class="ptah-staged-steps__bar"
                    role="progressbar"
                    [attr.aria-label]="step.label"
                    aria-valuemin="0"
                    [attr.aria-valuemax]="step.total"
                    [attr.aria-valuenow]="step.done"
                  >
                    <span
                      class="ptah-staged-steps__fill"
                      [style.transform]="'scaleX(' + step.fraction + ')'"
                    ></span>
                  </div>
                } @else {
                  <div
                    class="ptah-staged-steps__bar ptah-staged-steps__bar--indeterminate"
                    role="progressbar"
                    [attr.aria-label]="step.label"
                  >
                    <span class="ptah-staged-steps__sweep"></span>
                  </div>
                }
              }
            </div>
            <span
              class="ptah-staged-steps__aside text-base-content-muted tabular-nums"
              [attr.aria-hidden]="step.asideIsCount ? 'true' : null"
              >{{ step.aside }}</span
            >
          </li>
        }
      </ul>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .ptah-staged-steps__list {
        display: flex;
        flex-direction: column;
        gap: 14px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .ptah-staged-steps__row {
        display: grid;
        grid-template-columns: 22px 1fr auto;
        gap: 12px;
        align-items: center;
      }
      .ptah-staged-steps__icon {
        display: inline-flex;
        transform-origin: center;
      }
      .ptah-staged-steps__icon--pending {
        color: oklch(var(--bc) / 0.5);
      }
      .ptah-staged-steps__icon--done {
        color: oklch(var(--su));
      }
      .ptah-staged-steps__icon--failed {
        color: oklch(var(--er));
      }
      /* The TASK_2026_860 pulse that replaces the active row's icon: an 8 px
         core breathing inside a 14 px ring that fades out from it, in the
         active accent. Shared global keyframes; transform and opacity only. */
      .ptah-staged-steps__pulse {
        position: relative;
        justify-self: center;
        width: 8px;
        height: 8px;
      }
      .ptah-staged-steps__pulse::before {
        content: '';
        position: absolute;
        inset: 1px;
        border-radius: 9999px;
        background: oklch(var(--p));
      }
      .ptah-staged-steps__pulse::after {
        content: '';
        position: absolute;
        inset: -3px;
        border: 1.5px solid oklch(var(--p));
        border-radius: 9999px;
      }
      .ptah-staged-steps__body {
        min-width: 0;
      }
      .ptah-staged-steps__label {
        font-weight: 600;
      }
      [data-state='pending'] .ptah-staged-steps__label {
        font-weight: 500;
        color: oklch(var(--bc) / 0.78);
      }
      .ptah-staged-steps__aside {
        font-size: 12.5px;
        white-space: nowrap;
      }
      .ptah-staged-steps__bar {
        position: relative;
        margin-top: 6px;
        height: 6px;
        border-radius: 99px;
        background: oklch(var(--bc) / 0.12);
        overflow: hidden;
      }
      .ptah-staged-steps__fill,
      .ptah-staged-steps__sweep {
        position: absolute;
        inset: 0;
        border-radius: 99px;
        background: oklch(var(--p));
        transform-origin: left center;
      }
      .ptah-staged-steps__sweep {
        right: auto;
        width: 40%;
      }
      /* Without motion the sweep cannot travel; a static 40% segment would read
         as 40% done, so it becomes a full-width faint fill instead. The pulse
         keeps a still dimmed dot, its ring hidden. */
      @media (prefers-reduced-motion: reduce) {
        .ptah-staged-steps__sweep {
          width: 100%;
          opacity: 0.35;
        }
        .ptah-staged-steps__pulse::after {
          display: none;
        }
        .ptah-staged-steps__pulse::before {
          opacity: 0.8;
        }
      }
      @media (prefers-reduced-motion: no-preference) {
        .ptah-staged-steps__pulse::before {
          animation: ptah-pulse-core 1.4s ease-in-out infinite;
        }
        .ptah-staged-steps__pulse::after {
          animation: ptah-pulse-ring 1.4s ease-out infinite;
        }
        .ptah-staged-steps__sweep {
          animation: ptah-staged-sweep 1.4s ease-in-out infinite;
        }
      }
      @keyframes ptah-staged-sweep {
        from {
          transform: translateX(-100%);
        }
        to {
          transform: translateX(250%);
        }
      }
    `,
  ],
})
export class StagedStepsComponent {
  readonly steps = input.required<readonly StagedStep[]>();
  readonly ariaLabel = input.required<string>();

  protected readonly views = computed<readonly StepView[]>(() =>
    this.steps().map((step) => {
      const total = knownTotal(step);
      const done = knownDone(step, total);
      const counts = total !== null ? `${done} / ${total}` : '';
      return {
        id: step.id,
        label: step.label,
        state: step.state,
        icon: step.state === 'active' ? null : STATE_ICON[step.state],
        word: STATE_WORD[step.state],
        aside: step.detail || counts,
        asideIsCount: !step.detail && counts !== '',
        fraction:
          step.state === 'active' && total !== null && done !== null
            ? done / total
            : null,
        done,
        total,
      };
    }),
  );

  /** Busy while work remains and nothing has failed (a failure ends the run). */
  protected readonly busy = computed(() => {
    const steps = this.steps();
    return (
      !steps.some((step) => step.state === 'failed') &&
      steps.some((step) => step.state === 'active' || step.state === 'pending')
    );
  });
}
