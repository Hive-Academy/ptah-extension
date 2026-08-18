import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { SPEC_ROOT } from '@ptah-extension/shared';
import { FilePathLinkComponent } from '@ptah-extension/chat-ui';
import type {
  RelayPhase,
  RelayRole,
  TribunalProgress,
  VendorLane,
} from '../types/tribunal-ui.types';

/**
 * How a phase reads on screen. This is the AC-4.2 vocabulary — four words, one
 * of which the data model deliberately does not carry.
 */
export type RelayPhaseDisplayStatus =
  | 'pending'
  | 'running'
  | 'complete'
  | 'failed';

/** Phase names, in pipeline order. Rendered, never sorted. */
const PHASE_LABEL: Record<RelayRole, string> = {
  plan: 'Plan',
  architect: 'Architect',
  implement: 'Implement',
  review: 'Review',
};

const STATUS_LABEL: Record<RelayPhaseDisplayStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  complete: 'Complete',
  failed: 'Failed',
};

/** Dot colour per display status. Literal classes so Tailwind keeps them. */
const STATUS_DOT: Record<RelayPhaseDisplayStatus, string> = {
  pending: 'bg-base-content opacity-30',
  running: 'bg-info animate-pulse',
  complete: 'bg-success',
  failed: 'bg-error',
};

/**
 * Relay's four-step phase rail (AC-4.1, AC-4.4, AC-4.5).
 *
 * ## Two arms, and no third
 *
 * Either we have a derived pipeline, or we say we cannot see one. There is no
 * arm that paints four `pending` steps from an absent reading: an all-pending
 * pipeline claims "nothing has happened yet", which is a DIFFERENT statement
 * from "we cannot tell", and the AC-4.5 defect is exactly the conflation of the
 * two (R1). A progress value of `none` or `crucible` renders nothing at all
 * rather than guessing.
 *
 * ## Exactly one running step
 *
 * {@link RelayPhase} carries no `'running'` member; liveness is the container's
 * single `runningIndex`. So the "two concurrent phases" render is unreachable
 * here by construction, not by a guard in this template (AC-4.2).
 *
 * ## Untrusted text
 *
 * Nothing in this component renders judge- or agent-authored markdown. Lane
 * names come from the user's own roster, deliverable names from the shared spec
 * contract, and the `unavailable` reason from this codebase's own strings —
 * all interpolated. No `[innerHTML]` (NFR-4).
 */
@Component({
  selector: 'ptah-relay-phase-rail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FilePathLinkComponent],
  template: `
    @if (phases(); as steps) {
      <ol
        class="flex flex-wrap items-stretch gap-2"
        data-testid="tribunal-phase-rail"
      >
        @for (step of steps; track step.phase.role; let index = $index) {
          <li
            class="flex min-w-[9rem] flex-1 flex-col gap-1 rounded-lg border border-base-300 px-3 py-2"
            data-testid="tribunal-phase-step"
            [attr.data-role]="step.phase.role"
            [attr.data-status]="step.status"
          >
            <span class="flex items-center gap-2">
              <span
                class="h-2 w-2 shrink-0 rounded-full {{
                  dotClass(step.status)
                }}"
                aria-hidden="true"
              ></span>
              <span class="text-xs font-semibold text-base-content">
                {{ index + 1 }}. {{ label(step.phase.role) }}
              </span>
              <span
                class="ml-auto text-[10px] uppercase tracking-wide text-base-content-muted"
                data-testid="tribunal-phase-status"
              >
                {{ statusLabel(step.status) }}
              </span>
            </span>

            <span
              class="truncate text-[11px] text-base-content-muted"
              data-testid="tribunal-phase-lane"
            >
              {{ step.laneName }}
            </span>

            @if (step.phase.reassignedFromLaneId; as from) {
              <span
                class="text-[11px] text-warning"
                data-testid="tribunal-phase-reassigned"
              >
                Reassigned from {{ laneName(from) }}
              </span>
            }

            @if (step.deliverablePath; as path) {
              <ptah-file-path-link
                data-testid="tribunal-phase-deliverable-link"
                [fullPath]="path"
              />
            } @else {
              <span
                class="truncate font-mono text-[10px] text-base-content-muted"
                data-testid="tribunal-phase-deliverable-name"
                [title]="
                  step.phase.deliverable +
                  ' — no spec folder was allocated, so it cannot be opened from here'
                "
              >
                {{ step.phase.deliverable }}
              </span>
            }
          </li>
        }
      </ol>
    } @else if (unavailableReason(); as reason) {
      <p
        class="flex flex-col gap-0.5 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-base-content-muted"
        data-testid="tribunal-phase-unavailable"
        role="status"
      >
        <span class="font-semibold text-base-content"
          >Phase progress unavailable</span
        >
        <span>{{ reason }}</span>
        <span>
          The panelist tiles are unaffected — this only means the pipeline
          readout cannot be derived.
        </span>
      </p>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class RelayPhaseRailComponent {
  readonly progress = input.required<TribunalProgress>();
  /** The run's roster, used to resolve a laneId to the name the user picked. */
  readonly lanes = input<readonly VendorLane[]>([]);
  /** The run's spec folder. `null` ⇒ deliverables are named but not openable. */
  readonly specTaskId = input<string | null>(null);

  /** The rendered pipeline, or `null` when there is nothing to render. */
  protected readonly phases = computed<readonly RelayStep[] | null>(() => {
    const progress = this.progress();
    if (progress.kind !== 'relay') return null;
    return progress.phases.map((phase, index) => ({
      phase,
      status: this.displayStatus(phase, index, progress.runningIndex),
      laneName: phase.laneId ? this.laneName(phase.laneId) : 'No lane assigned',
      deliverablePath: this.deliverablePath(phase.deliverable),
    }));
  });

  protected readonly unavailableReason = computed<string | null>(() => {
    const progress = this.progress();
    return progress.kind === 'unavailable' ? progress.reason : null;
  });

  protected label(role: RelayRole): string {
    return PHASE_LABEL[role];
  }

  protected statusLabel(status: RelayPhaseDisplayStatus): string {
    return STATUS_LABEL[status];
  }

  protected dotClass(status: RelayPhaseDisplayStatus): string {
    return STATUS_DOT[status];
  }

  /**
   * The lane's display name, or the raw laneId when the roster does not know it
   * (a lane the conductor spawned mid-run). Showing the id beats showing
   * nothing: it is what the `[tribunal:<laneId>]` tag says.
   */
  protected laneName(laneId: string): string {
    return (
      this.lanes().find((lane) => lane.laneId === laneId)?.displayName ?? laneId
    );
  }

  /**
   * A DELIVERED or FAILED phase keeps its own word; `runningIndex` only ever
   * promotes a `pending` one.
   *
   * Those two are facts on disk and on the agent record, while "running" is a
   * statement about right now — so a phase whose file already exists must not
   * read as still working on it.
   */
  private displayStatus(
    phase: RelayPhase,
    index: number,
    runningIndex: number | null,
  ): RelayPhaseDisplayStatus {
    if (phase.status !== 'pending') return phase.status;
    return index === runningIndex ? 'running' : 'pending';
  }

  private deliverablePath(deliverable: string): string | null {
    const taskId = this.specTaskId();
    return taskId ? `${SPEC_ROOT}/${taskId}/${deliverable}` : null;
  }
}

/** One rendered step: the derived phase plus everything the template needs. */
interface RelayStep {
  readonly phase: RelayPhase;
  readonly status: RelayPhaseDisplayStatus;
  readonly laneName: string;
  readonly deliverablePath: string | null;
}
