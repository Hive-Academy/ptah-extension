import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { GitPullRequest, LucideAngularModule } from 'lucide-angular';
import { AppStateManager } from '@ptah-extension/core';
import type {
  SessionPrLinkSummary,
  SessionTaskLinkRole,
  SessionTaskLinkSource,
  SessionTodoProgress,
  SessionTurnPhase,
  TaskLinkedSession,
} from '@ptah-extension/shared';
import { TaskAgentDiscoveryService } from '../../services/task-agent-discovery.service';
import { TaskSessionLinksService } from '../../services/task-session-links.service';

/**
 * Visible word for a session's live phase; `none` is a session not loaded in
 * this host. The same words the board card writes, so a phase reads the same
 * on the card and in the detail.
 */
const SESSION_PHASE_LABELS: Record<SessionTurnPhase | 'none', string> = {
  generating: 'running',
  'awaiting-background': 'background work',
  sleeping: 'sleeping',
  idle: 'idle',
  failed: 'failed',
  none: 'not open',
};

/**
 * Dot fill per phase, as on the board card. A secondary cue only: every dot
 * carries a base-content/70 ring (non-text contrast whatever the fill) and the
 * phase is written out beside it. `none` is hollow, so it differs by shape.
 */
const SESSION_PHASE_DOT_CLASSES: Record<SessionTurnPhase | 'none', string> = {
  generating: 'bg-info motion-safe:animate-pulse',
  'awaiting-background': 'bg-warning',
  sleeping: 'bg-secondary',
  idle: 'bg-success',
  failed: 'bg-error',
  none: 'bg-transparent',
};

const SESSION_ROLE_LABELS: Record<SessionTaskLinkRole, string> = {
  primary: 'Primary',
  related: 'Related',
};

const SESSION_SOURCE_LABELS: Record<SessionTaskLinkSource, string> = {
  'board-start': 'started from the board',
  agent: 'linked by an agent',
  user: 'linked by you',
  orchestrate: 'linked by /orchestrate',
  worktree: 'linked by its worktree',
  inherited: 'inherited from its parent or fork',
};

const NO_SESSIONS: readonly TaskLinkedSession[] = [];

/**
 * Only an `https:` URL is rendered as a link; anything else stays text. A
 * value that is not an absolute URL fails `canParse` and is not linked.
 */
function isHttpsUrl(url: string): boolean {
  return URL.canParse(url) && new URL(url).protocol === 'https:';
}

/** One PR link as the panel renders it. */
interface SessionPrRow {
  readonly url: string;
  /** `#42`, or `PR` when the URL carried no number. */
  readonly label: string;
  /** Last known state in words, or `''` when unknown. */
  readonly state: string;
  /** The link's accessible name and tooltip. */
  readonly title: string;
  /** `https:` — rendered as an external link. Otherwise shown as text only. */
  readonly linkable: boolean;
}

/** A linked session's todo progress as the panel renders it. */
interface SessionTodoRow {
  /** `done/total`. */
  readonly count: string;
  /** Label of the item in progress; null when none. */
  readonly active: string | null;
  /** Accessible name and tooltip. */
  readonly title: string;
}

/** One linked session as the panel renders it. */
interface SessionRow {
  readonly sessionId: string;
  /** The stored name, passed on to "Open session" as-is. */
  readonly name: string;
  /** The name shown: the stored one, or a placeholder when it is empty. */
  readonly displayName: string;
  readonly role: string;
  readonly source: string;
  readonly phase: SessionTurnPhase | 'none';
  readonly phaseLabel: string;
  readonly dotClass: string;
  readonly prs: readonly SessionPrRow[];
  /** The session's latest todo progress; null when none was recorded. */
  readonly todos: SessionTodoRow | null;
}

function toTodoRow(todos: SessionTodoProgress | null): SessionTodoRow | null {
  if (!todos || todos.total <= 0) return null;
  const done = `${todos.done} of ${todos.total} todos done`;
  return {
    count: `${todos.done}/${todos.total}`,
    active: todos.inProgress,
    title: todos.inProgress
      ? `${done}; in progress: ${todos.inProgress}`
      : done,
  };
}

