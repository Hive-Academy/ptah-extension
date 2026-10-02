/**
 * SessionOrganizationChipsComponent specs (TASK_2026_580 C1.1.1).
 *
 * Coverage: a deleted task folder reads "missing" (AC6), the agent badge,
 * every chip's aria label, defaults that draw nothing, and the live-phase
 * precedence (the liveness registry wins over the row snapshot).
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SessionLivenessRegistry } from '@ptah-extension/chat-state';
import {
  SESSION_ORGANIZATION_DEFAULTS,
  type ChatSessionSummary,
  type SessionId,
  type SessionOrganizationSummary,
} from '@ptah-extension/shared';
import { SessionOrganizationChipsComponent } from './session-organization-chips.component';

const SESSION_ID = 'a1b2c3d4-0000-4000-8000-000000000001';

function organization(
  overrides: Partial<SessionOrganizationSummary> = {},
): SessionOrganizationSummary {
  return {
    ...SESSION_ORGANIZATION_DEFAULTS,
    worktreePath: null,
    branch: null,
    parentSessionId: null,
    forkOfSessionId: null,
    tasks: [],
    prLinks: [],
    childCount: 0,
    updatedAt: null,
    ...overrides,
  };
}

function row(overrides: Partial<ChatSessionSummary> = {}): ChatSessionSummary {
  return {
    id: SESSION_ID as SessionId,
    name: 'Session',
    messageCount: 1,
    createdAt: 1,
    lastActivityAt: 2,
    isActive: false,
    ...overrides,
  };
}

describe('SessionOrganizationChipsComponent', () => {
  let fixture: ComponentFixture<SessionOrganizationChipsComponent>;
  let host: HTMLElement;
  let registry: SessionLivenessRegistry;

  const render = (session: ChatSessionSummary): void => {
    fixture.componentRef.setInput('session', session);
    fixture.detectChanges();
  };
  const chip = (testId: string): HTMLElement | null =>
    host.querySelector(`[data-testid="${testId}"]`);

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SessionOrganizationChipsComponent],
    });
    registry = TestBed.inject(SessionLivenessRegistry);
    fixture = TestBed.createComponent(SessionOrganizationChipsComponent);
    host = fixture.nativeElement as HTMLElement;
  });

  it('draws no organization chip for a row without organization or with defaults', () => {
    render(row());
    expect(host.querySelectorAll('li').length).toBe(0);

    render(row({ organization: organization() }));
    expect(host.querySelectorAll('li').length).toBe(0);
  });

  it('labels a missing linked task with visible text and its aria label (AC6)', () => {
    render(
      row({
        organization: organization({
          tasks: [
            {
              taskId: 'TASK_2026_100_aaaa',
              role: 'primary',
              source: 'user',
              createdAt: 1,
              missing: true,
            },
            {
              taskId: 'TASK_2026_101_bbbb',
              role: 'related',
              source: 'agent',
              createdAt: 1,
              missing: false,
            },
          ],
        }),
      }),
    );

    const tasks = host.querySelectorAll<HTMLElement>(
      '[data-testid="session-chip-task"]',
    );
    expect(tasks.length).toBe(2);
    expect(tasks[0].textContent).toContain('missing');
    expect(tasks[0].getAttribute('aria-label')).toBe(
      'Linked primary task TASK_2026_100_aaaa (missing)',
    );
    expect(tasks[1].textContent).not.toContain('missing');
    expect(tasks[1].getAttribute('aria-label')).toBe(
      'Linked related task TASK_2026_101_bbbb',
    );
  });

  it('shows the agent badge only for agent-started sessions', () => {
    render(row({ organization: organization({ startedBy: 'agent' }) }));
    expect(chip('session-chip-agent')?.getAttribute('aria-label')).toBe(
      'Started by an agent',
    );

    render(row({ organization: organization({ startedBy: 'user' }) }));
    expect(chip('session-chip-agent')).toBeNull();
  });

  it('labels priority, status, pin and PR count with text, not colour alone', () => {
    render(
      row({
        organization: organization({
          priority: 'urgent',
          status: 'in_review',
          pinned: true,
          prLinks: [
            {
              url: 'https://github.com/o/r/pull/1',
              number: 1,
              repo: 'o/r',
              state: 'open',
              source: 'user',
              createdAt: 1,
            },
          ],
        }),
      }),
    );

    const priority = chip('session-chip-priority');
    expect(priority?.getAttribute('aria-label')).toBe('Priority: Urgent');
    expect(priority?.textContent?.trim()).toBe('Urgent');
    const status = chip('session-chip-status');
    expect(status?.getAttribute('aria-label')).toBe('Status: In review');
    expect(status?.textContent?.trim()).toBe('In review');
    expect(chip('session-chip-pinned')?.getAttribute('aria-label')).toBe(
      'Pinned',
    );
    expect(chip('session-chip-pr-count')?.getAttribute('aria-label')).toBe(
      '1 pull request',
    );
  });

  it('uses the row livePhase when the registry does not track the session', () => {
    render(row({ livePhase: 'generating' }));
    const live = chip('session-chip-live');
    expect(live?.getAttribute('data-live-phase')).toBe('running');
    expect(live?.getAttribute('aria-label')).toBe('Live: Running');

    render(row({ livePhase: 'idle' }));
    expect(chip('session-chip-live')).toBeNull();
  });

  it('lets the liveness registry win over the row livePhase', () => {
    render(row({ livePhase: 'generating' }));
    registry.markFailed(SESSION_ID);
    fixture.detectChanges();
    expect(chip('session-chip-live')?.getAttribute('data-live-phase')).toBe(
      'failed',
    );

    registry.markIdle(SESSION_ID);
    fixture.detectChanges();
    expect(chip('session-chip-live')).toBeNull();
  });
});
