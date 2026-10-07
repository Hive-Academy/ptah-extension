/**
 * SessionOrganizationChipsComponent — the organization summary shown on one
 * sidebar session row (TASK_2026_580, plan component 11).
 *
 * Renders, in order: pin, priority, workflow status, agent badge, linked
 * tasks (a deleted task folder reads "missing", AC6) and the PR count.
 * Defaults (`normal` priority, `active` status) are not drawn: every
 * unorganized row would otherwise repeat the same two chips. The live-phase
 * marker used to render here as the first chip; it moved to
 * `SessionLivePhaseIndicatorComponent`, which the row renders as its leading
 * column, beside the session name and time.
 *
 * Colour never carries meaning alone: every chip has visible text or a
 * distinct icon shape plus an `aria-label`, and chip text stays on
 * `base-content` so it keeps contrast in both themes; the semantic colour is
 * only the tint and border.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { Bot, GitPullRequest, LucideAngularModule, Pin } from 'lucide-angular';
import type {
  ChatSessionSummary,
  SessionPriority,
  SessionWorkflowStatus,
} from '@ptah-extension/shared';
import {
  SESSION_PRIORITY_LABELS,
  SESSION_STATUS_LABELS,
} from './session-organization-labels';

const CHIP_BASE =
  'inline-flex items-center gap-1 h-4 px-1.5 rounded border text-[10px] leading-none whitespace-nowrap text-base-content';

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
  /** The sidebar row. Organization chips render only when it carries one. */
  readonly session = input.required<ChatSessionSummary>();

  protected readonly PinIcon = Pin;
  protected readonly BotIcon = Bot;
  protected readonly PrIcon = GitPullRequest;

  protected readonly organization = computed(
    () => this.session().organization ?? null,
  );

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
