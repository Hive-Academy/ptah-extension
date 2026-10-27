import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  Check,
  Circle,
  Loader,
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

/** Icon shape and screen-reader word per state: never colour alone. */
const STATE_ICON: Record<StepState, LucideIconData> = {
  pending: Circle,
  active: Loader,
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
  readonly icon: LucideIconData;
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
 * "done / total"). The active row carries a progress bar: determinate when
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
            <lucide-angular
              [img]="step.icon"
              [size]="18"
              [class]="
                'ptah-staged-steps__icon ptah-staged-steps__icon--' + step.state
              "
              aria-hidden="true"
            />
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
      .ptah-staged-steps__icon--active {
        color: oklch(var(--p));
      }
      .ptah-staged-steps__icon--done {
        color: oklch(var(--su));
      }
      .ptah-staged-steps__icon--failed {
        color: oklch(var(--er));
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
         as 40% done, so it becomes a full-width faint fill instead. */
      @media (prefers-reduced-motion: reduce) {
        .ptah-staged-steps__sweep {
          width: 100%;
          opacity: 0.35;
        }
      }
      @media (prefers-reduced-motion: no-preference) {
        .ptah-staged-steps__icon--active {
          animation: ptah-staged-spin 1.1s linear infinite;
        }
        .ptah-staged-steps__sweep {
          animation: ptah-staged-sweep 1.4s ease-in-out infinite;
        }
      }
      @keyframes ptah-staged-spin {
        to {
          transform: rotate(360deg);
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
        icon: STATE_ICON[step.state],
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
