import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { LucideAngularModule, Check, Loader } from 'lucide-angular';
import type {
  BackendReadiness,
  BootPhase,
  BootProgressStepId,
  BootProgressStepState,
} from '@ptah-extension/shared';
import {
  StagedStepsComponent,
  type StagedStep,
} from '../vitals/staged-steps.component';

/**
 * BootProgressComponent — the staged boot screen (TASK_2026_380, component 13).
 *
 * Replaces a bare spinner that said nothing with a live region that names the
 * stage the Electron host has reached. Presentational: inputs only, no RPC and
 * no service. The one timer it owns is the elapsed-seconds clock, cleared via
 * `DestroyRef`.
 *
 * `settled` is deliberately NOT in the list — the screen is gone by then. An
 * unrecognised phase degrades to "Starting" with nothing checked, because a
 * host may skip a phase and a renderer must never gate on one it expects.
 *
 * `hostSteps` (TASK_2026_721, 11d) carries the Electron host's three boot
 * steps on from the pre-renderer window, with the same labels and figures, so
 * the first in-app frame continues the checklist the user was just watching.
 * `null` (every non-Electron host, or before the first `boot:progress`) hides it.
 */
interface BootStep {
  readonly phase: BootPhase;
  readonly label: string;
}

const BOOT_STEPS: readonly BootStep[] = [
  { phase: 'starting', label: 'Starting up' },
  { phase: 'database', label: 'Opening the database' },
  { phase: 'harness', label: 'Syncing the agent harness' },
  { phase: 'sessions', label: 'Importing sessions' },
  { phase: 'index', label: 'Indexing the workspace' },
];

/**
 * One host boot step as `BootStatusService.hostSteps()` reports it. Declared
 * structurally here because this presentation lib may not import core.
 */
export interface BootHostStep {
  readonly stepId: BootProgressStepId;
  readonly state: 'pending' | BootProgressStepState;
  readonly done?: number;
  readonly count?: number;
  readonly elapsedMs?: number;
}

/** The pre-renderer window's labels (`preparing-workspace.html`), verbatim. */
const HOST_STEP_LABELS: Record<BootProgressStepId, string> = {
  verify: 'Verify local state',
  restore: 'Restore workspace history',
  agents: 'Start agents',
};

