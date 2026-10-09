/**
 * SessionLivePhaseIndicatorComponent — the live-phase marker for one sidebar
 * session row, extracted from `SessionOrganizationChipsComponent` (which used
 * to render it as its first chip) so the row can place it in its leading
 * column, beside the session name and time, instead of under them.
 *
 * Shows a pulsing dot (running), a moon (waiting on background work) or an
 * alert icon (last run failed). Idle shows nothing: the host is `invisible`
 * but stays mounted. The sidebar row positions this host out of flow, in the
 * list padding, so the dot never shifts the title, time or chips.
 *
 * Live phase: the webview's own `SessionLivenessRegistry` wins over the row's
 * `livePhase`, because the registry is fed by the stream and the row is a
 * snapshot from the last `session:list`. One computed over the registry's
 * `statuses` signal — no subscription, timer or observer per row.
 *
 * Colour never carries meaning alone: the marker keeps its `aria-label` and
 * `title`, and the running ring carries the contrast (task-card dots, C2.2):
 * a theme fill alone fell to 1.25:1 on the light sidebar.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { CircleAlert, LucideAngularModule, Moon } from 'lucide-angular';
import {
  SessionLivenessRegistry,
  type LivenessStatus,
} from '@ptah-extension/chat-state';
import type {
  ChatSessionSummary,
  SessionTurnPhase,
} from '@ptah-extension/shared';

/** The live states a row can show. Idle shows nothing. */
export type SessionRowLivePhase = 'running' | 'background' | 'failed';

const LIVE_PHASE_LABELS: Readonly<Record<SessionRowLivePhase, string>> = {
  running: 'Running',
  background: 'Waiting on background work',
  failed: 'Last run failed',
};

function fromLiveness(status: LivenessStatus): SessionRowLivePhase | null {
  switch (status) {
    case 'streaming':
      return 'running';
    case 'awaiting-background':
      return 'background';
    case 'failed':
      return 'failed';
    default:
      return null;
  }
}

function fromTurnPhase(
  phase: SessionTurnPhase | undefined,
): SessionRowLivePhase | null {
  switch (phase) {
    case 'generating':
      return 'running';
    case 'awaiting-background':
    case 'sleeping':
      return 'background';
    case 'failed':
      return 'failed';
    default:
      return null;
  }
}

@Component({
  selector: 'ptah-session-live-phase-indicator',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'img',
    class: 'shrink-0 inline-flex items-center justify-center w-4 h-4',
    '[class.invisible]': 'livePhase() === null',
    '[attr.aria-label]': 'ariaLabel()',
    '[attr.title]': 'livePhaseLabel()',
    '[attr.data-live-phase]': 'livePhase()',
    'data-testid': 'session-chip-live',
  },
  template: `
    @switch (livePhase()) {
      @case ('running') {
        <span
          class="w-2.5 h-2.5 rounded-full border border-base-content/70 bg-info motion-safe:animate-pulse"
          aria-hidden="true"
        ></span>
      }
      @case ('background') {
        <lucide-angular
          [img]="MoonIcon"
          class="w-3 h-3 text-base-content-muted"
          aria-hidden="true"
        />
      }
      @case ('failed') {
        <lucide-angular
          [img]="FailedIcon"
          class="w-3 h-3 text-error"
          aria-hidden="true"
        />
      }
    }
  `,
})
export class SessionLivePhaseIndicatorComponent {
  private readonly liveness = inject(SessionLivenessRegistry);

  /** The sidebar row. */
  readonly session = input.required<ChatSessionSummary>();

  protected readonly MoonIcon = Moon;
  protected readonly FailedIcon = CircleAlert;

  /** Registry first (live), then the row snapshot. */
  readonly livePhase = computed<SessionRowLivePhase | null>(() => {
    const session = this.session();
    const tracked = this.liveness.statuses().get(session.id);
    return tracked !== undefined
      ? fromLiveness(tracked)
      : fromTurnPhase(session.livePhase);
  });

  protected readonly livePhaseLabel = computed<string | null>(() => {
    const phase = this.livePhase();
    return phase ? LIVE_PHASE_LABELS[phase] : null;
  });

  protected readonly ariaLabel = computed<string | null>(() => {
    const label = this.livePhaseLabel();
    return label ? `Live: ${label}` : null;
  });
}
