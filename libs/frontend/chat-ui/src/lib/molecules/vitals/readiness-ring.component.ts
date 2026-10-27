import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { ArrowRight, LucideAngularModule } from 'lucide-angular';

import { ProgressRingComponent } from './progress-ring.component';

/** One workspace readiness check. `ready: null` = still being checked. */
export interface ReadinessCheck {
  readonly id: 'skills' | 'scan' | 'agents';
  readonly label: string;
  readonly ready: boolean | null;
}

/** The single next step the ring offers, e.g. `{ id: 'agents', label: 'Generate agents' }`. */
export interface ReadinessAction {
  readonly id: string;
  readonly label: string;
}

/** The word a screen reader hears for one check's state. */
function checkWord(ready: boolean | null): string {
  if (ready === null) return 'checking';
  return ready ? 'ready' : 'not ready';
}

/**
 * ReadinessRingComponent —the workspace readiness hero: a 112 px gold
 * `ptah-progress-ring` reading "2/3 · ready" and, under it, one gold text
 * link for the next step (TASK_2026_721 component 10, screen 02).
 *
 * While any check is still unknown (`ready: null`) the ring is indeterminate
 * and reads "checking". The ring's accessible name lists every check, so the
 * state is not carried by the arc alone. The parent hides the component when
 * all checks are ready; this component does not hide itself.
 */
@Component({
  selector: 'ptah-readiness-ring',
  standalone: true,
  imports: [ProgressRingComponent, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ptah-readiness' },
  template: `
    <ptah-progress-ring
      [value]="fraction()"
      [centerText]="centerText()"
      [subText]="subText()"
      tone="gold"
      size="lg"
      [ariaLabel]="ariaLabel()"
    />
    @if (action(); as next) {
      <button
        type="button"
        class="ptah-readiness__link"
        (click)="actionRequested.emit(next.id)"
      >
        <span>{{ next.label }}</span>
        <lucide-angular [img]="arrowIcon" [size]="14" aria-hidden="true" />
      </button>
    }
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        flex-direction: column;
        align-items: flex-start;
        justify-content: center;
        gap: 12px;
      }
      .ptah-readiness__link {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 2px 0;
        border: 0;
        background: none;
        /* --ptah-link is the measured gold-as-text token (styles.css): brand
           gold on dark anubis, gold-strong on light, the per-theme accent ink
           on stock themes and the glass link on glass. The raw primary
           measured 3.08:1 on anubis at this 13 px size. */
        color: var(--ptah-link, oklch(var(--p)));
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        border-radius: 6px;
      }
      .ptah-readiness__link:hover {
        text-decoration: underline;
        text-underline-offset: 3px;
      }
      .ptah-readiness__link:focus-visible {
        outline: 2px solid oklch(var(--p));
        outline-offset: 3px;
      }
    `,
  ],
})
export class ReadinessRingComponent {
  readonly checks = input.required<readonly ReadinessCheck[]>();
  readonly action = input<ReadinessAction | null>(null);

  /** Emits the action id when the link is activated. */
  readonly actionRequested = output<string>();

  protected readonly arrowIcon = ArrowRight;

  /**
   * True while at least one check has no answer yet, or before any check has
   * arrived (an empty list reads "checking", never "0/0 ready").
   */
  private readonly checking = computed(() => {
    const checks = this.checks();
    return checks.length === 0 || checks.some((check) => check.ready === null);
  });

  private readonly readyCount = computed(
    () => this.checks().filter((check) => check.ready === true).length,
  );

  /** 0-1, or `null` (indeterminate) while checking (including no checks). */
  protected readonly fraction = computed(() =>
    this.checking() ? null : this.readyCount() / this.checks().length,
  );

  protected readonly centerText = computed(() =>
    this.checking() ? '' : `${this.readyCount()}/${this.checks().length}`,
  );

  protected readonly subText = computed(() =>
    this.checking() ? 'checking' : 'ready',
  );

  protected readonly ariaLabel = computed(() => {
    const checks = this.checks();
    const detail = checks
      .map((check) => `${check.label} ${checkWord(check.ready)}`)
      .join(', ');
    const summary = this.checking()
      ? 'Checking workspace readiness'
      : `Workspace readiness: ${this.readyCount()} of ${checks.length} ready`;
    return detail ? `${summary}. ${detail}` : summary;
  });
}