/** Same figure the pre-renderer window shows for a finished step. */
function formatStepElapsed(ms: number): string {
  const seconds = ms / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)} s` : `${Math.round(seconds)} s`;
}

function toStagedStep(step: BootHostStep): StagedStep {
  const elapsed =
    step.state === 'done' &&
    typeof step.elapsedMs === 'number' &&
    Number.isFinite(step.elapsedMs)
      ? formatStepElapsed(Math.max(0, step.elapsedMs))
      : undefined;
  return {
    id: step.stepId,
    label: HOST_STEP_LABELS[step.stepId],
    state: step.state,
    ...(step.done === undefined || step.count === undefined
      ? {}
      : { done: step.done, total: step.count }),
    ...(elapsed === undefined ? {} : { detail: elapsed }),
  };
}

/** How often the elapsed counter is re-read. One second is all it shows. */
const ELAPSED_TICK_MS = 1000;

@Component({
  selector: 'ptah-boot-progress',
  standalone: true,
  imports: [LucideAngularModule, StagedStepsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex flex-col items-center justify-center h-full w-full gap-5 p-6"
      role="status"
      aria-live="polite"
    >
      <div class="flex flex-col items-center gap-1">
        <span class="text-lg font-semibold tracking-wide">Ptah</span>
        <span
          [class]="'text-sm ' + headlineClass()"
          data-testid="boot-headline"
        >
          {{ headline() }}
        </span>
      </div>

      @if (hostStagedSteps(); as hostSteps) {
        <ptah-staged-steps
          class="w-full max-w-xs"
          data-testid="boot-host-steps"
          [steps]="hostSteps"
          ariaLabel="Startup steps"
        />
      }

      <ol
        class="flex flex-col gap-1.5 w-full max-w-xs"
        data-testid="boot-steps"
      >
        @for (step of steps(); track step.phase) {
          <li
            [class]="
              'flex items-center gap-2 text-sm ' +
              (step.state === 'pending'
                ? 'text-base-content-muted opacity-70'
                : 'text-base-content')
            "
            [attr.data-phase]="step.phase"
            [attr.data-state]="step.state"
          >
            @if (step.state === 'done') {
              <lucide-angular
                [img]="CheckIcon"
                class="w-4 h-4 text-success shrink-0"
                aria-hidden="true"
              />
            } @else if (step.state === 'active') {
              <lucide-angular
                [img]="LoaderIcon"
                class="w-4 h-4 text-primary shrink-0 boot-spin"
                aria-hidden="true"
              />
            } @else {
              <span
                class="w-4 h-4 shrink-0 flex items-center justify-center"
                aria-hidden="true"
              >
                <span
                  class="w-1.5 h-1.5 rounded-full bg-base-content/30"
                ></span>
              </span>
            }
            <span class="flex-1 truncate">{{ step.label }}</span>
          </li>
        }
      </ol>

      @if (detail()) {
        <p
          class="text-xs text-base-content-muted max-w-sm text-center truncate"
        >
          {{ detail() }}
        </p>
      }

      <p class="text-xs text-base-content-muted" data-testid="boot-elapsed">
        {{ elapsedLabel() }}
      </p>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        width: 100%;
      }

      .boot-spin {
        animation: bootSpin 1200ms linear infinite;
      }

      @keyframes bootSpin {
        to {
          transform: rotate(360deg);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .boot-spin {
          animation: none !important;
        }
      }
    `,
  ],
})
export class BootProgressComponent {
  private readonly destroyRef = inject(DestroyRef);

  readonly phase = input.required<BootPhase>();
  readonly readiness = input.required<BackendReadiness>();
  /** Epoch ms of boot start, so elapsed time is the host's, not the view's. */
  readonly startedAt = input.required<number>();
  readonly detail = input<string | undefined>(undefined);
  /** The host's boot steps, or `null` when the host publishes none. */
  readonly hostSteps = input<readonly BootHostStep[] | null>(null);

  protected readonly CheckIcon = Check;
  protected readonly LoaderIcon = Loader;

  protected readonly hostStagedSteps = computed<readonly StagedStep[] | null>(
    () => {
      const steps = this.hostSteps();
      return steps && steps.length > 0 ? steps.map(toStagedStep) : null;
    },
  );

  private readonly now = signal<number>(Date.now());

  /** -1 when the host reports a phase this build does not know about. */
  private readonly currentIndex = computed<number>(() =>
    BOOT_STEPS.findIndex((step) => step.phase === this.phase()),
  );

  protected readonly headline = computed<string>(() => {
    const index = this.currentIndex();
    if (index === -1) return 'Starting';
    return BOOT_STEPS[index].label;
  });

  /** A degraded or failed boot is tinted, so the line is not read as normal. */
  protected readonly headlineClass = computed<string>(() => {
    const readiness = this.readiness();
    return readiness === 'failed' || readiness === 'degraded'
      ? 'text-warning'
      : 'text-base-content-muted';
  });

  protected readonly steps = computed<
    readonly (BootStep & { state: 'done' | 'active' | 'pending' })[]
  >(() => {
    const index = this.currentIndex();
    return BOOT_STEPS.map((step, position) => ({
      ...step,
      state:
        index === -1
          ? 'pending'
          : position < index
            ? 'done'
            : position === index
              ? 'active'
              : 'pending',
    }));
  });

  protected readonly elapsedLabel = computed<string>(() => {
    const elapsedMs = Math.max(0, this.now() - this.startedAt());
    return `${Math.floor(elapsedMs / 1000)}s elapsed`;
  });

  constructor() {
    const handle = setInterval(() => {
      this.now.set(Date.now());
    }, ELAPSED_TICK_MS);
    this.destroyRef.onDestroy(() => clearInterval(handle));
  }
}
