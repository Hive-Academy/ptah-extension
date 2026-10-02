/**
 * SessionOrganizationChipsComponent — the organization summary shown on one
 * sidebar session row (TASK_2026_580, plan component 11).
 *
 * Renders, in order: the live-phase marker, pin, priority, workflow status,
 * agent badge, linked tasks (a deleted task folder reads "missing", AC6) and
 * the PR count. Defaults (`normal` priority, `active` status) are not drawn:
 * every unorganized row would otherwise repeat the same two chips.
 *
 * Colour never carries meaning alone: every chip has visible text or a
 * distinct icon shape plus an `aria-label`, and chip text stays on
 * `base-content` so it keeps contrast in both themes; the semantic colour is
 * only the tint and border.
 *
 * Live phase: the webview's own `SessionLivenessRegistry` wins over the row's
 * `livePhase`, because the registry is fed by the stream and the row is a
 * snapshot from the last `session:list`. One computed over the registry's
 * `statuses` signal — no subscription, timer or observer per row.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import {
  Bot,
  CircleAlert,
  GitPullRequest,
  LucideAngularModule,
  Moon,
  Pin,
} from 'lucide-angular';
import {
  SessionLivenessRegistry,
  type LivenessStatus,
} from '@ptah-extension/chat-state';
import type {
  ChatSessionSummary,
  SessionPriority,
  SessionTurnPhase,
  SessionWorkflowStatus,
} from '@ptah-extension/shared';

/** The live states a row can show. Idle shows nothing. */
export type SessionRowLivePhase = 'running' | 'background' | 'failed';

export const SESSION_PRIORITY_LABELS: Readonly<
  Record<SessionPriority, string>
> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

export const SESSION_STATUS_LABELS: Readonly<
  Record<SessionWorkflowStatus, string>
> = {
  active: 'Active',
  waiting: 'Waiting',
  in_review: 'In review',
  done: 'Done',
  archived: 'Archived',
};

const LIVE_PHASE_LABELS: Readonly<Record<SessionRowLivePhase, string>> = {
  running: 'Running',
  background: 'Waiting on background work',
  failed: 'Last run failed',
};

const CHIP_BASE =
  'inline-flex items-center gap-1 h-5 px-1.5 rounded border text-[11px] leading-none whitespace-nowrap text-base-content';

const PRIORITY_TINT: Readonly<Record<SessionPriority, string>> = {
  urgent: 'border-error/60 bg-error/15',
  high: 'border-warning/70 bg-warning/15',
  normal: 'border-base-content/20 bg-base-content/5',
  low: 'border-base-content/20 bg-base-content/5',
};