function toPrRow(link: SessionPrLinkSummary): SessionPrRow {
  const label = link.number !== null ? `#${link.number}` : 'PR';
  const repo = link.repo ? ` in ${link.repo}` : '';
  const state = link.state ?? '';
  const linkable = isHttpsUrl(link.url);
  return {
    url: link.url,
    label,
    state,
    title: linkable
      ? `Open pull request ${label}${repo}${state ? `, ${state}` : ''} in the browser`
      : `Pull request ${label}${repo} is not linked: only https addresses open`,
    linkable,
  };
}

function toSessionRow(session: TaskLinkedSession): SessionRow {
  const phase = session.livePhase ?? 'none';
  return {
    sessionId: session.sessionId,
    name: session.name,
    displayName: session.name || 'Untitled session',
    role: SESSION_ROLE_LABELS[session.role] ?? session.role,
    source: SESSION_SOURCE_LABELS[session.source] ?? session.source,
    phase,
    phaseLabel: SESSION_PHASE_LABELS[phase],
    dotClass: SESSION_PHASE_DOT_CLASSES[phase],
    prs: session.prLinks.map(toPrRow),
    todos: toTodoRow(session.todos),
  };
}

/**
 * Activity for one task: its linked sessions with live phase, todo progress
 * and PR links (TASK_2026_580 / TASK_2026_854), and the CLI lanes the Start
 * picker offers, labelled exactly as the picker labels them
 * (`Run through codex v0.155.1.`).
 *
 * Reads the board-wide links map the Tasks surface already loaded; it never
 * fetches sessions itself. Start stays a chat prefill owned by the board.
 */
@Component({
  selector: 'ptah-task-activity',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="bg-surface-2 border border-surface-border rounded-box p-4 flex flex-col gap-3 text-sm"
      aria-labelledby="task-activity-heading"
      data-testid="task-activity"
    >
      <h3
        id="task-activity-heading"
        class="text-sm font-semibold text-base-content"
      >
        Activity
      </h3>

      <!-- The section is always present, with a quiet empty line, so the map
           arriving rewrites it in place rather than inserting a new block.
           Phase is written in words beside each dot (WCAG 1.4.1). -->
      <div class="flex flex-col gap-1" data-testid="task-detail-sessions">
        <span class="text-xs text-base-content-muted">
          Sessions ({{ sessionRows().length }})
        </span>
        @if (sessionRows().length > 0) {
          <ul class="flex flex-col gap-2">
            @for (session of sessionRows(); track session.sessionId) {
              <li
                class="flex items-start gap-2 min-w-0 text-xs"
                data-testid="task-detail-session"
                [attr.data-session-id]="session.sessionId"
              >
                <!-- base-content/70 ring: ≥3:1 against the panel in light
                     and dark (SC 1.4.11), whatever the phase fill is. -->
                <span
                  class="mt-1 inline-block w-2.5 h-2.5 shrink-0 rounded-full border border-base-content/70"
                  [class]="session.dotClass"
                  role="img"
                  [attr.aria-label]="'Live phase: ' + session.phaseLabel"
                  [title]="'Live phase: ' + session.phaseLabel"
                  data-testid="task-detail-session-dot"
                  [attr.data-phase]="session.phase"
                ></span>
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    class="truncate font-medium text-base-content"
                    [title]="session.displayName"
                    data-testid="task-detail-session-name"
                    >{{ session.displayName }}</span
                  >
                  <span
                    class="text-base-content-muted"
                    data-testid="task-detail-session-meta"
                    >{{ session.role }} · {{ session.source }} ·
                    {{ session.phaseLabel }}</span
                  >
                  @if (session.todos; as todos) {
                    <span
                      class="truncate text-base-content-muted tabular-nums"
                      [title]="todos.title"
                      [attr.aria-label]="todos.title"
                      data-testid="task-detail-session-todos"
                      >Todos {{ todos.count
                      }}{{ todos.active ? ' · ' + todos.active : '' }}</span
                    >
                  }
                  @if (session.prs.length > 0) {
                    <span
                      class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5"
                    >
                      @for (pr of session.prs; track pr.url + '|' + $index) {
                        @if (pr.linkable) {
                          <a
                            class="inline-flex items-center gap-0.5 min-h-6 rounded px-0.5 text-[color:var(--ptah-link)] underline tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                            [href]="pr.url"
                            target="_blank"
                            rel="noopener noreferrer"
                            [attr.aria-label]="pr.title"
                            [title]="pr.title"
                            data-testid="task-detail-session-pr"
                          >
                            <lucide-angular
                              [img]="GitPullRequestIcon"
                              class="w-3 h-3"
                              aria-hidden="true"
                            />
                            {{ pr.label }}{{ pr.state ? ' · ' + pr.state : '' }}
                          </a>
                        } @else {
                          <span
                            class="inline-flex items-center gap-0.5 text-base-content-muted tabular-nums"
                            [title]="pr.title"
                            data-testid="task-detail-session-pr-unlinked"
                          >
                            <lucide-angular
                              [img]="GitPullRequestIcon"
                              class="w-3 h-3"
                              aria-hidden="true"
                            />
                            {{ pr.label }} (not linked)
                          </span>
                        }
                      }
                    </span>
                  } @else {
                    <span
                      class="text-[11px] text-base-content-muted italic"
                      data-testid="task-detail-session-no-pr"
                      >No pull request</span
                    >
                  }
                </div>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                  [attr.aria-label]="'Open session ' + session.displayName"
                  [title]="'Open session ' + session.displayName"
                  data-testid="task-detail-session-open"
                  (click)="onOpenSession(session)"
                >
                  Open session
                </button>
              </li>
            }
          </ul>
        } @else {
          <span
            class="text-xs text-base-content-muted"
            data-testid="task-detail-sessions-empty"
          >
            No sessions linked to this task. Start opens a chat prompt for
            review.
          </span>
        }
      </div>

      <!-- The lanes the Start picker offers, in the picker's own words. Text,
           not a control: Start itself stays on the board card. -->
      @if (laneLabels().length > 0) {
        <div class="flex flex-col gap-1" data-testid="task-activity-lanes">
          <span class="text-xs text-base-content-muted">Start lanes</span>
          <ul class="flex flex-wrap gap-1">
            @for (lane of laneLabels(); track lane.id) {
              <li
                class="badge badge-ghost badge-sm h-auto font-mono text-base-content"
                [title]="lane.name"
                data-testid="task-activity-lane"
              >
                {{ lane.description }}
              </li>
            }
          </ul>
        </div>
      }
      <p class="text-xs text-base-content-muted">
        Optional isolated workspace in the Start picker.
      </p>
    </section>
  `,
})
export class TaskActivityComponent {
  /** Folder id of the task whose activity is shown. */
  public readonly taskId = input.required<string>();

  private readonly sessionLinks = inject(TaskSessionLinksService);
  private readonly appState = inject(AppStateManager);
  private readonly agentDiscovery = inject(TaskAgentDiscoveryService);

  public constructor() {
    // Cached for the service lifetime; a failure keeps the safe default roster.
    void this.agentDiscovery.load();
  }

  /**
   * The task's linked sessions, primary first and then newest, read from the
   * board-wide map — a `computed`, never a fetch per detail.
   */
  protected readonly sessionRows = computed<readonly SessionRow[]>(() => {
    const id = this.taskId();
    const sessions = id ? this.sessionLinks.linksFor(id) : NO_SESSIONS;
    return sessions.map(toSessionRow);
  });

  /** CLI lanes with the picker's description (`Run through codex v0.155.1.`). */
  protected readonly laneLabels = computed(() =>
    this.agentDiscovery
      .availableAgents()
      .filter((agent) => agent.category === 'lane' && !!agent.description)
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        description: agent.description ?? '',
      })),
  );

  /**
   * Hand the session to the chat lib, which switches view and opens it. A
   * session deleted since the map loaded takes the existing `switchSession`
   * error path there; nothing is checked here.
   */
  protected onOpenSession(session: SessionRow): void {
    this.appState.requestOpenSession({
      sessionId: session.sessionId,
      name: session.name,
    });
  }

  protected readonly GitPullRequestIcon = GitPullRequest;
}