const STATUS_TINT: Readonly<Record<SessionWorkflowStatus, string>> = {
  active: 'border-base-content/20 bg-base-content/5',
  waiting: 'border-warning/70 bg-warning/15',
  in_review: 'border-info/60 bg-info/15',
  done: 'border-success/60 bg-success/15',
  archived: 'border-base-content/20 bg-base-content/5',
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
  selector: 'ptah-session-organization-chips',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul
      class="flex flex-wrap items-center gap-1 min-w-0"
      aria-label="Session organization"
      data-testid="session-organization-chips"
    >
      @if (livePhase(); as phase) {
        <li
          class="inline-flex items-center justify-center w-4 h-4"
          [attr.aria-label]="'Live: ' + livePhaseLabel()"
          [title]="livePhaseLabel()"
          [attr.data-live-phase]="phase"
          data-testid="session-chip-live"
        >
          @switch (phase) {
            @case ('running') {
              <!-- The ring carries the contrast (task-card dots, C2.2): a
                   theme fill alone fell to 1.25:1 on the light sidebar. -->
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
        </li>
      }

      @if (organization(); as org) {
        @if (org.pinned) {
          <li
            class="inline-flex items-center justify-center w-4 h-4 text-base-content"
            aria-label="Pinned"
            title="Pinned"
            data-testid="session-chip-pinned"
          >
            <lucide-angular
              [img]="PinIcon"
              class="w-3 h-3"
              aria-hidden="true"
            />
          </li>
        }

        @if (org.priority !== 'normal') {
          <li
            [class]="priorityClasses()"
            [attr.aria-label]="'Priority: ' + priorityLabel()"
            data-testid="session-chip-priority"
          >
            {{ priorityLabel() }}
          </li>
        }

        @if (org.status !== 'active') {
          <li
            [class]="statusClasses()"
            [attr.aria-label]="'Status: ' + statusLabel()"
            data-testid="session-chip-status"
          >
            {{ statusLabel() }}
          </li>
        }

        @if (org.startedBy === 'agent') {
          <li
            class="${CHIP_BASE} border-base-content/20 bg-base-content/5"
            aria-label="Started by an agent"
            title="Started by an agent"
            data-testid="session-chip-agent"
          >
            <lucide-angular
              [img]="BotIcon"
              class="w-3 h-3"
              aria-hidden="true"
            />
            Agent
          </li>
        }

        @for (task of org.tasks; track task.taskId) {
          <li
            class="${CHIP_BASE} max-w-[12rem]"
            [class.border-base-content/20]="!task.missing"
            [class.bg-base-content/5]="!task.missing"
            [class.border-dashed]="task.missing"
            [class.border-base-content/40]="task.missing"
            [attr.aria-label]="taskLabel(task.taskId, task.role, task.missing)"
            [title]="taskLabel(task.taskId, task.role, task.missing)"
            [attr.data-missing]="task.missing"
            data-testid="session-chip-task"
          >
            <span class="truncate" [class.line-through]="task.missing">{{
              task.taskId
            }}</span>
            @if (task.missing) {
              <span class="text-base-content-muted">missing</span>
            }
          </li>
        }

        @if (org.prLinks.length > 0) {
          <li
            class="${CHIP_BASE} border-base-content/20 bg-base-content/5 tabular-nums"
            [attr.aria-label]="prCountLabel()"
            [title]="prCountLabel()"
            data-testid="session-chip-pr-count"
          >
            <lucide-angular [img]="PrIcon" class="w-3 h-3" aria-hidden="true" />
            {{ org.prLinks.length }}
          </li>
        }
      }
    </ul>
  `,
})
export class SessionOrganizationChipsComponent {
  private readonly liveness = inject(SessionLivenessRegistry);

  /** The sidebar row. Organization chips render only when it carries one. */
  readonly session = input.required<ChatSessionSummary>();

  protected readonly MoonIcon = Moon;
  protected readonly FailedIcon = CircleAlert;
  protected readonly PinIcon = Pin;
  protected readonly BotIcon = Bot;
  protected readonly PrIcon = GitPullRequest;

  protected readonly organization = computed(
    () => this.session().organization ?? null,
  );

  /** Registry first (live), then the row snapshot. */
  readonly livePhase = computed<SessionRowLivePhase | null>(() => {
    const session = this.session();
    const tracked = this.liveness.statuses().get(session.id);
    return tracked !== undefined
      ? fromLiveness(tracked)
      : fromTurnPhase(session.livePhase);
  });

  protected readonly livePhaseLabel = computed(() => {
    const phase = this.livePhase();
    return phase ? LIVE_PHASE_LABELS[phase] : '';
  });

  protected readonly priorityLabel = computed(() => {
    const org = this.organization();
    return org ? SESSION_PRIORITY_LABELS[org.priority] : '';
  });

  protected readonly statusLabel = computed(() => {
    const org = this.organization();
    return org ? SESSION_STATUS_LABELS[org.status] : '';
  });

  protected readonly priorityClasses = computed(() => {
    const org = this.organization();
    return org ? `${CHIP_BASE} ${PRIORITY_TINT[org.priority]}` : CHIP_BASE;
  });

  protected readonly statusClasses = computed(() => {
    const org = this.organization();
    return org ? `${CHIP_BASE} ${STATUS_TINT[org.status]}` : CHIP_BASE;
  });

  protected readonly prCountLabel = computed(() => {
    const count = this.organization()?.prLinks.length ?? 0;
    return count === 1 ? '1 pull request' : `${count} pull requests`;
  });

  protected taskLabel(
    taskId: string,
    role: 'primary' | 'related',
    missing: boolean,
  ): string {
    const roleText = role === 'primary' ? 'primary task' : 'related task';
    return `Linked ${roleText} ${taskId}${missing ? ' (missing)' : ''}`;
  }
}
